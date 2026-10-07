// Qty item PR yang sudah "ter-PO", dari dua sumber:
//   1. po_items.pr_item_id  -- PO reguler (qty dalam satuan PR yang sama).
//   2. po_item_pr_links     -- link manual dari PO Non-PR (qty_pr diisi
//                              manual dalam satuan PR, karena PN/satuan PO beda).
// PO yang rejected tidak dihitung. Satu-satunya definisi "sudah PO" -- dipakai
// create PO (sisa qty), status konversi PR, detail PR, dan (mirror SQL-nya)
// cascade delete moderator.

export type PrItemPoCoverage = {
  convertedQty: number;
  pos: { id: number; po_kode: string; via_link: boolean }[];
};

function poRel(row: any) {
  return Array.isArray(row?.pos) ? row.pos[0] : row?.pos;
}

export async function fetchPrItemPoCoverage(
  supabase: any,
  prItemIds: number[],
): Promise<Record<number, PrItemPoCoverage>> {
  const map: Record<number, PrItemPoCoverage> = {};
  if (prItemIds.length === 0) return map;

  const [{ data: poItemRows }, { data: linkRows }] = await Promise.all([
    supabase
      .from("po_items")
      .select("pr_item_id, po_id, qty, pos!inner(po_status, po_kode)")
      .in("pr_item_id", prItemIds),
    supabase
      .from("po_item_pr_links")
      .select(
        "pr_item_id, qty_pr, po_items!inner(po_id, pos!inner(po_status, po_kode))",
      )
      .in("pr_item_id", prItemIds),
  ]);

  const add = (
    prItemId: number,
    qty: number,
    poId: number,
    poKode: string,
    viaLink: boolean,
  ) => {
    if (!map[prItemId]) map[prItemId] = { convertedQty: 0, pos: [] };
    map[prItemId].convertedQty += Number(qty) || 0;
    if (!map[prItemId].pos.some((p) => p.id === poId)) {
      map[prItemId].pos.push({ id: poId, po_kode: poKode, via_link: viaLink });
    }
  };

  for (const row of poItemRows ?? []) {
    const po = poRel(row);
    if (!po || po.po_status === "rejected") continue;
    add(row.pr_item_id, row.qty, row.po_id, po.po_kode, false);
  }
  for (const row of linkRows ?? []) {
    const poItem = Array.isArray(row.po_items) ? row.po_items[0] : row.po_items;
    const po = poRel(poItem);
    if (!poItem || !po || po.po_status === "rejected") continue;
    add(row.pr_item_id, row.qty_pr, poItem.po_id, po.po_kode, true);
  }

  return map;
}

export async function fetchPrItemConvertedQty(
  supabase: any,
  prItemIds: number[],
): Promise<Map<number, number>> {
  const coverage = await fetchPrItemPoCoverage(supabase, prItemIds);
  return new Map(
    Object.entries(coverage).map(([id, c]) => [Number(id), c.convertedQty]),
  );
}

// pending / partial / complete untuk prs.pr_convert_status.
export async function computePrConvertStatus(
  supabase: any,
  prId: number,
): Promise<"pending" | "partial" | "complete" | null> {
  const { data: items } = await supabase
    .from("pr_items")
    .select("id, qty")
    .eq("pr_id", prId);
  if (!items || items.length === 0) return null;

  const converted = await fetchPrItemConvertedQty(
    supabase,
    items.map((i: any) => i.id),
  );
  const totalQty = items.reduce((s: number, i: any) => s + (i.qty || 0), 0);
  const totalConverted = items.reduce(
    (s: number, i: any) => s + Math.min(i.qty || 0, converted.get(i.id) || 0),
    0,
  );
  return totalConverted <= 0
    ? "pending"
    : totalConverted < totalQty
      ? "partial"
      : "complete";
}
