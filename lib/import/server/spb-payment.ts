import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { type ImportHandler, codeVariants, fail, fetchAll, fetchIn, keyOf, loadCabang, ok, str, tsToWibDate } from "./common";

export const spbPaymentHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const nos = rows.map((r) => str(r.values.inv_no));
    const invoices = await fetchIn<any>(codeVariants(nos), (part) =>
      supabase.from("spb_invoice").select("id, invoice_no, payment_status").in("invoice_no", part).order("id"),
    );
    const byNo = new Map<string, any[]>();
    for (const i of invoices) byNo.set(keyOf(i.invoice_no), [...(byNo.get(keyOf(i.invoice_no)) || []), i]);

    const results: ImportRowResult[] = [];
    const updates = new Map<"paid" | "unpaid", { row: number; ids: number[] }[]>([
      ["paid", []],
      ["unpaid", []],
    ]);
    for (const r of rows) {
      const no = str(r.values.inv_no)!;
      const target = r.values.payment === "PAID" ? "paid" : "unpaid";
      const list = byNo.get(keyOf(no)) || [];
      if (!list.length) {
        results.push(fail(r.row, "No Invoice tidak ditemukan di invoice SPB", no));
        continue;
      }
      const toChange = list.filter((i) => i.payment_status !== target);
      if (!toChange.length) {
        results.push(ok(r.row, "skip", `Sudah ${target.toUpperCase()}`, no));
        continue;
      }
      updates.get(target)!.push({ row: r.row, ids: toChange.map((i) => i.id) });
      results.push(
        ok(r.row, "update", `${list.length > 1 ? `${toChange.length} dari ${list.length} baris invoice (beberapa DO)` : "Status"}: ${toChange[0].payment_status.toUpperCase()} → ${target.toUpperCase()}`, no),
      );
    }

    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const [status, list] of updates) {
      const ids = list.flatMap((l) => l.ids);
      for (let i = 0; i < ids.length; i += 150) {
        const { error } = await supabase.from("spb_invoice").update({ payment_status: status }).in("id", ids.slice(i, i + 150));
        if (error) {
          for (const l of list) if (l.ids.some((id) => ids.slice(i, i + 150).includes(id))) byRow.set(l.row, fail(l.row, error.message, byRow.get(l.row)?.ref));
        }
      }
    }
    revalidatePath("/spb/report");
    revalidatePath("/spb/invoice");
    return rows.map((r) => byRow.get(r.row)!);
  },

  async prefill(ctx, params) {
    const { supabase } = ctx;
    const cabang = await loadCabang(supabase);
    const rows = await fetchAll<any>(() => {
      let q = supabase
        .from("spb_invoice")
        .select("id, invoice_no, invoice_date, payment_status, do:spb_do_id(do_no, po:spb_po_id(spb:spb_id(spb_no, cabang_id)))")
        .order("invoice_date", { ascending: true, nullsFirst: false })
        .order("id");
      if (params.mode === "unpaid") q = q.eq("payment_status", "unpaid");
      return q;
    });
    const seen = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const spb = r.do?.po?.spb;
      if (params.cabangIds.length && !params.cabangIds.includes(spb?.cabang_id)) continue;
      const k = keyOf(r.invoice_no);
      if (seen.has(k)) continue;
      seen.set(k, {
        inv_no: r.invoice_no,
        payment: r.payment_status === "paid" ? "PAID" : "UNPAID",
        tgl_inv: tsToWibDate(r.invoice_date),
        gudang: cabang.byId.get(spb?.cabang_id)?.nama_cabang || null,
        spb_no: spb?.spb_no || null,
        do_no: r.do?.do_no || null,
      });
    }
    return Array.from(seen.values());
  },
};
