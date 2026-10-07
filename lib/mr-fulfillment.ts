// Pemenuhan qty MR (mr_items.qty_received + mrs.mr_status), dihitung ulang
// (live-recompute, bukan increment) dari SEMUA sumber yang sudah final:
//   1. item_transfer_items.mr_item_id pada Item Transfer yang completed
//      (alur RI -> IT -> MR).
//   2. job_costing_finish_parts.mr_item_id pada Job Costing yang stoknya
//      sudah diterapkan (stock_applied_at IS NOT NULL) -- alur PO Non-PR ->
//      Job Costing -> "kirim finish part ke MR".
// Dipanggil setiap kali salah satu sumber berubah (finalize IT, apply/reverse
// /hapus Job Costing) supaya keduanya tidak saling menimpa.

export async function recomputeMrItemsFulfillment(
  supabase: any,
  mrItemIds: number[],
): Promise<Set<number>> {
  const affectedMrIds = new Set<number>();
  const uniqueIds = Array.from(new Set(mrItemIds.filter(Boolean)));
  if (uniqueIds.length === 0) return affectedMrIds;

  const [{ data: mrItems }, { data: itRows }, { data: jcRows }] =
    await Promise.all([
      supabase
        .from("mr_items")
        .select("id, mr_id, qty_request")
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
    ]);

  const totals = new Map<number, number>();
  for (const r of [...(itRows || []), ...(jcRows || [])]) {
    totals.set(r.mr_item_id, (totals.get(r.mr_item_id) || 0) + Number(r.qty || 0));
  }

  for (const mrItem of mrItems || []) {
    await supabase
      .from("mr_items")
      .update({
        qty_received: Math.min(mrItem.qty_request, totals.get(mrItem.id) || 0),
      })
      .eq("id", mrItem.id);
    affectedMrIds.add(mrItem.mr_id);
  }

  for (const mrId of affectedMrIds) {
    const { data: rows } = await supabase
      .from("mr_items")
      .select("qty_request, qty_received")
      .eq("mr_id", mrId);
    if (!rows) continue;
    const totalRequest = rows.reduce((s: number, i: any) => s + i.qty_request, 0);
    const totalReceived = rows.reduce((s: number, i: any) => s + i.qty_received, 0);
    // Tidak pernah balik ke "open" (= menunggu approval): MR yang punya
    // sumber pemenuhan pasti sudah approved, dan qty bisa turun ke 0 lagi
    // kalau Job Costing-nya di-reverse.
    const mrStatus = totalReceived >= totalRequest ? "completed" : "approved";
    await supabase.from("mrs").update({ mr_status: mrStatus }).eq("id", mrId);
  }

  return affectedMrIds;
}
