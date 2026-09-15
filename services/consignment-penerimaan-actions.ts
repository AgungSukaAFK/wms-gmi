"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ============================================================
// PENERIMAAN KONSINYASI — konfirmasi customer atas satu IK (staff internal
// yang input atas nama customer, belum ada login customer di sistem ini).
//
// qty_terima SELALU dianggap sudah berpindah fisik ke customer (dikurangi
// dari stok gudang tujuan IK, ditambahkan ke customer_stock) — terlepas
// dari status ('sesuai'/'komplain'). Selisih qty_kirim - qty_terima TETAP
// di stok gudang tujuan, belum jadi tanggungan customer, ditindaklanjuti
// manual (redelivery via IK baru, dst).
//
// Satu IK cuma boleh punya SATU penerimaan (UNIQUE ik_id di DB).
// ============================================================

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

export type ConsignmentPenerimaanItemInput = {
  ik_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty_kirim: number;
  qty_terima: number;
  status: "sesuai" | "komplain";
  catatan_komplain?: string;
};

/**
 * Daftar IK yang belum punya dokumen penerimaan — dipakai picker di form
 * create Penerimaan.
 */
export async function getIkPendingPenerimaan() {
  const supabase = await createClient();

  const { data: iks, error } = await supabase
    .from("consignment_ik")
    .select(
      "id, ik_kode, ik_tanggal, no_awb, so:consignment_so(so_no, customer:customers!customer_id(customer_name)), cabang_tujuan:cabang!consignment_ik_ke_cabang_id_fkey(nama_cabang), consignment_ik_items(id)",
    )
    .order("ik_tanggal", { ascending: false });
  if (error) return { data: [], error: error.message };

  const { data: existing } = await supabase
    .from("consignment_penerimaan")
    .select("ik_id");
  const doneIkIds = new Set((existing || []).map((r: any) => r.ik_id));

  const pending = (iks || []).filter((ik: any) => !doneIkIds.has(ik.id));
  return { data: pending, error: null as string | null };
}

/**
 * Detail satu IK + itemnya, dipakai form create Penerimaan setelah IK dipilih.
 */
export async function getIkForPenerimaan(ikId: number) {
  const supabase = await createClient();
  const { data: ik, error } = await supabase
    .from("consignment_ik")
    .select(
      "id, ik_kode, so_id, so:consignment_so(customer_id), consignment_ik_items(id, part_id, part_number, part_name, satuan, qty)",
    )
    .eq("id", ikId)
    .single();
  if (error || !ik) return { data: null, error: error?.message || "IK tidak ditemukan." };

  const { data: existing } = await supabase
    .from("consignment_penerimaan")
    .select("id")
    .eq("ik_id", ikId)
    .maybeSingle();
  if (existing)
    return { data: null, error: "IK ini sudah punya dokumen penerimaan." };

  return { data: ik, error: null as string | null };
}

export async function createConsignmentPenerimaan(data: {
  penerimaan_kode: string;
  tanggal_terima: string;
  ik_id: number;
  nama_penerima: string;
  catatan?: string;
  items: ConsignmentPenerimaanItemInput[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const kode = data.penerimaan_kode?.trim();
  if (!kode) return { error: "No. Penerimaan wajib diisi." };
  if (!data.nama_penerima?.trim())
    return { error: "Nama penerima wajib diisi." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };

  for (const item of data.items) {
    if (item.qty_terima < 0 || item.qty_terima > item.qty_kirim)
      return {
        error: `${item.part_number}: qty terima harus antara 0 - ${item.qty_kirim}.`,
      };
    if (item.status === "komplain" && !item.catatan_komplain?.trim())
      return { error: `${item.part_number}: catatan komplain wajib diisi.` };
  }

  const { data: dupe } = await supabase
    .from("consignment_penerimaan")
    .select("id")
    .eq("penerimaan_kode", kode)
    .maybeSingle();
  if (dupe) return { error: "No. Penerimaan sudah digunakan. Gunakan kode lain." };

  const { data: ik, error: ikError } = await supabase
    .from("consignment_ik")
    .select("id, ik_kode, ke_cabang_id, so:consignment_so(customer_id)")
    .eq("id", data.ik_id)
    .single();
  if (ikError || !ik) return { error: "IK tidak ditemukan." };

  const { data: existingPenerimaan } = await supabase
    .from("consignment_penerimaan")
    .select("id")
    .eq("ik_id", data.ik_id)
    .maybeSingle();
  if (existingPenerimaan)
    return { error: "IK ini sudah punya dokumen penerimaan." };

  const customerId = (ik as any).so?.customer_id;
  if (!customerId) return { error: "SO pada IK ini tidak punya customer." };

  const { data: header, error: headerError } = await supabase
    .from("consignment_penerimaan")
    .insert([
      {
        penerimaan_kode: kode,
        tanggal_terima: data.tanggal_terima,
        ik_id: data.ik_id,
        customer_id: customerId,
        nama_penerima: data.nama_penerima.trim(),
        catatan: data.catatan?.trim() || null,
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (headerError) return { error: headerError.message };

  const itemsToInsert = data.items.map((item) => ({
    penerimaan_id: header.id,
    ik_item_id: item.ik_item_id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty_kirim: item.qty_kirim,
    qty_terima: item.qty_terima,
    status: item.status,
    catatan_komplain: item.status === "komplain" ? item.catatan_komplain!.trim() : null,
    resolution_status: item.status === "komplain" ? "open" : null,
  }));
  const { error: itemsError } = await supabase
    .from("consignment_penerimaan_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Pindahkan qty_terima: kurangi stok gudang tujuan IK, tambahkan ke
  // customer_stock. Selisih (qty_kirim - qty_terima) sengaja dibiarkan di
  // stok gudang tujuan.
  for (const item of data.items) {
    if (item.qty_terima <= 0) continue;

    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", ik.ke_cabang_id)
      .maybeSingle();
    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty - item.qty_terima })
        .eq("id", destStock.id);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: ik.ke_cabang_id,
      qty_change: -item.qty_terima,
      type: "PENERIMAAN_KONSINYASI",
      reference_id: kode,
      created_by: user.id,
      notes: `Penerimaan ${kode} (IK ${ik.ik_kode}): ${item.part_number} ${item.part_name} diterima customer`,
    });

    const { data: custStock } = await supabase
      .from("customer_stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (custStock) {
      await supabase
        .from("customer_stock")
        .update({ qty: custStock.qty + item.qty_terima })
        .eq("id", custStock.id);
    } else {
      await supabase
        .from("customer_stock")
        .insert([{ part_id: item.part_id, customer_id: customerId, qty: item.qty_terima }]);
    }
  }

  revalidatePath("/so-reguler/consignment/penerimaan");
  revalidatePath("/so-reguler/consignment/customer-stock");
  revalidatePath("/stock");
  return { success: true, data: header };
}

export async function getConsignmentPenerimaanList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consignment_penerimaan")
    .select(
      "*, customer:customers(customer_name), ik:consignment_ik(ik_kode, no_awb), consignment_penerimaan_items(id, part_number, part_name, satuan, qty_kirim, qty_terima, status, catatan_komplain, resolution_status, catatan_resolusi)",
    )
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

/**
 * Tandai satu baris komplain selesai ditindaklanjuti (manual, tanpa approval).
 */
export async function resolveComplaintItem(itemId: number, catatanResolusi: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const { error } = await supabase
    .from("consignment_penerimaan_items")
    .update({
      resolution_status: "selesai",
      catatan_resolusi: catatanResolusi?.trim() || null,
    })
    .eq("id", itemId)
    .eq("status", "komplain");
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/consignment/penerimaan");
  return { success: true };
}

/**
 * Hapus Penerimaan (moderator/admin) — membalikkan stok (kembalikan ke
 * gudang tujuan IK, kurangi dari customer_stock) sebelum menghapus
 * dokumennya. Safety valve, sama seperti deleteConsignmentIk.
 */
export async function deleteConsignmentPenerimaan(penerimaanId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await getRoleNames(supabase, user.id);
  if (!roleNames.some((r) => r === "moderator" || r === "admin")) {
    return { error: "Hanya moderator/admin yang dapat menghapus Penerimaan." };
  }

  const { data: penerimaan } = await supabase
    .from("consignment_penerimaan")
    .select("id, penerimaan_kode, customer_id, ik:consignment_ik(ik_kode, ke_cabang_id)")
    .eq("id", penerimaanId)
    .single();
  if (!penerimaan) return { error: "Penerimaan tidak ditemukan." };

  const keCabangId = (penerimaan as any).ik?.ke_cabang_id;
  const ikKode = (penerimaan as any).ik?.ik_kode;

  const { data: items } = await supabase
    .from("consignment_penerimaan_items")
    .select("part_id, part_number, part_name, qty_terima")
    .eq("penerimaan_id", penerimaanId);

  for (const item of items || []) {
    if (item.qty_terima <= 0) continue;

    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", keCabangId)
      .maybeSingle();
    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty + item.qty_terima })
        .eq("id", destStock.id);
    } else {
      await supabase
        .from("stock")
        .insert([{ part_id: item.part_id, cabang_id: keCabangId, qty: item.qty_terima }]);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: keCabangId,
      qty_change: item.qty_terima,
      type: "PENERIMAAN_KONSINYASI",
      reference_id: penerimaan.penerimaan_kode,
      created_by: user.id,
      notes: `Pembatalan Penerimaan ${penerimaan.penerimaan_kode} (IK ${ikKode}): ${item.part_number} ${item.part_name} dikembalikan ke gudang tujuan`,
    });

    const { data: custStock } = await supabase
      .from("customer_stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("customer_id", penerimaan.customer_id)
      .maybeSingle();
    if (custStock) {
      await supabase
        .from("customer_stock")
        .update({ qty: custStock.qty - item.qty_terima })
        .eq("id", custStock.id);
    }
  }

  const { error } = await supabase
    .from("consignment_penerimaan")
    .delete()
    .eq("id", penerimaanId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/consignment/penerimaan");
  revalidatePath("/so-reguler/consignment/customer-stock");
  revalidatePath("/stock");
  return { success: true };
}

export async function getCustomerStockList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_customer_stock")
    .select("*")
    .order("customer_name")
    .order("part_number");
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}
