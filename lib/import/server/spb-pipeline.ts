import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import {
  type ImportHandler,
  codeVariants,
  dateToTs,
  fail,
  fetchAll,
  fetchIn,
  groupRows,
  keyOf,
  loadCabang,
  looseKey,
  ok,
  str,
  tsToWibDate,
} from "./common";

// Rantai dokumen SPB: spb_details -> spb_po_details -> spb_po
//                      -> spb_do_details -> spb_do -> spb_invoice_details -> spb_invoice
type Po = { id: number; spb_id: number; po_no: string; so_no: string | null; so_date: string | null; isNew?: boolean };
type Pod = { id: number; spb_po_id: number; spb_dtl_id: number; isNew?: boolean };
type Do = { id: number; spb_po_id: number; do_no: string; do_date: string | null; isNew?: boolean };
type Dod = { id: number; spb_do_id: number; spb_po_dtl_id: number; isNew?: boolean };
type Inv = {
  id: number;
  spb_do_id: number;
  invoice_no: string;
  invoice_date: string | null;
  invoice_email_date: string | null;
  payment_status: string;
  approval_status: string;
  isNew?: boolean;
};
type Invd = { id: number; spb_invoice_id: number; spb_do_dtl_id: number; invoice_qty: number | null; isNew?: boolean };

const cleanDo = (v: unknown) => {
  const t = str(v);
  return t ? t.replace(/^DO\.?\s*/i, "") : null;
};

function statusOf(spbId: number, pos: Po[], dos: Do[], invs: Inv[], allReturned: boolean, current: string) {
  if (current === "CANCELLED") return "CANCELLED";
  if (allReturned) return "Returned";
  const poIds = new Set(pos.filter((p) => p.spb_id === spbId).map((p) => p.id));
  const doIds = new Set(dos.filter((d) => poIds.has(d.spb_po_id)).map((d) => d.id));
  if (invs.some((i) => doIds.has(i.spb_do_id) && i.approval_status === "completed")) return "DONE QUOT";
  if (doIds.size) return "DO_ATTACH";
  if (poIds.size) return "PO_ATTACH";
  return "DONE QUOT";
}

export const spbPipelineHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const nowIso = new Date().toISOString();

    // ---------- muat data yang ada
    const spbs = await fetchIn<any>(codeVariants(rows.map((r) => str(r.values.spb_no))), (part) =>
      supabase.from("spb").select("id, spb_no, spb_status").in("spb_no", part).order("id"),
    );
    const spbByNo = new Map(spbs.map((s) => [keyOf(s.spb_no), s]));
    const spbIds = spbs.map((s) => s.id);
    const details = await fetchIn<any>(spbIds, (ids) =>
      supabase.from("spb_details").select("id, spb_id, dtl_spb_part_number, dtl_spb_qty, dtl_spb_qty_returned").in("spb_id", ids).order("id"),
    );
    const pos: Po[] = await fetchIn<Po>(spbIds, (ids) => supabase.from("spb_po").select("id, spb_id, po_no, so_no, so_date").in("spb_id", ids).order("id"));
    const pods: Pod[] = await fetchIn<Pod>(details.map((d) => d.id), (ids) =>
      supabase.from("spb_po_details").select("id, spb_po_id, spb_dtl_id").in("spb_dtl_id", ids).order("id"),
    );
    const dos: Do[] = await fetchIn<Do>(pos.map((p) => p.id), (ids) => supabase.from("spb_do").select("id, spb_po_id, do_no, do_date").in("spb_po_id", ids).order("id"));
    const dods: Dod[] = await fetchIn<Dod>(pods.map((p) => p.id), (ids) =>
      supabase.from("spb_do_details").select("id, spb_do_id, spb_po_dtl_id").in("spb_po_dtl_id", ids).order("id"),
    );
    const invs: Inv[] = await fetchIn<Inv>(dos.map((d) => d.id), (ids) =>
      supabase
        .from("spb_invoice")
        .select("id, spb_do_id, invoice_no, invoice_date, invoice_email_date, payment_status, approval_status")
        .in("spb_do_id", ids)
        .order("id"),
    );
    const invds: Invd[] = await fetchIn<Invd>(dods.map((d) => d.id), (ids) =>
      supabase.from("spb_invoice_details").select("id, spb_invoice_id, spb_do_dtl_id, invoice_qty").in("spb_do_dtl_id", ids).order("id"),
    );

    const poById = new Map(pos.map((p) => [p.id, p]));
    const poByKey = new Map(pos.map((p) => [`${p.spb_id}|${keyOf(p.po_no)}`, p]));
    const podByDtl = new Map(pods.map((p) => [p.spb_dtl_id, p]));
    const doById = new Map(dos.map((d) => [d.id, d]));
    const doByKey = new Map(dos.map((d) => [`${d.spb_po_id}|${keyOf(d.do_no)}`, d]));
    const dodByPod = new Map(dods.map((d) => [d.spb_po_dtl_id, d]));
    const invById = new Map(invs.map((i) => [i.id, i]));
    const invByKey = new Map(invs.map((i) => [`${i.spb_do_id}|${keyOf(i.invoice_no)}`, i]));
    const invdByDod = new Map(invds.map((i) => [i.spb_do_dtl_id, i]));

    // Baris Excel -> barang SPB (part number mirip + urutan kemunculan).
    const dtlBySpbPn = new Map<string, any[]>();
    for (const d of details) {
      const k = `${d.spb_id}|${looseKey(d.dtl_spb_part_number)}`;
      dtlBySpbPn.set(k, [...(dtlBySpbPn.get(k) || []), d]);
    }

    let tmp = -1;
    const poUpd = new Map<number, any>();
    const doUpd = new Map<number, any>();
    const invUpd = new Map<number, any>();
    const results: ImportRowResult[] = [];
    const touched = new Set<number>();
    const bySpb = groupRows(rows, (r) => keyOf(r.values.spb_no));

    for (const [spbKey, list] of bySpb) {
      const spb = spbByNo.get(spbKey);
      if (!spb) {
        for (const r of list) results.push(fail(r.row, "No SPB tidak ditemukan di WMS", str(r.values.spb_no) || undefined));
        continue;
      }
      if (spb.spb_status === "CANCELLED") {
        for (const r of list) results.push(fail(r.row, "SPB berstatus CANCELLED", spb.spb_no));
        continue;
      }
      const used = new Map<string, number>();
      for (const r of list) {
        const v = r.values;
        const ref = `${spb.spb_no} · ${v.part_number}`;
        const lk = `${spb.id}|${looseKey(v.part_number)}`;
        const n = used.get(lk) || 0;
        used.set(lk, n + 1);
        const dtl = (dtlBySpbPn.get(lk) || [])[n];
        if (!dtl) {
          results.push(
            fail(r.row, n === 0 ? `Part ${v.part_number} tidak ada di SPB ini` : `Part ${v.part_number} hanya ${n}× di SPB ini, baris ini kelebihan`, ref),
          );
          continue;
        }
        const poNo = str(v.po_no);
        const soNo = str(v.so_no);
        const doNo = cleanDo(v.do_no);
        const invNo = str(v.inv_no);
        const tglSo = (v.tgl_so as string) || null;
        const tglDo = (v.tgl_do as string) || null;
        const tglInv = (v.tgl_inv as string) || null;
        const tglEmail = (v.tgl_email as string) || null;
        const payment = v.payment ? (v.payment === "PAID" ? "paid" : "unpaid") : null;

        // ---- validasi rantai yang sudah tercatat (tanpa mengubah apa pun dulu)
        const curPod = podByDtl.get(dtl.id);
        const curPo = curPod ? poById.get(curPod.spb_po_id) : undefined;
        const curDod = curPod ? dodByPod.get(curPod.id) : undefined;
        const curDo = curDod ? doById.get(curDod.spb_do_id) : undefined;
        const curInvd = curDod ? invdByDod.get(curDod.id) : undefined;
        const curInv = curInvd ? invById.get(curInvd.spb_invoice_id) : undefined;
        if (poNo && curPo && keyOf(curPo.po_no) !== keyOf(poNo)) {
          results.push(fail(r.row, `Barang ini sudah tercatat di PO ${curPo.po_no} (bukan ${poNo})`, ref));
          continue;
        }
        if (doNo && curDo && keyOf(curDo.do_no) !== keyOf(doNo)) {
          results.push(fail(r.row, `Barang ini sudah tercatat di DO ${curDo.do_no} (bukan ${doNo})`, ref));
          continue;
        }
        if (invNo && curInv && keyOf(curInv.invoice_no) !== keyOf(invNo)) {
          results.push(fail(r.row, `Barang ini sudah tercatat di invoice ${curInv.invoice_no} (bukan ${invNo})`, ref));
          continue;
        }
        if ((doNo || invNo) && !poNo && !curPo) {
          results.push(fail(r.row, "No PO kosong: DO/Invoice hanya bisa dicatat setelah ada PO", ref));
          continue;
        }
        if (invNo && !doNo && !curDo) {
          results.push(fail(r.row, "No DO kosong: invoice hanya bisa dicatat setelah ada DO", ref));
          continue;
        }

        // ---- rencanakan
        const msgs: string[] = [];
        const warnings: string[] = [];
        let created = false;
        let updated = false;
        let po = curPo;
        let pod = curPod;
        if (poNo && !po) {
          po = poByKey.get(`${spb.id}|${keyOf(poNo)}`);
          if (!po) {
            po = { id: tmp--, spb_id: spb.id, po_no: poNo, so_no: soNo, so_date: tglSo, isNew: true };
            poByKey.set(`${spb.id}|${keyOf(poNo)}`, po);
            poById.set(po.id, po);
            pos.push(po);
            msgs.push(`PO ${poNo} baru`);
          } else msgs.push(`masuk PO ${po.po_no}`);
          pod = { id: tmp--, spb_po_id: po.id, spb_dtl_id: dtl.id, isNew: true };
          podByDtl.set(dtl.id, pod);
          pods.push(pod);
          created = true;
        }
        if (po && (soNo || tglSo)) {
          const fill: any = {};
          if (soNo && !po.so_no) fill.so_no = soNo;
          else if (soNo && keyOf(po.so_no) !== keyOf(soNo)) warnings.push(`No SO di WMS ${po.so_no}, di file ${soNo} (tidak diubah)`);
          if (tglSo && !po.so_date) fill.so_date = tglSo;
          if (Object.keys(fill).length) {
            Object.assign(po, fill);
            if (!po.isNew) {
              poUpd.set(po.id, { ...(poUpd.get(po.id) || {}), ...fill });
              updated = true;
              msgs.push(`lengkapi ${Object.keys(fill).map((k) => (k === "so_no" ? "No SO" : "Tgl SO")).join(" & ")}`);
            }
          }
        }
        let d = curDo;
        let dod = curDod;
        if (doNo && !d && po && pod) {
          d = doByKey.get(`${po.id}|${keyOf(doNo)}`);
          if (!d) {
            d = { id: tmp--, spb_po_id: po.id, do_no: doNo, do_date: tglDo, isNew: true };
            doByKey.set(`${po.id}|${keyOf(doNo)}`, d);
            doById.set(d.id, d);
            dos.push(d);
            msgs.push(`DO ${doNo} baru`);
          } else msgs.push(`masuk DO ${d.do_no}`);
          dod = { id: tmp--, spb_do_id: d.id, spb_po_dtl_id: pod.id, isNew: true };
          dodByPod.set(pod.id, dod);
          dods.push(dod);
          created = true;
        }
        if (d && tglDo && !d.do_date) {
          d.do_date = tglDo;
          if (!d.isNew) {
            doUpd.set(d.id, { do_date: tglDo });
            updated = true;
            msgs.push("lengkapi Tgl DO");
          }
        }
        let inv = curInv;
        if (invNo && !inv && d && dod) {
          inv = invByKey.get(`${d.id}|${keyOf(invNo)}`);
          if (!inv) {
            inv = {
              id: tmp--,
              spb_do_id: d.id,
              invoice_no: invNo,
              invoice_date: tglInv,
              invoice_email_date: tglEmail,
              payment_status: payment || "unpaid",
              approval_status: "completed",
              isNew: true,
            };
            invByKey.set(`${d.id}|${keyOf(invNo)}`, inv);
            invById.set(inv.id, inv);
            invs.push(inv);
            msgs.push(`invoice ${invNo} baru`);
          } else msgs.push(`masuk invoice ${inv.invoice_no}`);
          const invd: Invd = { id: tmp--, spb_invoice_id: inv.id, spb_do_dtl_id: dod.id, invoice_qty: Number(dtl.dtl_spb_qty) || null, isNew: true };
          invdByDod.set(dod.id, invd);
          invds.push(invd);
          created = true;
        }
        if (inv) {
          const fill: any = {};
          if (tglInv && !inv.invoice_date) fill.invoice_date = tglInv;
          if (tglEmail && !inv.invoice_email_date) fill.invoice_email_date = tglEmail;
          if (payment && inv.payment_status !== payment) fill.payment_status = payment;
          if (Object.keys(fill).length) {
            Object.assign(inv, fill);
            if (!inv.isNew) {
              invUpd.set(inv.id, { ...(invUpd.get(inv.id) || {}), ...fill });
              updated = true;
              if (fill.payment_status) msgs.push(`payment → ${fill.payment_status.toUpperCase()}`);
              if (fill.invoice_date || fill.invoice_email_date) msgs.push("lengkapi tanggal invoice");
            }
          }
        }
        if (created || updated) touched.add(spb.id);
        results.push(ok(r.row, created ? "create" : updated ? "update" : "skip", msgs.join(", ") || "Tidak ada perubahan", ref, warnings));
      }
    }

    // Status SPB sesudah import (rumus refreshSpbStatus).
    const statusChange = new Map<number, string>();
    for (const spbId of touched) {
      const spb = spbs.find((s) => s.id === spbId)!;
      const ds = details.filter((x) => x.spb_id === spbId);
      const allReturned = ds.length > 0 && ds.every((x) => (Number(x.dtl_spb_qty_returned) || 0) >= (Number(x.dtl_spb_qty) || 0));
      const next = statusOf(spbId, pos, dos, invs, allReturned, spb.spb_status);
      if (next !== spb.spb_status) statusChange.set(spbId, next);
    }
    for (const [spbKey, list] of bySpb) {
      const spb = spbByNo.get(spbKey);
      const next = spb ? statusChange.get(spb.id) : undefined;
      if (!next) continue;
      const first = results.find((x) => list.some((r) => r.row === x.row) && x.status !== "error");
      if (first) first.message = `${first.message} · status SPB ${spb.spb_status} → ${next}`;
    }

    if (!ctx.commit) return results;

    // ---------- tulis (bulk per tabel; gagal = bersihkan yang sudah masuk)
    const inserted: { table: string; ids: number[] }[] = [];
    const rollback = async () => {
      for (const t of inserted.reverse()) {
        for (let i = 0; i < t.ids.length; i += 150) await supabase.from(t.table).delete().in("id", t.ids.slice(i, i + 150));
      }
    };
    const bulk = async (table: string, payload: any[], select: string) => {
      const out: any[] = [];
      for (let i = 0; i < payload.length; i += 500) {
        const { data, error } = await supabase.from(table).insert(payload.slice(i, i + 500)).select(select);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data || []));
        inserted.push({ table, ids: (data || []).map((x: any) => x.id) });
      }
      return out;
    };
    try {
      const realPo = new Map<number, number>();
      const newPos = pos.filter((p) => p.isNew);
      const insPos = await bulk(
        "spb_po",
        newPos.map((p) => ({
          spb_id: p.spb_id,
          po_no: p.po_no,
          so_no: p.so_no,
          so_date: dateToTs(p.so_date),
          approvals: [],
          approval_status: "completed",
          completed_at: nowIso,
          ...(p.so_date ? { created_at: dateToTs(p.so_date) } : {}),
        })),
        "id, spb_id, po_no",
      );
      for (const p of newPos) realPo.set(p.id, insPos.find((x) => x.spb_id === p.spb_id && x.po_no === p.po_no)!.id);
      const poId = (id: number) => (id < 0 ? realPo.get(id)! : id);

      const realPod = new Map<number, number>();
      const newPods = pods.filter((p) => p.isNew);
      const insPods = await bulk("spb_po_details", newPods.map((p) => ({ spb_po_id: poId(p.spb_po_id), spb_dtl_id: p.spb_dtl_id })), "id, spb_dtl_id");
      for (const p of newPods) realPod.set(p.id, insPods.find((x) => x.spb_dtl_id === p.spb_dtl_id)!.id);
      const podId = (id: number) => (id < 0 ? realPod.get(id)! : id);

      const realDo = new Map<number, number>();
      const newDos = dos.filter((x) => x.isNew);
      const insDos = await bulk(
        "spb_do",
        newDos.map((x) => ({
          spb_po_id: poId(x.spb_po_id),
          do_no: x.do_no,
          do_date: dateToTs(x.do_date),
          do_status_part: "DELIVERED",
          approvals: [],
          approval_status: "completed",
          completed_at: nowIso,
          ...(x.do_date ? { created_at: dateToTs(x.do_date) } : {}),
        })),
        "id, spb_po_id, do_no",
      );
      for (const x of newDos) realDo.set(x.id, insDos.find((y) => y.spb_po_id === poId(x.spb_po_id) && y.do_no === x.do_no)!.id);
      const doId = (id: number) => (id < 0 ? realDo.get(id)! : id);

      const realDod = new Map<number, number>();
      const newDods = dods.filter((x) => x.isNew);
      const insDods = await bulk("spb_do_details", newDods.map((x) => ({ spb_do_id: doId(x.spb_do_id), spb_po_dtl_id: podId(x.spb_po_dtl_id) })), "id, spb_po_dtl_id");
      for (const x of newDods) realDod.set(x.id, insDods.find((y) => y.spb_po_dtl_id === podId(x.spb_po_dtl_id))!.id);
      const dodId = (id: number) => (id < 0 ? realDod.get(id)! : id);

      const realInv = new Map<number, number>();
      const newInvs = invs.filter((x) => x.isNew);
      const insInvs = await bulk(
        "spb_invoice",
        newInvs.map((x) => ({
          spb_do_id: doId(x.spb_do_id),
          invoice_no: x.invoice_no,
          invoice_date: dateToTs(x.invoice_date),
          invoice_email_date: dateToTs(x.invoice_email_date),
          payment_status: x.payment_status,
          approvals: [],
          approval_status: "completed",
          completed_at: nowIso,
          ...(x.invoice_date ? { created_at: dateToTs(x.invoice_date) } : {}),
        })),
        "id, spb_do_id, invoice_no",
      );
      for (const x of newInvs) realInv.set(x.id, insInvs.find((y) => y.spb_do_id === doId(x.spb_do_id) && y.invoice_no === x.invoice_no)!.id);
      const invId = (id: number) => (id < 0 ? realInv.get(id)! : id);

      await bulk(
        "spb_invoice_details",
        invds.filter((x) => x.isNew).map((x) => ({ spb_invoice_id: invId(x.spb_invoice_id), spb_do_dtl_id: dodId(x.spb_do_dtl_id), invoice_qty: x.invoice_qty })),
        "id",
      );
    } catch (e: any) {
      await rollback();
      return rows.map((r) => {
        const cur = results.find((x) => x.row === r.row)!;
        return cur.status === "error" || cur.status === "skip" ? cur : fail(r.row, `Gagal disimpan (batch dibatalkan): ${e.message}`, cur.ref);
      });
    }

    const updErr: string[] = [];
    for (const [id, payload] of poUpd) {
      const p = { ...payload };
      if (p.so_date) p.so_date = dateToTs(p.so_date);
      const { error } = await supabase.from("spb_po").update(p).eq("id", id);
      if (error) updErr.push(error.message);
    }
    for (const [id, payload] of doUpd) {
      const { error } = await supabase.from("spb_do").update({ do_date: dateToTs(payload.do_date) }).eq("id", id);
      if (error) updErr.push(error.message);
    }
    for (const [id, payload] of invUpd) {
      const p = { ...payload };
      if (p.invoice_date) p.invoice_date = dateToTs(p.invoice_date);
      if (p.invoice_email_date) p.invoice_email_date = dateToTs(p.invoice_email_date);
      const { error } = await supabase.from("spb_invoice").update(p).eq("id", id);
      if (error) updErr.push(error.message);
    }
    const byStatus = new Map<string, number[]>();
    for (const [id, st] of statusChange) byStatus.set(st, [...(byStatus.get(st) || []), id]);
    for (const [st, ids] of byStatus) {
      for (let i = 0; i < ids.length; i += 150) {
        const { error } = await supabase.from("spb").update({ spb_status: st }).in("id", ids.slice(i, i + 150)).neq("spb_status", "CANCELLED");
        if (error) updErr.push(error.message);
      }
    }
    revalidatePath("/spb");
    revalidatePath("/spb/report");
    revalidatePath("/spb/po");
    revalidatePath("/spb/do");
    revalidatePath("/spb/invoice");
    if (updErr.length) {
      for (const x of results) if (x.status === "update") x.warnings = [...(x.warnings || []), `Sebagian update gagal: ${updErr[0]}`];
    }
    return results;
  },

  async prefill(ctx, params) {
    const { supabase } = ctx;
    const cabang = await loadCabang(supabase);
    const rows = await fetchAll<any>(() => {
      let q = supabase
        .from("v_spb_report")
        .select("spb_id, spb_no, spb_tanggal, spb_cabang_id, spb_status, spb_dtl_id, dtl_spb_part_number, dtl_spb_qty, po_no, so_no, so_date, do_no, do_date, invoice_no, invoice_date, invoice_email_date, invoice_payment_status")
        .neq("spb_status", "CANCELLED")
        .order("spb_tanggal", { ascending: true })
        .order("spb_id")
        .order("spb_dtl_id");
      if (params.cabangIds.length) q = q.in("spb_cabang_id", params.cabangIds);
      if (params.mode === "outstanding") q = q.is("invoice_no", null);
      if (params.mode === "no_po") q = q.is("po_no", null);
      return q;
    });
    return rows.map((r) => ({
      spb_no: r.spb_no,
      part_number: r.dtl_spb_part_number,
      qty: r.dtl_spb_qty,
      gudang: cabang.byId.get(r.spb_cabang_id)?.nama_cabang || null,
      tgl_spb: tsToWibDate(r.spb_tanggal),
      po_no: r.po_no,
      so_no: r.so_no,
      tgl_so: tsToWibDate(r.so_date),
      do_no: r.do_no,
      tgl_do: tsToWibDate(r.do_date),
      inv_no: r.invoice_no,
      tgl_inv: tsToWibDate(r.invoice_date),
      tgl_email: tsToWibDate(r.invoice_email_date),
      payment: r.invoice_no ? (r.invoice_payment_status === "paid" ? "PAID" : "UNPAID") : null,
    }));
  },
};

