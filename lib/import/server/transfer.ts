import type { ImportRowResult } from "../types";
import { createItemTransfer } from "@/services/item-transfer-actions";
import { createDelivery, getShareStockRemaining } from "@/services/inventory-actions";
import { defaultEstimasiHari } from "@/lib/shipment";
import { businessToday } from "@/lib/business-date";
import { type ImportHandler, codeVariants, fetchIn, firstValue, groupRows, keyOf, loadCabang, looseKey, matchBarang, num, savedErr, str } from "./common";
import { type RowIssue, StockCache, addIssue, docResults, existingCodes, resolveDocItems, sumByPart } from "./docs";
import { formatRowList } from "../explain";
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
      if (res?.error) for (const x of docResults(p.list, p.code, "error", savedErr(res.error))) byRow.set(x.row, x);
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
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.mr_kode))), (p) => supabase.from("mrs").select("id, mr_kode, mr_status, cabang_id, mr_type, is_frozen, mr_due_date").in("mr_kode", p).order("id")),
    ]);
    const mrByCode = new Map(mrs.map((m) => [keyOf(m.mr_kode), m]));
    const mrItems = await fetchIn<any>(mrs.map((m) => m.id), (ids) =>
      supabase.from("mr_items").select("id, mr_id, part_id, part_number, part_name, satuan, item_status, qty_request").in("mr_id", ids).order("id"),
    );
    // Jatah share stock semua gudang sumber (untuk menjelaskan "jatahnya ada di gudang lain").
    const allocRows = await fetchIn<any>(mrItems.map((i) => i.id), (p) =>
      supabase.from("mr_sharestock_allocations").select("id, mr_item_id, source_cabang_id, qty").in("mr_item_id", p).order("id"),
    );
    const allocsByItem = new Map<number, { source: number; qty: number }[]>();
    for (const a of allocRows) allocsByItem.set(a.mr_item_id, [...(allocsByItem.get(a.mr_item_id) || []), { source: a.source_cabang_id, qty: a.qty }]);
    const partInMrs = await mrsContainingParts(supabase, rows, mrByCode, mrItems, cabang);
    const frozenMr = await predictFrozenMrs(supabase, mrs, mrItems);
    // Sisa alokasi share stock per "mr_item|gudang asal", dikurangi pemakaian
    // dokumen sebelumnya di batch yang sama (sama dengan cek createDelivery).
    const allocLeft = new Map<string, number>();
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
      const errors = new Map<number, string | RowIssue>();
      const warnings = new Map<number, string[]>();
      const items: any[] = [];
      for (const r of list) {
        const mr = mrByCode.get(keyOf(r.values.mr_kode));
        const pn = str(r.values.part_number)!;
        if (!mr) {
          addIssue(errors, r.row, {
            kind: "master_missing",
            message: `No MR ${r.values.mr_kode} tidak ditemukan di WMS`,
            details: [{ label: "No MR", file: String(r.values.mr_kode), wms: "tidak ada" }],
            hint: "Cek penulisan No MR persis seperti di WMS (huruf, garis miring, nol di depan).",
          });
          continue;
        }
        const mi = mrItems.find((i) => i.mr_id === mr.id && looseKey(i.part_number) === looseKey(pn));
        if (!mi || mi.item_status === "rejected") {
          const elsewhere = partInMrs.get(looseKey(pn)) || [];
          const others = elsewhere.filter((k) => k !== mr.mr_kode);
          addIssue(errors, r.row, {
            kind: "not_in_source",
            message: mi ? `Part ${pn} di MR ${mr.mr_kode} sudah DITOLAK approver` : `Part ${pn} tidak ada di MR ${mr.mr_kode}`,
            details: [
              { label: "Part di MR ini", file: pn, wms: mi ? "ditolak" : `tidak ada (MR berisi ${mrItems.filter((i) => i.mr_id === mr.id).length} barang)` },
              ...(others.length ? [{ label: `MR lain yang memuat ${pn}`, wms: others.slice(0, 6).join(", ") + (others.length > 6 ? ", …" : "") }] : []),
            ],
            hint: others.length
              ? `Kemungkinan No MR tertukar: part ini ada di ${others.slice(0, 3).join(", ")}. Ganti No MR-nya atau hapus barisnya.`
              : `Part ini tidak ada di MR mana pun yang menuju ${ke!.nama_cabang}. Cek Part Number / No MR, atau hapus barisnya.`,
          });
          continue;
        }
        if (mr.cabang_id && mr.cabang_id !== ke!.id) {
          warnings.set(r.row, [`MR ${mr.mr_kode} milik ${cabang.byId.get(mr.cabang_id)?.nama_cabang || mr.cabang_id}, bukan gudang tujuan ${ke!.nama_cabang}`]);
        }
        if (frozenMr.has(mr.id)) {
          const f = frozenMr.get(mr.id)!;
          addIssue(errors, r.row, { kind: "freeze", message: f.message, details: f.details });
          continue;
        }
        items.push({ row: r.row, mr_item_id: mi.id, part_id: mi.part_id, part_number: mi.part_number, part_name: mi.part_name, satuan: mi.satuan, qty_request: mi.qty_request, qty: Number(r.values.qty), mr });
      }
      // Jatah share stock MR dari gudang asal (createDelivery menolak kalau lebih).
      const needAlloc = items.filter((i) => !allocLeft.has(`${i.mr_item_id}|${dari!.id}`)).map((i) => i.mr_item_id);
      if (needAlloc.length) {
        const rem: any = await getShareStockRemaining(needAlloc, dari!.id);
        for (const id of needAlloc) allocLeft.set(`${id}|${dari!.id}`, rem?.data?.[id] ?? 0);
      }
      const rowsByItem = new Map<number, number[]>();
      const wantByItem = new Map<number, number>();
      for (const i of items) {
        wantByItem.set(i.mr_item_id, (wantByItem.get(i.mr_item_id) || 0) + i.qty);
        rowsByItem.set(i.mr_item_id, [...(rowsByItem.get(i.mr_item_id) || []), i.row]);
      }
      for (const i of items) {
        const left = allocLeft.get(`${i.mr_item_id}|${dari!.id}`) || 0;
        const want = wantByItem.get(i.mr_item_id)!;
        if (want <= left) continue;
        const srcAllocs = allocsByItem.get(i.mr_item_id) || [];
        const fromHere = srcAllocs.filter((a) => a.source === dari!.id).reduce((t, a) => t + a.qty, 0);
        const otherSrc = srcAllocs.filter((a) => a.source !== dari!.id);
        const sameItemRows = rowsByItem.get(i.mr_item_id)!;
        const notApproved = i.mr.mr_status !== "approved";
        const details = [
          { label: "Qty dikirim", file: sameItemRows.length > 1 ? `${want} (total baris ${formatRowList(sameItemRows)})` : want, wms: `sisa jatah ${Math.max(0, left)}` },
          { label: `Jatah dari ${dari!.nama_cabang}`, wms: fromHere ? `${fromHere} (sudah terpakai ${fromHere - Math.max(0, left)})` : "tidak ada" },
          { label: "Qty request MR", wms: i.qty_request },
          ...(otherSrc.length ? [{ label: "Jatah dari gudang lain", wms: otherSrc.map((a) => `${cabang.byId.get(a.source)?.nama_cabang || a.source}: ${a.qty}`).join(", ") }] : []),
          ...(notApproved ? [{ label: "Status MR", wms: i.mr.mr_status }] : []),
        ];
        const hint = notApproved
          ? `MR ${i.mr.mr_kode} masih ${i.mr.mr_status}: approve dulu & atur jatah share stock-nya.`
          : otherSrc.length && !fromHere
            ? `Jatah part ini diatur dari gudang lain (${otherSrc.map((a) => cabang.byId.get(a.source)?.nama_cabang).join(", ")}), bukan ${dari!.nama_cabang}. Ganti Gudang Asal atau ubah alokasinya di Share Stock.`
            : left > 0
              ? `Turunkan qty jadi maksimal ${left}${sameItemRows.length > 1 ? " (total semua baris part ini di MR ini)" : ""}, atau tambah jatahnya di Share Stock.`
              : fromHere
                ? `Jatah dari ${dari!.nama_cabang} sudah habis terpakai Delivery lain. Hapus baris ini atau tambah jatahnya di Share Stock.`
                : `Atur dulu jatah share stock part ini dari ${dari!.nama_cabang} di Share Stock, atau hapus barisnya.`;
        addIssue(errors, i.row, {
          kind: "allocation",
          message:
            left <= 0
              ? `${i.part_number} di MR ${i.mr.mr_kode} ${fromHere ? "sudah habis jatah" : "tidak punya jatah"} share stock dari ${dari!.nama_cabang}`
              : `Qty ${want} melebihi sisa jatah share stock ${i.part_number} MR ${i.mr.mr_kode} dari ${dari!.nama_cabang} (sisa ${left})`,
          details,
          hint,
        });
      }
      // Stok gudang asal (total per part di dokumen ini + dokumen sebelumnya di file).
      await levels.ensure(dari!.id, items.map((i) => i.part_id));
      for (const [partId, need] of sumByPart(items)) {
        const onHand = levels.get(dari!.id, partId);
        const usedBefore = usedStock.get(`${dari!.id}|${partId}`) || 0;
        const avail = onHand - usedBefore;
        if (need <= avail) continue;
        const partRows = items.filter((i) => i.part_id === partId).map((i) => i.row);
        for (const row of partRows) {
          addIssue(errors, row, {
            kind: "stock",
            message: `Stok ${items.find((i) => i.part_id === partId)!.part_number} di ${dari!.nama_cabang} tidak cukup: tersedia ${Math.max(0, avail)}, dibutuhkan ${need}`,
            details: [
              { label: "Total dikirim di dokumen ini", file: partRows.length > 1 ? `${need} (baris ${formatRowList(partRows)})` : need },
              { label: `Stok ${dari!.nama_cabang}`, wms: onHand },
              ...(usedBefore ? [{ label: "Sudah dipakai dokumen sebelumnya di file", file: usedBefore }] : []),
            ],
          });
        }
      }
      if (errors.size) {
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      for (const [partId, need] of sumByPart(items)) usedStock.set(`${dari!.id}|${partId}`, (usedStock.get(`${dari!.id}|${partId}`) || 0) + need);
      for (const [itemId, want] of wantByItem) allocLeft.set(`${itemId}|${dari!.id}`, (allocLeft.get(`${itemId}|${dari!.id}`) || 0) - want);
      results.push(...docResults(list, code, "create", `Delivery ${dari!.nama_cabang} → ${ke!.nama_cabang}`, undefined, warnings));
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
      if (res?.error) for (const x of docResults(p.list, p.code, "error", savedErr(res.error))) byRow.set(x.row, x);
    }
    return rows.map((r) => byRow.get(r.row)!);
  },
};

/**
 * MR (standard) yang akan/ sudah di-freeze -- prediksi read-only dari
 * evaluateMrFreeze (yang dipanggil createDelivery dan MEMBEKUKAN MR-nya):
 * is_frozen, atau due date lewat & masih ada item ber-jatah share stock yang
 * belum punya delivery. Ditolak di preview supaya import tidak ikut memicu freeze.
 */
async function predictFrozenMrs(supabase: any, mrs: any[], mrItems: any[]) {
  const out = new Map<number, { message: string; details: RowIssue["details"] }>();
  const today = businessToday();
  const due: any[] = [];
  for (const m of mrs) {
    if (m.mr_type === "scheduled") continue;
    if (m.is_frozen) out.set(m.id, { message: `MR ${m.mr_kode} sedang di-FREEZE`, details: [{ label: "Status freeze MR", wms: "FREEZE" }] });
    else if (m.mr_due_date && m.mr_due_date < today) due.push(m);
  }
  if (!due.length) return out;
  const dueIds = new Set(due.map((m) => m.id));
  const itemIds = mrItems.filter((i) => dueIds.has(i.mr_id)).map((i) => i.id);
  const allocs = await fetchIn<any>(itemIds, (p) => supabase.from("mr_sharestock_allocations").select("id, mr_item_id").in("mr_item_id", p).order("id"));
  const allocated = Array.from(new Set(allocs.map((a) => a.mr_item_id)));
  const delivered = await fetchIn<any>(allocated, (p) =>
    supabase.from("delivery_items").select("id, mr_item_id, deliveries!inner(status)").in("mr_item_id", p).neq("deliveries.status", "cancelled").order("id"),
  );
  const deliveredSet = new Set(delivered.map((d) => d.mr_item_id));
  const mrOfItem = new Map(mrItems.map((i) => [i.id, i.mr_id]));
  const pendingCount = new Map<number, number>();
  for (const id of allocated) if (!deliveredSet.has(id)) pendingCount.set(mrOfItem.get(id), (pendingCount.get(mrOfItem.get(id)) || 0) + 1);
  for (const m of due) {
    const n = pendingCount.get(m.id);
    if (n)
      out.set(m.id, {
        message: `MR ${m.mr_kode} lewat due date & akan otomatis di-FREEZE kalau Delivery dibuat`,
        details: [
          { label: "Due date MR", wms: `${m.mr_due_date} (hari ini ${today})` },
          { label: "Item ber-jatah share stock belum dikirim", wms: n },
        ],
      });
  }
  return out;
}

/** PN -> daftar MR (ke gudang tujuan mana pun di file) yang memuat part itu; bahan saran "No MR tertukar". */
async function mrsContainingParts(supabase: any, rows: any[], mrByCode: Map<string, any>, mrItems: any[], cabang: Awaited<ReturnType<typeof loadCabang>>) {
  const out = new Map<string, string[]>();
  const add = (pn: string, kode: string) => {
    const k = looseKey(pn);
    const list = out.get(k) || [];
    if (!list.includes(kode)) list.push(kode);
    out.set(k, list);
  };
  const kodeById = new Map(Array.from(mrByCode.values()).map((m) => [m.id, m.mr_kode]));
  // PN yang tidak cocok di MR-nya -> cari juga ke MR approved lain milik gudang tujuan.
  const missing = rows.filter((r) => {
    const mr = mrByCode.get(keyOf(r.values.mr_kode));
    return mr && !mrItems.some((i) => i.mr_id === mr.id && i.item_status !== "rejected" && looseKey(i.part_number) === looseKey(str(r.values.part_number)));
  });
  if (!missing.length) return out;
  for (const i of mrItems) if (i.item_status !== "rejected") add(i.part_number, kodeById.get(i.mr_id));
  const keIds = Array.from(new Set(missing.map((r) => cabang.byName.get(keyOf(str(r.values.ke))))?.filter(Boolean).map((c: any) => c.id)));
  const pns = codeVariants(missing.map((r) => str(r.values.part_number)));
  if (keIds.length && pns.length) {
    const found = await fetchIn<any>(pns, (p) =>
      supabase
        .from("mr_items")
        .select("id, part_number, item_status, mrs!inner(mr_kode, cabang_id, mr_status)")
        .in("part_number", p)
        .in("mrs.cabang_id", keIds)
        .eq("mrs.mr_status", "approved")
        .neq("item_status", "rejected")
        .order("id"),
    );
    for (const f of found) add(f.part_number, (Array.isArray(f.mrs) ? f.mrs[0] : f.mrs).mr_kode);
  }
  for (const [k, list] of out) out.set(k, list.sort());
  return out;
}
