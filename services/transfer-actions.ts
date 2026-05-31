"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
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
 * Kurangi stok dari gudang asal (saat TI disetujui penuh). Idempotent via
 * flag stock_released pada header.
 */
async function releaseStockFromSource(
  supabase: any,
  ti: { id: number; ti_kode: string; dari_cabang_id: number },
  items: { part_id: number; part_number: string; part_name: string; qty: number }[],
  userId?: string,
) {
  // Validasi ulang: stok asal harus mencukupi saat ini.
  const violations: string[] = [];
  for (const item of items) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", ti.dari_cabang_id)
      .maybeSingle();
    const avail = srcStock?.qty ?? 0;
    if (item.qty > avail) {
      violations.push(`${item.part_number}: minta ${item.qty}, stok ${avail}`);
    }
  }
  if (violations.length > 0) {
    return {
      error: "Stok gudang asal tidak mencukupi:\n" + violations.join("\n"),
    };
  }

  for (const item of items) {
    const { data: srcStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", ti.dari_cabang_id)
      .maybeSingle();
    if (srcStock) {
      await supabase
        .from("stock")
        .update({ qty: srcStock.qty - item.qty })
        .eq("id", srcStock.id);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: ti.dari_cabang_id,
      qty_change: -item.qty,
      type: "TI",
      reference_id: ti.ti_kode,
      created_by: userId,
      notes: `Transfer Item ${ti.ti_kode}: ${item.part_number} ${item.part_name} keluar dari cabang ${ti.dari_cabang_id} (dalam pengiriman)`,
    });
  }
  return { success: true };
}

/**
 * BUAT TRANSFER ITEM
 */
export async function createTransferItem(data: {
  ti_kode: string;
  ti_tanggal: string;
  dari_cabang_id: number;
  ke_cabang_id: number;
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
  }[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." };

  const tiKode = data.ti_kode?.trim();
  if (!tiKode) return { error: "Kode Transfer Item wajib diisi." };
  if (!data.dari_cabang_id || !data.ke_cabang_id)
    return { error: "Gudang asal dan tujuan wajib dipilih." };
  if (data.dari_cabang_id === data.ke_cabang_id)
    return { error: "Gudang asal dan tujuan tidak boleh sama." };
  if (!data.items || data.items.length === 0)
    return { error: "Daftar item tidak boleh kosong." };

  // Kode unik
  const { data: existing } = await supabase
    .from("transfer_items")
    .select("id")
    .eq("ti_kode", tiKode)
    .maybeSingle();
  if (existing)
    return { error: "Kode Transfer Item sudah digunakan. Gunakan kode lain." };

  // Validasi qty <= stok gudang asal
  const partIds = data.items.map((i) => i.part_id);
  const { data: stockRows } = await supabase
    .from("stock")
    .select("part_id, qty")
    .eq("cabang_id", data.dari_cabang_id)
    .in("part_id", partIds);
  const stockMap = new Map((stockRows || []).map((s: any) => [s.part_id, s.qty]));
  const violations: string[] = [];
  for (const item of data.items) {
    const avail = (stockMap.get(item.part_id) as number) ?? 0;
    if (item.qty <= 0) violations.push(`${item.part_number}: qty harus > 0`);
    else if (item.qty > avail)
      violations.push(`${item.part_number}: minta ${item.qty}, stok ${avail}`);
  }
  if (violations.length > 0)
    return { error: "Qty melebihi stok gudang asal:\n" + violations.join("\n") };

  const approvals = data.approvals ?? [];
  const initialStatus =
    approvals.length === 0 || approvals.every((a: any) => a.status !== "pending")
      ? "approved"
      : "open";

  // Insert header
  const { data: ti, error: tiError } = await supabase
    .from("transfer_items")
    .insert([
      {
        ti_kode: tiKode,
        ti_tanggal: data.ti_tanggal,
        dari_cabang_id: data.dari_cabang_id,
        ke_cabang_id: data.ke_cabang_id,
        shipment_type: data.shipment_type || "ekspedisi",
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
  if (tiError) return { error: tiError.message };

  // Insert items
  const itemsToInsert = data.items.map((item) => ({
    ti_id: ti.id,
    part_id: item.part_id,
    part_number: item.part_number,
    part_name: item.part_name,
    satuan: item.satuan,
    qty: item.qty,
  }));
  const { error: itemsError } = await supabase
    .from("transfer_item_items")
    .insert(itemsToInsert);
  if (itemsError) return { error: itemsError.message };

  // Jika langsung approved (tanpa langkah pending), keluarkan stok sekarang.
  if (initialStatus === "approved") {
    const res = await releaseStockFromSource(supabase, ti, data.items, user.id);
    if (res.error) return { error: res.error };
    await supabase
      .from("transfer_items")
      .update({ stock_released: true })
      .eq("id", ti.id);
  } else if (approvals.length > 0) {
    notifyApprovers(
      approvals,
      "Transfer Item",
      ti.id,
      ti.ti_kode,
      `/transfer-item/${ti.id}`,
    ).catch(console.error);
  }

  revalidatePath("/transfer-item");
  revalidatePath("/stock");
  return { success: true, data: ti };
}

/**
 * SETUJUI TRANSFER ITEM (advance approval; stok keluar saat langkah terakhir)
 */
export async function approveTransferItem(tiId: number, signatureUrl: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: ti, error: tiError } = await supabase
    .from("transfer_items")
    .select("*")
    .eq("id", tiId)
    .single();
  if (tiError || !ti) return { error: "Transfer Item tidak ditemukan" };
  if (ti.status === "rejected")
    return { error: "Transfer Item ini sudah ditolak" };

  const approvals = [...(ti.approvals || [])];
  const currentStepIndex = approvals.findIndex(
    (a: any) => a.status === "pending",
  );
  if (currentStepIndex === -1)
    return { error: "Tidak ada langkah approval yang menunggu" };

  const isLastStep = currentStepIndex === approvals.length - 1;

  // Jika langkah terakhir: keluarkan stok dari gudang asal (validasi dulu).
  if (isLastStep && !ti.stock_released) {
    const { data: items } = await supabase
      .from("transfer_item_items")
      .select("part_id, part_number, part_name, qty")
      .eq("ti_id", tiId);
    const res = await releaseStockFromSource(
      supabase,
      ti,
      items || [],
      user.id,
    );
    if (res.error) return { error: res.error };
  }

  approvals[currentStepIndex].status = "approved";
  approvals[currentStepIndex].signature_url = signatureUrl;
  approvals[currentStepIndex].processed_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("transfer_items")
    .update({
      approvals,
      status: isLastStep ? "approved" : "open",
      stock_released: isLastStep ? true : ti.stock_released,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tiId);
  if (updateError) return { error: updateError.message };

  notifyDocumentOwner(
    ti.uid_requester,
    isLastStep ? "document_completed" : "approved",
    "Transfer Item",
    tiId,
    ti.ti_kode,
    `/transfer-item/${tiId}`,
    approvals[currentStepIndex].nama,
  ).catch(console.error);

  if (!isLastStep) {
    const remaining = approvals.filter((a: any) => a.status === "pending");
    notifyApprovers(
      remaining,
      "Transfer Item",
      tiId,
      ti.ti_kode,
      `/transfer-item/${tiId}`,
    ).catch(console.error);
  }

  revalidatePath("/transfer-item");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * TOLAK TRANSFER ITEM
 */
export async function rejectTransferItem(tiId: number, reason: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" };

  const { data: ti } = await supabase
    .from("transfer_items")
    .select("id, ti_kode, status, stock_released, approvals, uid_requester")
    .eq("id", tiId)
    .single();
  if (!ti) return { error: "Transfer Item tidak ditemukan" };
  if (ti.stock_released)
    return {
      error:
        "Tidak bisa menolak: stok sudah keluar dari gudang asal (TI sudah disetujui).",
    };

  const approvals = [...(ti.approvals || [])];
  const idx = approvals.findIndex((a: any) => a.status === "pending");
  if (idx !== -1) {
    approvals[idx].status = "rejected";
    approvals[idx].processed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("transfer_items")
    .update({
      status: "rejected",
      rejection_reason: reason,
      approvals,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tiId);
  if (error) return { error: error.message };

  notifyDocumentOwner(
    ti.uid_requester,
    "rejected",
    "Transfer Item",
    tiId,
    ti.ti_kode,
    `/transfer-item/${tiId}`,
    undefined,
  ).catch(console.error);

  revalidatePath("/transfer-item");
  return { success: true };
}

/**
 * UPDATE TRACKING (hanya setelah approved)
 */
export async function updateTransferItemTracking(
  tiId: number,
  trackingStatus: string,
) {
  const supabase = await createClient();
  if (!TRACKING_ORDER.includes(trackingStatus))
    return { error: "Status tracking tidak valid" };

  const { data: ti } = await supabase
    .from("transfer_items")
    .select("status")
    .eq("id", tiId)
    .single();
  if (!ti) return { error: "Transfer Item tidak ditemukan" };
  if (ti.status !== "approved")
    return { error: "Transfer Item harus disetujui dulu sebelum tracking." };

  const { error } = await supabase
    .from("transfer_items")
    .update({ tracking_status: trackingStatus, updated_at: new Date().toISOString() })
    .eq("id", tiId);
  if (error) return { error: error.message };

  revalidatePath("/transfer-item");
  return { success: true };
}

/**
 * FINALISASI: gudang tujuan konfirmasi terima → stok masuk ke gudang tujuan.
 */
export async function finalizeTransferItem(tiId: number, signatureId: string) {
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

  const { data: ti } = await supabase
    .from("transfer_items")
    .select(
      "id, ti_kode, ke_cabang_id, dari_cabang_id, status, tracking_status, signature_receiver_id",
    )
    .eq("id", tiId)
    .single();
  if (!ti) return { error: "Transfer Item tidak ditemukan" };

  if (ti.signature_receiver_id || ti.status === "completed")
    return { success: true, alreadyFinalized: true };

  if (ti.tracking_status !== "delivered")
    return {
      error:
        "Tracking belum mencapai 'Barang Diterima'. Update tracking terlebih dahulu.",
    };
  if (profile.cabang_id !== ti.ke_cabang_id)
    return {
      error: "Hanya admin gudang tujuan yang dapat menyelesaikan transfer ini.",
    };

  // Validasi tanda tangan milik user
  const { data: sig } = await supabase
    .from("user_signatures")
    .select("id")
    .eq("id", signatureId)
    .eq("user_id", user.id)
    .eq("is_hidden", false)
    .single();
  if (!sig) return { error: "Tanda tangan tidak valid" };

  const { data: items } = await supabase
    .from("transfer_item_items")
    .select("part_id, part_number, part_name, qty")
    .eq("ti_id", tiId);
  if (!items || items.length === 0) return { error: "Tidak ada item transfer" };

  // Tambah stok ke gudang tujuan
  for (const item of items) {
    const { data: destStock } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", ti.ke_cabang_id)
      .maybeSingle();
    if (destStock) {
      await supabase
        .from("stock")
        .update({ qty: destStock.qty + item.qty })
        .eq("id", destStock.id);
    } else {
      await supabase
        .from("stock")
        .insert([
          { part_id: item.part_id, cabang_id: ti.ke_cabang_id, qty: item.qty },
        ]);
    }
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: ti.ke_cabang_id,
      qty_change: item.qty,
      type: "TI",
      reference_id: ti.ti_kode,
      created_by: user.id,
      notes: `Transfer Item ${ti.ti_kode}: ${item.part_number} ${item.part_name} diterima di cabang ${ti.ke_cabang_id}`,
    });
  }

  const { error } = await supabase
    .from("transfer_items")
    .update({
      status: "completed",
      tracking_status: "completed",
      signature_receiver_id: signatureId,
      signed_by_receiver_at: new Date().toISOString(),
      uid_receiver: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tiId);
  if (error) return { error: error.message };

  revalidatePath("/transfer-item");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * HAPUS TRANSFER ITEM (hanya jika stok belum keluar / belum approved).
 */
export async function deleteTransferItem(tiId: number) {
  const supabase = await createClient();
  const { data: ti } = await supabase
    .from("transfer_items")
    .select("id, stock_released, status")
    .eq("id", tiId)
    .single();
  if (!ti) return { error: "Transfer Item tidak ditemukan" };
  if (ti.stock_released)
    return {
      error: "Tidak bisa menghapus: stok sudah bergerak. Batalkan via proses.",
    };

  const { error } = await supabase
    .from("transfer_items")
    .delete()
    .eq("id", tiId);
  if (error) return { error: error.message };

  revalidatePath("/transfer-item");
  return { success: true };
}
