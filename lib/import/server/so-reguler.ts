import type { ImportRowResult } from "../types";
import { createSoReguler } from "@/services/so-reguler-actions";
import { type ImportHandler, firstValue, groupRows, keyOf, matchBarang, str } from "./common";
import { docResults, existingCodes, loadCustomers, resolveDocItems } from "./docs";

export const soRegulerHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const docs = groupRows(rows, (r) => keyOf(r.values.so_kode));
    const codes = Array.from(docs.values()).map((l) => str(l[0].values.so_kode));
    const [existing, customers, barang] = await Promise.all([
      existingCodes(supabase, "so_reguler", "so_kode", codes),
      loadCustomers(supabase, rows.map((r) => str(r.values.customer_no))),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
    ]);

    const results: ImportRowResult[] = [];
    const plans: { list: typeof rows; payload: Parameters<typeof createSoReguler>[0] }[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.so_kode)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No SO sudah ada di WMS"));
        continue;
      }
      const custNo = str(firstValue(list, "customer_no"))!;
      const cust = customers.get(keyOf(custNo));
      const poDate = (firstValue(list, "customer_po_date") as string) || null;
      const poRecv = (firstValue(list, "customer_po_received_date") as string) || null;
      const soDate = String(firstValue(list, "so_tanggal"));
      const due = (firstValue(list, "so_due_date") as string) || null;
      const docErr = !cust
        ? `Customer ${custNo} tidak ada di master Customers`
        : !cust.is_active
          ? `Customer ${custNo} nonaktif`
          : cust.customer_type === "consignment"
            ? `Customer ${custNo} bertipe Consignment (pakai import SO Consignment)`
            : poDate && poRecv && poRecv < poDate
              ? "Tgl PO Diterima sebelum Tgl PO Customer"
              : due && due < soDate
                ? "Due Date sebelum Tgl SO"
                : null;
      if (docErr) {
        results.push(...docResults(list, code, "error", docErr));
        continue;
      }
      const { items, errors, warnings } = resolveDocItems(list, barang, {
        mergeDuplicates: true,
        extra: (r) => ({ remarks: str(r.values.item_remarks) }),
      });
      if (errors.size) {
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      results.push(...docResults(list, code, "create", `SO baru · ${cust!.customer_name} · ${items.length} barang`, errors, warnings));
      plans.push({
        list,
        payload: {
          so_kode: code,
          so_tanggal: soDate,
          so_due_date: due,
          kategori: String(firstValue(list, "kategori")),
          customer_po_no: str(firstValue(list, "customer_po_no")) || undefined,
          customer_po_date: poDate,
          customer_po_received_date: poRecv,
          marketing_name: str(firstValue(list, "marketing_name")) || undefined,
          customer_id: cust!.id,
          remarks: str(firstValue(list, "remarks")) || undefined,
          items: items.map((i) => ({
            part_id: i.part_id,
            part_number: i.part_number,
            part_name: i.part_name,
            satuan: i.satuan,
            qty: i.qty,
            remarks: (i.extra.remarks as string) || undefined,
          })),
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const p of plans) {
      const res: any = await createSoReguler(p.payload);
      if (res?.error) for (const x of docResults(p.list, p.payload.so_kode, "error", res.error)) byRow.set(x.row, x);
    }
    return rows.map((r) => byRow.get(r.row)!);
  },
};
