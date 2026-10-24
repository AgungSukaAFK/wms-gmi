import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { createMaterialRequest, createPurchaseOrder, createPurchaseRequest } from "@/services/procurement-actions";
import { fetchMrItemPrConvertedQty } from "@/lib/procurement-status";
import { fetchPrItemConvertedQty, isPrItemRejected } from "@/lib/pr-po-coverage";
import { computeSoItemRemaining, fetchSoItemFulfillment } from "@/lib/so-reguler";
import { type ImportCtx, type ImportHandler, codeVariants, fetchIn, firstValue, groupRows, keyOf, loadCabang, looseKey, matchBarang, num, str } from "./common";
import { docResults, existingCodes, resolveDocItems } from "./docs";
import { loadApprovalTemplate, mrStyleApprovals, prStyleApprovals } from "./approvals";

const isRiwayat = (ctx: ImportCtx) => ctx.options.mode === "riwayat";

async function templateOrError(ctx: ImportCtx, type: string) {
  if (isRiwayat(ctx)) return { tpl: null, error: null };
  const tpl = await loadApprovalTemplate(ctx.supabase, Number(ctx.options.approval_template_id) || null, type);
  return { tpl, error: tpl ? null : `Pilih template approval ${type} (mode Normal) sebelum memproses` };
}

// ------------------------------------------------------------------ MR
export const mrHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const riwayat = isRiwayat(ctx);
    const t = await templateOrError(ctx, "Material Request");
    if (t.error) return rows.map((r) => ({ row: r.row, status: "error" as const, message: t.error! }));
    const docs = groupRows(rows, (r) => keyOf(r.values.mr_kode));
    const [existing, barang, cabang] = await Promise.all([
      existingCodes(supabase, "mrs", "mr_kode", Array.from(docs.values()).map((l) => str(l[0].values.mr_kode))),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
      loadCabang(supabase),
    ]);
    const results: ImportRowResult[] = [];
    const plans: { list: typeof rows; code: string; cabangId: number; head: any; items: any[] }[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.mr_kode)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No MR sudah ada di WMS"));
        continue;
      }
      const lok = str(firstValue(list, "lokasi"))!;
      const g = cabang.byName.get(keyOf(lok));
      if (!g) {
        results.push(...docResults(list, code, "error", `Lokasi ${lok} tidak ada di master Cabang`));
        continue;
      }
      const { items, errors, warnings } = resolveDocItems(list, barang, {
        mergeDuplicates: true,
        extra: (r) => ({ priority: str(r.values.priority) || "P3", remarks: str(r.values.remarks) }),
      });
      // Batas max stok gudang (sama dengan createMaterialRequest) -- hanya mode Normal.
      if (!errors.size && !riwayat) {
        const { data: stockRows } = await supabase.from("stock").select("part_id, qty, max_qty").eq("cabang_id", g.id).in("part_id", items.map((i) => i.part_id));
        const sm = new Map((stockRows || []).map((s: any) => [s.part_id, s]));
        for (const it of items) {
          const s: any = sm.get(it.part_id);
          const maxQty = s?.max_qty ?? 0;
          const allowed = Math.max(0, maxQty - (s?.qty ?? 0));
          if (it.qty > allowed) {
            errors.set(
              it.row,
              maxQty <= 0
                ? `${it.part_number}: belum ada kebijakan max stok di ${g.nama_cabang} (atur di menu Stock, atau pakai mode Riwayat)`
                : `${it.part_number}: maksimal ${allowed} (stok ${s?.qty ?? 0}/${maxQty}), diminta ${it.qty}`,
            );
          }
        }
      }
      if (errors.size) {
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      results.push(...docResults(list, code, "create", `MR baru ${g.nama_cabang} · ${items.length} barang${riwayat ? " (riwayat, langsung approved)" : " (menunggu approval)"}`, errors, warnings));
      plans.push({
        list,
        code,
        cabangId: g.id,
        items,
        head: {
          mr_tanggal: String(firstValue(list, "mr_tanggal")),
          mr_due_date: String(firstValue(list, "mr_due_date")),
          kategori: String(firstValue(list, "kategori")),
          keterangan: str(firstValue(list, "keterangan")),
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    const markErr = (p: (typeof plans)[number], msg: string) => {
      for (const x of docResults(p.list, p.code, "error", msg)) byRow.set(x.row, x);
    };
    for (const p of plans) {
      if (!riwayat) {
        const res: any = await createMaterialRequest({
          mr_kode: p.code,
          cabang_id: p.cabangId,
          mr_pic: ctx.userName,
          mr_pic_id: ctx.userId,
          mr_tanggal: p.head.mr_tanggal,
          mr_due_date: p.head.mr_due_date,
          kategori: p.head.kategori,
          approvals: mrStyleApprovals(t.tpl, ctx),
          items: p.items.map((i) => ({
            part_id: i.part_id,
            part_number: i.part_number,
            part_name: i.part_name,
            satuan: i.satuan,
            qty_request: i.qty,
            item_priority: String(i.extra.priority),
            remarks: (i.extra.remarks as string) || undefined,
          })),
        });
        if (res?.error) markErr(p, res.error);
        else if (p.head.keterangan && res?.data?.id) await supabase.from("mrs").update({ mr_remarks: p.head.keterangan }).eq("id", res.data.id);
        continue;
      }
      const { data: mr, error } = await supabase
        .from("mrs")
        .insert({
          mr_kode: p.code,
          cabang_id: p.cabangId,
          mr_pic: ctx.userName,
          mr_pic_id: ctx.userId,
          mr_tanggal: p.head.mr_tanggal,
          mr_due_date: p.head.mr_due_date,
          kategori: p.head.kategori,
          mr_remarks: p.head.keterangan,
          mr_status: "approved",
          approvals: [],
          mr_is_import: true,
        })
        .select("id")
        .single();
      if (error || !mr) {
        markErr(p, error?.message || "Gagal membuat MR");
        continue;
      }
      const { error: itemErr } = await supabase.from("mr_items").insert(
        p.items.map((i) => ({
          mr_id: mr.id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty_request: i.qty,
          item_priority: String(i.extra.priority),
          remarks: (i.extra.remarks as string) || null,
          qty_pr: i.qty,
          qty_sharestock_total: 0,
        })),
      );
      if (itemErr) {
        await supabase.from("mrs").delete().eq("id", mr.id);
        markErr(p, itemErr.message);
      }
    }
    revalidatePath("/mr");
    return rows.map((r) => byRow.get(r.row)!);
  },
};

// ------------------------------------------------------------------ PR
export const prHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const riwayat = isRiwayat(ctx);
    const t = await templateOrError(ctx, "Purchase Request");
    if (t.error) return rows.map((r) => ({ row: r.row, status: "error" as const, message: t.error! }));
    const docs = groupRows(rows, (r) => keyOf(r.values.pr_kode));
    const [existing, cabang, mrs] = await Promise.all([
      existingCodes(supabase, "prs", "pr_kode", Array.from(docs.values()).map((l) => str(l[0].values.pr_kode))),
      loadCabang(supabase),
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.mr_kode))), (p) => supabase.from("mrs").select("id, mr_kode, mr_status").in("mr_kode", p).order("id")),
    ]);
    const mrByCode = new Map(mrs.map((m) => [keyOf(m.mr_kode), m]));
    const mrItems = await fetchIn<any>(mrs.map((m) => m.id), (ids) =>
      supabase.from("mr_items").select("id, mr_id, part_id, part_number, part_name, satuan, qty_pr, item_status").in("mr_id", ids).order("id"),
    );
    const converted = await fetchMrItemPrConvertedQty(supabase, mrItems.map((i) => i.id));
    const used = new Map<number, number>();

    const results: ImportRowResult[] = [];
    const plans: { list: typeof rows; code: string; cabangId: number; tanggal: string; items: any[] }[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.pr_kode)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No PR sudah ada di WMS"));
        continue;
      }
      const lok = str(firstValue(list, "lokasi"))!;
      const g = cabang.byName.get(keyOf(lok));
      if (!g) {
        results.push(...docResults(list, code, "error", `Lokasi ${lok} tidak ada di master Cabang`));
        continue;
      }
      const errors = new Map<number, string>();
      const warnings = new Map<number, string[]>();
      const items: any[] = [];
      const before = new Map(used);
      for (const r of list) {
        const mrCode = str(r.values.mr_kode)!;
        const mr = mrByCode.get(keyOf(mrCode));
        const pn = str(r.values.part_number)!;
        const qty = Number(r.values.qty);
        const note = str(r.values.over_mr_note);
        if (!mr) {
          errors.set(r.row, `MR ${mrCode} tidak ditemukan`);
          continue;
        }
        if (mr.mr_status !== "approved") {
          errors.set(r.row, `MR ${mr.mr_kode} berstatus ${mr.mr_status} (harus approved)`);
          continue;
        }
        const cands = mrItems.filter((i) => i.mr_id === mr.id && i.item_status !== "rejected" && looseKey(i.part_number) === looseKey(pn));
        if (!cands.length) {
          errors.set(r.row, `Part ${pn} tidak ada di MR ${mr.mr_kode} (atau ditolak)`);
          continue;
        }
        const sisaOf = (i: any) => Math.max(0, (Number(i.qty_pr) || 0) - (converted.get(i.id) || 0) - (used.get(i.id) || 0));
        const mi = cands.find((i) => sisaOf(i) >= qty) || cands[0];
        const sisa = sisaOf(mi);
        if (qty > sisa && !note) {
          errors.set(r.row, `Qty ${qty} melebihi sisa jatah PR di MR (${sisa}); isi Keterangan Lebih MR`);
          continue;
        }
        if (qty > sisa) warnings.set(r.row, [`Melebihi sisa MR (${sisa}): ${note}`]);
        used.set(mi.id, (used.get(mi.id) || 0) + qty);
        items.push({ part_id: mi.part_id, part_number: mi.part_number, part_name: mi.part_name, satuan: mi.satuan, qty, mr_id: mi.mr_id, mr_item_id: mi.id, over_mr_note: qty > sisa ? note : null });
      }
      if (errors.size) {
        for (const [k, v] of before) used.set(k, v);
        for (const k of Array.from(used.keys())) if (!before.has(k)) used.delete(k);
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      results.push(...docResults(list, code, "create", `PR baru ${g.nama_cabang} · ${items.length} barang${riwayat ? " (riwayat, langsung approved)" : " (menunggu approval)"}`, errors, warnings));
      plans.push({ list, code, cabangId: g.id, tanggal: String(firstValue(list, "pr_tanggal")), items });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const p of plans) {
      const res: any = await createPurchaseRequest({
        pr_kode: p.code,
        cabang_id: p.cabangId,
        pr_pic_id: ctx.userId,
        pr_tanggal: p.tanggal,
        approvals: riwayat ? [] : prStyleApprovals(t.tpl, ctx),
        items: p.items,
      });
      if (res?.error) for (const x of docResults(p.list, p.code, "error", res.error)) byRow.set(x.row, x);
    }
    return rows.map((r) => byRow.get(r.row)!);
  },
};

// ------------------------------------------------------------------ PO
const JENIS: Record<string, "reguler" | "non_pr" | "so"> = { Reguler: "reguler", "Non-PR": "non_pr", "Dari SO": "so" };

export const poHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const riwayat = isRiwayat(ctx);
    if (!ctx.userRoles.includes("purchasing")) {
      return rows.map((r) => ({
        row: r.row,
        status: "error" as const,
        message: "Akun Anda butuh role Purchasing untuk membuat PO (aturan akses harga PO, sama seperti form PO).",
      }));
    }
    const t = await templateOrError(ctx, "Purchase Order");
    if (t.error) return rows.map((r) => ({ row: r.row, status: "error" as const, message: t.error! }));
    const docs = groupRows(rows, (r) => keyOf(r.values.po_kode));
    const [existing, cabang, barang, vendors, prs, sos] = await Promise.all([
      existingCodes(supabase, "pos", "po_kode", Array.from(docs.values()).map((l) => str(l[0].values.po_kode))),
      loadCabang(supabase),
      matchBarang(supabase, rows.map((r) => str(r.values.part_number))),
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.vendor_no))), (p) => supabase.from("vendors").select("id, vendor_no, vendor_name, is_active").in("vendor_no", p).order("id")),
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.pr_kode))), (p) => supabase.from("prs").select("id, pr_kode, pr_status").in("pr_kode", p).order("id")),
      fetchIn<any>(codeVariants(rows.map((r) => str(r.values.so_kode))), (p) =>
        supabase.from("so_reguler").select("id, so_kode, so_status, so_reguler_items(id, qty, part_id, part_number)").in("so_kode", p).order("id"),
      ),
    ]);
    const vendorByNo = new Map(vendors.map((v) => [keyOf(v.vendor_no), v]));
    const prByCode = new Map(prs.map((p) => [keyOf(p.pr_kode), p]));
    const soByCode = new Map(sos.map((s) => [keyOf(s.so_kode), s]));
    const prItems = await fetchIn<any>(prs.map((p) => p.id), (ids) =>
      supabase.from("pr_items").select("id, pr_id, mr_id, part_id, part_number, part_name, satuan, qty, status").in("pr_id", ids).order("id"),
    );
    const prConverted = await fetchPrItemConvertedQty(supabase, prItems.map((i) => i.id));
    const soItemIds = sos.flatMap((s) => (s.so_reguler_items || []).map((i: any) => i.id));
    const soFulfill = await fetchSoItemFulfillment(supabase, soItemIds);
    const usedPr = new Map<number, number>();
    const usedSo = new Map<number, number>();

    const results: ImportRowResult[] = [];
    const plans: { list: typeof rows; code: string; payload: any }[] = [];
    for (const [, list] of docs) {
      const code = str(list[0].values.po_kode)!;
      if (existing.has(keyOf(code))) {
        results.push(...docResults(list, code, "skip", "No PO sudah ada di WMS"));
        continue;
      }
      const jenis = JENIS[String(firstValue(list, "jenis") || "Reguler")] || "reguler";
      const vNo = str(firstValue(list, "vendor_no"))!;
      const vendor = vendorByNo.get(keyOf(vNo));
      const soCode = str(firstValue(list, "so_kode"));
      const so = soCode ? soByCode.get(keyOf(soCode)) : null;
      const gName = str(firstValue(list, "gudang_penerima"));
      const g = gName ? cabang.byName.get(keyOf(gName)) : null;
      const docErr = !vendor
        ? `Vendor ${vNo} tidak ada di master Vendors`
        : !vendor.is_active
          ? `Vendor ${vNo} nonaktif`
          : gName && !g
            ? `Gudang ${gName} tidak ada di master Cabang`
            : jenis === "so" && !so
              ? soCode
                ? `SO ${soCode} tidak ditemukan`
                : "Jenis PO Dari SO wajib mengisi No SO"
              : jenis === "so" && ["cancelled", "completed"].includes(so.so_status)
                ? `SO ${so.so_kode} sudah ${so.so_status === "cancelled" ? "dibatalkan" : "selesai"}`
                : jenis === "so" && !g
                  ? "PO Dari SO wajib mengisi Gudang Penerima"
                  : null;
      if (docErr) {
        results.push(...docResults(list, code, "error", docErr));
        continue;
      }
      const errors = new Map<number, string>();
      const warnings = new Map<number, string[]>();
      const items: any[] = [];
      const snapPr = new Map(usedPr);
      const snapSo = new Map(usedSo);
      for (const r of list) {
        const pn = str(r.values.part_number)!;
        const qty = Number(r.values.qty);
        const harga = num(r.values.harga) ?? 0;
        if (!(harga > 0)) {
          errors.set(r.row, "Harga satuan wajib > 0");
          continue;
        }
        const base = { qty, harga, vendor_id: vendor.id, mr_id: null as number | null, pr_item_id: null as number | null, pr_id: null as number | null, so_item_id: null as number | null };
        if (jenis === "reguler") {
          const prCode = str(r.values.pr_kode);
          const pr = prCode ? prByCode.get(keyOf(prCode)) : null;
          if (!pr) {
            errors.set(r.row, prCode ? `PR ${prCode} tidak ditemukan` : "PO Reguler wajib mengisi No PR per barang");
            continue;
          }
          if (pr.pr_status !== "approved") {
            errors.set(r.row, `PR ${pr.pr_kode} berstatus ${pr.pr_status} (harus approved)`);
            continue;
          }
          const cands = prItems.filter((i) => i.pr_id === pr.id && !isPrItemRejected(i) && looseKey(i.part_number) === looseKey(pn));
          const sisaOf = (i: any) => Math.max(0, (Number(i.qty) || 0) - (prConverted.get(i.id) || 0) - (usedPr.get(i.id) || 0));
          const pi = cands.find((i) => sisaOf(i) >= qty);
          if (!pi) {
            errors.set(r.row, cands.length ? `Qty ${qty} melebihi sisa PR yang belum di-PO (${cands.reduce((a, i) => a + sisaOf(i), 0)})` : `Part ${pn} tidak ada di PR ${pr.pr_kode} (atau ditolak)`);
            continue;
          }
          usedPr.set(pi.id, (usedPr.get(pi.id) || 0) + qty);
          items.push({ ...base, part_id: pi.part_id, part_number: pi.part_number, part_name: pi.part_name, satuan: pi.satuan, mr_id: pi.mr_id, pr_item_id: pi.id, pr_id: pi.pr_id });
          continue;
        }
        const m = barang.get(pn);
        if (!m) {
          errors.set(r.row, `Part ${pn} tidak ada di master Barang`);
          continue;
        }
        if (m.match === "mirip") warnings.set(r.row, [`Part “${pn}” dicocokkan ke “${m.part_number}”`]);
        if (jenis === "so") {
          const si = (so.so_reguler_items || []).find((x: any) => x.part_id === m.id);
          if (!si) {
            errors.set(r.row, `Part ${m.part_number} bukan barang SO ${so.so_kode}`);
            continue;
          }
          const { sisaPo } = computeSoItemRemaining(Number(si.qty), soFulfill.get(si.id));
          const left = sisaPo - (usedSo.get(si.id) || 0);
          if (qty > left) {
            errors.set(r.row, `Qty ${qty} melebihi sisa SO yang belum di-PO/DO (${Math.max(0, left)})`);
            continue;
          }
          usedSo.set(si.id, (usedSo.get(si.id) || 0) + qty);
          items.push({ ...base, part_id: m.id, part_number: m.part_number, part_name: m.part_name, satuan: m.part_satuan, so_item_id: si.id });
          continue;
        }
        items.push({ ...base, part_id: m.id, part_number: m.part_number, part_name: m.part_name, satuan: m.part_satuan });
      }
      if (errors.size) {
        usedPr.clear();
        snapPr.forEach((v, k) => usedPr.set(k, v));
        usedSo.clear();
        snapSo.forEach((v, k) => usedSo.set(k, v));
        results.push(...docResults(list, code, "error", "", errors, warnings));
        continue;
      }
      results.push(...docResults(list, code, "create", `PO ${jenis === "reguler" ? "reguler" : jenis === "so" ? "dari SO" : "Non-PR"} baru · ${vendor.vendor_name} · ${items.length} barang${riwayat ? " (riwayat, langsung approved)" : " (menunggu approval)"}`, errors, warnings));
      const yes = firstValue(list, "harga_termasuk_pajak") === true;
      plans.push({
        list,
        code,
        payload: {
          po_kode: code,
          cabang_id: jenis === "non_pr" ? (g?.id ?? ctx.userCabangId) : ctx.userCabangId,
          po_pic: ctx.userName,
          po_pic_id: ctx.userId,
          po_tanggal: String(firstValue(list, "po_tanggal")),
          po_estimasi: (firstValue(list, "estimasi") as string) || undefined,
          po_payment_term: str(firstValue(list, "payment_term")) || undefined,
          po_keterangan: str(firstValue(list, "keterangan")) || undefined,
          po_currency: (str(firstValue(list, "currency")) as any) || "IDR",
          po_tax_mode: "document",
          po_harga_termasuk_pajak: yes,
          po_ppn_mode: "percent",
          po_ppn_rate: num(firstValue(list, "ppn_rate")) ?? 0,
          po_ppn_amount: 0,
          po_diskon_mode: "percent",
          po_diskon_value: num(firstValue(list, "diskon_persen")) ?? 0,
          po_ongkir: num(firstValue(list, "ongkir")) ?? 0,
          po_pph_type: null,
          po_pph_mode: "percent",
          po_pph_rate: 0,
          po_pph_amount: 0,
          po_jenis: jenis,
          po_pr_referensi: jenis === "non_pr" ? str(firstValue(list, "pr_referensi")) || undefined : undefined,
          so_id: jenis === "so" ? so.id : undefined,
          so_cabang_id: jenis === "so" ? g!.id : undefined,
          approvals: riwayat ? [] : prStyleApprovals(t.tpl, ctx),
          items,
        },
      });
    }
    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const p of plans) {
      const res: any = await createPurchaseOrder(p.payload);
      if (res?.error) for (const x of docResults(p.list, p.code, "error", res.error)) byRow.set(x.row, x);
    }
    return rows.map((r) => byRow.get(r.row)!);
  },
};

