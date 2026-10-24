import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { type ImportHandler, bool, describeChanges, fail, fetchAll, keyOf, ok, str } from "./common";

const FIELDS = ["vendor_name", "address", "telephone", "email", "contact_name", "pic_name", "is_active"] as const;
const LABELS: Record<string, string> = {
  vendor_name: "Nama",
  address: "Alamat",
  telephone: "Telepon",
  email: "Email",
  contact_name: "Kontak",
  pic_name: "PIC",
  is_active: "Aktif",
};

export const vendorHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const vendors = await fetchAll<any>(() => supabase.from("vendors").select("*").order("id"));
    const byNo = new Map(vendors.map((v) => [keyOf(v.vendor_no), v]));
    const byName = new Map<string, any[]>();
    for (const v of vendors) {
      const k = keyOf(v.vendor_name);
      byName.set(k, [...(byName.get(k) || []), v]);
    }
    let nextNo = vendors.reduce((m, v) => Math.max(m, Number(v.id) || 0), 0) + 1;
    const usedNos = new Set(vendors.map((v) => keyOf(v.vendor_no)));
    const genNo = () => {
      let code = `VND-${String(nextNo).padStart(5, "0")}`;
      while (usedNos.has(keyOf(code))) code = `VND-${String(++nextNo).padStart(5, "0")}`;
      usedNos.add(keyOf(code));
      nextNo++;
      return code;
    };

    const results: ImportRowResult[] = [];
    const ops: { row: number; kind: "insert" | "update"; id?: number; payload: any }[] = [];
    const namesInFile = new Map<string, number>();

    for (const r of rows) {
      const v = r.values;
      const no = str(v.vendor_no);
      const name = str(v.vendor_name)!;
      const incoming: Record<string, unknown> = {
        vendor_name: name,
        address: str(v.address),
        telephone: str(v.telephone),
        email: str(v.email),
        contact_name: str(v.contact_name),
        pic_name: str(v.pic_name),
        is_active: bool(v.is_active),
      };
      let existing: any = no ? byNo.get(keyOf(no)) : null;
      if (!no) {
        const prev = namesInFile.get(keyOf(name));
        if (prev) {
          results.push(fail(r.row, `Nama vendor dobel dengan baris ${prev} (isi Kode Vendor untuk membedakan)`, name));
          continue;
        }
        namesInFile.set(keyOf(name), r.row);
        const same = byName.get(keyOf(name)) || [];
        if (same.length > 1) {
          results.push(fail(r.row, `Ada ${same.length} vendor bernama “${name}” (${same.map((s) => s.vendor_no).join(", ")}). Isi Kode Vendor.`, name));
          continue;
        }
        existing = same[0] || null;
      }
      if (!existing) {
        const code = no || (ctx.commit ? genNo() : null);
        const payload: any = { vendor_no: code, ...incoming, is_active: incoming.is_active ?? true };
        ops.push({ row: r.row, kind: "insert", payload });
        results.push(ok(r.row, "create", `Vendor baru${no ? "" : " (kode otomatis VND-xxxxx)"}`, code || name));
        continue;
      }
      const changes: Record<string, [unknown, unknown]> = {};
      const payload: any = {};
      for (const f of FIELDS) {
        const nv = incoming[f];
        if (nv === null || nv === undefined) continue; // sel kosong = tidak diubah
        const cur = existing[f];
        const same = typeof nv === "boolean" ? cur === nv : keyOf(cur) === keyOf(nv) && String(cur ?? "") === String(nv);
        if (!same) {
          changes[f] = [typeof cur === "boolean" ? (cur ? "Ya" : "Tidak") : cur, typeof nv === "boolean" ? (nv ? "Ya" : "Tidak") : nv];
          payload[f] = nv;
        }
      }
      if (!Object.keys(payload).length) {
        results.push(ok(r.row, "skip", "Tidak ada perubahan", existing.vendor_no));
      } else {
        ops.push({ row: r.row, kind: "update", id: existing.id, payload });
        results.push(ok(r.row, "update", describeChanges(changes, LABELS), existing.vendor_no));
      }
    }

    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const op of ops) {
      const q =
        op.kind === "insert"
          ? supabase.from("vendors").insert(op.payload)
          : supabase.from("vendors").update({ ...op.payload, updated_at: new Date().toISOString() }).eq("id", op.id);
      const { error } = await q;
      if (error) byRow.set(op.row, fail(op.row, error.message, byRow.get(op.row)?.ref));
    }
    revalidatePath("/vendors");
    return rows.map((r) => byRow.get(r.row)!);
  },

  async prefill(ctx, params) {
    const vendors = await fetchAll<any>(() => ctx.supabase.from("vendors").select("*").order("vendor_no"));
    const list = params.mode === "incomplete" ? vendors.filter((v) => !str(v.address) || !str(v.telephone) || !str(v.email)) : vendors;
    return list.map((v) => ({
      vendor_no: v.vendor_no,
      vendor_name: v.vendor_name,
      address: v.address,
      telephone: v.telephone,
      email: v.email,
      contact_name: v.contact_name,
      pic_name: v.pic_name,
      is_active: v.is_active,
    }));
  },
};
