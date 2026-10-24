import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { createDoReguler } from "@/services/do-reguler-actions";
import { computeSoItemRemaining, fetchSoItemFulfillment, poPoolAvailableAt, refreshSoStatus } from "@/lib/so-reguler";
import { defaultEstimasiHari } from "@/lib/shipment";
import { type ImportHandler, codeVariants, fetchIn, firstValue, groupRows, keyOf, loadCabang, looseKey, matchBarang, num, str } from "./common";
import { StockCache, cutStock, docResults, existingCodes, loadCustomers, resolveDocItems, sumByPart } from "./docs";

const SHIPMENT: Record<string, string> = {
  "Handcarry Internal": "handcarry_internal",
  "Handcarry Eksternal": "handcarry_eksternal",
  "Ekspedisi Laut": "ekspedisi_laut",
  "Ekspedisi Udara": "ekspedisi_udara",
};

export const doRegulerHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const riwayat = ctx.options.mode === "riwayat";
    const potong = !riwayat || ctx.options.potong_stok !== false;
    const docs = groupRows(rows, (r) => keyOf(r.values.do_kode));
    const codes = Array.from(docs.values()).map((l) => str(l[0].values.do_kode));
    const [existing, customers, barang, cabang, sos] = await Promise.all([
      existingCodes(supabase, "do_reguler", "do_kode", codes),
      loadCustomers(supabase, rows.map((r) => str(r.values.customer_no))),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
      loadCabang(supabase),
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.so_kode))), (p) =>
        supabase
          .from("so_reguler")
          .select("id, so_kode, so_status, customer_id, so_reguler_items(id, qty, part_id, part_number, part_name, satuan)")
          .in("so_kode", p)
          .order("id"),
      ),
    ]);
    const soByCode = new Map(sos.map((s) => [keyOf(s.so_kode), s]));
    const soItemIds = sos.flatMap((s) => (s.so_reguler_items || []).map((i: any) => i.id));
    const fulfillment = await fetchSoItemFulfillment(supabase, soItemIds);
    const allocatedSo = new Map<number, number>();
    const usedStock = new Map<string, number>();
    const levels = new StockCache(supabase);

    const results: ImportRowResult[] = [];
    type Plan = { list: typeof rows; code: string; so: any; cust: any; cabangId: number; payload: any; items: any[] };
    const plans: Plan[] = [];

    for (const [, list] of docs) {
      const code = str(list[0].values.do_kode)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No DO sudah ada di WMS"));
        continue;
      }
      const gName = str(firstValue(list, "gudang"))!;
      const g = cabang.byName.get(keyOf(gName));
      const soCode = str(firstValue(list, "so_kode"));
      const so = soCode ? soByCode.get(keyOf(soCode)) : null;
      const custNo = str(firstValue(list, "customer_no"));
      const custByNo = custNo ? customers.get(keyOf(custNo)) : null;
      let docErr: string | null = null;
      if (!g) docErr = `Gudang ${gName} tidak ada di master Cabang`;
      else if (soCode && !so) docErr = `SO ${soCode} tidak ditemukan`;
      else if (so?.so_status === "cancelled") docErr = `SO ${so.so_kode} sudah dibatalkan`;
      else if (!so && !custNo) docErr = "No Customer wajib diisi kalau No SO kosong";
      else if (custNo && !custByNo) docErr = `Customer ${custNo} tidak ada di master Customers`;
      else if (so && custByNo && custByNo.id !== so.customer_id) docErr = `Customer ${custNo} beda dengan customer SO ${so.so_kode}`;
      if (docErr) {
        results.push(...docResults(list, code, "error", docErr));
        continue;
      }
      const customerId = so ? so.customer_id : custByNo!.id;
      const { items, errors, warnings } = resolveDocItems(list, barang);
      const allocs: any[] = [];
      // DO dari SO: barang wajib barang SO, qty <= sisa SO yang belum di-DO.
      if (so) {
        for (const it of items) {
          if (errors.has(it.row)) continue;
          const si =
            (so.so_reguler_items || []).find((x: any) => x.part_id === it.part_id) ||
            (so.so_reguler_items || []).find((x: any) => looseKey(x.part_number) === looseKey(it.part_number));
          if (!si) {
            errors.set(it.row, `Part ${it.part_number} bukan barang SO ${so.so_kode}`);
            continue;
          }
          const { sisaDo } = computeSoItemRemaining(Number(si.qty), fulfillment.get(si.id));
          const left = sisaDo - (allocatedSo.get(si.id) || 0);
          if (it.qty > left) {
            errors.set(it.row, `Qty ${it.qty} melebihi sisa SO yang belum di-DO (${Math.max(0, left)})`);
            continue;
          }
          allocatedSo.set(si.id, (allocatedSo.get(si.id) || 0) + it.qty);
          allocs.push({ ...it, so_item_id: si.id, part_id: si.part_id, part_number: si.part_number, part_name: si.part_name, satuan: si.satuan });
        }
      } else {
        for (const it of items) if (!errors.has(it.row)) allocs.push({ ...it, so_item_id: null });
      }
      // Stok gudang pengirim.
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
        // Jatah sisa SO dikembalikan untuk dokumen yang gagal.
        for (const a of allocs) if (a.so_item_id) allocatedSo.set(a.so_item_id, (allocatedSo.get(a.so_item_id) || 0) - a.qty);
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      for (const [partId, need] of sumByPart(allocs)) usedStock.set(`${g!.id}|${partId}`, (usedStock.get(`${g!.id}|${partId}`) || 0) + need);
      const shipment = SHIPMENT[String(firstValue(list, "shipment_type") || "")] || "ekspedisi_laut";
      results.push(
        ...docResults(
          list,
          code,
          "create",
          `DO baru dari ${g!.nama_cabang}${so ? ` untuk SO ${so.so_kode}` : ""}${riwayat ? " (riwayat, langsung selesai)" : ""}${potong ? "" : " · tanpa potong stok"}`,
          errors,
          warnings,
        ),
      );
      plans.push({
        list,
        code,
        so,
        cust: customerId,
        cabangId: g!.id,
        items: allocs,
        payload: {
          do_kode: code,
          do_tanggal: String(firstValue(list, "do_tanggal")),
          dari_cabang_id: g!.id,
          customer_id: customerId,
          so_id: so?.id ?? null,
          kode_po: str(firstValue(list, "kode_po")) || undefined,
          shipment_type: shipment,
          ekspedisi: str(firstValue(list, "ekspedisi")) || undefined,
          no_resi: str(firstValue(list, "no_resi")) || undefined,
          jumlah_koli: num(firstValue(list, "jumlah_koli")) ?? 1,
          estimasi_hari: defaultEstimasiHari(shipment),
          pic: str(firstValue(list, "pic")) || undefined,
          remarks: str(firstValue(list, "remarks")) || undefined,
        },
      });
    }

    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    const markErr = (p: Plan, msg: string) => {
      for (const x of docResults(p.list, p.code, "error", msg)) byRow.set(x.row, x);
    };
    for (const p of plans) {
      const items = p.items.map((i) => ({ part_id: i.part_id, part_number: i.part_number, part_name: i.part_name, satuan: i.satuan, qty: i.qty, so_item_id: i.so_item_id }));
      if (!riwayat) {
        const res: any = await createDoReguler({ ...p.payload, items });
        if (res?.error) markErr(p, res.error);
        continue;
      }
      // Riwayat: DO langsung completed / delivered (pola import DO ERP).
      const { data: doRow, error } = await supabase
        .from("do_reguler")
        .insert({
          ...p.payload,
          uid_requester: ctx.userId,
          created_by: ctx.userId,
          status: "completed",
          tracking_status: "delivered",
          stock_released: potong,
          koli_detail: [],
          remarks: [p.payload.remarks, "Import riwayat Excel"].filter(Boolean).join(" | "),
        })
        .select("id")
        .single();
      if (error || !doRow) {
        markErr(p, error?.message || "Gagal membuat DO");
        continue;
      }
      // qty_from_po sama dengan createDoReguler: pakai pool barang PO di gudang ini.
      const fromPoLeft = new Map<number, number>();
      for (const i of items) {
        if (!i.so_item_id || fromPoLeft.has(i.so_item_id)) continue;
        const f = fulfillment.get(i.so_item_id);
        const si = (p.so?.so_reguler_items || []).find((x: any) => x.id === i.so_item_id);
        const { poPoolAvailable } = computeSoItemRemaining(Number(si?.qty || 0), f);
        fromPoLeft.set(i.so_item_id, poPoolAvailableAt(f, p.cabangId, poPoolAvailable));
      }
      const { error: itemErr } = await supabase.from("do_reguler_items").insert(
        items.map((i) => {
          const left = i.so_item_id ? fromPoLeft.get(i.so_item_id) || 0 : 0;
          const used = Math.min(left, i.qty);
          if (i.so_item_id) fromPoLeft.set(i.so_item_id, left - used);
          return { do_id: doRow.id, part_id: i.part_id, part_number: i.part_number, part_name: i.part_name, satuan: i.satuan, qty: i.qty, so_item_id: i.so_item_id, qty_from_po: used };
        }),
      );
      if (itemErr) {
        await supabase.from("do_reguler").delete().eq("id", doRow.id);
        markErr(p, itemErr.message);
        continue;
      }
      if (potong) {
        const err = await cutStock(supabase, {
          cabangId: p.cabangId,
          items,
          type: "DO_REG",
          reference: p.code,
          userId: ctx.userId,
          note: (i) => `DO Reguler ${p.code} (import riwayat): ${i.part_number} ${i.part_name} keluar (kirim ke customer)`,
        });
        if (err) for (const rw of p.list) byRow.set(rw.row, { ...byRow.get(rw.row)!, warnings: [...(byRow.get(rw.row)?.warnings || []), err] });
      }
      await refreshSoStatus(supabase, p.so?.id);
    }
    revalidatePath("/so-reguler/do");
    revalidatePath("/so-reguler/so");
    revalidatePath("/stock");
    return rows.map((r) => byRow.get(r.row)!);
  },
};
