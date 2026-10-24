import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { createReceive } from "@/services/procurement-actions";
import { applyReceiveCompletion } from "@/lib/receive-posting";
import { fetchPoItemPendingReceiveQty } from "@/lib/procurement-status";
import { resolveNonPrReceiveCabang } from "@/lib/po-non-pr";
import { type ImportHandler, codeVariants, fail, fetchAll, fetchIn, groupRows, keyOf, loadCabang, looseKey, num, ok, str } from "./common";

type Alloc = { po_item_id: number; qty: number; cabang_id: number; row: number };

export const receiveHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const mode = ctx.options.mode === "riwayat" ? "riwayat" : "normal";
    const templateId = Number(ctx.options.approval_template_id) || null;

    const docs = groupRows(rows, (r) => keyOf(r.values.ri_kode));
    const riCodes = Array.from(docs.values()).map((l) => str(l[0].values.ri_kode));
    const poCodes = rows.map((r) => str(r.values.po_kode));
    const [existingRi, poRows, cabang, nonPr] = await Promise.all([
      fetchIn<any>(codeVariants(riCodes), (p) => supabase.from("receives").select("id, ri_kode").in("ri_kode", p).order("id")),
      fetchIn<any>(codeVariants(poCodes), (p) =>
        supabase.from("pos").select("id, po_kode, po_status, cabang_id, po_jenis, prs:pr_id(cabang_id)").in("po_kode", p).order("id"),
      ),
      loadCabang(supabase),
      resolveNonPrReceiveCabang(supabase),
    ]);
    const riExists = new Set(existingRi.map((r) => keyOf(r.ri_kode)));
    const poByCode = new Map<string, any>(poRows.map((p) => [keyOf(p.po_kode), p]));
    const poItems = await fetchIn<any>(poRows.map((p) => p.id), (ids) =>
      supabase.from("po_items").select("id, po_id, part_id, part_number, part_name, satuan, qty, qty_received, mr_id").in("po_id", ids).order("id"),
    );
    const pending = await fetchPoItemPendingReceiveQty(supabase, poItems.map((i) => i.id));
    const allocated = new Map<number, number>();
    const sisaOf = (pi: any) => (Number(pi.qty) || 0) - (Number(pi.qty_received) || 0) - (pending.get(pi.id) || 0) - (allocated.get(pi.id) || 0);

    if (mode === "normal" && !templateId) {
      return rows.map((r) => fail(r.row, "Pilih template approval RI (mode Normal) sebelum memproses"));
    }

    const results: ImportRowResult[] = [];
    const plans: { code: string; po: any; rows: number[]; allocs: Alloc[]; tanggal: string; ket: string | null }[] = [];

    for (const [, list] of docs) {
      const code = str(list[0].values.ri_kode)!;
      if (riExists.has(keyOf(code))) {
        for (const r of list) results.push(ok(r.row, "skip", "No RI sudah ada di WMS", code));
        continue;
      }
      const poCode = str(list[0].values.po_kode)!;
      const po = poByCode.get(keyOf(poCode));
      const docErr = !po ? `PO ${poCode} tidak ditemukan` : po.po_status !== "approved" ? `PO ${po.po_kode} berstatus ${po.po_status} (harus approved)` : null;
      if (docErr) {
        for (const r of list) results.push(fail(r.row, docErr, code));
        continue;
      }
      const items = poItems.filter((i) => i.po_id === po.id);
      const allocs: Alloc[] = [];
      const rowRes: ImportRowResult[] = [];
      const before = new Map(allocated);
      for (const r of list) {
        const pn = str(r.values.part_number)!;
        const qty = num(r.values.qty)!;
        const gName = str(r.values.gudang_penerima);
        const g = gName ? cabang.byName.get(keyOf(gName)) : cabang.byId.get(po.cabang_id);
        if (!g) {
          rowRes.push(fail(r.row, gName ? `Gudang “${gName}” tidak ada di master Cabang` : "PO tidak punya gudang; isi Gudang Penerima", code));
          continue;
        }
        if (po.po_jenis === "so" && g.id !== po.cabang_id) {
          rowRes.push(fail(r.row, `Barang PO dari SO wajib diterima di gudang PO (${cabang.byId.get(po.cabang_id)?.nama_cabang || "-"})`, code));
          continue;
        }
        if (po.po_jenis === "non_pr" && (!nonPr || g.id !== nonPr.id)) {
          rowRes.push(fail(r.row, `Barang PO Non-PR wajib diterima di ${nonPr?.nama_cabang || "GMI-JAKARTA"}`, code));
          continue;
        }
        const cands = items.filter((i) => looseKey(i.part_number) === looseKey(pn));
        if (!cands.length) {
          rowRes.push(fail(r.row, `Part ${pn} tidak ada di PO ${po.po_kode}`, code));
          continue;
        }
        const totalSisa = cands.reduce((a, i) => a + Math.max(0, sisaOf(i)), 0);
        if (qty > totalSisa) {
          rowRes.push(fail(r.row, `Qty ${qty} melebihi sisa PO yang belum diterima (${totalSisa}, termasuk RI lain yang masih menunggu approval)`, code));
          continue;
        }
        let left = qty;
        for (const i of cands) {
          const take = Math.min(left, Math.max(0, sisaOf(i)));
          if (take <= 0) continue;
          allocs.push({ po_item_id: i.id, qty: take, cabang_id: g.id, row: r.row });
          allocated.set(i.id, (allocated.get(i.id) || 0) + take);
          left -= take;
          if (!left) break;
        }
        rowRes.push(ok(r.row, "create", `Terima ${qty} ${cands[0].satuan || ""} ke ${g.nama_cabang}${mode === "riwayat" ? " (langsung masuk stok)" : " (menunggu approval)"}`.replace("  ", " "), code));
      }
      if (rowRes.some((x) => x.status === "error")) {
        // Satu barang error -> 1 dokumen RI tidak dibuat; jatah qty dikembalikan.
        for (const [k, v] of before) allocated.set(k, v);
        for (const k of Array.from(allocated.keys())) if (!before.has(k)) allocated.delete(k);
        for (const x of rowRes) results.push(x.status === "error" ? x : fail(x.row, "Dilewati: ada barang error di RI yang sama", code));
        continue;
      }
      results.push(...rowRes);
      plans.push({ code, po, rows: list.map((r) => r.row), allocs, tanggal: String(list[0].values.ri_tanggal), ket: str(list[0].values.ri_keterangan) });
    }

    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    const itemById = new Map(poItems.map((i) => [i.id, i]));
    const headerCabang = (po: any) => (Array.isArray(po.prs) ? po.prs[0]?.cabang_id : po.prs?.cabang_id) ?? po.cabang_id;
    const markDoc = (plan: (typeof plans)[number], message: string) => {
      for (const rw of plan.rows) byRow.set(rw, fail(rw, message, plan.code));
    };

    for (const plan of plans) {
      const items = plan.allocs.map((a) => {
        const pi = itemById.get(a.po_item_id);
        return {
          part_id: pi.part_id,
          part_number: pi.part_number,
          part_name: pi.part_name,
          satuan: pi.satuan,
          qty: a.qty,
          po_id: plan.po.id,
          mr_id: pi.mr_id ?? null,
          po_item_id: pi.id,
          cabang_penerima_id: a.cabang_id,
        };
      });
      if (mode === "normal") {
        const res: any = await createReceive({
          ri_kode: plan.code,
          po_id: plan.po.id,
          cabang_id: headerCabang(plan.po),
          ri_pic: ctx.userName,
          ri_pic_id: ctx.userId,
          ri_tanggal: plan.tanggal,
          ri_keterangan: plan.ket || "Import Excel",
          approval_template_id: templateId!,
          items,
        });
        if (res?.error) markDoc(plan, res.error);
        continue;
      }
      // Riwayat: RI langsung completed lalu diposting (pola approveReceive).
      const { data: ri, error } = await supabase
        .from("receives")
        .insert({
          ri_kode: plan.code,
          po_id: plan.po.id,
          cabang_id: headerCabang(plan.po),
          ri_pic: ctx.userName,
          ri_pic_id: ctx.userId,
          ri_tanggal: plan.tanggal,
          ri_keterangan: plan.ket ? `${plan.ket} (import riwayat)` : "Import riwayat Excel",
          approvals: [],
          ri_status: "open",
        })
        .select("id")
        .single();
      if (error || !ri) {
        markDoc(plan, error?.message || "Gagal membuat RI");
        continue;
      }
      const { error: itemErr } = await supabase.from("receive_items").insert(items.map((it) => ({ ...it, ri_id: ri.id })));
      if (itemErr) {
        await supabase.from("receives").delete().eq("id", ri.id);
        markDoc(plan, itemErr.message);
        continue;
      }
      const { data: claimed } = await supabase
        .from("receives")
        .update({ ri_status: "completed", completed_at: new Date().toISOString() })
        .eq("id", ri.id)
        .eq("ri_status", "open")
        .select("id");
      if (!claimed?.length) {
        markDoc(plan, "RI diproses request lain");
        continue;
      }
      const posted: any = await applyReceiveCompletion(supabase, ri.id);
      if (posted?.error) {
        await supabase
          .from("receives")
          .update({ ri_status: "rejected", completed_at: null, rejection_reason: `Import riwayat gagal posting: ${posted.error}` })
          .eq("id", ri.id);
        markDoc(plan, `Gagal posting stok: ${posted.error} (RI ditandai rejected)`);
      }
    }
    revalidatePath("/receive");
    revalidatePath("/po");
    revalidatePath("/stock");
    return rows.map((r) => byRow.get(r.row)!);
  },

  async prefill(ctx, params) {
    const { supabase } = ctx;
    const cabang = await loadCabang(supabase);
    const poRows = await fetchAll<any>(() => {
      let q = supabase.from("pos").select("id, po_kode, cabang_id").eq("po_status", "approved").order("po_kode");
      if (params.cabangIds.length) q = q.in("cabang_id", params.cabangIds);
      return q;
    });
    const items = await fetchIn<any>(poRows.map((p) => p.id), (ids) =>
      supabase.from("po_items").select("id, po_id, part_number, qty, qty_received").in("po_id", ids).order("id"),
    );
    const pending = await fetchPoItemPendingReceiveQty(supabase, items.map((i) => i.id));
    const poById = new Map(poRows.map((p) => [p.id, p]));
    const out: Record<string, unknown>[] = [];
    for (const i of items) {
      const sisa = (Number(i.qty) || 0) - (Number(i.qty_received) || 0) - (pending.get(i.id) || 0);
      if (sisa <= 0) continue;
      const po = poById.get(i.po_id);
      out.push({
        ri_kode: null,
        po_kode: po.po_kode,
        ri_tanggal: null,
        part_number: i.part_number,
        qty: sisa,
        gudang_penerima: cabang.byId.get(po.cabang_id)?.nama_cabang || null,
        sisa_po: sisa,
      });
    }
    return out;
  },
};
