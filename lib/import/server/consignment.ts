import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { createConsignmentSo } from "@/services/consignment-so-actions";
import { createConsignmentIk } from "@/services/consignment-ik-actions";
import { type ImportHandler, codeVariants, fetchAll, fetchIn, firstValue, groupRows, keyOf, loadCabang, looseKey, matchBarang, str } from "./common";
import { StockCache, cutStock, docResults, existingCodes, loadCustomers, resolveDocItems, sumByPart } from "./docs";

async function loadSites(supabase: any, customerIds: number[]) {
  const rows = await fetchIn<any>(customerIds, (ids) => supabase.from("customer_sites").select("id, customer_id, site_name, is_active").in("customer_id", ids).order("id"));
  return new Map(rows.map((s) => [`${s.customer_id}|${keyOf(s.site_name)}`, s]));
}

// ------------------------------------------------------------------ SO Consignment
export const consignmentSoHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const docs = groupRows(rows, (r) => keyOf(r.values.so_no));
    const codes = Array.from(docs.values()).map((l) => str(l[0].values.so_no));
    const [existing, customers, barang] = await Promise.all([
      existingCodes(supabase, "consignment_so", "so_no", codes),
      loadCustomers(supabase, rows.map((r) => str(r.values.customer_no))),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
    ]);
    const sites = await loadSites(supabase, Array.from(customers.values()).map((c) => c.id));
    const results: ImportRowResult[] = [];
    const plans: { list: typeof rows; code: string; payload: Parameters<typeof createConsignmentSo>[0] }[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.so_no)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No SO sudah ada di WMS"));
        continue;
      }
      const custNo = str(firstValue(list, "customer_no"))!;
      const cust = customers.get(keyOf(custNo));
      const siteName = str(firstValue(list, "site"));
      const site = cust && siteName ? sites.get(`${cust.id}|${keyOf(siteName)}`) : null;
      const docErr = !cust
        ? `Customer ${custNo} tidak ada di master Customers`
        : cust.customer_type === "non_consignment"
          ? `Customer ${custNo} bertipe Reguler (ubah tipenya lewat import Customer bila perlu)`
          : siteName && !site
            ? `Site “${siteName}” tidak ada untuk customer ${custNo} (tambahkan lewat import Customer & Site)`
            : null;
      if (docErr) {
        results.push(...docResults(list, code, "error", docErr));
        continue;
      }
      const { items, errors, warnings } = resolveDocItems(list, barang, { extra: (r) => ({ pnc: str(r.values.part_number_customer) }) });
      if (errors.size) {
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      results.push(...docResults(list, code, "create", `SO Consignment baru · ${cust!.customer_name}${site ? ` · site ${site.site_name}` : ""}`, errors, warnings));
      plans.push({
        list,
        code,
        payload: {
          so_no: code,
          so_tanggal_input: String(firstValue(list, "so_tanggal_input")),
          tgl_po_email_marketing: (firstValue(list, "tgl_po_email_marketing") as string) || undefined,
          tgl_po_customer: (firstValue(list, "tgl_po_customer") as string) || undefined,
          due_date: (firstValue(list, "due_date") as string) || undefined,
          no_po: str(firstValue(list, "no_po")) || undefined,
          customer_id: cust!.id,
          site_id: site?.id ?? null,
          items: items.map((i) => ({ part_id: i.part_id, part_number: i.part_number, part_name: i.part_name, satuan: i.satuan, part_number_customer: String(i.extra.pnc), qty: i.qty })),
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const p of plans) {
      const res: any = await createConsignmentSo(p.payload);
      if (res?.error) for (const x of docResults(p.list, p.code, "error", res.error)) byRow.set(x.row, x);
    }
    return rows.map((r) => byRow.get(r.row)!);
  },
};

// ------------------------------------------------------------------ IK
const marker = (ref: string) => `[IMPORT:${ref}]`;

export const consignmentIkHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const riwayat = ctx.options.mode === "riwayat";
    const potong = !riwayat || ctx.options.potong_stok !== false;
    const docs = groupRows(rows, (r) => keyOf(r.values.ref));
    const refs = Array.from(docs.values()).map((l) => str(l[0].values.ref));
    const [byKode, imported, barang, cabang, sos] = await Promise.all([
      existingCodes(supabase, "consignment_ik", "ik_kode", refs),
      fetchAll<any>(() => supabase.from("consignment_ik").select("id, ik_kode, remarks").like("remarks", "%[IMPORT:%").order("id")),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
      loadCabang(supabase),
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.so_no))), (p) =>
        supabase
          .from("consignment_so")
          .select("id, so_no, customer_id, site_id, site, consignment_so_items(id, part_id, part_number, part_name, satuan, part_number_customer, qty)")
          .in("so_no", p)
          .order("id"),
      ),
    ]);
    const importedRefs = new Set<string>();
    for (const ik of imported) {
      const m = String(ik.remarks).match(/\[IMPORT:([^\]]+)\]/);
      if (m) importedRefs.add(keyOf(m[1]));
    }
    const soByNo = new Map(sos.map((s) => [keyOf(s.so_no), s]));
    const sites = await loadSites(supabase, Array.from(new Set(sos.map((s) => s.customer_id))));
    const siteById = new Map(Array.from(sites.values()).map((s) => [s.id, s]));
    const soItemIds = sos.flatMap((s) => (s.consignment_so_items || []).map((i: any) => i.id));
    const shippedRows = await fetchIn<any>(soItemIds, (ids) => supabase.from("consignment_ik_items").select("so_item_id, qty").in("so_item_id", ids).order("id"));
    const shipped = new Map<number, number>();
    for (const r of shippedRows) shipped.set(r.so_item_id, (shipped.get(r.so_item_id) || 0) + Number(r.qty));
    const levels = new StockCache(supabase);
    const usedStock = new Map<string, number>();

    const results: ImportRowResult[] = [];
    type Plan = { list: typeof rows; ref: string; so: any; site: any; cabangId: number; items: any[]; head: any };
    const plans: Plan[] = [];
    for (const [, list] of docs) {
      const ref = str(list[0].values.ref)!;
      if (importedRefs.has(keyOf(ref)) || byKode.has(keyOf(ref))) {
        results.push(...docResults(list, ref, "skip", "No Referensi ini sudah pernah diimport / dipakai sebagai kode IK"));
        continue;
      }
      const soNo = str(firstValue(list, "so_no"))!;
      const so = soByNo.get(keyOf(soNo));
      const gName = str(firstValue(list, "gudang"))!;
      const g = cabang.byName.get(keyOf(gName));
      const siteName = str(firstValue(list, "site"));
      const site = so ? (siteName ? sites.get(`${so.customer_id}|${keyOf(siteName)}`) : siteById.get(so.site_id)) : null;
      const docErr = !so
        ? `SO Consignment ${soNo} tidak ditemukan`
        : !g
          ? `Gudang ${gName} tidak ada di master Cabang`
          : !site
            ? siteName
              ? `Site “${siteName}” tidak ada untuk customer SO ini`
              : "SO tidak punya site; isi Site Tujuan"
            : !site.is_active
              ? `Site ${site.site_name} nonaktif`
              : null;
      if (docErr) {
        results.push(...docResults(list, ref, "error", docErr));
        continue;
      }
      const { items, errors, warnings } = resolveDocItems(list, barang);
      const allocs: any[] = [];
      for (const it of items) {
        if (errors.has(it.row)) continue;
        const cands = (so.consignment_so_items || []).filter((x: any) => x.part_id === it.part_id || looseKey(x.part_number) === looseKey(it.part_number));
        if (!cands.length) {
          errors.set(it.row, `Part ${it.part_number} bukan barang SO ${so.so_no}`);
          continue;
        }
        let left = it.qty;
        const sisaTotal = cands.reduce((a: number, c: any) => a + Math.max(0, Number(c.qty) - (shipped.get(c.id) || 0)), 0);
        if (left > sisaTotal) {
          errors.set(it.row, `Qty ${it.qty} melebihi sisa SO yang belum dikirim (${sisaTotal})`);
          continue;
        }
        for (const c of cands) {
          const sisa = Math.max(0, Number(c.qty) - (shipped.get(c.id) || 0));
          const take = Math.min(sisa, left);
          if (take <= 0) continue;
          allocs.push({ row: it.row, so_item_id: c.id, part_id: c.part_id, part_number: c.part_number, part_name: c.part_name, satuan: c.satuan, part_number_customer: c.part_number_customer, qty: take });
          shipped.set(c.id, (shipped.get(c.id) || 0) + take);
          left -= take;
          if (!left) break;
        }
      }
      if (!errors.size && potong) {
        await levels.ensure(g!.id, allocs.map((a) => a.part_id));
        for (const [partId, need] of sumByPart(allocs)) {
          const k = `${g!.id}|${partId}`;
          const avail = levels.get(g!.id, partId) - (usedStock.get(k) || 0);
          const it = allocs.find((a) => a.part_id === partId)!;
          if (need > avail) {
            if (riwayat) warnings.set(it.row, [...(warnings.get(it.row) || []), `Stok ${g!.nama_cabang} jadi minus (${avail} - ${need})`]);
            else errors.set(it.row, `Stok ${g!.nama_cabang} tidak cukup: ada ${Math.max(0, avail)}, dikirim ${need}`);
          }
        }
      }
      if (errors.size) {
        for (const a of allocs) shipped.set(a.so_item_id, (shipped.get(a.so_item_id) || 0) - a.qty);
        results.push(...docResults(list, ref, "error", "", errors, warnings));
        continue;
      }
      for (const [partId, need] of sumByPart(allocs)) usedStock.set(`${g!.id}|${partId}`, (usedStock.get(`${g!.id}|${partId}`) || 0) + need);
      results.push(
        ...docResults(list, ref, "create", `IK ${riwayat ? ref : "baru (kode otomatis)"} dari ${g!.nama_cabang} ke site ${site.site_name}${potong ? "" : " · tanpa potong stok"}`, errors, warnings),
      );
      plans.push({
        list,
        ref,
        so,
        site,
        cabangId: g!.id,
        items: allocs,
        head: {
          ik_tanggal: String(firstValue(list, "ik_tanggal")),
          no_awb: str(firstValue(list, "no_awb")),
          no_po: str(firstValue(list, "no_po")),
          remarks: str(firstValue(list, "remarks")),
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    const markErr = (p: Plan, msg: string) => {
      for (const x of docResults(p.list, p.ref, "error", msg)) byRow.set(x.row, x);
    };
    for (const p of plans) {
      const remarks = [p.head.remarks, marker(p.ref)].filter(Boolean).join(" ");
      if (!riwayat) {
        const res: any = await createConsignmentIk({
          ik_tanggal: p.head.ik_tanggal,
          so_id: p.so.id,
          dari_cabang_id: p.cabangId,
          ke_site_id: p.site.id,
          no_awb: p.head.no_awb || undefined,
          no_po: p.head.no_po || undefined,
          remarks,
          items: p.items.map((i) => ({
            so_item_id: i.so_item_id,
            part_id: i.part_id,
            part_number: i.part_number,
            part_name: i.part_name,
            part_number_customer: i.part_number_customer || undefined,
            satuan: i.satuan,
            qty: i.qty,
          })),
        });
        if (res?.error) markErr(p, res.error);
        continue;
      }
      const { data: ik, error } = await supabase
        .from("consignment_ik")
        .insert({
          ik_kode: p.ref,
          ik_tanggal: p.head.ik_tanggal,
          so_id: p.so.id,
          dari_cabang_id: p.cabangId,
          ke_site_id: p.site.id,
          ke_site_name: p.site.site_name,
          no_awb: p.head.no_awb,
          no_po: p.head.no_po,
          remarks,
          created_by: ctx.userId,
          ik_is_import: true,
        })
        .select("id")
        .single();
      if (error || !ik) {
        markErr(p, error?.message || "Gagal membuat IK");
        continue;
      }
      const { error: itemErr } = await supabase.from("consignment_ik_items").insert(
        p.items.map((i) => ({
          ik_id: ik.id,
          so_item_id: i.so_item_id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          part_number_customer: i.part_number_customer,
          satuan: i.satuan,
          qty: i.qty,
        })),
      );
      if (itemErr) {
        await supabase.from("consignment_ik").delete().eq("id", ik.id);
        markErr(p, itemErr.message);
        continue;
      }
      if (potong) {
        const err = await cutStock(supabase, {
          cabangId: p.cabangId,
          items: p.items,
          type: "IK",
          reference: p.ref,
          userId: ctx.userId,
          note: (i) => `IK ${p.ref} (import riwayat): ${i.part_number} ${i.part_name} dikirim ke site ${p.site.site_name} (consignment)`,
        });
        if (err) for (const rw of p.list) byRow.set(rw.row, { ...byRow.get(rw.row)!, warnings: [...(byRow.get(rw.row)?.warnings || []), err] });
      }
    }
    revalidatePath("/so-reguler/consignment/ik");
    revalidatePath("/so-reguler/consignment/dashboard");
    revalidatePath("/stock");
    return rows.map((r) => byRow.get(r.row)!);
  },
};
