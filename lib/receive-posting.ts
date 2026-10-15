// Posting penerimaan barang (RI). Lihat applyReceiveCompletion di bawah.

import { changeStockQty } from "@/lib/stock-mutation";
import {
  recomputeMrItemsFulfillment,
  resolveReceiveItemsMrLineage,
} from "@/lib/mr-fulfillment";
import { syncPoReceiveAndCompletion } from "@/lib/procurement-status";

/**
 * PRIVATE HELPER: Adjust Stock at an explicit cabang (gudang penerima RI,
 * BUKAN otomatis cabang MR lagi -- lihat catatan di applyReceiveCompletion).
 */
async function adjustItemStock(
  supabase: any,
  cabangId: number,
  partId: number,
  partNumber: string | null,
  quantity: number,
  mode: "add" | "subtract",
  type: "PR" | "SS" | "RI",
  fromStatus: string,
  toStatus: string,
  referenceKode: string,
) {
  const branchId = cabangId;
  const { data: cabangRow } = await supabase
    .from("cabang")
    .select("nama_cabang")
    .eq("id", branchId)
    .maybeSingle();
  const mrLocationName = cabangRow?.nama_cabang || "Unknown Site";

  // Resolve canonical part_id using part_number when available.
  let canonicalPartId = partId;
  if (partNumber) {
    const { data: partByNumber } = await supabase
      .from("barang")
      .select("id")
      .eq("part_number", partNumber)
      .maybeSingle();

    if (partByNumber?.id) {
      canonicalPartId = partByNumber.id;
    }
  }
  const qtyChange = mode === "add" ? quantity : -quantity;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: partInfo } = await supabase
    .from("barang")
    .select("part_number, part_name, part_satuan")
    .eq("id", canonicalPartId)
    .maybeSingle();

  let actorLabel = "System";
  if (user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("nama")
      .eq("id", user.id)
      .maybeSingle();
    actorLabel = profile?.nama || user.email || user.id;
  }

  // B. Mutasi stok atomik (optimistic lock, aman dari request bersamaan).
  const change = await changeStockQty(
    supabase,
    { partId: canonicalPartId, cabangId: branchId },
    qtyChange,
    { label: partInfo?.part_number || partNumber || String(canonicalPartId) },
  );
  if (!change.ok) {
    return { error: `Gagal update stok: ${change.error}` };
  }
  const qtyBefore = change.before;
  const qtyAfter = change.after;

  // C. Log Movement
  const movementNote = [
    `${mode === "add" ? "STOK DITAMBAH" : "STOK DIKURANGI"} via ${type}`,
    `Status: ${fromStatus} -> ${toStatus}`,
    `Part: ${partInfo?.part_number || partNumber || "N/A"} - ${partInfo?.part_name || "Unknown Part"}`,
    `Gudang Penerima: ${mrLocationName}`,
    `Qty: ${qtyBefore} ${partInfo?.part_satuan || ""} -> ${qtyAfter} ${partInfo?.part_satuan || ""}`,
    `Ref: ${referenceKode}`,
    `By: ${actorLabel}`,
  ].join(" | ");

  const { error: movementError } = await supabase
    .from("stock_movements")
    .insert({
      part_id: canonicalPartId,
      cabang_id: branchId,
      qty_change: qtyChange,
      type: type,
      reference_id: referenceKode,
      created_by: user?.id,
      notes: movementNote,
    });

  if (movementError) {
    return {
      error: `Stok terupdate, tapi gagal simpan riwayat: ${movementError.message}`,
    };
  }

  return { success: true };
}

/**
 * Posting RI yang sudah completed: po_items.qty_received, stok gudang
 * penerima, status PO/PR, dan kredit MR untuk barang yang mendarat langsung di
 * gudang MR. SENGAJA bukan server action ("use server") -- kalau di-export dari
 * modul server action, fungsi ini bisa dipanggil langsung dari browser dan
 * memposting stok berulang kali. Pemanggil wajib sudah "claim" RI-nya
 * (ri_status open -> completed secara kondisional).
 */
export async function applyReceiveCompletion(supabase: any, receiveId: number) {
  const { data: ri } = await supabase
    .from("receives")
    .select("id, po_id, ri_kode")
    .eq("id", receiveId)
    .single();

  if (!ri) {
    return { error: "Receive tidak ditemukan" };
  }

  const { data: receiveItems } = await supabase
    .from("receive_items")
    .select("id, po_id, mr_id, part_id, part_number, qty, po_item_id, cabang_penerima_id")
    .eq("ri_id", receiveId);

  if (!receiveItems || receiveItems.length === 0) {
    return { error: "Receive items tidak ditemukan" };
  }

  // Validasi ulang sebelum posting: PO bisa saja direvisi turun sejak RI ini
  // dibuat -- qty diterima tidak boleh melebihi qty PO.
  const perPoItem = new Map<number, number>();
  for (const item of receiveItems) {
    if (!item.po_item_id) continue;
    perPoItem.set(item.po_item_id, (perPoItem.get(item.po_item_id) || 0) + Number(item.qty));
  }
  if (perPoItem.size > 0) {
    const { data: poItemRows } = await supabase
      .from("po_items")
      .select("id, part_number, qty, qty_received")
      .in("id", Array.from(perPoItem.keys()));
    for (const pi of poItemRows || []) {
      const sisa = (Number(pi.qty) || 0) - (Number(pi.qty_received) || 0);
      const qty = perPoItem.get(pi.id) || 0;
      if (qty > sisa) {
        return {
          error: `Qty terima ${pi.part_number} (${qty}) melebihi sisa PO yang belum diterima (${Math.max(0, sisa)}). Kemungkinan PO sudah direvisi -- tolak RI ini lalu buat ulang.`,
        };
      }
    }
  }

  // Per-item: update po_items.qty_received + stock di gudang penerima.
  // Distribusi ke MR: lewat Item Transfer (finalizeItemTransfer), KECUALI
  // barang yang diterima langsung di gudang MR-nya sendiri -- itu dikredit ke
  // MR di sini lewat recomputeMrItemsFulfillment (lib/mr-fulfillment.ts).
  for (const item of receiveItems) {
    if (item.po_item_id) {
      // Increment dengan optimistic lock (aman dari posting bersamaan).
      let applied = false;
      for (let attempt = 0; attempt < 6 && !applied; attempt++) {
        const { data: poItem } = await supabase
          .from("po_items")
          .select("qty_received")
          .eq("id", item.po_item_id)
          .single();
        if (!poItem) break;
        const { data: upd } = await supabase
          .from("po_items")
          .update({ qty_received: (poItem.qty_received || 0) + item.qty })
          .eq("id", item.po_item_id)
          .eq("qty_received", poItem.qty_received)
          .select("id");
        applied = !!upd && upd.length > 0;
      }
      if (!applied) {
        return { error: `Gagal mencatat qty diterima untuk ${item.part_number}. Silakan coba lagi.` };
      }
    }

    if (!item.cabang_penerima_id) {
      // RI lama (pra-revisi) tanpa gudang penerima -- lewati posting stok di
      // sini, sudah terlanjur diposting lewat alur lama saat pertama kali
      // completed.
      continue;
    }

    const stockRes = await adjustItemStock(
      supabase,
      item.cabang_penerima_id,
      item.part_id,
      item.part_number,
      item.qty,
      "add",
      "RI",
      "pending",
      "received",
      ri.ri_kode,
    );
    if ((stockRes as any)?.error) return { error: (stockRes as any).error };
  }

  // po_receive_status + po_status (completed) + completion PR sumber.
  await syncPoReceiveAndCompletion(supabase, ri.po_id);

  // RI yang mendarat langsung di gudang MR: kredit pemenuhan MR.
  const lineage = await resolveReceiveItemsMrLineage(
    supabase,
    receiveItems.map((i: any) => i.id),
  );
  const creditedMrItemIds: number[] = [];
  for (const item of receiveItems) {
    const l = lineage.get(item.id);
    if (l?.credited_on_receive) {
      // mr_item_id sengaja null di lineage (supaya IT tidak mengkredit
      // lagi); ambil dari po_item -> pr_item.
      const { data: pi } = await supabase
        .from("po_items")
        .select("pr_items(mr_item_id)")
        .eq("id", item.po_item_id)
        .maybeSingle();
      const pr = Array.isArray((pi as any)?.pr_items) ? (pi as any).pr_items[0] : (pi as any)?.pr_items;
      if (pr?.mr_item_id) creditedMrItemIds.push(pr.mr_item_id);
    }
  }
  if (creditedMrItemIds.length > 0) {
    await recomputeMrItemsFulfillment(supabase, creditedMrItemIds);
  }

  return { success: true };
}

