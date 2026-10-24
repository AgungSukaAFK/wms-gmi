import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { createSpb } from "@/services/spb-actions";
import { type ImportHandler, firstValue, groupRows, keyOf, loadCabang, matchBarang, num, str } from "./common";
import { StockCache, cutStock, docResults, existingCodes, resolveDocItems, sumByPart } from "./docs";

export const spbHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const riwayat = ctx.options.mode === "riwayat";
    const potong = !riwayat || ctx.options.potong_stok !== false;
    const docs = groupRows(rows, (r) => keyOf(r.values.spb_no));
    const codes = Array.from(docs.values()).map((l) => str(l[0].values.spb_no));
    const [existing, barang, cabang, tplRes] = await Promise.all([
      existingCodes(supabase, "spb", "spb_no", codes),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
      loadCabang(supabase),
      supabase.from("approval_templates").select("id, name, cabang_id").eq("type", "Stock Out - SPB").order("id"),
    ]);
    // Template tanda tangan SPB per gudang (fallback template tanpa gudang).
    const templates = (tplRes.data || []) as { id: number; name: string; cabang_id: number | null }[];
    const templateFor = (cabangId: number) => templates.find((t) => t.cabang_id === cabangId) || templates.find((t) => t.cabang_id === null);
    const levels = new StockCache(supabase);
    const usedStock = new Map<string, number>();

    const results: ImportRowResult[] = [];
    type Plan = { list: typeof rows; code: string; cab: any; tpl: any; items: any[]; head: Record<string, unknown> };
    const plans: Plan[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.spb_no)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No SPB sudah ada di WMS"));
        continue;
      }
      const gName = str(firstValue(list, "gudang"))!;
      const g = cabang.byName.get(keyOf(gName));
      const tpl = g ? templateFor(g.id) : null;
      const docErr = !g ? `Gudang ${gName} tidak ada di master Cabang` : !riwayat && !tpl ? `Belum ada template approval SPB untuk ${g.nama_cabang} (dibutuhkan untuk slot tanda tangan)` : null;
      if (docErr) {
        results.push(...docResults(list, code, "error", docErr));
        continue;
      }
      const { items, errors, warnings } = resolveDocItems(list, barang);
      if (!errors.size && potong) {
        await levels.ensure(g!.id, items.map((i) => i.part_id));
        for (const [partId, need] of sumByPart(items)) {
          const k = `${g!.id}|${partId}`;
          const avail = levels.get(g!.id, partId) - (usedStock.get(k) || 0);
          const it = items.find((a) => a.part_id === partId)!;
          if (need > avail) {
            if (riwayat) warnings.set(it.row, [...(warnings.get(it.row) || []), `Stok ${g!.nama_cabang} jadi minus (${avail} - ${need})`]);
            else errors.set(it.row, `Stok ${g!.nama_cabang} tidak cukup: ada ${Math.max(0, avail)}, keluar ${need}`);
          }
        }
      }
      if (errors.size) {
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      for (const [partId, need] of sumByPart(items)) usedStock.set(`${g!.id}|${partId}`, (usedStock.get(`${g!.id}|${partId}`) || 0) + need);
      results.push(...docResults(list, code, "create", `SPB baru ${g!.nama_cabang}${riwayat ? " (riwayat)" : ""}${potong ? "" : " · tanpa potong stok"}`, errors, warnings));
      plans.push({
        list,
        code,
        cab: g,
        tpl,
        items,
        head: {
          spb_tanggal: String(firstValue(list, "spb_tanggal")),
          spb_no_wo: str(firstValue(list, "no_wo")),
          spb_section: str(firstValue(list, "section")),
          spb_pic_gmi: str(firstValue(list, "pic_gmi")) || ctx.userName,
          spb_pic_ppa: str(firstValue(list, "pic_customer")),
          spb_kode_unit: str(firstValue(list, "kode_unit")),
          spb_tipe_unit: str(firstValue(list, "tipe_unit")),
          spb_brand: str(firstValue(list, "brand")),
          spb_hm: num(firstValue(list, "hm")),
          spb_problem_remark: str(firstValue(list, "remark")),
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    const markErr = (p: Plan, msg: string) => {
      for (const x of docResults(p.list, p.code, "error", msg)) byRow.set(x.row, x);
    };
    for (const p of plans) {
      const details = p.items.map((i) => ({
        part_id: i.part_id,
        dtl_spb_part_number: i.part_number,
        dtl_spb_part_name: i.part_name,
        dtl_spb_part_satuan: i.satuan,
        dtl_spb_qty: i.qty,
      }));
      if (!riwayat) {
        const res: any = await createSpb({
          spb_no: p.code,
          approval_template_id: p.tpl.id,
          spb_tanggal: String(p.head.spb_tanggal),
          spb_no_wo: (p.head.spb_no_wo as string) || undefined,
          spb_section: (p.head.spb_section as string) || undefined,
          spb_pic_gmi: (p.head.spb_pic_gmi as string) || undefined,
          spb_pic_ppa: (p.head.spb_pic_ppa as string) || undefined,
          spb_kode_unit: (p.head.spb_kode_unit as string) || undefined,
          spb_tipe_unit: (p.head.spb_tipe_unit as string) || undefined,
          spb_brand: (p.head.spb_brand as string) || undefined,
          spb_hm: (p.head.spb_hm as number) ?? undefined,
          spb_problem_remark: (p.head.spb_problem_remark as string) || undefined,
          spb_gudang: p.cab.nama_cabang,
          cabang_id: p.cab.id,
          items: details,
        });
        if (res?.error) markErr(p, res.error);
        continue;
      }
      const { data: spb, error } = await supabase
        .from("spb")
        .insert({
          spb_no: p.code,
          ...p.head,
          spb_status: "DONE QUOT",
          spb_gudang: p.cab.nama_cabang,
          cabang_id: p.cab.id,
          spb_pic: ctx.userName,
          created_by: ctx.userId,
          approvals: [],
          approval_status: "completed",
          completed_at: new Date().toISOString(),
          spb_is_import: true,
        })
        .select("id")
        .single();
      if (error || !spb) {
        markErr(p, error?.message || "Gagal membuat SPB");
        continue;
      }
      const { error: dErr } = await supabase.from("spb_details").insert(details.map((d) => ({ ...d, spb_id: spb.id })));
      if (dErr) {
        await supabase.from("spb").delete().eq("id", spb.id);
        markErr(p, dErr.message);
        continue;
      }
      if (potong) {
        const err = await cutStock(supabase, {
          cabangId: p.cab.id,
          items: p.items,
          type: "SPB_OUT",
          reference: p.code,
          userId: ctx.userId,
          note: () => `Stock out dari SPB ${p.code} (import riwayat)`,
        });
        if (err) for (const rw of p.list) byRow.set(rw.row, { ...byRow.get(rw.row)!, warnings: [...(byRow.get(rw.row)?.warnings || []), err] });
      }
    }
    revalidatePath("/spb");
    revalidatePath("/spb/report");
    revalidatePath("/stock");
    return rows.map((r) => byRow.get(r.row)!);
  },
};
