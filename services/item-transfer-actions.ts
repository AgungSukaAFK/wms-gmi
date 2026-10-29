"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  parseKoliDetail,
  SHIPMENT_LABEL,
  validateKoliRows,
  type KoliRow,
} from "@/lib/shipment";
import {
  computeMrItemsOutstandingForTransfer,
  recomputeMrItemsFulfillment,
  resolveReceiveItemsMrLineage,
} from "@/lib/mr-fulfillment";
import { changeStockQty, sumQtyByPart } from "@/lib/stock-mutation";
import {
  applyConsignmentChanges,
  fetchConsignmentStockMap,
} from "@/lib/vendor-consignment";
import {
  notifyApprovers,
  notifyDocumentOwner,
} from "@/services/notification-actions";
import type { ModeratorApprovalStep } from "@/services/moderator-edit-actions";

const TRACKING_ORDER = [
  "created",
  "packing",
  "ready_pickup",
  "in_transit",
  "delivered",
];

/**
 * Kurangi stok dari gudang asal (saat IT disetujui penuh). Idempotent via
 * flag stock_released pada header.
 */
async function releaseStockFromSource(
  supabase: any,
  it: {
    id: number;
    it_kode: string;
    dari_cabang_id: number;
    it_is_consignment?: boolean | null;
    it_vendor_id?: number | null;
  },
  items: { part_id: number; part_number: string; part_name: string; qty: number }[],
  userId?: string,
) {
  // IT konsinyasi: yang keluar stok titipan vendor (vendor_consignment_stock).
  if (it.it_is_consignment && it.it_vendor_id) {
    const res = await applyConsignmentChanges(
      supabase,
      items.map((item) => ({
        vendorId: it.it_vendor_id!,
        cabangId: it.dari_cabang_id,
        partId: item.part_id,
        delta: -item.qty,
        label: item.part_number,
        notes: `Item Transfer ${it.it_kode}: ${item.part_number} ${item.part_name} keluar (dalam pengiriman)`,
      })),
      { type: "IT_OUT", referenceId: it.it_kode, actorId: userId ?? null },
    );
    if (!res.ok) return { error: "Stok konsinyasi gudang asal tidak mencukupi:\n" + res.error };
    return { success: true };
  }

  // Total per part (PN sama di beberapa baris dijumlah), dipotong atomik.
  // Kalau ada yang gagal, potongan yang sudah terjadi dikembalikan.
  const neededByPart = sumQtyByPart(items, (i) => i.qty);
  const deducted: { partId: number; qty: number }[] = [];
  for (const [partId, qty] of neededByPart) {
    const sample = items.find((i) => i.part_id === partId)!;
    const res = await changeStockQty(
      supabase,
      { partId, cabangId: it.dari_cabang_id },
      -qty,
      { label: sample.part_number },
    );
    if (!res.ok) {
      for (const d of deducted) {
        await changeStockQty(supabase, { partId: d.partId, cabangId: it.dari_cabang_id }, d.qty, {
          allowNegative: true,
        });
      }
      return { error: "Stok gudang asal tidak mencukupi:\n" + res.error };
    }
    deducted.push({ partId, qty });
  }

  for (const item of items) {
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: it.dari_cabang_id,
      qty_change: -item.qty,
      type: "IT",
      reference_id: it.it_kode,
      created_by: userId,
      notes: `Item Transfer ${it.it_kode}: ${item.part_number} ${item.part_name} keluar dari cabang ${it.dari_cabang_id} (dalam pengiriman)`,
    });
  }
  return { success: true };
}

/**
 * BUAT ITEM TRANSFER
 */
export async function createItemTransfer(data: {
  it_kode: string;
  it_tanggal: string;
  dari_cabang_id: number;
  ke_cabang_id: number;
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
  uid_pic?: string;
  uid_receiver?: string;
  signature_requester_id?: string;
  approvals?: any[];
  // IT Konsinyasi: memindahkan stok titipan vendor ini (bukan stok GMI).
  // Item boleh membawa mr_item_id langsung (MR site tujuan) -- dikredit ke
  // MR saat finalize, tanpa perlu RI sumber.
  is_consignment?: boolean;
  vendor_id?: number | null;
  items: {
    part_id: number;
    part_number: string;
    part_name: string;
    satuan: string;
    qty: number;
    // Diisi kalau item ini "dari RI" -- lineage ke MR yang direferensikan +
    // receive_item asalnya. Dipakai buat distribusi qty ke MR saat IT ini
    // finalize (lihat finalizeItemTransfer) dan buat hitung sisa qty RI yang
    // belum ditransfer (lihat picker "Cari dari RI" di item-transfer/create).
    mr_item_id?: number | null;
    receive_item_id?: number | null;
  }[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const itKode = data.it_kode?.trim();
  if (!itKode) return { error: "Kode Item Transfer wajib diisi." };
  if (!data.dari_cabang_id || !data.ke_cabang_id)
    return { error: "Gudang asal dan tujuan wajib dipilih." };
  if (data.dari_cabang_id === data.ke_cabang_id)
    return { error: "Gudang asal dan tujuan tidak boleh sama." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };

  // Kode unik
  const { data: existing } = await supabase
    .from("item_transfers")
    .select("id")
    .eq("it_kode", itKode)
    .maybeSingle();
  if (existing)
    return { error: "Kode Item Transfer sudah digunakan. Gunakan kode lain." };

  if (data.items.some((i) => !(i.qty > 0) || !Number.isInteger(Number(i.qty))))
    return { error: "Qty item harus bilangan bulat lebih dari 0." };

  const isConsignment = Boolean(data.is_consignment);
  if (isConsignment) {
    if (!data.vendor_id) return { error: "Vendor konsinyasi wajib dipilih." };
    if (data.items.some((i) => i.receive_item_id))
      return { error: "IT Konsinyasi tidak bisa mengambil item dari RI." };
    // Item yang membawa MR site tujuan: divalidasi ulang di server (MR
    // approved, milik gudang tujuan, part sama, qty <= sisa yang belum
    // terpenuhi / belum dalam proses IT lain).
    const mrItemIds = data.items.map((i) => i.mr_item_id).filter(Boolean) as number[];
    if (mrItemIds.length > 0) {
      const outstanding = await computeMrItemsOutstandingForTransfer(supabase, mrItemIds);
      const requested = new Map<number, number>();
      for (const item of data.items) {
        if (!item.mr_item_id) continue;
        const o = outstanding.get(item.mr_item_id);
        if (!o) return { error: `${item.part_number}: item MR tidak ditemukan.` };
        if (o.mr_status !== "approved")
          return { error: `${item.part_number}: MR ${o.mr_kode} tidak berstatus approved.` };
        if (Number(o.cabang_id) !== Number(data.ke_cabang_id))
          return { error: `${item.part_number}: MR ${o.mr_kode} bukan milik gudang tujuan.` };
        if (Number(o.part_id) !== Number(item.part_id))
          return { error: `${item.part_number}: part tidak sesuai dengan item MR ${o.mr_kode}.` };
        if (o.item_status === "rejected")
          return { error: `${item.part_number}: item MR ${o.mr_kode} sudah ditolak.` };
        requested.set(item.mr_item_id, (requested.get(item.mr_item_id) || 0) + Number(item.qty));
      }
      for (const [mrItemId, qty] of requested) {
        const o = outstanding.get(mrItemId)!;
        if (qty > o.outstanding)
          return {
            error: `MR ${o.mr_kode}: qty ${qty} melebihi sisa MR yang belum terpenuhi (${o.outstanding}).`,
          };
      }
    }
  }

  // Baris "dari RI": divalidasi ulang di server -- RI harus completed, barang
  // mendarat di gudang asal IT ini, part sama, dan total qty tidak melebihi
  // sisa RI (qty RI - IT lain yang belum rejected). mr_item_id diturunkan dari
  // lineage RI (po_item -> pr_item -> mr_item), bukan dari payload. Baris RI
  // yang sudah mendarat di gudang MR-nya sendiri sudah mengkredit MR saat RI
  // completed, jadi tidak membawa mr_item_id lagi (cegah kredit dobel).
  const riItemIds = Array.from(
    new Set(data.items.map((i) => i.receive_item_id).filter(Boolean) as number[]),
  );
  if (riItemIds.length > 0) {
    const lineage = await resolveReceiveItemsMrLineage(supabase, riItemIds);
    const { data: usedRows } = await supabase
      .from("item_transfer_items")
      .select("receive_item_id, qty, item_transfers!inner(status)")
      .in("receive_item_id", riItemIds)
      .neq("item_transfers.status", "rejected");
    const usedMap = new Map<number, number>();
    for (const row of usedRows || []) {
      usedMap.set(row.receive_item_id, (usedMap.get(row.receive_item_id) || 0) + Number(row.qty));
    }
    const requested = new Map<number, number>();
    for (const item of data.items) {
      if (!item.receive_item_id) continue;
      const l = lineage.get(item.receive_item_id);
      if (!l) return { error: `${item.part_number}: baris RI sumber tidak ditemukan.` };
      if (l.ri_status !== "completed")
        return { error: `${item.part_number}: RI sumber belum completed.` };
      if (Number(l.cabang_penerima_id) !== Number(data.dari_cabang_id))
        return { error: `${item.part_number}: barang RI ini tidak diterima di gudang asal yang dipilih.` };
      if (Number(l.part_id) !== Number(item.part_id))
        return { error: `${item.part_number}: part tidak sesuai dengan baris RI sumber.` };
      item.mr_item_id = l.mr_item_id;
      requested.set(item.receive_item_id, (requested.get(item.receive_item_id) || 0) + Number(item.qty));
    }
    for (const [riItemId, qty] of requested) {
      const l = lineage.get(riItemId)!;
      const sisa = l.qty - (usedMap.get(riItemId) || 0);
      if (qty > sisa) {
        const name = data.items.find((i) => i.receive_item_id === riItemId)?.part_number;
        return { error: `${name}: qty ${qty} melebihi sisa RI yang belum di-transfer (${Math.max(0, sisa)}).` };
      }
    }
  }
  // Tanpa RI sumber tidak ada lineage MR yang sah (kecuali IT konsinyasi
  // yang item MR-nya sudah divalidasi di atas).
  for (const item of data.items) {
    if (!isConsignment && !item.receive_item_id) item.mr_item_id = null;
  }

  // Validasi qty <= stok gudang asal (dijumlah per part)
  const partIds = data.items.map((i) => i.part_id);
  const neededByPart = sumQtyByPart(data.items, (i) => i.qty);
  let stockMap: Map<number, number>;
  if (isConsignment) {
    stockMap = await fetchConsignmentStockMap(supabase, data.vendor_id!, data.dari_cabang_id, partIds);
  } else {
    const { data: stockRows } = await supabase
      .from("stock")
      .select("part_id, qty")
      .eq("cabang_id", data.dari_cabang_id)
      .in("part_id", partIds);
    stockMap = new Map((stockRows || []).map((s: any) => [s.part_id, s.qty]));
  }
  const violations: string[] = [];
  for (const [partId, needed] of neededByPart) {
    const avail = (stockMap.get(partId) as number) ?? 0;
    const name = data.items.find((i) => i.part_id === partId)?.part_number;
    if (needed > avail) violations.push(`${name}: minta ${needed}, stok ${avail}`);
  }
  if (violations.length > 0)
    return {
      error:
        `Qty melebihi stok ${isConsignment ? "konsinyasi " : ""}gudang asal:\n` +
        violations.join("\n"),
    };

  // Validasi batas max stok di gudang tujuan: stok_tujuan + qty <= max_qty.
  // max_qty = 0 dianggap belum di-set => barang tidak boleh ditransfer ke sana.
  // Min/max mengatur stok GMI, jadi tidak berlaku untuk stok titipan vendor.
  if (!isConsignment) {
    const { data: destRows } = await supabase
      .from("stock")
      .select("part_id, qty, max_qty")
      .eq("cabang_id", data.ke_cabang_id)
      .in("part_id", partIds);
    const destMap = new Map(
      (destRows || []).map((s: any) => [s.part_id, s]),
    );
    const destViolations: string[] = [];
    for (const [partId, needed] of neededByPart) {
      const name = data.items.find((i) => i.part_id === partId)?.part_number;
      const d = destMap.get(partId) as
        | { qty: number; max_qty: number }
        | undefined;
      const destMax = d?.max_qty ?? 0;
      const destQty = d?.qty ?? 0;
      if (destMax <= 0)
        destViolations.push(
          `${name}: belum ada batas max stok di gudang tujuan`,
        );
      else if (destQty + needed > destMax)
        destViolations.push(
          `${name}: ${destQty} + ${needed} melebihi max ${destMax}`,
        );
    }
    if (destViolations.length > 0)
      return {
        error:
          "Melebihi batas max stok gudang tujuan:\n" + destViolations.join("\n"),
      };
  }

  const approvals = data.approvals ?? [];
  const initialStatus =
    approvals.length === 0 || approvals.every((a: any) => a.status !== "pending")
      ? "approved"
      : "open";

  // Insert header
  const { data: it, error: itError } = await supabase
    .from("item_transfers")
    .insert([
      {
        it_kode: itKode,
        it_tanggal: data.it_tanggal,
        dari_cabang_id: data.dari_cabang_id,
        ke_cabang_id: data.ke_cabang_id,
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
        uid_pic: data.uid_pic || null,
        uid_receiver: data.uid_receiver || null,
        created_by: user.id,
        approvals: approvals as any,
        signature_requester_id: data.signature_requester_id || null,
        signed_by_requester_at: data.signature_requester_id
          ? new Date().toISOString()
          : null,
        status: initialStatus as any,
        tracking_status: "created",
        stock_released: false,
        ...(isConsignment ? { it_is_consignment: true, it_vendor_id: data.vendor_id } : {}),
      },
    ])
    .select()
    .single();
  if (itError) return { error: itError.message };

  // Insert items
  const itemsToInsert = data.items.map((item) => ({
    it_id: it.id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
    mr_item_id: item.mr_item_id ?? null,
    receive_item_id: item.receive_item_id ?? null,
  }));
  const { error: itemsError } = await supabase
    .from("item_transfer_items")
    .insert(itemsToInsert);
  if (itemsError) {
    await supabase.from("item_transfers").delete().eq("id", it.id);
    return { error: itemsError.message };
  }

  // Jika langsung approved (tanpa langkah pending), keluarkan stok sekarang.
  if (initialStatus === "approved") {
    const res = await releaseStockFromSource(supabase, it, data.items, user.id);
    if (res.error) {
      await supabase.from("item_transfers").delete().eq("id", it.id);
      return { error: res.error };
    }
    await supabase
      .from("item_transfers")
      .update({ stock_released: true })
      .eq("id", it.id);
  } else if (approvals.length > 0) {
    notifyApprovers(
      approvals,
      "Item Transfer",
      it.id,
      it.it_kode,
      `/item-transfer/${it.id}`,
    ).catch(console.error);
  }

  revalidatePath("/item-transfer");
  revalidatePath("/stock");
  return { success: true, data: it };
}

/**
 * SETUJUI ITEM TRANSFER (advance approval; stok keluar saat langkah terakhir)
 */
export async function approveItemTransfer(itId: number, signatureUrl: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: it, error: itError } = await supabase
    .from("item_transfers")
    .select("*")
    .eq("id", itId)
    .single();
  if (itError || !it) return { error: "Item Transfer tidak ditemukan" };
  if (it.status !== "open")
    return { error: `Item Transfer berstatus ${it.status}, tidak bisa di-approve.` };

  const originalApprovals = it.approvals || [];
  const approvals = originalApprovals.map((a: any) => ({ ...a }));
  const currentStepIndex = approvals.findIndex(
    (a: any) => a.status === "pending",
  );
  if (currentStepIndex === -1)
    return { error: "Tidak ada langkah approval yang menunggu" };
  const currentStep = approvals[currentStepIndex];
  if (currentStep.userid !== user.id && currentStep.user_id !== user.id)
    return { error: "Bukan giliran Anda untuk approval Item Transfer ini." };

  const isLastStep = currentStepIndex === approvals.length - 1;

  approvals[currentStepIndex].status = "approved";
  approvals[currentStepIndex].signature_url = signatureUrl;
  approvals[currentStepIndex].processed_at = new Date().toISOString();

  // Claim kondisional (status masih open & stok belum keluar) SEBELUM stok
  // dipotong, supaya dua klik tidak memotong stok gudang asal dua kali.
  const { data: claimed, error: updateError } = await supabase
    .from("item_transfers")
    .update({
      approvals,
      status: isLastStep ? "approved" : "open",
      stock_released: isLastStep ? true : it.stock_released,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itId)
    .eq("status", "open")
    .eq("stock_released", false)
    .select("id");
  if (updateError) return { error: updateError.message };
  if (!claimed || claimed.length === 0)
    return { error: "Item Transfer ini baru saja diproses oleh request lain. Muat ulang halaman." };

  // Langkah terakhir: keluarkan stok dari gudang asal. Gagal -> kembalikan.
  if (isLastStep) {
    const { data: items } = await supabase
      .from("item_transfer_items")
      .select("part_id, part_number, part_name, qty")
      .eq("it_id", itId);
    const res = await releaseStockFromSource(
      supabase,
      it,
      items || [],
      user.id,
    );
    if (res.error) {
      await supabase
        .from("item_transfers")
        .update({ approvals: originalApprovals, status: "open", stock_released: false })
        .eq("id", itId);
      return { error: res.error };
    }
  }

  notifyDocumentOwner(
    it.uid_requester,
    isLastStep ? "document_completed" : "approved",
    "Item Transfer",
    itId,
    it.it_kode,
    `/item-transfer/${itId}`,
    approvals[currentStepIndex].nama,
  ).catch(console.error);

  if (!isLastStep) {
    const remaining = approvals.filter((a: any) => a.status === "pending");
    notifyApprovers(
      remaining,
      "Item Transfer",
      itId,
      it.it_kode,
      `/item-transfer/${itId}`,
    ).catch(console.error);
  }

  revalidatePath("/item-transfer");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * TOLAK ITEM TRANSFER
 */
export async function rejectItemTransfer(itId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: it } = await supabase
    .from("item_transfers")
    .select("id, it_kode, status, stock_released, approvals, uid_requester")
    .eq("id", itId)
    .single();
  if (!it) return { error: "Item Transfer tidak ditemukan" };
  if (it.stock_released)
    return {
      error:
        "Tidak bisa menolak: stok sudah keluar dari gudang asal (IT sudah disetujui).",
    };

  if (it.status !== "open")
    return { error: `Item Transfer berstatus ${it.status}, tidak bisa ditolak.` };

  const approvals = [...(it.approvals || [])];
  const idx = approvals.findIndex((a: any) => a.status === "pending");
  if (idx === -1) return { error: "Tidak ada langkah approval yang menunggu" };
  if (approvals[idx].userid !== user.id && approvals[idx].user_id !== user.id)
    return { error: "Bukan giliran Anda untuk approval Item Transfer ini." };
  approvals[idx].status = "rejected";
  approvals[idx].processed_at = new Date().toISOString();

  const { data: claimed, error } = await supabase
    .from("item_transfers")
    .update({
      status: "rejected",
      rejection_reason: reason,
      approvals,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itId)
    .eq("status", "open")
    .eq("stock_released", false)
    .select("id");
  if (error) return { error: error.message };
  if (!claimed || claimed.length === 0)
    return { error: "Item Transfer ini baru saja diproses oleh request lain. Muat ulang halaman." };

  notifyDocumentOwner(
    it.uid_requester,
    "rejected",
    "Item Transfer",
    itId,
    it.it_kode,
    `/item-transfer/${itId}`,
    undefined,
  ).catch(console.error);

  revalidatePath("/item-transfer");
  return { success: true };
}

/**
 * UPDATE TRACKING (hanya setelah approved)
 */
export async function updateItemTransferTracking(
  itId: number,
  trackingStatus: string,
) {
  const supabase = await createClient();
  if (!TRACKING_ORDER.includes(trackingStatus))
    return { error: "Status tracking tidak valid" };

  const { data: it } = await supabase
    .from("item_transfers")
    .select("status")
    .eq("id", itId)
    .single();
  if (!it) return { error: "Item Transfer tidak ditemukan" };
  if (it.status !== "approved")
    return { error: "Item Transfer harus disetujui dulu sebelum tracking." };

  const { error } = await supabase
    .from("item_transfers")
    .update({ tracking_status: trackingStatus, updated_at: new Date().toISOString() })
    .eq("id", itId);
  if (error) return { error: error.message };

  revalidatePath("/item-transfer");
  return { success: true };
}

/**
 * OVERRIDE TRACKING oleh moderator/admin (set status mana saja + catatan).
 * Mirip updateDeliveryTrackingModerator pada Delivery.
 */
export async function updateItemTransferTrackingModerator(
  itId: number,
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

  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  if (roleError) return { error: roleError.message };

  const roleNames = (roleRows || [])
    .map((row: any) => row?.roles?.name)
    .filter((role: string | undefined): role is string => Boolean(role));
  const isModeratorOrAdmin = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );
  if (!isModeratorOrAdmin)
    return {
      error:
        "Hanya moderator/admin yang dapat override status dan catatan tracking.",
    };

  // Hanya bisa diubah setelah Item Transfer disetujui (approved).
  const { data: itRow } = await supabase
    .from("item_transfers")
    .select("status")
    .eq("id", itId)
    .single();
  if (!itRow) return { error: "Item Transfer tidak ditemukan" };
  if (itRow.status !== "approved")
    return { error: "Item Transfer harus disetujui dulu sebelum tracking." };

  const safeTrackingNote = trackingNote?.trim() || null;
  if (safeTrackingNote && safeTrackingNote.length > 1000)
    return { error: "Catatan tracking maksimal 1000 karakter." };

  const { error } = await supabase
    .from("item_transfers")
    .update({
      tracking_status: trackingStatus,
      tracking_note: safeTrackingNote,
      tracking_note_updated_by: user.id,
      tracking_note_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", itId);
  if (error) return { error: error.message };

  revalidatePath("/item-transfer");
  return { success: true };
}

/**
 * FINALISASI: gudang tujuan konfirmasi terima → stok masuk ke gudang tujuan.
 */
export async function finalizeItemTransfer(itId: number, signatureId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("cabang_id")
    .eq("id", user.id)
    .single();
  if (!profile) return { error: "Profil tidak ditemukan" };

  const { data: it } = await supabase
    .from("item_transfers")
    .select(
      "id, it_kode, ke_cabang_id, dari_cabang_id, status, tracking_status, signature_receiver_id, it_is_consignment, it_vendor_id",
    )
    .eq("id", itId)
    .single();
  if (!it) return { error: "Item Transfer tidak ditemukan" };

  if (it.signature_receiver_id || it.status === "completed")
    return { success: true, alreadyFinalized: true };

  if (it.tracking_status !== "delivered")
    return {
      error:
        "Tracking belum mencapai 'Barang Diterima'. Update tracking terlebih dahulu.",
    };
  if (profile.cabang_id !== it.ke_cabang_id)
    return {
      error: "Hanya admin gudang tujuan yang dapat menyelesaikan transfer ini.",
    };

  // Validasi tanda tangan milik user
  const { data: sig } = await supabase
    .from("user_signatures")
    .select("id, image_url, printed_name, label")
    .eq("id", signatureId)
    .eq("user_id", user.id)
    .eq("is_hidden", false)
    .single();
  if (!sig) return { error: "Tanda tangan tidak valid" };

  const { data: items } = await supabase
    .from("item_transfer_items")
    .select("part_id, part_number, part_name, qty, mr_item_id")
    .eq("it_id", itId);
  if (!items || items.length === 0) return { error: "Tidak ada item transfer" };

  // Claim dulu (kondisional: belum completed & belum ada tanda tangan
  // penerima) SEBELUM stok ditambah -- dua klik tidak menambah stok dua kali.
  const { data: claimed, error } = await supabase
    .from("item_transfers")
    .update({
      status: "completed",
      tracking_status: "completed",
      signature_receiver_id: signatureId,
      signed_by_receiver_at: new Date().toISOString(),
      signature_receiver_image_url: sig.image_url,
      signature_receiver_printed_name: sig.printed_name,
      signature_receiver_label: sig.label,
      uid_receiver: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itId)
    .eq("status", "approved")
    .is("signature_receiver_id", null)
    .select("id");
  if (error) return { error: error.message };
  if (!claimed || claimed.length === 0) return { success: true, alreadyFinalized: true };

  // Tambah stok ke gudang tujuan. IT konsinyasi: masuk stok titipan vendor
  // di gudang tujuan (penerimaan GR konsinyasi di WH site).
  if (it.it_is_consignment && it.it_vendor_id) {
    await applyConsignmentChanges(
      supabase,
      items.map((item: any) => ({
        vendorId: it.it_vendor_id,
        cabangId: it.ke_cabang_id,
        partId: item.part_id,
        delta: item.qty,
        label: item.part_number,
        notes: `Item Transfer ${it.it_kode}: ${item.part_number} ${item.part_name} diterima`,
      })),
      { type: "IT_IN", referenceId: it.it_kode, actorId: user.id },
    );
  }
  for (const item of it.it_is_consignment ? [] : items) {
    await changeStockQty(
      supabase,
      { partId: item.part_id, cabangId: it.ke_cabang_id },
      item.qty,
      { label: item.part_number },
    );
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: it.ke_cabang_id,
      qty_change: item.qty,
      type: "IT",
      reference_id: it.it_kode,
      created_by: user.id,
      notes: `Item Transfer ${it.it_kode}: ${item.part_number} ${item.part_name} diterima di cabang ${it.ke_cabang_id}`,
    });
  }

  // Distribusi qty ke MR: item IT yang bawa referensi mr_item_id berarti
  // ini pemenuhan MR (turunan RI -> IT). Live-recompute (bukan increment)
  // dari SEMUA item_transfer_items yang sudah completed buat mr_item itu,
  // mirror pola convert_status yang sudah ada -- supaya kalau nanti ada IT
  // yang di-reverse/dihapus, cukup panggil ulang recompute ini.
  // Sumber pemenuhan lain (Job Costing -> MR) ikut dihitung di helper yang
  // sama supaya tidak saling menimpa.
  const mrItemIds = (items || [])
    .map((i: any) => i.mr_item_id)
    .filter((id: unknown): id is number => typeof id === "number");
  const affectedMrIds = await recomputeMrItemsFulfillment(supabase, mrItemIds);

  if (affectedMrIds.size > 0) {
    revalidatePath("/mr");
    revalidatePath("/mr/scheduled");
  }

  revalidatePath("/item-transfer");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * HAPUS ITEM TRANSFER (hanya jika stok belum keluar / belum approved).
 */
export async function deleteItemTransfer(itId: number) {
  const supabase = await createClient();
  const { data: it } = await supabase
    .from("item_transfers")
    .select("id, stock_released, status")
    .eq("id", itId)
    .single();
  if (!it) return { error: "Item Transfer tidak ditemukan" };
  if (it.stock_released)
    return {
      error: "Tidak bisa menghapus: stok sudah bergerak. Batalkan via proses.",
    };

  // Kondisional: jangan sampai terhapus bersamaan dengan approve terakhir
  // yang baru saja mengeluarkan stok.
  const { error } = await supabase
    .from("item_transfers")
    .delete()
    .eq("id", itId)
    .eq("stock_released", false);
  if (error) return { error: error.message };

  revalidatePath("/item-transfer");
  return { success: true };
}

// ============================================================
// EDIT ITEM TRANSFER (edit biasa & Moderator Edit)
// ============================================================

export type ItemTransferEditItem = {
  // Baris lama: id terisi, cuma qty yang dipakai (part & lineage RI/MR tetap
  // dari DB). Baris baru: id kosong, selalu item manual tanpa lineage.
  id?: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
};

export type ItemTransferEditPayload = {
  it_kode?: string;
  it_tanggal?: string;
  dari_cabang_id?: number;
  ke_cabang_id?: number;
  shipment_type?: string;
  ekspedisi?: string | null;
  sender_name?: string | null;
  eksternal_provider?: string | null;
  eksternal_id?: string | null;
  jumlah_koli?: number;
  koli_detail?: KoliRow[];
  layanan_kurir?: string | null;
  rate_per_kg?: number | null;
  no_resi?: string | null;
  estimasi_hari?: number;
  pic?: string | null;
  uid_pic?: string | null;
  uid_receiver?: string | null;
  remarks?: string | null;
  // Daftar item final (lengkap). Tidak dikirim = item tidak diubah.
  items?: ItemTransferEditItem[];
};

export type ModeratorItemTransferEditPayload = ItemTransferEditPayload & {
  approvals: ModeratorApprovalStep[];
  rejection_reason?: string;
  reason: string;
};

const IT_EDITABLE_FIELDS = [
  "it_tanggal",
  "shipment_type",
  "ekspedisi",
  "sender_name",
  "eksternal_provider",
  "eksternal_id",
  "jumlah_koli",
  "koli_detail",
  "layanan_kurir",
  "rate_per_kg",
  "no_resi",
  "estimasi_hari",
  "pic",
  "uid_pic",
  "uid_receiver",
  "remarks",
] as const;

const IT_FIELD_LABEL: Record<string, string> = {
  it_kode: "kode",
  it_tanggal: "tanggal",
  dari_cabang_id: "gudang asal",
  ke_cabang_id: "gudang tujuan",
  shipment_type: "jenis pengiriman",
  ekspedisi: "kurir",
  sender_name: "nama pengantar",
  eksternal_provider: "penyedia handcarry",
  eksternal_id: "booking ID",
  jumlah_koli: "koli",
  koli_detail: "koli",
  layanan_kurir: "layanan kurir",
  rate_per_kg: "rate/kg",
  no_resi: "no. resi",
  estimasi_hari: "estimasi",
  pic: "PIC",
  uid_pic: "PIC",
  uid_receiver: "penerima",
  remarks: "keterangan",
};

type ItItemRow = {
  id?: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  mr_item_id: number | null;
  receive_item_id: number | null;
};

type ItemTransferEditPlan = {
  headerPatch: Record<string, any>;
  itemsChanged: boolean;
  toUpdate: { id: number; qty: number }[];
  toDelete: number[];
  toInsert: Omit<ItItemRow, "id">[];
  finalItems: ItItemRow[];
  // Qty final - qty sebelum edit, per part (koreksi stok IT yang sudah keluar).
  partDelta: Map<number, number>;
  partLabel: Map<number, string>;
};

const IT_ITEM_COLUMNS =
  "id, part_id, part_number, part_name, satuan, qty, mr_item_id, receive_item_id";

// Pembanding nilai header lama vs baru (koli_detail JSONB urutan key-nya
// diacak Postgres, angka numeric bisa datang sebagai string).
function normalizeItField(key: string, v: any) {
  if (key === "koli_detail")
    return parseKoliDetail(v).map((r) => [
      r.qty,
      r.berat_kg,
      r.panjang_cm,
      r.lebar_cm,
      r.tinggi_cm,
    ]);
  if (v === "" || v === undefined || v === null) return null;
  if (["rate_per_kg", "jumlah_koli", "estimasi_hari"].includes(key)) return Number(v);
  if (key === "it_tanggal") return String(v).slice(0, 10);
  return v;
}

function deriveItApprovalStatus(
  steps: { status: string }[],
): "open" | "approved" | "rejected" {
  if (steps.some((s) => s.status === "rejected")) return "rejected";
  if (steps.length > 0 && steps.every((s) => s.status === "approved")) return "approved";
  return "open";
}

/** Jalur approval dari ApprovalFlowEditor -> bentuk JSON approvals Item Transfer. */
function toItApprovals(steps: ModeratorApprovalStep[]) {
  const now = new Date().toISOString();
  return steps.map((s, idx) => {
    const pending = s.status === "pending";
    return {
      step_id: s.step_id ?? null,
      step_order: idx + 1,
      level: s.approval_role,
      status: s.status,
      user_id: s.userid,
      nama: s.nama,
      email: s.email ?? null,
      role:
        s.role === "Requester"
          ? "Requester"
          : s.approval_role === "menyetujui"
            ? "Approver"
            : "Reviewer",
      processed_at: pending ? null : (s.processed_at ?? now),
      signature_url: pending ? null : (s.signature_url ?? null),
      notes: pending ? null : (s.notes ?? null),
    };
  });
}

/**
 * Validasi & susun perubahan Item Transfer (edit biasa maupun Moderator
 * Edit) tanpa menulis apa pun. Aturan qty mengikuti createItemTransfer (sisa
 * RI, sisa MR untuk IT konsinyasi, stok gudang asal, batas max gudang tujuan)
 * tapi cuma dicek untuk qty yang BERTAMBAH -- atau semua baris kalau gudang
 * berubah / IT rejected dihidupkan lagi -- supaya mengurangi qty atau
 * mengubah info lain tidak terblok data lama.
 */
async function planItemTransferEdit(
  supabase: any,
  it: any,
  currentItems: ItItemRow[],
  payload: ItemTransferEditPayload,
  opts: { revive: boolean; checkAllSourceStock: boolean },
): Promise<{ error: string } | { plan: ItemTransferEditPlan }> {
  const released = Boolean(it.stock_released);
  const completed = it.status === "completed";
  const isConsignment = Boolean(it.it_is_consignment);
  const headerPatch: Record<string, any> = {};

  // --- Header ---
  if (payload.it_kode !== undefined) {
    const kode = payload.it_kode.trim();
    if (!kode) return { error: "Kode Item Transfer wajib diisi." };
    if (kode !== it.it_kode) {
      // stock_movements & kartu stok konsinyasi mereferensikan it_kode.
      if (released)
        return {
          error:
            "Kode tidak bisa diubah setelah stok keluar — riwayat stok sudah tercatat dengan kode lama.",
        };
      const { data: dup } = await supabase
        .from("item_transfers")
        .select("id")
        .eq("it_kode", kode)
        .neq("id", it.id)
        .maybeSingle();
      if (dup) return { error: "Kode Item Transfer sudah digunakan. Gunakan kode lain." };
      headerPatch.it_kode = kode;
    }
  }

  const dari = Number(payload.dari_cabang_id ?? it.dari_cabang_id);
  const ke = Number(payload.ke_cabang_id ?? it.ke_cabang_id);
  const dariChanged = dari !== Number(it.dari_cabang_id);
  const keChanged = ke !== Number(it.ke_cabang_id);
  if (dariChanged || keChanged) {
    if (released)
      return { error: "Gudang asal/tujuan tidak bisa diubah setelah stok keluar dari gudang asal." };
    if (!dari || !ke) return { error: "Gudang asal dan tujuan wajib dipilih." };
    if (dari === ke) return { error: "Gudang asal dan tujuan tidak boleh sama." };
    if (dariChanged) headerPatch.dari_cabang_id = dari;
    if (keChanged) headerPatch.ke_cabang_id = ke;
  }

  for (const key of IT_EDITABLE_FIELDS) {
    if (payload[key] === undefined) continue;
    // String kosong disimpan NULL (sama seperti createItemTransfer).
    headerPatch[key] = normalizeItField(key, payload[key]) === null ? null : payload[key];
  }
  if ("it_tanggal" in headerPatch && !headerPatch.it_tanggal)
    return { error: "Tanggal wajib diisi." };
  if ("shipment_type" in headerPatch && !SHIPMENT_LABEL[headerPatch.shipment_type])
    return { error: "Jenis pengiriman tidak valid." };
  if (
    "estimasi_hari" in headerPatch &&
    !(Number.isInteger(Number(headerPatch.estimasi_hari)) && Number(headerPatch.estimasi_hari) >= 1)
  )
    return { error: "Estimasi hari minimal 1." };
  if ("jumlah_koli" in headerPatch && !(Number(headerPatch.jumlah_koli) >= 1))
    return { error: "Jumlah koli minimal 1." };
  if ("koli_detail" in headerPatch) {
    if (!Array.isArray(headerPatch.koli_detail)) return { error: "Detail koli tidak valid." };
    if (headerPatch.koli_detail.length > 0) {
      // Berat tidak diwajibkan: IT lama belum punya detail koli.
      const koliErr = validateKoliRows(headerPatch.koli_detail, { requireBerat: false });
      if (koliErr) return { error: koliErr };
    }
  }
  if ("rate_per_kg" in headerPatch && headerPatch.rate_per_kg !== null) {
    if (Number(headerPatch.rate_per_kg) < 0) return { error: "Rate per kg tidak boleh negatif." };
    if (Number(headerPatch.rate_per_kg) === 0) headerPatch.rate_per_kg = null;
  }

  // Hanya field yang benar-benar berubah yang ditulis.
  for (const key of Object.keys(headerPatch)) {
    if (key === "it_kode" || key === "dari_cabang_id" || key === "ke_cabang_id") continue;
    if (
      JSON.stringify(normalizeItField(key, headerPatch[key])) ===
      JSON.stringify(normalizeItField(key, it[key]))
    )
      delete headerPatch[key];
  }
  if (completed && "uid_receiver" in headerPatch)
    return { error: "Penerima tidak bisa diubah: barang sudah dikonfirmasi diterima." };

  // --- Item ---
  const currentById = new Map(currentItems.map((i) => [i.id!, i]));
  let finalItems: ItItemRow[] = currentItems;
  const toUpdate: { id: number; qty: number }[] = [];
  const toInsert: Omit<ItItemRow, "id">[] = [];
  let toDelete: number[] = [];

  if (payload.items !== undefined) {
    if (completed)
      return {
        error:
          "Item Transfer sudah selesai (barang diterima di gudang tujuan). Item tidak bisa diubah lagi.",
      };
    if (payload.items.length === 0) return { error: "Daftar item tidak boleh kosong." };
    if (payload.items.some((i) => !(Number(i.qty) > 0) || !Number.isInteger(Number(i.qty))))
      return { error: "Qty item harus bilangan bulat lebih dari 0." };

    const newPartIds = Array.from(
      new Set(payload.items.filter((i) => i.id == null).map((i) => Number(i.part_id))),
    );
    const { data: barangRows } =
      newPartIds.length > 0
        ? await supabase
            .from("barang")
            .select("id, part_number, part_name, part_satuan")
            .in("id", newPartIds)
        : { data: [] as any[] };
    const barangById = new Map((barangRows || []).map((b: any) => [b.id, b]));

    finalItems = [];
    const kept = new Set<number>();
    for (const row of payload.items) {
      const qty = Number(row.qty);
      if (row.id != null) {
        const cur = currentById.get(row.id);
        if (!cur || kept.has(row.id))
          return { error: "Data item tidak sinkron dengan Item Transfer ini. Muat ulang halaman." };
        kept.add(row.id);
        if (qty !== Number(cur.qty)) toUpdate.push({ id: row.id, qty });
        finalItems.push({ ...cur, qty });
      } else {
        const b: any = barangById.get(Number(row.part_id));
        if (!b) return { error: `Barang ${row.part_number || row.part_id} tidak ditemukan.` };
        const line = {
          part_id: b.id,
          part_number: b.part_number,
          part_name: b.part_name,
          satuan: b.part_satuan || row.satuan,
          qty,
          mr_item_id: null,
          receive_item_id: null,
        };
        toInsert.push(line);
        finalItems.push(line);
      }
    }
    toDelete = currentItems.filter((i) => !kept.has(i.id!)).map((i) => i.id!);
    // Diblok juga oleh trigger guard_consignment_item_transfer_delete.
    if (released && isConsignment && toDelete.length > 0)
      return {
        error:
          "Baris item IT konsinyasi yang sedang dalam pengiriman tidak bisa dihapus — kurangi qty-nya saja.",
      };
  }
  const itemsChanged = toUpdate.length + toDelete.length + toInsert.length > 0;

  const partLabel = new Map<number, string>();
  for (const i of [...currentItems, ...finalItems]) partLabel.set(i.part_id, i.part_number);
  const originalByPart = sumQtyByPart(currentItems, (i) => i.qty);
  const finalByPart = sumQtyByPart(finalItems, (i) => i.qty);
  // IT rejected tidak dihitung memakai sisa RI/MR maupun stok, jadi kalau
  // dihidupkan lagi seluruh qty-nya dianggap baru.
  const baselineByPart = opts.revive ? new Map<number, number>() : originalByPart;
  const allParts = Array.from(finalByPart.keys());
  const increasedParts = allParts.filter(
    (p) => (finalByPart.get(p) || 0) > (baselineByPart.get(p) || 0),
  );
  const rowIncreased = (r: ItItemRow) =>
    opts.revive || r.id == null || r.qty > Number(currentById.get(r.id)?.qty || 0);
  const sumRows = (pred: (r: ItItemRow) => boolean) =>
    finalItems.filter(pred).reduce((s, r) => s + r.qty, 0);

  // Baris dari RI: barang RI harus mendarat di gudang asal & total qty tidak
  // melebihi sisa RI (qty RI - IT lain yang tidak rejected).
  const riCheckIds = Array.from(
    new Set(
      finalItems
        .filter((r) => r.receive_item_id && (dariChanged || rowIncreased(r)))
        .map((r) => r.receive_item_id!),
    ),
  );
  if (riCheckIds.length > 0) {
    const lineage = await resolveReceiveItemsMrLineage(supabase, riCheckIds);
    const { data: usedRows } = await supabase
      .from("item_transfer_items")
      .select("receive_item_id, qty, it_id, item_transfers!inner(status)")
      .in("receive_item_id", riCheckIds)
      .neq("item_transfers.status", "rejected");
    const used = new Map<number, number>();
    for (const row of usedRows || []) {
      if (Number(row.it_id) === Number(it.id)) continue;
      used.set(row.receive_item_id, (used.get(row.receive_item_id) || 0) + Number(row.qty));
    }
    for (const riItemId of riCheckIds) {
      const name = finalItems.find((r) => r.receive_item_id === riItemId)?.part_number;
      const l = lineage.get(riItemId);
      if (!l) return { error: `${name}: baris RI sumber tidak ditemukan.` };
      if (l.ri_status !== "completed") return { error: `${name}: RI sumber belum completed.` };
      if (Number(l.cabang_penerima_id) !== dari)
        return { error: `${name}: barang RI ini tidak diterima di gudang asal yang dipilih.` };
      const requested = sumRows((r) => r.receive_item_id === riItemId);
      const sisa = l.qty - (used.get(riItemId) || 0);
      if (requested > sisa)
        return {
          error: `${name}: qty ${requested} melebihi sisa RI yang belum di-transfer (${Math.max(0, sisa)}).`,
        };
    }
  }

  // Baris IT konsinyasi yang membawa MR site tujuan: MR approved, milik
  // gudang tujuan, qty <= sisa MR (di luar IT ini).
  const mrCheckIds = isConsignment
    ? Array.from(
        new Set(
          finalItems
            .filter((r) => r.mr_item_id && !r.receive_item_id && (keChanged || rowIncreased(r)))
            .map((r) => r.mr_item_id!),
        ),
      )
    : [];
  if (mrCheckIds.length > 0) {
    const outstanding = await computeMrItemsOutstandingForTransfer(supabase, mrCheckIds, {
      excludeItId: it.id,
    });
    for (const mrItemId of mrCheckIds) {
      const name = finalItems.find((r) => r.mr_item_id === mrItemId)?.part_number;
      const o = outstanding.get(mrItemId);
      if (!o) return { error: `${name}: item MR tidak ditemukan.` };
      if (o.mr_status !== "approved")
        return { error: `${name}: MR ${o.mr_kode} tidak berstatus approved.` };
      if (Number(o.cabang_id) !== ke)
        return { error: `${name}: MR ${o.mr_kode} bukan milik gudang tujuan.` };
      if (o.item_status === "rejected")
        return { error: `${name}: item MR ${o.mr_kode} sudah ditolak.` };
      const requested = sumRows((r) => r.mr_item_id === mrItemId && !r.receive_item_id);
      if (requested > o.outstanding)
        return {
          error: `MR ${o.mr_kode}: qty ${requested} melebihi sisa MR yang belum terpenuhi (${o.outstanding}).`,
        };
    }
  }

  // Stok gudang asal (IT yang stoknya sudah keluar dicek atomik saat koreksi).
  if (!released) {
    const parts = dariChanged || opts.checkAllSourceStock ? allParts : increasedParts;
    if (parts.length > 0) {
      let stockMap: Map<number, number>;
      if (isConsignment) {
        stockMap = await fetchConsignmentStockMap(supabase, it.it_vendor_id, dari, parts);
      } else {
        const { data: stockRows } = await supabase
          .from("stock")
          .select("part_id, qty")
          .eq("cabang_id", dari)
          .in("part_id", parts);
        stockMap = new Map((stockRows || []).map((s: any) => [s.part_id, Number(s.qty) || 0]));
      }
      const violations = parts
        .filter((p) => (finalByPart.get(p) || 0) > (stockMap.get(p) ?? 0))
        .map((p) => `${partLabel.get(p)}: butuh ${finalByPart.get(p)}, stok ${stockMap.get(p) ?? 0}`);
      if (violations.length > 0)
        return {
          error:
            `Qty melebihi stok ${isConsignment ? "konsinyasi " : ""}gudang asal:\n` +
            violations.join("\n"),
        };
    }
  }

  // Batas max stok gudang tujuan (tidak berlaku untuk stok titipan vendor).
  if (!isConsignment) {
    const parts = keChanged ? allParts : increasedParts;
    if (parts.length > 0) {
      const { data: destRows } = await supabase
        .from("stock")
        .select("part_id, qty, max_qty")
        .eq("cabang_id", ke)
        .in("part_id", parts);
      const destMap = new Map((destRows || []).map((s: any) => [s.part_id, s]));
      const violations: string[] = [];
      for (const p of parts) {
        const d: any = destMap.get(p);
        const destMax = d?.max_qty ?? 0;
        const destQty = d?.qty ?? 0;
        const needed = finalByPart.get(p) || 0;
        if (destMax <= 0)
          violations.push(`${partLabel.get(p)}: belum ada batas max stok di gudang tujuan`);
        else if (destQty + needed > destMax)
          violations.push(`${partLabel.get(p)}: ${destQty} + ${needed} melebihi max ${destMax}`);
      }
      if (violations.length > 0)
        return { error: "Melebihi batas max stok gudang tujuan:\n" + violations.join("\n") };
    }
  }

  const partDelta = new Map<number, number>();
  for (const p of new Set([...originalByPart.keys(), ...finalByPart.keys()])) {
    const d = (finalByPart.get(p) || 0) - (originalByPart.get(p) || 0);
    if (d !== 0) partDelta.set(p, d);
  }

  return {
    plan: {
      headerPatch,
      itemsChanged,
      toUpdate,
      toDelete,
      toInsert,
      finalItems,
      partDelta,
      partLabel,
    },
  };
}

async function applyItemTransferItemChanges(
  supabase: any,
  itId: number,
  plan: ItemTransferEditPlan,
): Promise<string | null> {
  if (plan.toDelete.length > 0) {
    const { error } = await supabase
      .from("item_transfer_items")
      .delete()
      .in("id", plan.toDelete)
      .eq("it_id", itId);
    if (error) return `Gagal hapus item: ${error.message}`;
  }
  for (const u of plan.toUpdate) {
    const { error } = await supabase
      .from("item_transfer_items")
      .update({ qty: u.qty, updated_at: new Date().toISOString() })
      .eq("id", u.id)
      .eq("it_id", itId);
    if (error) return `Gagal update item: ${error.message}`;
  }
  if (plan.toInsert.length > 0) {
    const { error } = await supabase
      .from("item_transfer_items")
      .insert(plan.toInsert.map((i) => ({ ...i, it_id: itId })));
    if (error) return `Gagal tambah item: ${error.message}`;
  }
  return null;
}

/**
 * Koreksi stok gudang asal untuk IT yang stoknya SUDAH keluar (approved,
 * belum diterima): qty naik -> stok asal dipotong lagi, qty turun / baris
 * dihapus -> dikembalikan. Pemotongan dijalankan dulu; gagal -> perubahan
 * yang sudah terjadi dikembalikan.
 */
async function applyReleasedQtyCorrection(
  supabase: any,
  it: {
    it_kode: string;
    dari_cabang_id: number;
    it_is_consignment?: boolean | null;
    it_vendor_id?: number | null;
  },
  plan: ItemTransferEditPlan,
  userId: string,
) {
  const changes = Array.from(plan.partDelta.entries());
  if (changes.length === 0) return { success: true };
  const noteOf = (partId: number, d: number) =>
    `Edit Item Transfer ${it.it_kode}: koreksi qty ${plan.partLabel.get(partId)} ${d > 0 ? `+${d} (keluar tambahan)` : `${d} (kembali ke gudang asal)`}`;

  if (it.it_is_consignment && it.it_vendor_id) {
    const res = await applyConsignmentChanges(
      supabase,
      changes.map(([partId, d]) => ({
        vendorId: it.it_vendor_id!,
        cabangId: it.dari_cabang_id,
        partId,
        delta: -d,
        label: plan.partLabel.get(partId),
        notes: noteOf(partId, d),
      })),
      { type: "IT_OUT", referenceId: it.it_kode, actorId: userId },
    );
    if (!res.ok) return { error: "Stok konsinyasi gudang asal tidak mencukupi:\n" + res.error };
    return { success: true };
  }

  const ordered = [...changes].sort((a, b) => b[1] - a[1]);
  const applied: [number, number][] = [];
  for (const [partId, d] of ordered) {
    const res = await changeStockQty(
      supabase,
      { partId, cabangId: it.dari_cabang_id },
      -d,
      { label: plan.partLabel.get(partId) },
    );
    if (!res.ok) {
      for (const [p, ad] of applied) {
        await changeStockQty(supabase, { partId: p, cabangId: it.dari_cabang_id }, ad, {
          allowNegative: true,
        });
      }
      return { error: "Stok gudang asal tidak mencukupi:\n" + res.error };
    }
    applied.push([partId, d]);
  }
  await supabase.from("stock_movements").insert(
    changes.map(([partId, d]) => ({
      part_id: partId,
      cabang_id: it.dari_cabang_id,
      qty_change: -d,
      type: "IT",
      reference_id: it.it_kode,
      created_by: userId,
      notes: noteOf(partId, d),
    })),
  );
  return { success: true };
}

/**
 * EDIT BIASA: pembuat IT atau approver "menyetujui" yang sedang giliran bisa
 * mengubah header, info pengiriman, dan item selama IT masih menunggu
 * approval (stok belum keluar). Sama seperti Edit Isi MR: setelah disimpan
 * approval diulang dari tahap ke-2 (tahap pembuat tetap).
 */
export async function editItemTransfer(itId: number, payload: ItemTransferEditPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const { data: it } = await supabase
    .from("item_transfers")
    .select("*")
    .eq("id", itId)
    .single();
  if (!it) return { error: "Item Transfer tidak ditemukan." };
  if (it.status !== "open" || it.stock_released)
    return {
      error:
        "Item Transfer hanya bisa diedit selama masih menunggu approval (stok belum keluar). Hubungi moderator untuk perubahan setelahnya.",
    };

  const approvals: any[] = it.approvals || [];
  const pendingStep = approvals.find((a) => a.status === "pending");
  const isRequester = it.uid_requester === user.id || it.created_by === user.id;
  const isPendingMenyetujui =
    !!pendingStep &&
    (pendingStep.user_id === user.id || pendingStep.userid === user.id) &&
    (pendingStep.level ?? pendingStep.approval_role ?? "menyetujui") !== "mengetahui";
  if (!isRequester && !isPendingMenyetujui)
    return {
      error:
        "Hanya pembuat Item Transfer atau approver 'Menyetujui' yang sedang giliran yang bisa mengedit.",
    };

  const { data: currentItems } = await supabase
    .from("item_transfer_items")
    .select(IT_ITEM_COLUMNS)
    .eq("it_id", itId);

  const planned = await planItemTransferEdit(supabase, it, currentItems || [], payload, {
    revive: false,
    checkAllSourceStock: false,
  });
  if ("error" in planned) return { error: planned.error };
  const { plan } = planned;
  if (!plan.itemsChanged && Object.keys(plan.headerPatch).length === 0)
    return { error: "Tidak ada perubahan untuk disimpan." };

  const resetApprovals = approvals.map((a, idx) =>
    idx === 0
      ? a
      : { ...a, status: "pending", processed_at: null, signature_url: null, notes: null },
  );

  // Claim kondisional dulu: kalau approver terakhir barusan approve (stok
  // keluar), edit ini batal sebelum item disentuh.
  const { data: claimed, error: claimErr } = await supabase
    .from("item_transfers")
    .update({
      ...plan.headerPatch,
      approvals: resetApprovals,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itId)
    .eq("status", "open")
    .eq("stock_released", false)
    .select("id");
  if (claimErr) return { error: claimErr.message };
  if (!claimed || claimed.length === 0)
    return { error: "Item Transfer ini baru saja diproses oleh request lain. Muat ulang halaman." };

  const itemErr = await applyItemTransferItemChanges(supabase, itId, plan);
  if (itemErr) return { error: itemErr };

  notifyApprovers(
    resetApprovals.slice(1),
    "Item Transfer",
    itId,
    plan.headerPatch.it_kode ?? it.it_kode,
    `/item-transfer/${itId}`,
  ).catch(console.error);

  revalidatePath("/item-transfer");
  revalidatePath(`/item-transfer/${itId}`);
  return { success: true };
}

/**
 * MODERATOR EDIT: header, info pengiriman, item, dan jalur/status approval
 * sekaligus, di luar giliran approval normal. Batasan mengikuti posisi stok:
 *  - Stok belum keluar (open/rejected): semua bisa diubah, termasuk gudang &
 *    kode. Jadi approved semua -> stok gudang asal dikeluarkan seperti
 *    approve normal.
 *  - Stok sudah keluar (approved, belum diterima): gudang & kode dikunci,
 *    status tidak bisa turun dari approved; perubahan qty langsung
 *    dikoreksi ke stok gudang asal.
 *  - Completed (barang diterima, stok tujuan & MR sudah dikredit): hanya
 *    info dokumen/pengiriman.
 */
export async function moderatorEditItemTransfer(
  itId: number,
  payload: ModeratorItemTransferEditPayload,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  const isModerator = (roleRows || []).some((r: any) => r?.roles?.name === "moderator");
  if (!isModerator) return { error: "Hanya moderator yang dapat menggunakan Moderator Edit." };

  const reason = payload.reason?.trim();
  if (!reason) return { error: "Alasan perubahan wajib diisi." };

  const { data: it } = await supabase
    .from("item_transfers")
    .select("*")
    .eq("id", itId)
    .single();
  if (!it) return { error: "Item Transfer tidak ditemukan." };

  const prevStatus: string = it.status;
  if (!["open", "approved", "rejected", "completed"].includes(prevStatus))
    return { error: `Item Transfer berstatus ${prevStatus}, tidak bisa diedit.` };

  if (!payload.approvals || payload.approvals.length === 0)
    return { error: "Jalur approval tidak boleh kosong." };
  for (const step of payload.approvals) {
    if (!step.userid || !step.nama)
      return { error: "Setiap tahap approval harus punya approver yang dipilih." };
    if (!["menyetujui", "mengetahui"].includes(step.approval_role))
      return { error: "Role approval tidak valid." };
    if (!["pending", "approved", "rejected"].includes(step.status))
      return { error: "Status approval tidak valid." };
  }

  const released = Boolean(it.stock_released);
  const completed = prevStatus === "completed";
  const derived = deriveItApprovalStatus(payload.approvals);
  if ((released || completed) && derived !== "approved")
    return {
      error: completed
        ? "Item Transfer sudah selesai (barang diterima). Status approval tidak bisa diubah keluar dari 'approved'."
        : "Stok Item Transfer ini sudah keluar dari gudang asal. Status approval tidak bisa diturunkan dari 'approved'.",
    };
  const newStatus = completed ? "completed" : derived;
  const rejectionReason = payload.rejection_reason?.trim() || "";
  if (newStatus === "rejected" && !rejectionReason)
    return { error: "Alasan penolakan wajib diisi jika status approval jadi rejected." };
  const becomingApproved = !released && newStatus === "approved";

  const { data: currentItems } = await supabase
    .from("item_transfer_items")
    .select(IT_ITEM_COLUMNS)
    .eq("it_id", itId);

  const planned = await planItemTransferEdit(supabase, it, currentItems || [], payload, {
    revive: prevStatus === "rejected" && newStatus !== "rejected",
    checkAllSourceStock: becomingApproved,
  });
  if ("error" in planned) return { error: planned.error };
  const { plan } = planned;

  const newApprovals = toItApprovals(payload.approvals);
  const claimPatch: Record<string, any> = {
    ...plan.headerPatch,
    approvals: newApprovals,
    status: newStatus,
    rejection_reason: newStatus === "rejected" ? rejectionReason : null,
    updated_at: new Date().toISOString(),
  };
  if (becomingApproved) claimPatch.stock_released = true;
  const revertPatch = Object.fromEntries(Object.keys(claimPatch).map((k) => [k, it[k]]));

  // Claim kondisional pada posisi stok/status yang dibaca di atas supaya
  // tidak bentrok dengan approve/finalize yang berjalan bersamaan.
  let claimQuery = supabase
    .from("item_transfers")
    .update(claimPatch)
    .eq("id", itId)
    .eq("status", prevStatus)
    .eq("stock_released", released);
  if (released && !completed) claimQuery = claimQuery.is("signature_receiver_id", null);
  const { data: claimed, error: claimErr } = await claimQuery.select("id");
  if (claimErr) return { error: claimErr.message };
  if (!claimed || claimed.length === 0)
    return { error: "Item Transfer ini baru saja diproses oleh request lain. Muat ulang halaman." };

  const itAfter = { ...it, ...plan.headerPatch };
  if (becomingApproved) {
    const res = await releaseStockFromSource(supabase, itAfter, plan.finalItems, user.id);
    if (res.error) {
      await supabase.from("item_transfers").update(revertPatch).eq("id", itId);
      return { error: res.error };
    }
  } else if (released && plan.itemsChanged) {
    const res = await applyReleasedQtyCorrection(supabase, itAfter, plan, user.id);
    if (res.error) {
      await supabase.from("item_transfers").update(revertPatch).eq("id", itId);
      return { error: res.error };
    }
  }

  const itemErr = await applyItemTransferItemChanges(supabase, itId, plan);
  if (itemErr) return { error: itemErr };

  // Audit log.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("nama")
    .eq("id", user.id)
    .single();
  const fieldLabels = Array.from(
    new Set(Object.keys(plan.headerPatch).map((k) => IT_FIELD_LABEL[k] || k)),
  );
  const summaryParts: string[] = [];
  if (fieldLabels.length > 0) summaryParts.push(fieldLabels.join("/"));
  if (plan.toUpdate.length) summaryParts.push(`${plan.toUpdate.length} item diubah`);
  if (plan.toInsert.length) summaryParts.push(`${plan.toInsert.length} item ditambah`);
  if (plan.toDelete.length) summaryParts.push(`${plan.toDelete.length} item dihapus`);
  if (prevStatus !== newStatus) summaryParts.push(`status ${prevStatus} → ${newStatus}`);
  summaryParts.push(`jalur approval (${newApprovals.length} tahap)`);
  const itemSnapshot = (rows: ItItemRow[]) =>
    rows.map((r) => ({ id: r.id ?? null, part_number: r.part_number, qty: r.qty }));

  await supabase.from("moderator_edit_logs").insert({
    doc_type: "item_transfer",
    doc_id: itId,
    user_id: user.id,
    user_nama: myProfile?.nama || user.email,
    summary: `Moderator edit: ${summaryParts.join(", ")}. Alasan: ${reason}`,
    changes: {
      reason,
      before: { ...revertPatch, approvals: it.approvals },
      after: claimPatch,
      items: plan.itemsChanged
        ? { before: itemSnapshot(currentItems || []), after: itemSnapshot(plan.finalItems) }
        : undefined,
    },
  });

  const itKode = itAfter.it_kode;
  if (prevStatus !== newStatus && it.uid_requester) {
    if (newStatus === "approved") {
      notifyDocumentOwner(
        it.uid_requester,
        "document_completed",
        "Item Transfer",
        itId,
        itKode,
        `/item-transfer/${itId}`,
        myProfile?.nama || "Moderator",
      ).catch(console.error);
    } else if (newStatus === "rejected") {
      notifyDocumentOwner(
        it.uid_requester,
        "rejected",
        "Item Transfer",
        itId,
        itKode,
        `/item-transfer/${itId}`,
        myProfile?.nama || "Moderator",
        rejectionReason,
      ).catch(console.error);
    }
  }
  if (newStatus === "open") {
    notifyApprovers(newApprovals, "Item Transfer", itId, itKode, `/item-transfer/${itId}`).catch(
      console.error,
    );
  }

  revalidatePath("/item-transfer");
  revalidatePath(`/item-transfer/${itId}`);
  revalidatePath("/stock");
  return { success: true };
}
