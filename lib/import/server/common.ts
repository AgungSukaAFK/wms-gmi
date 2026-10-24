// Helper server untuk handler Pusat Import. SENGAJA bukan modul "use server":
// handler menulis data, jadi hanya boleh dipanggil lewat services/import-actions.ts
// yang memeriksa role moderator lebih dulu.

import type { ImportOptionValues, ImportRow, ImportRowResult } from "../types";
import { keyOf } from "../values";

export type ImportCtx = {
  supabase: any;
  userId: string;
  userName: string;
  userEmail: string;
  userRoles: string[];
  userCabangId: number | null;
  userCabangName: string | null;
  options: ImportOptionValues;
  /** false = preview (tidak menulis apa pun). */
  commit: boolean;
};

export type PrefillParams = { mode: string; cabangIds: number[] };

export type ImportHandler = {
  run(ctx: ImportCtx, rows: ImportRow[]): Promise<ImportRowResult[]>;
  prefill?(ctx: ImportCtx, params: PrefillParams): Promise<Record<string, unknown>[]>;
};

export const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
export { keyOf };

/** Kunci "mirip": huruf besar, tanpa spasi/titik/strip. */
export const looseKey = (v: unknown) => String(v ?? "").toUpperCase().replace(/[\s.\-]/g, "");

/** Ambil semua baris (pagination 1000) dari query builder yang dibuat ulang tiap halaman. */
export async function fetchAll<T = any>(make: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Query .in() dipecah per potongan (URL PostgREST terbatas). */
export async function fetchIn<T = any>(
  values: (string | number)[],
  make: (chunk: (string | number)[]) => any,
  size = 150,
): Promise<T[]> {
  const uniq = Array.from(new Set(values.filter((v) => v !== null && v !== undefined && v !== "")));
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += size) {
    const part = uniq.slice(i, i + size);
    const rows = await fetchAll<T>(() => make(part));
    out.push(...rows);
  }
  return out;
}

/** Variasi teks untuk pencocokan kode persis (apa adanya, trim, huruf besar). */
export function codeVariants(values: (string | null | undefined)[]) {
  const set = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const t = String(v).trim();
    set.add(t);
    set.add(t.toUpperCase());
    set.add(t.toLowerCase());
  }
  return Array.from(set);
}

export type BarangMatch = { id: number; part_number: string; part_name: string; part_satuan: string; match: "persis" | "mirip" };

/** Cocokkan part number ke master barang (RPC import_match_barang). Kunci hasil = teks input apa adanya. */
export async function matchBarang(supabase: any, partNumbers: (string | null)[]) {
  const map = new Map<string, BarangMatch>();
  const uniq = Array.from(new Set(partNumbers.filter((p): p is string => !!p)));
  for (let i = 0; i < uniq.length; i += 500) {
    const { data, error } = await supabase.rpc("import_match_barang", { p_part_numbers: uniq.slice(i, i + 500) });
    if (error) throw new Error(`Gagal mencocokkan barang: ${error.message}`);
    for (const r of data || []) map.set(r.input, r as BarangMatch);
  }
  return map;
}

export type CabangRef = { id: number; nama_cabang: string; kode_cabang: string | null; is_active: boolean };

export async function loadCabang(supabase: any) {
  const rows = await fetchAll<CabangRef>(() => supabase.from("cabang").select("id, nama_cabang, kode_cabang, is_active").order("id"));
  const byName = new Map<string, CabangRef>();
  for (const c of rows) {
    if (!byName.has(keyOf(c.nama_cabang))) byName.set(keyOf(c.nama_cabang), c);
    if (c.kode_cabang && !byName.has(keyOf(c.kode_cabang))) byName.set(keyOf(c.kode_cabang), c);
  }
  return { rows, byName, byId: new Map(rows.map((c) => [c.id, c])) };
}

export const ok = (row: number, status: ImportRowResult["status"], message?: string, ref?: string, warnings?: string[]): ImportRowResult => ({
  row,
  status,
  message,
  ref,
  warnings: warnings?.length ? warnings : undefined,
});
export const fail = (row: number, message: string, ref?: string): ImportRowResult => ({ row, status: "error", message, ref });

/** Kelompokkan baris per kunci (urutan kemunculan dipertahankan). */
export function groupRows(rows: ImportRow[], keyFn: (r: ImportRow) => string) {
  const map = new Map<string, ImportRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return map;
}

/** Nilai pertama yang terisi di antara baris-baris 1 dokumen. */
export function firstValue(rows: ImportRow[], key: string) {
  for (const r of rows) {
    const v = r.values[key];
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return null;
}

/** Ringkas perubahan field untuk pesan preview. */
export function describeChanges(changes: Record<string, [unknown, unknown]>, labels: Record<string, string>) {
  return Object.entries(changes)
    .map(([k, [a, b]]) => `${labels[k] || k}: ${a === null || a === undefined || a === "" ? "(kosong)" : a} → ${b}`)
    .join("; ");
}

/** Tanggal YYYY-MM-DD -> timestamptz tengah malam WIB (sama dengan input form). */
export const dateToTs = (d: string | null) => (d ? `${d}T00:00:00+07:00` : null);

/** timestamptz / date dari DB -> YYYY-MM-DD menurut WIB (UTC+7), untuk template isi-data. */
export const tsToWibDate = (v: unknown): string | null => {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
};
