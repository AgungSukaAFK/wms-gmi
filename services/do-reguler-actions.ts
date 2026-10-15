"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { KoliRow } from "@/lib/shipment";
import { changeStockQty, sumQtyByPart } from "@/lib/stock-mutation";
import {
  computeSoItemRemaining,
  fetchSoItemFulfillment,
  refreshSoStatus,
} from "@/lib/so-reguler";

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
  // Diisi kalau DO dibuat dari SO Reguler.
  so_item_id?: number | null;
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

async function requireModeratorOrAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" } as const;

  const roleNames = await getRoleNames(supabase, user.id);
  const allowed = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );
  if (!allowed)
    return {
      error:
        "Akses ditolak. Hanya moderator/admin yang dapat mengubah atau menghapus DO Reguler.",
    } as const;

  return { supabase, user } as const;
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
  // Opsional: DO dibuat dari SO Reguler (customer & item mengikuti SO).
  so_id?: number | null;
  kode_po?: string;
  shipment_type?: string;
  ekspedisi?: string;
  sender_name?: string;
  eksternal_provider?: string;
  eksternal_id?: string;
  jumlah_koli?: number;
  koli_detail?: KoliRow[];
  layanan_kurir?: string;
  rate_per_kg?: number;
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
  if (!data.dari_cabang_id)
    return { error: "Gudang pengirim wajib diketahui." };
  if (!data.customer_id) return { error: "Customer tujuan wajib dipilih." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };

  // DO dari SO: customer harus sama dengan SO, semua item wajib dari SO
  // tersebut, dan qty tidak boleh melebihi sisa SO yang belum di-DO.
  const soId = data.so_id || null;
  // Per so_item_id: berapa unit DO ini yang memakai barang hasil PO yang sudah
  // diterima (do_reguler_items.qty_from_po), lihat computeSoItemRemaining.
  const qtyFromPo = new Map<number, number>();
  if (soId) {
    const { data: so } = await supabase
      .from("so_reguler")
      .select("id, so_kode, so_status, customer_id, cabang_id, so_reguler_items(id, qty, part_id, part_number, part_name, satuan)")
      .eq("id", soId)
      .maybeSingle();
    if (!so) return { error: "SO Reguler tidak ditemukan." };
    if (so.so_status === "cancelled")
      return { error: `SO ${so.so_kode} sudah dibatalkan.` };
    if (Number(so.customer_id) !== Number(data.customer_id))
      return { error: `Customer DO harus sama dengan customer SO ${so.so_kode}.` };
    const soItems = new Map<number, any>(
      (so.so_reguler_items || []).map((i: any) => [i.id, i]),
    );
    if (data.items.some((i) => !i.so_item_id || !soItems.has(i.so_item_id)))
      return { error: `Semua item DO harus berasal dari SO ${so.so_kode}.` };
    // Data part diambil dari item SO (bukan payload).
    for (const item of data.items) {
      const soItem = soItems.get(item.so_item_id!);
      item.part_id = soItem.part_id;
      item.part_number = soItem.part_number;
      item.part_name = soItem.part_name;
      item.satuan = soItem.satuan;
    }
    const fulfillment = await fetchSoItemFulfillment(
      supabase,
      Array.from(soItems.keys()),
    );
    // Item SO yang sama bisa muncul lebih dari sekali -> dijumlah.
    const requestedBySoItem = new Map<number, number>();
    for (const item of data.items) {
      requestedBySoItem.set(item.so_item_id!, (requestedBySoItem.get(item.so_item_id!) || 0) + item.qty);
    }
    // Barang hasil PO dari SO mendarat di gudang site SO -- hanya DO yang
    // dikirim dari gudang itu yang memakai "pool" barang PO.
    const shipsFromSoSite = Number(data.dari_cabang_id) === Number(so.cabang_id);
    const over: string[] = [];
    for (const [soItemId, requested] of requestedBySoItem) {
      const soItem = soItems.get(soItemId)!;
      const { sisaDo, poPoolAvailable } = computeSoItemRemaining(
        soItem.qty,
        fulfillment.get(soItemId),
      );
      if (requested > sisaDo)
        over.push(`${soItem.part_number}: kirim ${requested}, sisa SO ${sisaDo}`);
      qtyFromPo.set(soItemId, shipsFromSoSite ? Math.min(requested, poPoolAvailable) : 0);
    }
    if (over.length > 0)
      return { error: "Qty melebihi sisa SO:\n" + over.join("\n") };
  } else if (data.items.some((i) => i.so_item_id)) {
    return { error: "Item SO hanya bisa dikirim lewat DO yang memilih SO." };
  }

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
    if (!(item.qty > 0) || !Number.isInteger(Number(item.qty)))
      violations.push(`${item.part_number}: qty harus bilangan bulat > 0`);
  }
  const neededByPart = sumQtyByPart(data.items, (i) => i.qty);
  for (const [partId, needed] of neededByPart) {
    const avail = (stockMap.get(partId) as number) ?? 0;
    const name = data.items.find((i) => i.part_id === partId)?.part_number;
    if (needed > avail) violations.push(`${name}: minta ${needed}, stok ${avail}`);
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
        so_id: soId,
        kode_po: data.kode_po?.trim() || null,
        shipment_type: data.shipment_type || "ekspedisi_laut",
        ekspedisi: data.ekspedisi || null,
        sender_name: data.sender_name || null,
        eksternal_provider: data.eksternal_provider || null,
        eksternal_id: data.eksternal_id || null,
        jumlah_koli: data.jumlah_koli ?? 1,
        koli_detail: data.koli_detail ?? [],
        layanan_kurir: data.layanan_kurir || null,
        rate_per_kg: data.rate_per_kg || null,
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

  // Insert items. qty_from_po per item SO dibagi ke baris-barisnya.
  const fromPoLeft = new Map(qtyFromPo);
  const itemsToInsert = data.items.map((item) => ({
    do_id: doRow.id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
    so_item_id: soId ? item.so_item_id : null,
    qty_from_po: (() => {
      if (!soId) return 0;
      const left = fromPoLeft.get(item.so_item_id!) || 0;
      const used = Math.min(left, item.qty);
      fromPoLeft.set(item.so_item_id!, left - used);
      return used;
    })(),
  }));
  const removeDo = async () => {
    await supabase.from("do_reguler_items").delete().eq("do_id", doRow.id);
    await supabase.from("do_reguler").delete().eq("id", doRow.id);
  };
  const { error: itemsError } = await supabase
    .from("do_reguler_items")
    .insert(itemsToInsert);
  if (itemsError) {
    await removeDo();
    return { error: itemsError.message };
  }

  // Verifikasi ulang setelah insert (DO lain bisa dibuat bersamaan dan lolos
  // cek sisa yang sama) -- kalau total DO melebihi qty SO, batalkan.
  if (soId) {
    const soItemIds = Array.from(new Set(data.items.map((i) => i.so_item_id!)));
    const { data: soItemRows } = await supabase
      .from("so_reguler_items")
      .select("id, qty, part_number")
      .in("id", soItemIds);
    const after = await fetchSoItemFulfillment(supabase, soItemIds);
    for (const si of soItemRows || []) {
      if ((after.get(si.id)?.qtyDo || 0) > Number(si.qty)) {
        await removeDo();
        return { error: `${si.part_number}: qty DO melebihi sisa SO (bentrok dengan DO lain yang baru dibuat). Coba lagi.` };
      }
    }
  }

  // Keluarkan stok dari gudang pengirim (langsung), atomik per part. Gagal ->
  // potongan yang sudah terjadi dikembalikan & DO dibatalkan.
  const deducted: { partId: number; qty: number }[] = [];
  for (const [partId, qty] of neededByPart) {
    const name = data.items.find((i) => i.part_id === partId)?.part_number;
    const res = await changeStockQty(
      supabase,
      { partId, cabangId: data.dari_cabang_id },
      -qty,
      { label: name },
    );
    if (!res.ok) {
      for (const d of deducted) {
        await changeStockQty(supabase, { partId: d.partId, cabangId: data.dari_cabang_id }, d.qty, { allowNegative: true });
      }
      await removeDo();
      return { error: res.error };
    }
    deducted.push({ partId, qty });
  }
  for (const item of data.items) {
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

  await refreshSoStatus(supabase, soId);

  revalidatePath("/so-reguler/do");
  revalidatePath("/so-reguler/so");
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
    .select("id, status, dari_cabang_id, uid_requester, so_id")
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
    .eq("id", doId)
    .neq("status", "cancelled");
  if (error) return { error: error.message };

  // SO baru "completed" kalau semua DO-nya sudah diterima customer.
  await refreshSoStatus(supabase, doRow.so_id);

  revalidatePath("/so-reguler/do");
  revalidatePath("/so-reguler/so");
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
    .select("status, so_id")
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
    .eq("id", doId)
    .neq("status", "cancelled");
  if (error) return { error: error.message };

  await refreshSoStatus(supabase, doRow.so_id);

  revalidatePath("/so-reguler/do");
  revalidatePath("/so-reguler/so");
  return { success: true };
}

/**
 * UPDATE DATA HEADER DO REGULER (moderator/admin).
 */
export async function updateDoReguler(
  doId: number,
  payload: Partial<{
    do_tanggal: string;
    kode_po: string;
    shipment_type: string;
    ekspedisi: string;
    sender_name: string;
    eksternal_provider: string;
    eksternal_id: string;
    jumlah_koli: number;
    koli_detail: KoliRow[];
    layanan_kurir: string;
    rate_per_kg: number;
    no_resi: string;
    estimasi_hari: number;
    pic: string;
    remarks: string;
  }>,
) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase } = auth;
  const safePayload = {
    ...payload,
    kode_po: payload.kode_po?.trim() || null,
    ekspedisi: payload.ekspedisi?.trim() || null,
    sender_name: payload.sender_name?.trim() || null,
    eksternal_provider: payload.eksternal_provider?.trim() || null,
    eksternal_id: payload.eksternal_id?.trim() || null,
    no_resi: payload.no_resi?.trim() || null,
    layanan_kurir: payload.layanan_kurir?.trim() || null,
    rate_per_kg: payload.rate_per_kg || null,
    pic: payload.pic?.trim() || null,
    remarks: payload.remarks?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("do_reguler")
    .update(safePayload)
    .eq("id", doId);
  if (error) return { error: error.message };

  revalidatePath("/so-reguler/do");
  revalidatePath("/stock");
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
    .select("id, do_kode, dari_cabang_id, status, stock_released, so_id")
    .eq("id", doId)
    .single();
  if (!doRow) return { error: "DO Reguler tidak ditemukan" };
  if (doRow.status === "cancelled")
    return { error: "DO Reguler ini sudah dibatalkan." };

  // Claim pembatalan dulu (kondisional) supaya request ganda tidak
  // mengembalikan stok dua kali.
  const { data: claimed, error } = await supabase
    .from("do_reguler")
    .update({
      status: "cancelled",
      stock_released: false,
      cancel_reason: reason?.trim() || "-",
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", doId)
    .neq("status", "cancelled")
    .select("id");
  if (error) return { error: error.message };
  if (!claimed || claimed.length === 0)
    return { error: "DO Reguler ini sudah dibatalkan." };

  // Kembalikan stok ke gudang pengirim (jika sebelumnya sudah keluar)
  if (doRow.stock_released) {
    const { data: items } = await supabase
      .from("do_reguler_items")
      .select("part_id, part_number, part_name, qty")
      .eq("do_id", doId);

    for (const item of items || []) {
      await changeStockQty(
        supabase,
        { partId: item.part_id, cabangId: doRow.dari_cabang_id },
        item.qty,
        { allowNegative: true },
      );
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

  await refreshSoStatus(supabase, doRow.so_id);

  revalidatePath("/so-reguler/do");
  revalidatePath("/so-reguler/so");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * HAPUS DO REGULER (moderator/admin).
 *
 * Item ikut terhapus lewat cascade. Jika stok sudah keluar, stok dikembalikan
 * dulu ke gudang pengirim sebelum header DO dihapus.
 */
export async function deleteDoReguler(doId: number) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase, user } = auth;

  const { data: doRow } = await supabase
    .from("do_reguler")
    .select("id, do_kode, dari_cabang_id, status, stock_released, so_id")
    .eq("id", doId)
    .single();
  if (!doRow) return { error: "DO Reguler tidak ditemukan" };
  if (doRow.status === "cancelled")
    return { error: "DO Reguler ini sudah dibatalkan." };

  if (doRow.stock_released) {
    // Claim (stock_released true -> false secara kondisional) sebelum stok
    // dikembalikan, supaya tidak dobel dengan cancel/hapus bersamaan.
    const { data: claimed } = await supabase
      .from("do_reguler")
      .update({ stock_released: false })
      .eq("id", doId)
      .eq("stock_released", true)
      .select("id");
    const { data: items } = await supabase
      .from("do_reguler_items")
      .select("part_id, part_number, part_name, qty")
      .eq("do_id", doId);

    for (const item of claimed && claimed.length > 0 ? items || [] : []) {
      await changeStockQty(
        supabase,
        { partId: item.part_id, cabangId: doRow.dari_cabang_id },
        item.qty,
        { allowNegative: true },
      );
      await supabase.from("stock_movements").insert({
        part_id: item.part_id,
        cabang_id: doRow.dari_cabang_id,
        qty_change: item.qty,
        type: "DO_REG",
        reference_id: doRow.do_kode,
        created_by: user.id,
        notes: `Hapus DO Reguler ${doRow.do_kode}: ${item.part_number} ${item.part_name} dikembalikan ke cabang ${doRow.dari_cabang_id}`,
      });
    }
  }

  const { error } = await supabase.from("do_reguler").delete().eq("id", doId);
  if (error) return { error: error.message };

  await refreshSoStatus(supabase, doRow.so_id);

  revalidatePath("/so-reguler/do");
  revalidatePath("/so-reguler/so");
  revalidatePath("/stock");
  return { success: true };
}
