"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ============================================================
// ITEM KONSINYASI (IK) — dokumen pengiriman fisik barang Consignment dari
// satu gudang ke gudang lain (Gd Asal -> Gd Tujuan) dengan No AWB.
//
// BEDA dari SO Consignment induknya (murni pencatatan, tanpa gerak stok &
// tanpa approval): IK BENAR-BENAR memindahkan stok — potong stok Gd Asal,
// tambah stok Gd Tujuan — satu langkah begitu disimpan, TANPA approval.
// Mengikuti pola stock_movements yang sama dengan Delivery/Item Transfer,
// cuma pakai type 'IK'.
//
// Satu item SO Consignment BISA dikirim lewat lebih dari satu IK (partial
// shipment) — divalidasi terhadap SISA qty yang belum dikirim (qty SO
// dikurangi total qty yang sudah tercatat di IK lain utk item yg sama).
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

export type ConsignmentIkItemInput = {
  so_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  part_number_customer?: string;
  satuan: string;
  qty: number;
};

/**
 * Sisa qty tiap item SO Consignment yang belum dikirim lewat IK manapun
 * (qty SO - total qty yang sudah tercatat di consignment_ik_items).
 * Dipakai form create IK utk cap input & guard race-condition di server.
 */
export async function getConsignmentSoRemainingToShip(soId: number) {
  const supabase = await createClient();

  const { data: soItems, error: soItemsError } = await supabase
    .from("consignment_so_items")
    .select("id, part_id, part_number, part_name, part_number_customer, satuan, qty")
    .eq("so_id", soId);
  if (soItemsError) return { data: [], error: soItemsError.message };

  const soItemIds = (soItems || []).map((i) => i.id);
  const shippedByItem = new Map<number, number>();
  if (soItemIds.length > 0) {
    const { data: ikItems } = await supabase
      .from("consignment_ik_items")
      .select("so_item_id, qty")
      .in("so_item_id", soItemIds);
    for (const row of ikItems || []) {
      shippedByItem.set(
        row.so_item_id,
        (shippedByItem.get(row.so_item_id) || 0) + row.qty,
      );
    }
  }

  const data = (soItems || []).map((item) => ({
    ...item,
    qty_shipped: shippedByItem.get(item.id) || 0,
    qty_remaining: Math.max(0, Number(item.qty) - (shippedByItem.get(item.id) || 0)),
  }));
  return { data, error: null as string | null };
}

/**
 * Stok fisik tiap part di gudang asal — dipakai form create IK utk
 * menampilkan & membatasi qty kirim sesuai stok yang benar-benar ada
 * (bukan cuma sisa qty SO).
 */
export async function getStockByCabang(cabangId: number, partIds: number[]) {
  const supabase = await createClient();
  if (!partIds || partIds.length === 0) return { data: [], error: null as string | null };

  const { data, error } = await supabase
    .from("stock")
    .select("part_id, qty")
    .eq("cabang_id", cabangId)
    .in("part_id", partIds);
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

export async function createConsignmentIk(data: {
  ik_tanggal: string;
  so_id: number;
  dari_cabang_id: number;
  ke_cabang_id: number;
  no_awb?: string;
  no_po?: string;
  remarks?: string;
  items: ConsignmentIkItemInput[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };
  if (data.dari_cabang_id === data.ke_cabang_id)
    return { error: "Gudang asal dan tujuan tidak boleh sama." };

  for (const item of data.items) {
    if (!item.qty || item.qty <= 0)
      return { error: `${item.part_number}: qty harus lebih dari 0.` };
  }

  // Guard sisa qty (race-safe — ambil ulang dari DB, bukan percaya payload client).
  const soItemIds = data.items.map((i) => i.so_item_id);
  const { data: soItemRows } = await supabase
    .from("consignment_so_items")
    .select("id, part_number, qty")
    .in("id", soItemIds);
  const soItemById = new Map((soItemRows || []).map((r: any) => [r.id, r]));

  const { data: existingIkItems } = await supabase
    .from("consignment_ik_items")
    .select("so_item_id, qty")
    .in("so_item_id", soItemIds);
  const shippedByItem = new Map<number, number>();
  for (const row of existingIkItems || []) {
    shippedByItem.set(
      row.so_item_id,
      (shippedByItem.get(row.so_item_id) || 0) + row.qty,
    );
  }

  const qtyViolations: string[] = [];
  for (const item of data.items) {
    const soItem = soItemById.get(item.so_item_id);
    if (!soItem) {
      qtyViolations.push(`${item.part_number}: item SO tidak ditemukan.`);
      continue;
    }
    const alreadyShipped = shippedByItem.get(item.so_item_id) || 0;
    const remaining = Number(soItem.qty) - alreadyShipped;
    if (item.qty > remaining) {
      qtyViolations.push(
        `${item.part_number}: sisa yang belum dikirim ${remaining}, diminta ${item.qty}.`,
      );
    }
  }
  if (qtyViolations.length > 0)
    return { error: "Qty melebihi sisa yang belum dikirim:\n" + qtyViolations.join("\n") };

  // Guard stok gudang asal.
  const stockViolations: string[] = [];
  for (const item of data.items) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", data.dari_cabang_id)
      .maybeSingle();
    const avail = srcStock?.qty ?? 0;
    if (item.qty > avail) {
      stockViolations.push(`${item.part_number}: stok gudang asal ${avail}, diminta ${item.qty}.`);
    }
  }
  if (stockViolations.length > 0)
    return { error: "Stok gudang asal tidak mencukupi:\n" + stockViolations.join("\n") };

  // Generate kode IK lewat SEQUENCE Postgres (nextval, atomik) -- dijamin
  // tidak akan pernah menghasilkan kode yang sama meski dipanggil nyaris
  // bersamaan dari banyak request sekaligus (race-safe di level DB, beda
  // dari pola "cek-lalu-insert" di aplikasi yang punya celah race).
  const { data: generatedKode, error: kodeError } = await supabase.rpc(
    "generate_consignment_ik_kode",
  );
  if (kodeError || !generatedKode)
    return { error: kodeError?.message || "Gagal membuat kode IK." };
  const ikKode = generatedKode as string;

  // Insert header
  const { data: ik, error: ikError } = await supabase
    .from("consignment_ik")
    .insert([
      {
        ik_kode: ikKode,
        ik_tanggal: data.ik_tanggal,
        so_id: data.so_id,
        dari_cabang_id: data.dari_cabang_id,
        ke_cabang_id: data.ke_cabang_id,
        no_awb: data.no_awb?.trim() || null,
        no_po: data.no_po?.trim() || null,
        remarks: data.remarks?.trim() || null,
        created_by: user.id,
      },
    ])
    .select()
    .single();
  if (ikError) return { error: ikError.message };

  const itemsToInsert = data.items.map((item) => ({
    ik_id: ik.id,
    so_item_id: item.so_item_id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    part_number_customer: item.part_number_customer?.trim() || null,
    satuan: item.satuan,
    qty: item.qty,
  }));
  const { error: itemsError } = await supabase
    .from("consignment_ik_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Pindahkan stok: potong gudang asal, tambah gudang tujuan — instan,
  // tanpa approval (beda dari Delivery/Item Transfer yang butuh finalize).
  for (const item of data.items) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", data.dari_cabang_id)
      .maybeSingle();
    if (srcStock) {
      await supabase
        .from("stock")
        .update({ qty: srcStock.qty - item.qty })
        .eq("id", srcStock.id);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: data.dari_cabang_id,
      qty_change: -item.qty,
      type: "IK",
      reference_id: ikKode,
      created_by: user.id,
      notes: `IK ${ikKode}: ${item.part_number} ${item.part_name} keluar dari gudang asal (consignment)`,
    });

    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", data.ke_cabang_id)
      .maybeSingle();
    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty + item.qty })
        .eq("id", destStock.id);
    } else {
      await supabase
        .from("stock")
        .insert([{ part_id: item.part_id, cabang_id: data.ke_cabang_id, qty: item.qty }]);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: data.ke_cabang_id,
      qty_change: item.qty,
      type: "IK",
      reference_id: ikKode,
      created_by: user.id,
      notes: `IK ${ikKode}: ${item.part_number} ${item.part_name} masuk ke gudang tujuan (consignment)`,
    });
  }

  revalidatePath("/so-reguler/consignment/ik");
  revalidatePath("/so-reguler/consignment/dashboard");
  revalidatePath("/stock");
  return { success: true, data: ik };
}

export async function getConsignmentIkList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consignment_ik")
    .select(
      "*, so:consignment_so(so_no), cabang_asal:cabang!consignment_ik_dari_cabang_id_fkey(nama_cabang), cabang_tujuan:cabang!consignment_ik_ke_cabang_id_fkey(nama_cabang), consignment_ik_items(id, part_number, part_name, qty, satuan)",
    )
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

/**
 * Hapus IK (moderator/admin) — membalikkan stok (kembalikan ke gudang asal,
 * kurangi dari gudang tujuan) sebelum menghapus dokumennya. Jaring pengaman
 * karena IK memindahkan stok sungguhan tanpa approval.
 */
export async function deleteConsignmentIk(ikId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await getRoleNames(supabase, user.id);
  if (!roleNames.some((r) => r === "moderator" || r === "admin")) {
    return { error: "Hanya moderator/admin yang dapat menghapus IK." };
  }

  const { data: ik } = await supabase
    .from("consignment_ik")
    .select("id, ik_kode, dari_cabang_id, ke_cabang_id")
    .eq("id", ikId)
    .single();
  if (!ik) return { error: "IK tidak ditemukan." };

  const { data: items } = await supabase
    .from("consignment_ik_items")
    .select("part_id, part_number, part_name, qty")
    .eq("ik_id", ikId);

  for (const item of items || []) {
    // Balikin ke gudang asal.
    const { data: srcStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", ik.dari_cabang_id)
      .maybeSingle();
    if (srcStock) {
      await supabase
        .from("stock")
        .update({ qty: srcStock.qty + item.qty })
        .eq("id", srcStock.id);
    } else {
      await supabase
        .from("stock")
        .insert([{ part_id: item.part_id, cabang_id: ik.dari_cabang_id, qty: item.qty }]);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: ik.dari_cabang_id,
      qty_change: item.qty,
      type: "IK",
      reference_id: ik.ik_kode,
      created_by: user.id,
      notes: `Pembatalan IK ${ik.ik_kode}: ${item.part_number} ${item.part_name} dikembalikan ke gudang asal`,
    });

    // Kurangi dari gudang tujuan.
    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", ik.ke_cabang_id)
      .maybeSingle();
    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty - item.qty })
        .eq("id", destStock.id);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: ik.ke_cabang_id,
      qty_change: -item.qty,
      type: "IK",
      reference_id: ik.ik_kode,
      created_by: user.id,
      notes: `Pembatalan IK ${ik.ik_kode}: ${item.part_number} ${item.part_name} dikeluarkan dari gudang tujuan`,
    });
  }

  const { error } = await supabase.from("consignment_ik").delete().eq("id", ikId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/consignment/ik");
  revalidatePath("/so-reguler/consignment/dashboard");
  revalidatePath("/stock");
  return { success: true };
}
