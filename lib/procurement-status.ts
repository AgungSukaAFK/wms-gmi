// Status turunan rantai MR -> PR -> PO -> RI, dihitung ulang (bukan
// increment) dari dokumen turunan. Satu tempat supaya create / reject /
// hapus / revisi / moderator edit memakai rumus yang sama persis.

import {
  computePrConvertStatus,
  fetchPrItemPoCoverage,
  isPrItemRejected,
} from "@/lib/pr-po-coverage";

function rel(row: any, key: string) {
  const v = row?.[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Qty item MR yang sudah dikonversi ke PR aktif: PR tidak rejected DAN item
 * PR-nya tidak ditolak per-item oleh approver.
 */
export async function fetchMrItemPrConvertedQty(
  supabase: any,
  mrItemIds: number[],
  opts?: { excludePrId?: number },
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (mrItemIds.length === 0) return map;
  const { data: rows } = await supabase
    .from("pr_items")
    .select("pr_id, mr_item_id, qty, status, prs!inner(pr_status)")
    .in("mr_item_id", mrItemIds);
  for (const row of rows ?? []) {
    if (rel(row, "prs")?.pr_status === "rejected") continue;
    if (isPrItemRejected(row)) continue;
    if (opts?.excludePrId && row.pr_id === opts.excludePrId) continue;
    map.set(row.mr_item_id, (map.get(row.mr_item_id) || 0) + (Number(row.qty) || 0));
  }
  return map;
}

/** mrs.mr_convert_status dari qty_pr vs qty yang sudah dikonversi ke PR aktif. */
export async function applyMrConversionStatus(supabase: any, mrId: number) {
  const { data: items } = await supabase
    .from("mr_items")
    .select("id, qty_pr")
    .eq("mr_id", mrId)
    .gt("qty_pr", 0);
  if (!items || items.length === 0) return;

  const converted = await fetchMrItemPrConvertedQty(
    supabase,
    items.map((i: any) => i.id),
  );
  const totalQtyPr = items.reduce((s: number, i: any) => s + (i.qty_pr || 0), 0);
  const totalConverted = items.reduce(
    (s: number, i: any) => s + Math.min(i.qty_pr || 0, converted.get(i.id) || 0),
    0,
  );
  const status =
    totalConverted <= 0 ? "pending" : totalConverted < totalQtyPr ? "partial" : "complete";
  await supabase.from("mrs").update({ mr_convert_status: status }).eq("id", mrId);
}

export async function applyPrConversionStatus(supabase: any, prId: number) {
  const status = await computePrConvertStatus(supabase, prId);
  if (!status) return;
  await supabase.from("prs").update({ pr_convert_status: status }).eq("id", prId);
}

/**
 * PR "completed" kalau seluruh qty item aktifnya (bukan yang ditolak per-item)
 * sudah ter-PO DAN semua PO (non-rejected) yang menutupinya sudah diterima
 * penuh. Sebaliknya PR completed yang syarat itu tidak lagi terpenuhi (mis.
 * PO-nya direvisi naik / dihapus) dikembalikan ke approved.
 */
export async function applyPrCompletionStatus(supabase: any, prId: number) {
  const { data: pr } = await supabase
    .from("prs")
    .select("pr_status")
    .eq("id", prId)
    .maybeSingle();
  if (!pr || !["approved", "completed"].includes(pr.pr_status)) return;

  const { data: allItems } = await supabase
    .from("pr_items")
    .select("id, qty, status")
    .eq("pr_id", prId);
  const items = (allItems || []).filter((i: any) => !isPrItemRejected(i));

  let done = false;
  if (items.length > 0) {
    const coverage = await fetchPrItemPoCoverage(
      supabase,
      items.map((i: any) => i.id),
    );
    const allConverted = items.every(
      (i: any) => (coverage[i.id]?.convertedQty || 0) >= (i.qty || 0),
    );
    const poIds = Array.from(
      new Set(Object.values(coverage).flatMap((c) => c.pos.map((p) => p.id))),
    );
    if (allConverted && poIds.length > 0) {
      const { data: pos } = await supabase
        .from("pos")
        .select("po_receive_status")
        .in("id", poIds);
      done =
        (pos ?? []).length === poIds.length &&
        (pos ?? []).every((p: any) => p.po_receive_status === "complete");
    }
  }

  const next = done ? "completed" : "approved";
  if (next !== pr.pr_status) {
    await supabase.from("prs").update({ pr_status: next as any }).eq("id", prId);
  }
}

/** Semua PR sumber sebuah PO (po_items.pr_item_id + link manual PO Non-PR). */
export async function fetchPoSourcePrIds(supabase: any, poId: number): Promise<number[]> {
  const [{ data: poHeader }, { data: poItemRows }] = await Promise.all([
    supabase.from("pos").select("pr_id").eq("id", poId).maybeSingle(),
    supabase.from("po_items").select("id, pr_item_id").eq("po_id", poId),
  ]);
  const poItemIds = (poItemRows ?? []).map((r: any) => r.id);
  const { data: linkRows } =
    poItemIds.length > 0
      ? await supabase.from("po_item_pr_links").select("pr_item_id").in("po_item_id", poItemIds)
      : { data: [] };
  const prItemIds = Array.from(
    new Set(
      [...(poItemRows ?? []), ...(linkRows ?? [])]
        .map((r: any) => r.pr_item_id)
        .filter(Boolean),
    ),
  );
  const { data: prItemRows } =
    prItemIds.length > 0
      ? await supabase.from("pr_items").select("pr_id").in("id", prItemIds)
      : { data: [] };
  const prIds = new Set<number>((prItemRows ?? []).map((r: any) => r.pr_id).filter(Boolean));
  if (poHeader?.pr_id) prIds.add(poHeader.pr_id);
  return Array.from(prIds);
}

/**
 * Sinkron pos.po_receive_status dari po_items (qty_received vs qty), lalu
 * po_status: approved <-> completed mengikuti penerimaan penuh. PO yang masih
 * open (menunggu approval) / rejected tidak diubah po_status-nya. PR sumber
 * ikut di-evaluasi ulang completion-nya.
 */
export async function syncPoReceiveAndCompletion(supabase: any, poId: number) {
  const [{ data: po }, { data: items }] = await Promise.all([
    supabase.from("pos").select("po_status, po_receive_status").eq("id", poId).maybeSingle(),
    supabase.from("po_items").select("qty, qty_received").eq("po_id", poId),
  ]);
  if (!po) return;
  const rows = items || [];
  const allReceived = rows.length > 0 && rows.every((i: any) => (i.qty_received || 0) >= (i.qty || 0));
  const someReceived = rows.some((i: any) => (i.qty_received || 0) > 0);
  const receiveStatus = allReceived ? "complete" : someReceived ? "partial" : "pending";

  const patch: Record<string, any> = {};
  if (receiveStatus !== po.po_receive_status) patch.po_receive_status = receiveStatus;
  if (po.po_status === "approved" && receiveStatus === "complete") patch.po_status = "completed";
  if (po.po_status === "completed" && receiveStatus !== "complete") patch.po_status = "approved";
  if (Object.keys(patch).length > 0) {
    await supabase.from("pos").update(patch).eq("id", poId);
  }

  for (const prId of await fetchPoSourcePrIds(supabase, poId)) {
    await applyPrCompletionStatus(supabase, prId);
  }
}

/**
 * Qty per po_item yang sedang "dalam proses" penerimaan: RI yang sudah dibuat
 * tapi belum completed / rejected. Wajib ikut mengurangi sisa PO supaya dua RI
 * pending tidak bisa sama-sama menerima qty yang sama.
 */
export async function fetchPoItemPendingReceiveQty(
  supabase: any,
  poItemIds: number[],
  opts?: { excludeRiId?: number },
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (poItemIds.length === 0) return map;
  const { data } = await supabase
    .from("receive_items")
    .select("ri_id, po_item_id, qty, receives!inner(ri_status)")
    .in("po_item_id", poItemIds)
    .not("receives.ri_status", "in", "(completed,rejected)");
  for (const r of data ?? []) {
    if (opts?.excludeRiId && r.ri_id === opts.excludeRiId) continue;
    map.set(r.po_item_id, (map.get(r.po_item_id) || 0) + (Number(r.qty) || 0));
  }
  return map;
}
