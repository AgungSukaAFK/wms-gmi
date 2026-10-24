import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { type ImportHandler, describeChanges, fail, fetchAll, keyOf, loadCabang, num, ok, str } from "./common";

const LABELS: Record<string, string> = { name: "Nama", model: "Model", current_hm: "HM", cabang_id: "Gudang" };

export const hmUnitHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const [units, cabang] = await Promise.all([
      fetchAll<any>(() => supabase.from("hm_units").select("*").order("id")),
      loadCabang(supabase),
    ]);
    const byCode = new Map<string, any[]>();
    for (const u of units) byCode.set(keyOf(u.code), [...(byCode.get(keyOf(u.code)) || []), u]);

    const results: ImportRowResult[] = [];
    const ops: { row: number; kind: "insert" | "update"; id?: number; payload: any }[] = [];
    for (const r of rows) {
      const code = str(r.values.code)!;
      const gudangName = str(r.values.gudang);
      const cab = gudangName ? cabang.byName.get(keyOf(gudangName)) : null;
      if (gudangName && !cab) {
        results.push(fail(r.row, `Gudang “${gudangName}” tidak ada di master Cabang`, code));
        continue;
      }
      const hm = num(r.values.current_hm);
      const same = byCode.get(keyOf(code)) || [];
      if (same.length > 1) {
        results.push(fail(r.row, `Ada ${same.length} unit dengan kode “${code}” di WMS, tidak bisa dipilih otomatis`, code));
        continue;
      }
      const cur = same[0];
      const name = str(r.values.name)!;
      const model = str(r.values.model)!;
      if (!cur) {
        ops.push({ row: r.row, kind: "insert", payload: { code, name, model, current_hm: hm ?? 0, cabang_id: cab?.id ?? null } });
        results.push(ok(r.row, "create", "Unit baru", code));
        continue;
      }
      const payload: any = {};
      const changes: Record<string, [unknown, unknown]> = {};
      const warnings: string[] = [];
      if (name !== cur.name) {
        payload.name = name;
        changes.name = [cur.name, name];
      }
      if (model !== cur.model) {
        payload.model = model;
        changes.model = [cur.model, model];
      }
      if (hm !== null && hm !== cur.current_hm) {
        payload.current_hm = hm;
        changes.current_hm = [cur.current_hm, hm];
        if (hm < cur.current_hm) warnings.push(`HM turun dari ${cur.current_hm} ke ${hm}`);
      }
      if (cab && cab.id !== cur.cabang_id) {
        payload.cabang_id = cab.id;
        changes.cabang_id = [cabang.byId.get(cur.cabang_id)?.nama_cabang || "-", cab.nama_cabang];
      }
      if (!Object.keys(payload).length) {
        results.push(ok(r.row, "skip", "Tidak ada perubahan", code));
      } else {
        ops.push({ row: r.row, kind: "update", id: cur.id, payload });
        results.push(ok(r.row, "update", describeChanges(changes, LABELS), code, warnings));
      }
    }

    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const op of ops) {
      const q = op.kind === "insert" ? supabase.from("hm_units").insert(op.payload) : supabase.from("hm_units").update(op.payload).eq("id", op.id);
      const { error } = await q;
      if (error) byRow.set(op.row, fail(op.row, error.message, byRow.get(op.row)?.ref));
    }
    revalidatePath("/maintenance");
    return rows.map((r) => byRow.get(r.row)!);
  },

  async prefill(ctx, params) {
    const { supabase } = ctx;
    const [units, cabang] = await Promise.all([
      fetchAll<any>(() => supabase.from("hm_units").select("*").order("code")),
      loadCabang(supabase),
    ]);
    return units
      .filter((u) => !params.cabangIds.length || params.cabangIds.includes(u.cabang_id))
      .map((u) => ({ code: u.code, name: u.name, model: u.model, current_hm: u.current_hm, gudang: cabang.byId.get(u.cabang_id)?.nama_cabang || null }));
  },
};
