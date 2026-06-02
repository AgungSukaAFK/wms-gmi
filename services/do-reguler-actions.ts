"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const TRACKING_ORDER = [
  "created",
  "packing",
  "ready_pickup",
  "in_transit",
  "delivered",
];

type DoItemInput = {
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
};

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (roleRows || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

/**
 * BUAT DO REGULER
 *
 * Tanpa approval. Stok langsung keluar dari gudang pengirim saat dibuat
 * (standar DO / penjualan keluar ke customer).
 */
export async function createDoReguler(data: {
  do_kode: string;
  do_tanggal: string;
  dari_cabang_id: number;
  customer_id: number;
  kode_po?: string;
  shipment_type?: string;
  ekspedisi?: string;
  sender_name?: string;
  eksternal_provider?: string;
  eksternal_id?: string;
  jumlah_koli?: number;
  no_resi?: string;
  estimasi_hari?: number;
  pic?: string;
  remarks?: string;
  items: DoItemInput[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const doKode = data.do_kode?.trim();
  if (!doKode) return { error: "Kode DO Reguler wajib diisi." };
  if (!data.dari_cabang_id) return { error: "Gudang pengirim wajib diketahui." };
  if (!data.customer_id) return { error: "Customer tujuan wajib dipilih." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };

  // Kode unik
  const { data: existing } = await supabase
    .from("do_reguler")
    .select("id")
    .eq("do_kode", doKode)
    .maybeSingle();
  if (existing)
    return { error: "Kode DO Reguler sudah digunakan. Gunakan kode lain." };

  // Validasi qty <= stok gudang pengirim
  const partIds = data.items.map((i) => i.part_id);
  const { data: stockRows } = await supabase
    .from("stock")
    .select("part_id, qty")
    .eq("cabang_id", data.dari_cabang_id)
    .in("part_id", partIds);
  const stockMap = new Map(
    (stockRows || []).map((s: any) => [s.part_id, s.qty]),
  );
  const violations: string[] = [];
  for (const item of data.items) {
    const avail = (stockMap.get(item.part_id) as number) ?? 0;
    if (item.qty <= 0) violations.push(`${item.part_number}: qty harus > 0`);
    else if (item.qty > avail)
      violations.push(`${item.part_number}: minta ${item.qty}, stok ${avail}`);
  }
  if (violations.length > 0)
    return {
      error: "Qty melebihi stok gudang pengirim:\n" + violations.join("\n"),
    };

  // Insert header
  const { data: doRow, error: doError } = await supabase
    .from("do_reguler")
    .insert([
      {
        do_kode: doKode,
        do_tanggal: data.do_tanggal,
        dari_cabang_id: data.dari_cabang_id,
        customer_id: data.customer_id,
        kode_po: data.kode_po?.trim() || null,
        shipment_type: data.shipment_type || "ekspedisi_laut",
        ekspedisi: data.ekspedisi || null,
        sender_name: data.sender_name || null,
        eksternal_provider: data.eksternal_provider || null,
        eksternal_id: data.eksternal_id || null,
        jumlah_koli: data.jumlah_koli ?? 1,
        no_resi: data.no_resi || null,
        estimasi_hari: data.estimasi_hari ?? 1,
        pic: data.pic || null,
        remarks: data.remarks || null,
        uid_requester: user.id,
        created_by: user.id,
        status: "active",
        tracking_status: "created",
        stock_released: false,
      },
    ])
    .select()
    .single();
  if (doError) return { error: doError.message };

  // Insert items
  const itemsToInsert = data.items.map((item) => ({
    do_id: doRow.id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
  }));
  const { error: itemsError } = await supabase
    .from("do_reguler_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Keluarkan stok dari gudang pengirim (langsung)
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
      type: "DO_REG",
      reference_id: doKode,
      created_by: user.id,
      notes: `DO Reguler ${doKode}: ${item.part_number} ${item.part_name} keluar dari cabang ${data.dari_cabang_id} (kirim ke customer)`,
    });
  }

  await supabase
    .from("do_reguler")
    .update({ stock_released: true })
    .eq("id", doRow.id);

  revalidatePath("/so-reguler/do");
  revalidatePath("/stock");
  return { success: true, data: doRow };
}

/**
 * UPDATE TRACKING DO REGULER
 *
 * Boleh oleh: pembuat DO, moderator/admin, atau staff gudang pengirim.
 * Saat status mencapai 'delivered' (Barang Diterima), DO ditandai 'completed'.
 * Tidak ada pergerakan stok di sisi tujuan (customer eksternal).
 */
export async function updateDoRegulerTracking(
  doId: number,
  trackingStatus: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  if (!TRACKING_ORDER.includes(trackingStatus))
    return { error: "Status tracking tidak valid" };

  const { data: doRow } = await supabase
    .from("do_reguler")
    .select("id, status, dari_cabang_id, uid_requester")
    .eq("id", doId)
    .single();
  if (!doRow) return { error: "DO Reguler tidak ditemukan" };
  if (doRow.status === "cancelled")
    return { error: "DO Reguler sudah dibatalkan." };

  // Cek izin
  const { data: profile } = await supabase
    .from("profiles")
    .select("cabang_id")
    .eq("id", user.id)
    .single();
  const roleNames = await getRoleNames(supabase, user.id);
  const isModeratorOrAdmin = roleNames.some(
    (r) => r === "moderator" || r === "admin",
  );
  const isCreator = doRow.uid_requester === user.id;
  const isSenderStaff =
    profile?.cabang_id != null && profile.cabang_id === doRow.dari_cabang_id;
  if (!isModeratorOrAdmin && !isCreator && !isSenderStaff)
    return {
      error:
        "Hanya pembuat DO, staff gudang pengirim, atau moderator yang dapat mengubah status.",
    };

  const reachedDelivered = trackingStatus === "delivered";

  const { error } = await supabase
    .from("do_reguler")
    .update({
      tracking_status: trackingStatus,
      status: reachedDelivered ? "completed" : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", doId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/do");
  return { success: true };
}

/**
 * OVERRIDE TRACKING + CATATAN (moderator/admin).
 */
export async function updateDoRegulerTrackingModerator(
  doId: number,
  trackingStatus: string,
  trackingNote: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  if (!TRACKING_ORDER.includes(trackingStatus))
    return { error: "Status tracking tidak valid" };

  const roleNames = await getRoleNames(supabase, user.id);
  const isModeratorOrAdmin = roleNames.some(
    (r) => r === "moderator" || r === "admin",
  );
  if (!isModeratorOrAdmin)
    return {
      error:
        "Hanya moderator/admin yang dapat override status dan catatan tracking.",
    };

  const { data: doRow } = await supabase
    .from("do_reguler")
    .select("status")
    .eq("id", doId)
    .single();
  if (!doRow) return { error: "DO Reguler tidak ditemukan" };
  if (doRow.status === "cancelled")
    return { error: "DO Reguler sudah dibatalkan." };

  const safeTrackingNote = trackingNote?.trim() || null;
  if (safeTrackingNote && safeTrackingNote.length > 1000)
    return { error: "Catatan tracking maksimal 1000 karakter." };

  const { error } = await supabase
    .from("do_reguler")
    .update({
      tracking_status: trackingStatus,
      status: trackingStatus === "delivered" ? "completed" : "active",
      tracking_note: safeTrackingNote,
      tracking_note_updated_by: user.id,
      tracking_note_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", doId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/do");
  return { success: true };
}

/**
 * BATALKAN DO REGULER (hanya moderator).
 *
 * Stok dikembalikan ke gudang pengirim. Berlaku meski DO sudah "completed"
 * (barang diterima): stok pengirim ditambah kembali sesuai item.
 */
export async function cancelDoReguler(doId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const roleNames = await getRoleNames(supabase, user.id);
  const isModerator = roleNames.some((r) => r === "moderator");
  if (!isModerator)
    return { error: "Hanya moderator yang dapat membatalkan DO Reguler." };

  const { data: doRow } = await supabase
    .from("do_reguler")
    .select("id, do_kode, dari_cabang_id, status, stock_released")
    .eq("id", doId)
    .single();
  if (!doRow) return { error: "DO Reguler tidak ditemukan" };
  if (doRow.status === "cancelled")
    return { error: "DO Reguler ini sudah dibatalkan." };

  // Kembalikan stok ke gudang pengirim (jika sebelumnya sudah keluar)
  if (doRow.stock_released) {
    const { data: items } = await supabase
      .from("do_reguler_items")
      .select("part_id, part_number, part_name, qty")
      .eq("do_id", doId);

    for (const item of items || []) {
      const { data: srcStock } = await supabase
        .from("stock")
        .select("id, qty")
        .eq("part_id", item.part_id)
        .eq("cabang_id", doRow.dari_cabang_id)
        .maybeSingle();
      if (srcStock) {
        await supabase
          .from("stock")
          .update({ qty: srcStock.qty + item.qty })
          .eq("id", srcStock.id);
      } else {
        await supabase.from("stock").insert([
          {
            part_id: item.part_id,
            cabang_id: doRow.dari_cabang_id,
            qty: item.qty,
          },
        ]);
      }
      await supabase.from("stock_movements").insert({
        part_id: item.part_id,
        cabang_id: doRow.dari_cabang_id,
        qty_change: item.qty,
        type: "DO_REG",
        reference_id: doRow.do_kode,
        created_by: user.id,
        notes: `Pembatalan DO Reguler ${doRow.do_kode}: ${item.part_number} ${item.part_name} dikembalikan ke cabang ${doRow.dari_cabang_id}`,
      });
    }
  }

  const { error } = await supabase
    .from("do_reguler")
    .update({
      status: "cancelled",
      stock_released: false,
      cancel_reason: reason?.trim() || "-",
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", doId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/do");
  revalidatePath("/stock");
  return { success: true };
}
