import type { ImportRowResult } from "../types";
import { createItemTransfer } from "@/services/item-transfer-actions";
import { createDelivery } from "@/services/inventory-actions";
import { defaultEstimasiHari } from "@/lib/shipment";
import { type ImportHandler, codeVariants, fetchIn, firstValue, groupRows, keyOf, loadCabang, looseKey, matchBarang, num, str } from "./common";
import { StockCache, docResults, existingCodes, resolveDocItems, sumByPart } from "./docs";
import { loadApprovalTemplate, mrStyleApprovals } from "./approvals";

const SHIPMENT: Record<string, string> = {
  "Handcarry Internal": "handcarry_internal",
  "Handcarry Eksternal": "handcarry_eksternal",
  "Ekspedisi Laut": "ekspedisi_laut",
  "Ekspedisi Udara": "ekspedisi_udara",
};

// ------------------------------------------------------------------ Item Transfer
export const itemTransferHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const tplId = ctx.options.approval_template_id && ctx.options.approval_template_id !== "none" ? Number(ctx.options.approval_template_id) : null;
    const tpl = tplId ? await loadApprovalTemplate(supabase, tplId, "Item Transfer") : null;
    if (tplId && !tpl) return rows.map((r) => ({ row: r.row, status: "error" as const, message: "Template approval Item Transfer tidak valid" }));
    const approvals = tpl ? mrStyleApprovals(tpl, ctx) : [];
    const directApproved = approvals.every((a) => a.status !== "pending");
    const docs = groupRows(rows, (r) => keyOf(r.values.it_kode));
    const [existing, cabang, barang] = await Promise.all([
      existingCodes(supabase, "item_transfers", "it_kode", Array.from(docs.values()).map((l) => str(l[0].values.it_kode))),
      loadCabang(supabase),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
    ]);
    const levels = new StockCache(supabase);
    const usedStock = new Map<string, number>();
    const results: ImportRowResult[] = [];
    const plans: { list: typeof rows; code: string; payload: any }[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.it_kode)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No IT sudah ada di WMS"));
        continue;
      }
      const dari = cabang.byName.get(keyOf(str(firstValue(list, "dari"))));
      const ke = cabang.byName.get(keyOf(str(firstValue(list, "ke"))));
      const docErr = !dari ? `Gudang asal ${firstValue(list, "dari")} tidak ada di master Cabang` : !ke ? `Gudang tujuan ${firstValue(list, "ke")} tidak ada di master Cabang` : dari.id === ke.id ? "Gudang asal & tujuan sama" : null;
      if (docErr) {
        results.push(...docResults(list, code, "error", docErr));
        continue;
      }
      const { items, errors, warnings } = resolveDocItems(list, barang);
      if (!errors.size) {
        await levels.ensure(dari!.id, items.map((i) => i.part_id));
        for (const [partId, need] of sumByPart(items)) {
          const avail = levels.get(dari!.id, partId) - (usedStock.get(`${dari!.id}|${partId}`) || 0);
          const it = items.find((i) => i.part_id === partId)!;
          if (need > avail) errors.set(it.row, `Stok ${dari!.nama_cabang} tidak cukup: ada ${Math.max(0, avail)}, dipindah ${need}`);
        }
      }
      if (errors.size) {
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      for (const [partId, need] of sumByPart(items)) usedStock.set(`${dari!.id}|${partId}`, (usedStock.get(`${dari!.id}|${partId}`) || 0) + need);
      results.push(...docResults(list, code, "create", `IT ${dari!.nama_cabang} → ${ke!.nama_cabang}${directApproved ? " (langsung approved, stok asal dipotong)" : " (menunggu approval)"}`, errors, warnings));
      const shipment = SHIPMENT[String(firstValue(list, "shipment_type") || "")] || "ekspedisi_laut";
      plans.push({
        list,
        code,
        payload: {
          it_kode: code,
          it_tanggal: String(firstValue(list, "it_tanggal")),
          dari_cabang_id: dari!.id,
          ke_cabang_id: ke!.id,
          shipment_type: shipment,
          ekspedisi: str(firstValue(list, "ekspedisi")) || undefined,
          no_resi: str(firstValue(list, "no_resi")) || undefined,
          jumlah_koli: num(firstValue(list, "jumlah_koli")) ?? 1,
          estimasi_hari: defaultEstimasiHari(shipment),
          pic: str(firstValue(list, "pic")) || undefined,
          remarks: str(firstValue(list, "remarks")) || undefined,
          uid_pic: ctx.userId,
          approvals,
          items: items.map((i) => ({ part_id: i.part_id, part_number: i.part_number, part_name: i.part_name, satuan: i.satuan, qty: i.qty })),
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const p of plans) {
      const res: any = await createItemTransfer(p.payload);
      if (res?.error) for (const x of docResults(p.list, p.code, "error", res.error)) byRow.set(x.row, x);
    }
    return rows.map((r) => byRow.get(r.row)!);
  },
};

// ------------------------------------------------------------------ Delivery
export const deliveryHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const docs = groupRows(rows, (r) => keyOf(r.values.dlv_kode));
    const [existing, cabang, mrs] = await Promise.all([
      existingCodes(supabase, "deliveries", "dlv_kode", Array.from(docs.values()).map((l) => str(l[0].values.dlv_kode))),
      loadCabang(supabase),
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.mr_kode))), (p) => supabase.from("mrs").select("id, mr_kode, mr_status, cabang_id").in("mr_kode", p).order("id")),
    ]);
    const mrByCode = new Map(mrs.map((m) => [keyOf(m.mr_kode), m]));
    const mrItems = await fetchIn<any>(mrs.map((m) => m.id), (ids) =>
      supabase.from("mr_items").select("id, mr_id, part_id, part_number, part_name, satuan, item_status").in("mr_id", ids).order("id"),
    );
    const levels = new StockCache(supabase);
    const usedStock = new Map<string, number>();
    const results: ImportRowResult[] = [];
    const plans: { list: typeof rows; code: string; payload: any }[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.dlv_kode)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No Delivery sudah ada di WMS"));
        continue;
      }
      const dari = cabang.byName.get(keyOf(str(firstValue(list, "dari"))));
      const ke = cabang.byName.get(keyOf(str(firstValue(list, "ke"))));
      const docErr = !dari ? `Gudang asal ${firstValue(list, "dari")} tidak ada di master Cabang` : !ke ? `Gudang tujuan ${firstValue(list, "ke")} tidak ada di master Cabang` : dari.id === ke.id ? "Gudang asal & tujuan sama" : null;
      if (docErr) {
        results.push(...docResults(list, code, "error", docErr));
        continue;
      }
      const errors = new Map<number, string>();
      const items: any[] = [];
      for (const r of list) {
        const mr = mrByCode.get(keyOf(r.values.mr_kode));
        const pn = str(r.values.part_number)!;
        if (!mr) {
          errors.set(r.row, `MR ${r.values.mr_kode} tidak ditemukan`);
          continue;
        }
        const mi = mrItems.find((i) => i.mr_id === mr.id && i.item_status !== "rejected" && looseKey(i.part_number) === looseKey(pn));
        if (!mi) {
          errors.set(r.row, `Part ${pn} tidak ada di MR ${mr.mr_kode}`);
          continue;
        }
        items.push({ row: r.row, mr_item_id: mi.id, part_id: mi.part_id, part_number: mi.part_number, part_name: mi.part_name, satuan: mi.satuan, qty: Number(r.values.qty) });
      }
      if (!errors.size) {
        await levels.ensure(dari!.id, items.map((i) => i.part_id));
        for (const [partId, need] of sumByPart(items)) {
          const avail = levels.get(dari!.id, partId) - (usedStock.get(`${dari!.id}|${partId}`) || 0);
          const it = items.find((i) => i.part_id === partId)!;
          if (need > avail) errors.set(it.row, `Stok ${dari!.nama_cabang} tidak cukup: ada ${Math.max(0, avail)}, dikirim ${need}`);
        }
      }
      if (errors.size) {
        results.push(...docResults(list, code, "error", "", errors));
        continue;
      }
      for (const [partId, need] of sumByPart(items)) usedStock.set(`${dari!.id}|${partId}`, (usedStock.get(`${dari!.id}|${partId}`) || 0) + need);
      results.push(...docResults(list, code, "create", `Delivery ${dari!.nama_cabang} → ${ke!.nama_cabang} (jatah share stock MR dicek lagi saat diproses)`));
      const shipment = SHIPMENT[String(firstValue(list, "shipment_type") || "")] || "ekspedisi_laut";
      plans.push({
        list,
        code,
        payload: {
          dlv_kode: code,
          dari_cabang_id: dari!.id,
          ke_cabang_id: ke!.id,
          ekspedisi: str(firstValue(list, "ekspedisi")) || "",
          shipment_type: shipment,
          estimasi_hari: defaultEstimasiHari(shipment),
          jumlah_koli: num(firstValue(list, "jumlah_koli")) ?? 1,
          no_resi: str(firstValue(list, "no_resi")) || undefined,
          pic: str(firstValue(list, "pic")) || undefined,
          uid_pic: ctx.userId,
          items: items.map((i) => ({ mr_item_id: i.mr_item_id, part_id: i.part_id, part_number: i.part_number, part_name: i.part_name, satuan: i.satuan, qty_on_delivery: i.qty })),
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const p of plans) {
      const res: any = await createDelivery(p.payload);
      if (res?.error) for (const x of docResults(p.list, p.code, "error", res.error)) byRow.set(x.row, x);
    }
    return rows.map((r) => byRow.get(r.row)!);
  },
};
