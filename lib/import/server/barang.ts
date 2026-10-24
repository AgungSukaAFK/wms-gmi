import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { type ImportHandler, describeChanges, fail, fetchAll, keyOf, matchBarang, ok, str } from "./common";

const LABELS = { part_name: "Nama", part_satuan: "Satuan" };

export const barangHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const updateExisting = ctx.options.update_existing !== false;
    const matches = await matchBarang(supabase, rows.map((r) => str(r.values.part_number)));
    const results: ImportRowResult[] = [];
    const inserts: { row: number; payload: any }[] = [];
    const updates: { row: number; id: number; payload: any }[] = [];

    for (const r of rows) {
      const pn = str(r.values.part_number)!;
      const name = str(r.values.part_name)!;
      const satuan = str(r.values.part_satuan)!.toUpperCase();
      const m = matches.get(pn);
      if (m && m.match === "mirip") {
        results.push(fail(r.row, `Mirip dengan barang yang sudah ada “${m.part_number}” (${m.part_name}). Kalau barangnya sama, pakai part number persis “${m.part_number}”.`, pn));
        continue;
      }
      if (!m) {
        inserts.push({ row: r.row, payload: { part_number: pn, part_name: name, part_satuan: satuan } });
        results.push(ok(r.row, "create", "Barang baru", pn));
        continue;
      }
      const changes: Record<string, [unknown, unknown]> = {};
      if (m.part_name !== name) changes.part_name = [m.part_name, name];
      if (keyOf(m.part_satuan) !== keyOf(satuan)) changes.part_satuan = [m.part_satuan, satuan];
      if (!Object.keys(changes).length) {
        results.push(ok(r.row, "skip", "Tidak ada perubahan", m.part_number));
      } else if (!updateExisting) {
        results.push(ok(r.row, "skip", `Sudah ada (opsi perbarui dimatikan): ${describeChanges(changes, LABELS)}`, m.part_number));
      } else {
        const payload: any = {};
        for (const k of Object.keys(changes)) payload[k] = k === "part_name" ? name : satuan;
        updates.push({ row: r.row, id: m.id, payload });
        results.push(ok(r.row, "update", describeChanges(changes, LABELS), m.part_number));
      }
    }

    if (!ctx.commit) return results;

    const byRow = new Map(results.map((x) => [x.row, x]));
    for (let i = 0; i < inserts.length; i += 500) {
      const part = inserts.slice(i, i + 500);
      const { error } = await supabase.from("barang").insert(part.map((p) => p.payload));
      if (error) {
        // Satu gagal (mis. dibuat orang lain barusan) -> ulangi per baris supaya yang lain tetap masuk.
        for (const p of part) {
          const { error: e2 } = await supabase.from("barang").insert(p.payload);
          if (e2) byRow.set(p.row, fail(p.row, e2.message, p.payload.part_number));
        }
      }
    }
    for (const u of updates) {
      const { error } = await supabase.from("barang").update(u.payload).eq("id", u.id);
      if (error) byRow.set(u.row, fail(u.row, error.message, byRow.get(u.row)?.ref));
    }
    revalidatePath("/barang");
    return rows.map((r) => byRow.get(r.row)!);
  },

  async prefill(ctx, params) {
    const rows = await fetchAll<any>(() =>
      ctx.supabase.from("barang").select("id, part_number, part_name, part_satuan").order("part_number"),
    );
    const list = params.mode === "name_eq_pn" ? rows.filter((b) => keyOf(b.part_name) === keyOf(b.part_number)) : rows;
    return list.map((b) => ({ part_number: b.part_number, part_name: b.part_name, part_satuan: b.part_satuan }));
  },
};
