// Pemenuhan qty MR (mr_items.qty_received + mrs.mr_status), dihitung ulang
// (live-recompute, bukan increment) dari SEMUA sumber yang sudah final:
//   1. item_transfer_items.mr_item_id pada Item Transfer yang completed
//      (alur RI -> IT -> MR).
//   2. job_costing_finish_parts.mr_item_id pada Job Costing yang stoknya
//      sudah diterapkan (stock_applied_at IS NOT NULL) -- alur PO Non-PR ->
//      Job Costing -> "kirim finish part ke MR".
//   3. delivery_items.mr_item_id pada Delivery share stock yang sudah
//      di-finalize (signature_receiver_id terisi).
//   4. mr_sharestock_bypasses -- Bypass share stock oleh moderator.
//   5. working_order_items.applied_qty pada WO yang sudah Closed.
//   6. RI yang gudang penerimanya = gudang MR itu sendiri (barang langsung
//      mendarat di tujuan, tidak perlu IT). Dilacak lewat
//      receive_items.po_item_id -> po_items.pr_item_id -> pr_items.mr_item_id.
//   7. RI lama (pra-revisi 2026-09-24, cabang_penerima_id NULL) yang dulu
//      langsung mengkredit MR lewat mr_id + part_id -- direkonstruksi persis
//      supaya qty lama tidak hilang saat item itu di-recompute.
// Dipanggil setiap kali salah satu sumber berubah supaya tidak saling menimpa.

export const MR_FULFILLED_STATUSES = ["approved", "completed", "done", "closed"];

function rel(row: any, key: string) {
  const v = row?.[key];
  return Array.isArray(v) ? v[0] : v;
}

function isMissingTable(error: any): boolean {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("42p01") || text.includes("does not exist") || text.includes("could not find the table");
}

export async function computeMrItemsFulfilledQty(
  supabase: any,
  mrItemIds: number[],
): Promise<{
  mrItems: { id: number; mr_id: number; part_id: number; qty_request: number; cabang_id: number | null }[];
  totals: Map<number, number>;
}> {
  const uniqueIds = Array.from(new Set(mrItemIds.filter(Boolean)));
  const totals = new Map<number, number>();
  if (uniqueIds.length === 0) return { mrItems: [], totals };

  const add = (id: number | null | undefined, qty: any) => {
    if (!id) return;
    totals.set(id, (totals.get(id) || 0) + (Number(qty) || 0));
  };

  const [
    { data: mrItemRows },
    { data: itRows },
    { data: jcRows },
    { data: dlvRows },
    bypassRes,
    { data: woRows },
    { data: prItemRows },
  ] = await Promise.all([
    supabase
      .from("mr_items")
      .select("id, mr_id, part_id, qty_request, mrs(cabang_id)")
      .in("id", uniqueIds),
    supabase
      .from("item_transfer_items")
      .select("mr_item_id, qty, item_transfers!inner(status)")
      .in("mr_item_id", uniqueIds)
      .eq("item_transfers.status", "completed"),
    supabase
      .from("job_costing_finish_parts")
      .select("mr_item_id, qty, job_costing!inner(stock_applied_at)")
      .in("mr_item_id", uniqueIds)
      .not("job_costing.stock_applied_at", "is", null),
    supabase
      .from("delivery_items")
      .select("mr_item_id, qty_on_delivery, deliveries!inner(status, signature_receiver_id)")
      .in("mr_item_id", uniqueIds)
      .not("deliveries.signature_receiver_id", "is", null)
      .neq("deliveries.status", "cancelled"),
    supabase
      .from("mr_sharestock_bypasses")
      .select("mr_item_id, qty")
      .in("mr_item_id", uniqueIds),
    supabase
      .from("working_order_items")
      .select("mr_item_id, applied_qty, working_orders!inner(wo_status)")
      .in("mr_item_id", uniqueIds)
      .eq("working_orders.wo_status", "Closed"),
    supabase
      .from("pr_items")
      .select("id, mr_item_id")
      .in("mr_item_id", uniqueIds),
  ]);

  const mrItems = (mrItemRows || []).map((r: any) => ({
    id: r.id,
    mr_id: r.mr_id,
    part_id: r.part_id,
    qty_request: Number(r.qty_request) || 0,
    cabang_id: rel(r, "mrs")?.cabang_id ?? null,
  }));
  const mrItemById = new Map(mrItems.map((i: any) => [i.id, i]));

  for (const r of itRows || []) add(r.mr_item_id, r.qty);
  for (const r of jcRows || []) add(r.mr_item_id, r.qty);
  for (const r of dlvRows || []) add(r.mr_item_id, r.qty_on_delivery);
  if (!bypassRes.error) {
    for (const r of bypassRes.data || []) add(r.mr_item_id, r.qty);
  } else if (!isMissingTable(bypassRes.error)) {
    console.error("Gagal membaca mr_sharestock_bypasses:", bypassRes.error.message);
  }
  for (const r of woRows || []) add(r.mr_item_id, r.applied_qty);

  // 6. RI langsung ke gudang MR.
  const mrItemByPrItem = new Map<number, number>(
    (prItemRows || []).map((r: any) => [r.id, r.mr_item_id]),
  );
  if (mrItemByPrItem.size > 0) {
    const { data: poItemRows } = await supabase
      .from("po_items")
      .select("id, pr_item_id")
      .in("pr_item_id", Array.from(mrItemByPrItem.keys()));
    const mrItemByPoItem = new Map<number, number>();
    for (const r of poItemRows || []) {
      const mrItemId = mrItemByPrItem.get(r.pr_item_id);
      if (mrItemId) mrItemByPoItem.set(r.id, mrItemId);
    }
    if (mrItemByPoItem.size > 0) {
      const { data: riRows } = await supabase
        .from("receive_items")
        .select("po_item_id, qty, cabang_penerima_id, receives!inner(ri_status)")
        .in("po_item_id", Array.from(mrItemByPoItem.keys()))
        .not("cabang_penerima_id", "is", null)
        .eq("receives.ri_status", "completed");
      for (const r of riRows || []) {
        const mrItemId = mrItemByPoItem.get(r.po_item_id);
        const mrItem: any = mrItemId ? mrItemById.get(mrItemId) : null;
        if (mrItem && mrItem.cabang_id && Number(r.cabang_penerima_id) === Number(mrItem.cabang_id)) {
          add(mrItemId, r.qty);
        }
      }
    }
  }

  // 7. RI lama (pra-revisi): kredit per (mr_id, part_id), persis alur lama.
  const mrIds = Array.from(new Set(mrItems.map((i: any) => i.mr_id)));
  if (mrIds.length > 0) {
    const { data: legacyRows } = await supabase
      .from("receive_items")
      .select("mr_id, part_id, qty, receives!inner(ri_status)")
      .in("mr_id", mrIds)
      .is("cabang_penerima_id", null)
      .eq("receives.ri_status", "completed");
    for (const r of legacyRows || []) {
      for (const mi of mrItems) {
        if (mi.mr_id === r.mr_id && mi.part_id === r.part_id) add(mi.id, r.qty);
      }
    }
  }

  return { mrItems, totals };
}

/**
 * Recompute mrs.mr_status dari total qty_received vs qty_request. Hanya MR
 * yang sudah approved/completed yang disentuh -- MR open (menunggu approval)
 * atau rejected tidak pernah diubah dari sini.
 */
export async function recomputeMrStatus(supabase: any, mrId: number) {
  const { data: mr } = await supabase
    .from("mrs")
    .select("mr_status")
    .eq("id", mrId)
    .maybeSingle();
  if (!mr || !MR_FULFILLED_STATUSES.includes(mr.mr_status)) return;

  const { data: rows } = await supabase
    .from("mr_items")
    .select("qty_request, qty_received")
    .eq("mr_id", mrId);
  if (!rows || rows.length === 0) return;
  const allFulfilled = rows.every(
    (i: any) => (Number(i.qty_received) || 0) >= (Number(i.qty_request) || 0),
  );
  const next = allFulfilled ? "completed" : "approved";
  if (next !== mr.mr_status) {
    await supabase.from("mrs").update({ mr_status: next }).eq("id", mrId);
  }
}

export async function recomputeMrItemsFulfillment(
  supabase: any,
  mrItemIds: number[],
): Promise<Set<number>> {
  const affectedMrIds = new Set<number>();
  const { mrItems, totals } = await computeMrItemsFulfilledQty(supabase, mrItemIds);

  for (const mrItem of mrItems) {
    await supabase
      .from("mr_items")
      .update({
        qty_received: Math.min(mrItem.qty_request, totals.get(mrItem.id) || 0),
      })
      .eq("id", mrItem.id);
    affectedMrIds.add(mrItem.mr_id);
  }

  for (const mrId of affectedMrIds) {
    await recomputeMrStatus(supabase, mrId);
  }

  return affectedMrIds;
}

/** Recompute seluruh item satu/lebih MR (mis. setelah qty_request diedit). */
export async function recomputeMrFulfillmentForMrs(supabase: any, mrIds: number[]) {
  const ids = Array.from(new Set(mrIds.filter(Boolean)));
  if (ids.length === 0) return;
  const { data: items } = await supabase.from("mr_items").select("id").in("mr_id", ids);
  const itemIds = (items || []).map((i: any) => i.id);
  if (itemIds.length > 0) await recomputeMrItemsFulfillment(supabase, itemIds);
  else for (const id of ids) await recomputeMrStatus(supabase, id);
}

/**
 * Lineage receive_item -> mr_item (via po_item.pr_item_id -> pr_items.mr_item_id)
 * plus gudang MR-nya. Dipakai Item Transfer "dari RI": baris RI yang sudah
 * mendarat di gudang MR-nya sendiri sudah mengkredit MR (sumber #6 di atas),
 * jadi IT lanjutan dari baris itu TIDAK boleh membawa mr_item_id lagi.
 */
export async function resolveReceiveItemsMrLineage(
  supabase: any,
  receiveItemIds: number[],
): Promise<
  Map<
    number,
    {
      ri_id: number;
      ri_status: string;
      part_id: number;
      qty: number;
      cabang_penerima_id: number | null;
      mr_item_id: number | null;
      mr_cabang_id: number | null;
      credited_on_receive: boolean;
    }
  >
> {
  const result = new Map<number, any>();
  const ids = Array.from(new Set(receiveItemIds.filter(Boolean)));
  if (ids.length === 0) return result;

  const { data: riRows } = await supabase
    .from("receive_items")
    .select("id, ri_id, part_id, qty, mr_id, cabang_penerima_id, po_item_id, receives!inner(ri_status), po_items(pr_item_id, pr_items(mr_item_id))")
    .in("id", ids);

  // Fallback mr_id + part_id untuk item tanpa lineage PR (data lama).
  const fallbackMrIds = Array.from(
    new Set((riRows || []).map((r: any) => r.mr_id).filter(Boolean)),
  );
  const { data: mrItemRows } =
    fallbackMrIds.length > 0
      ? await supabase.from("mr_items").select("id, mr_id, part_id").in("mr_id", fallbackMrIds)
      : { data: [] as any[] };

  const lineageMrItemIds: number[] = [];
  const draft: any[] = [];
  for (const r of riRows || []) {
    const poItem = rel(r, "po_items");
    const prItem = rel(poItem, "pr_items");
    let mrItemId: number | null = prItem?.mr_item_id ?? null;
    const viaPr = !!mrItemId;
    if (!mrItemId && r.mr_id) {
      const match = (mrItemRows || []).filter(
        (m: any) => m.mr_id === r.mr_id && m.part_id === r.part_id,
      );
      mrItemId = match.length === 1 ? match[0].id : null;
    }
    if (mrItemId) lineageMrItemIds.push(mrItemId);
    draft.push({ r, mrItemId, viaPr });
  }

  const { data: mrCabangRows } =
    lineageMrItemIds.length > 0
      ? await supabase.from("mr_items").select("id, mrs(cabang_id)").in("id", lineageMrItemIds)
      : { data: [] as any[] };
  const mrCabangById = new Map(
    (mrCabangRows || []).map((m: any) => [m.id, rel(m, "mrs")?.cabang_id ?? null]),
  );

  for (const { r, mrItemId, viaPr } of draft) {
    const mrCabang = mrItemId ? (mrCabangById.get(mrItemId) ?? null) : null;
    // Hanya lineage lewat PR yang dihitung sumber #6 (RI langsung ke gudang MR).
    const credited =
      viaPr &&
      !!mrItemId &&
      mrCabang != null &&
      r.cabang_penerima_id != null &&
      Number(r.cabang_penerima_id) === Number(mrCabang);
    result.set(r.id, {
      ri_id: r.ri_id,
      ri_status: rel(r, "receives")?.ri_status,
      part_id: r.part_id,
      qty: Number(r.qty) || 0,
      cabang_penerima_id: r.cabang_penerima_id,
      mr_item_id: credited ? null : mrItemId,
      mr_cabang_id: mrCabang,
      credited_on_receive: credited,
    });
  }
  return result;
}
