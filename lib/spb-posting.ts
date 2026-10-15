// Posting stok & status SPB (Stock Out). SENGAJA bukan modul "use server":
// fungsi di sini memposting stok, jadi tidak boleh bisa dipanggil langsung
// dari browser sebagai server action. Pemanggil (services/spb-actions.ts,
// services/moderator-edit-actions.ts) yang memegang validasi izin & claim.

import { changeStockQty } from "@/lib/stock-mutation";

function rel(row: any, key: string) {
  const v = row?.[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Qty yang sudah diretur per spb_detail = total retur yang approval-nya
 * completed (dihitung ulang, bukan increment -- aman dipanggil berulang).
 */
export async function recomputeSpbReturnedQty(supabase: any, spbId: number) {
  const { data: details } = await supabase
    .from("spb_details")
    .select("id, dtl_spb_qty_returned")
    .eq("spb_id", spbId);
  const ids = (details || []).map((d: any) => d.id);
  if (ids.length === 0) return;
  const { data: rows } = await supabase
    .from("return_spb_details")
    .select("spb_dtl_id, dtl_rtn_qty_return, return_spb!inner(approval_status)")
    .in("spb_dtl_id", ids)
    .eq("return_spb.approval_status", "completed");
  const returned = new Map<number, number>();
  for (const r of rows || []) {
    returned.set(r.spb_dtl_id, (returned.get(r.spb_dtl_id) || 0) + (Number(r.dtl_rtn_qty_return) || 0));
  }
  for (const d of details || []) {
    const next = returned.get(d.id) || 0;
    if (next !== (Number(d.dtl_spb_qty_returned) || 0)) {
      await supabase.from("spb_details").update({ dtl_spb_qty_returned: next }).eq("id", d.id);
    }
  }
}

/**
 * Status progres SPB, dihitung dari dokumen turunan (tidak pernah mundur
 * karena urutan pembuatan dokumen):
 *   CANCELLED (tetap) > Returned (semua qty sudah diretur) >
 *   DONE QUOT (ada invoice completed) > DO_ATTACH > PO_ATTACH > DONE QUOT.
 * Retur parsial TIDAK lagi menimpa status progres (info retur ada di dokumen
 * Return SPB-nya).
 */
export async function refreshSpbStatus(supabase: any, spbId: number | null | undefined) {
  if (!spbId) return;
  const { data: spb } = await supabase
    .from("spb")
    .select("id, spb_status, spb_details(dtl_spb_qty, dtl_spb_qty_returned)")
    .eq("id", spbId)
    .maybeSingle();
  if (!spb || spb.spb_status === "CANCELLED") return;

  const details = spb.spb_details || [];
  const allReturned =
    details.length > 0 &&
    details.every((d: any) => (Number(d.dtl_spb_qty_returned) || 0) >= (Number(d.dtl_spb_qty) || 0));

  let next = "DONE QUOT";
  if (allReturned) {
    next = "Returned";
  } else {
    const { data: pos } = await supabase
      .from("spb_po")
      .select("id, spb_do(id, spb_invoice(approval_status))")
      .eq("spb_id", spbId);
    const doRows = (pos || []).flatMap((p: any) => p.spb_do || []);
    const hasInvoice = doRows.some((d: any) =>
      (d.spb_invoice || []).some((i: any) => i.approval_status === "completed"),
    );
    if (hasInvoice) next = "DONE QUOT";
    else if (doRows.length > 0) next = "DO_ATTACH";
    else if ((pos || []).length > 0) next = "PO_ATTACH";
  }

  if (next !== spb.spb_status) {
    await supabase.from("spb").update({ spb_status: next }).eq("id", spbId);
  }
}

/** spb_id induk dari sebuah spb_do / spb_invoice. */
export async function resolveSpbIdFromInvoice(supabase: any, spbInvoiceId: number) {
  const { data } = await supabase
    .from("spb_invoice")
    .select("spb_do:spb_do_id(spb_po:spb_po_id(spb_id))")
    .eq("id", spbInvoiceId)
    .maybeSingle();
  return rel(rel(data, "spb_do"), "spb_po")?.spb_id ?? null;
}

/**
 * Stock out SPB: kurangi stok cabang SPB per part (baris dengan part sama
 * dijumlah). Idempotent per part lewat stock_movements SPB_OUT.
 */
export async function postSpbStockOut(supabase: any, spbId: number, actorId: string) {
  const { data: spbHeader, error: spbErr } = await supabase
    .from("spb")
    .select("id, spb_no, cabang_id")
    .eq("id", spbId)
    .single();
  if (spbErr || !spbHeader) return { error: spbErr?.message || "SPB tidak ditemukan." };

  const { data: detailRows, error: detailErr } = await supabase
    .from("spb_details")
    .select("part_id, dtl_spb_part_number, dtl_spb_qty")
    .eq("spb_id", spbId);
  if (detailErr) return { error: detailErr.message };
  if (!detailRows?.length) return { error: "Detail SPB tidak ditemukan." };

  const byPart = new Map<number, { qty: number; pn: string }>();
  for (const row of detailRows) {
    if (!row.part_id || !row.dtl_spb_qty || row.dtl_spb_qty <= 0) {
      return { error: "Qty item SPB tidak valid." };
    }
    const cur = byPart.get(row.part_id) || { qty: 0, pn: row.dtl_spb_part_number };
    cur.qty += Number(row.dtl_spb_qty);
    byPart.set(row.part_id, cur);
  }

  const { data: posted } = await supabase
    .from("stock_movements")
    .select("part_id")
    .eq("type", "SPB_OUT")
    .eq("reference_id", spbHeader.spb_no);
  const postedParts = new Set((posted || []).map((r: any) => r.part_id));

  const applied: { partId: number; qty: number }[] = [];
  for (const [partId, { qty, pn }] of byPart) {
    if (postedParts.has(partId)) continue;
    const res = await changeStockQty(
      supabase,
      { partId, cabangId: spbHeader.cabang_id },
      -qty,
      { label: pn },
    );
    if (!res.ok) {
      for (const a of applied) {
        await changeStockQty(supabase, { partId: a.partId, cabangId: spbHeader.cabang_id }, a.qty, {
          allowNegative: true,
        });
        await supabase
          .from("stock_movements")
          .delete()
          .eq("type", "SPB_OUT")
          .eq("reference_id", spbHeader.spb_no)
          .eq("part_id", a.partId);
      }
      return { error: `Stok part ${pn} tidak mencukupi. ${res.error}` };
    }
    applied.push({ partId, qty });
    await supabase.from("stock_movements").insert({
      part_id: partId,
      cabang_id: spbHeader.cabang_id,
      qty_change: -qty,
      type: "SPB_OUT",
      reference_id: spbHeader.spb_no,
      notes: `Stock out dari SPB ${spbHeader.spb_no}`,
      created_by: actorId,
    });
  }
  return { success: true };
}

/**
 * Kembalikan stok SPB yang belum diretur (dipakai cancel/hapus SPB). Qty
 * yang sudah balik lewat Return SPB tidak dikembalikan lagi.
 */
export async function returnSpbOutstandingStock(
  supabase: any,
  params: { spbId: number; spbNo: string; cabangId: number; actorId: string; type: string; note: string },
) {
  await recomputeSpbReturnedQty(supabase, params.spbId);
  const { data: items } = await supabase
    .from("spb_details")
    .select("part_id, dtl_spb_part_number, dtl_spb_qty, dtl_spb_qty_returned")
    .eq("spb_id", params.spbId);
  for (const item of items || []) {
    const qty = (Number(item.dtl_spb_qty) || 0) - (Number(item.dtl_spb_qty_returned) || 0);
    if (qty <= 0 || !item.part_id) continue;
    await changeStockQty(
      supabase,
      { partId: item.part_id, cabangId: params.cabangId },
      qty,
      { allowNegative: true, label: item.dtl_spb_part_number },
    );
    await supabase.from("stock_movements").insert({
      part_id: item.part_id,
      cabang_id: params.cabangId,
      qty_change: qty,
      type: params.type,
      reference_id: params.spbNo,
      notes: params.note,
      created_by: params.actorId,
    });
  }
}

/**
 * Posting Return SPB yang approval-nya sudah completed: stok kembali ke
 * cabang SPB (idempotent per part lewat stock_movements SPB_RETURN), qty
 * returned & status SPB dihitung ulang.
 */
export async function postReturnSpb(supabase: any, returnId: number, actorId: string) {
  const { data: header, error: headerErr } = await supabase
    .from("return_spb")
    .select(
      "id, rtn_kode, spb_id, approval_status, details:return_spb_details(spb_dtl_id, part_id, dtl_rtn_qty_return)",
    )
    .eq("id", returnId)
    .single();
  if (headerErr || !header) return { error: headerErr?.message || "Return SPB tidak ditemukan." };
  if (header.approval_status !== "completed") {
    return { error: "Return SPB belum completed, tidak bisa diposting." };
  }

  const { data: spbHeader, error: spbErr } = await supabase
    .from("spb")
    .select("id, cabang_id, spb_status")
    .eq("id", header.spb_id)
    .single();
  if (spbErr || !spbHeader) return { error: spbErr?.message || "SPB tidak ditemukan." };
  if (spbHeader.spb_status === "CANCELLED") {
    return { error: "SPB sudah dibatalkan (stok sudah dikembalikan), retur tidak bisa diposting." };
  }

  const detailRows = (header.details || []) as {
    spb_dtl_id: number;
    part_id: number;
    dtl_rtn_qty_return: number;
  }[];
  if (!detailRows.length) return { error: "Detail return SPB tidak ditemukan." };

  // Validasi ulang terhadap sisa qty SPB (retur completed lain + yang ini).
  const dtlIds = Array.from(new Set(detailRows.map((d) => d.spb_dtl_id)));
  const { data: spbDetails } = await supabase
    .from("spb_details")
    .select("id, part_id, dtl_spb_part_number, dtl_spb_qty")
    .in("id", dtlIds)
    .eq("spb_id", header.spb_id);
  const spbDetailById = new Map((spbDetails || []).map((d: any) => [d.id, d]));
  const { data: otherCompleted } = await supabase
    .from("return_spb_details")
    .select("spb_dtl_id, dtl_rtn_qty_return, rtn_id, return_spb!inner(approval_status)")
    .in("spb_dtl_id", dtlIds)
    .eq("return_spb.approval_status", "completed")
    .neq("rtn_id", returnId);
  const otherReturned = new Map<number, number>();
  for (const r of otherCompleted || []) {
    otherReturned.set(r.spb_dtl_id, (otherReturned.get(r.spb_dtl_id) || 0) + Number(r.dtl_rtn_qty_return || 0));
  }
  const thisByDtl = new Map<number, number>();
  for (const r of detailRows) {
    thisByDtl.set(r.spb_dtl_id, (thisByDtl.get(r.spb_dtl_id) || 0) + Number(r.dtl_rtn_qty_return || 0));
  }
  for (const [dtlId, qty] of thisByDtl) {
    const d: any = spbDetailById.get(dtlId);
    if (!d) return { error: `Detail SPB ${dtlId} bukan bagian dari SPB ini.` };
    const sisa = (Number(d.dtl_spb_qty) || 0) - (otherReturned.get(dtlId) || 0);
    if (qty > sisa) {
      return { error: `Qty retur ${d.dtl_spb_part_number} (${qty}) melebihi sisa yang belum diretur (${Math.max(0, sisa)}).` };
    }
  }

  // Stok kembali per part (part diambil dari detail SPB, bukan payload).
  const byPart = new Map<number, number>();
  for (const r of detailRows) {
    const d: any = spbDetailById.get(r.spb_dtl_id);
    const qty = Number(r.dtl_rtn_qty_return) || 0;
    if (!d?.part_id || qty <= 0) continue;
    byPart.set(d.part_id, (byPart.get(d.part_id) || 0) + qty);
  }
  const { data: posted } = await supabase
    .from("stock_movements")
    .select("part_id")
    .eq("type", "SPB_RETURN")
    .eq("reference_id", header.rtn_kode);
  const postedParts = new Set((posted || []).map((r: any) => r.part_id));
  for (const [partId, qty] of byPart) {
    if (postedParts.has(partId)) continue;
    await changeStockQty(
      supabase,
      { partId, cabangId: spbHeader.cabang_id },
      qty,
      { label: String(partId) },
    );
    await supabase.from("stock_movements").insert({
      part_id: partId,
      cabang_id: spbHeader.cabang_id,
      qty_change: qty,
      type: "SPB_RETURN",
      reference_id: header.rtn_kode,
      notes: "Stock return from SPB",
      created_by: actorId,
    });
  }

  await recomputeSpbReturnedQty(supabase, header.spb_id);
  const { data: allDetails } = await supabase
    .from("spb_details")
    .select("dtl_spb_qty, dtl_spb_qty_returned")
    .eq("spb_id", header.spb_id);
  const allReturned = (allDetails || []).every(
    (d: any) => (d.dtl_spb_qty_returned || 0) >= (d.dtl_spb_qty || 0),
  );
  await supabase
    .from("return_spb")
    .update({ rtn_status: allReturned ? "Returned" : "Partial" })
    .eq("id", returnId);
  await refreshSpbStatus(supabase, header.spb_id);

  return { success: true };
}
