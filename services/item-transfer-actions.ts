"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { KoliRow } from "@/lib/shipment";
import {
  recomputeMrItemsFulfillment,
  resolveReceiveItemsMrLineage,
} from "@/lib/mr-fulfillment";
import { changeStockQty, sumQtyByPart } from "@/lib/stock-mutation";
import {
  notifyApprovers,
  notifyDocumentOwner,
} from "@/services/notification-actions";

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
  it: { id: number; it_kode: string; dari_cabang_id: number },
  items: { part_id: number; part_number: string; part_name: string; qty: number }[],
  userId?: string,
) {
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
  // Tanpa RI sumber tidak ada lineage MR yang sah.
  for (const item of data.items) {
    if (!item.receive_item_id) item.mr_item_id = null;
  }

  // Validasi qty <= stok gudang asal (dijumlah per part)
  const partIds = data.items.map((i) => i.part_id);
  const neededByPart = sumQtyByPart(data.items, (i) => i.qty);
  const { data: stockRows } = await supabase
    .from("stock")
    .select("part_id, qty")
    .eq("cabang_id", data.dari_cabang_id)
    .in("part_id", partIds);
  const stockMap = new Map((stockRows || []).map((s: any) => [s.part_id, s.qty]));
  const violations: string[] = [];
  for (const [partId, needed] of neededByPart) {
    const avail = (stockMap.get(partId) as number) ?? 0;
    const name = data.items.find((i) => i.part_id === partId)?.part_number;
    if (needed > avail) violations.push(`${name}: minta ${needed}, stok ${avail}`);
  }
  if (violations.length > 0)
    return { error: "Qty melebihi stok gudang asal:\n" + violations.join("\n") };

  // Validasi batas max stok di gudang tujuan: stok_tujuan + qty <= max_qty.
  // max_qty = 0 dianggap belum di-set => barang tidak boleh ditransfer ke sana.
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
      "id, it_kode, ke_cabang_id, dari_cabang_id, status, tracking_status, signature_receiver_id",
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

  // Tambah stok ke gudang tujuan
  for (const item of items) {
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
