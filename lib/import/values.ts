// Konversi nilai sel Excel -> nilai sesuai tipe kolom import. Dipakai parser
// (client) supaya kesalahan format kelihatan per sel sebelum dikirim ke server.

import type { ImportColumn } from "./types";

const MONTHS: Record<string, number> = {};
[
  ["JANUARI", "JANUARY", "JAN"], ["FEBRUARI", "FEBRUARY", "FEB", "PEBRUARI"], ["MARET", "MARCH", "MAR"],
  ["APRIL", "APR"], ["MEI", "MAY"], ["JUNI", "JUNE", "JUN"], ["JULI", "JULY", "JUL"],
  ["AGUSTUS", "AUGUST", "AUG", "AGU", "AGT", "AGUST"], ["SEPTEMBER", "SEP", "SEPT"],
  ["OKTOBER", "OCTOBER", "OKT", "OCT"], ["NOVEMBER", "NOV", "NOPEMBER"], ["DESEMBER", "DECEMBER", "DES", "DEC"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Serial tanggal Excel (1900 system) -> YYYY-MM-DD. */
export function excelSerialToYmd(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Tanggal dari sel: Date, serial Excel, "DD/MM/YYYY", "YYYY-MM-DD", "12 Agustus 2026". */
export function parseDateValue(v: unknown): { value: string | null; error?: string } {
  if (v === null || v === undefined || v === "") return { value: null };
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { value: null, error: "tanggal tidak valid" };
    // SheetJS/exceljs mengembalikan Date UTC tengah malam untuk sel tanggal.
    const r = ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
    return r ? { value: r } : { value: null, error: "tanggal tidak valid" };
  }
  if (typeof v === "number") {
    const r = excelSerialToYmd(v);
    return r ? { value: r } : { value: null, error: `“${v}” bukan tanggal` };
  }
  const t = String(v).trim();
  if (!t || t === "-") return { value: null };
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) {
    const r = ymd(+m[1], +m[2], +m[3]);
    return r ? { value: r } : { value: null, error: `“${t}” bukan tanggal` };
  }
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    // Format Indonesia DD/MM/YYYY; kalau bagian kedua > 12 berarti MM/DD.
    const r = +m[2] > 12 ? ymd(y, +m[1], +m[2]) : ymd(y, +m[2], +m[1]);
    return r ? { value: r } : { value: null, error: `“${t}” bukan tanggal (pakai DD/MM/YYYY)` };
  }
  m = t.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s,-]+(\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) {
    const r = ymd(+m[3], MONTHS[m[2].toUpperCase()], +m[1]);
    return r ? { value: r } : { value: null, error: `“${t}” bukan tanggal` };
  }
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toUpperCase()]) {
    const r = ymd(+m[3], MONTHS[m[1].toUpperCase()], +m[2]);
    return r ? { value: r } : { value: null, error: `“${t}” bukan tanggal` };
  }
  return { value: null, error: `“${t}” bukan tanggal (pakai DD/MM/YYYY)` };
}

/** Angka: number, "1.234", "1.234,5" (format Indonesia), "1,234.5", "(5)" = -5. */
export function parseNumberValue(v: unknown): { value: number | null; error?: string } {
  if (v === null || v === undefined || v === "") return { value: null };
  if (typeof v === "number") return Number.isFinite(v) ? { value: v } : { value: null, error: "bukan angka" };
  let t = String(v).trim().replace(/\s+/g, "");
  if (!t || t === "-") return { value: null };
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    t = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1,5" desimal; "1,234" (3 digit di belakang) ribuan.
    t = /,\d{3}$/.test(t) && t.split(",").length > 1 && !/^0,/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if ((t.match(/\./g) || []).length > 1) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, error: `“${v}” bukan angka` };
  return { value: neg ? -n : n };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

/** Ubah nilai sel ke tipe kolom. Hasil null = kosong. */
export function parseCell(col: ImportColumn, raw: unknown): { value: string | number | boolean | null; error?: string } {
  if (raw && typeof raw === "object" && !(raw instanceof Date)) {
    // exceljs: rich text / hyperlink / formula result.
    const o = raw as any;
    raw = o.result ?? o.text ?? (Array.isArray(o.richText) ? o.richText.map((r: any) => r.text).join("") : String(raw));
  }
  switch (col.type) {
    case "date":
      return parseDateValue(raw);
    case "int": {
      const r = parseNumberValue(raw);
      if (r.error || r.value === null) return r;
      if (!Number.isInteger(r.value)) return { value: null, error: `“${raw}” harus bilangan bulat` };
      if (col.min !== undefined && r.value < col.min) return { value: null, error: `minimal ${col.min}` };
      return r;
    }
    case "number": {
      const r = parseNumberValue(raw);
      if (r.error || r.value === null) return r;
      if (col.min !== undefined && r.value < col.min) return { value: null, error: `minimal ${col.min}` };
      return r;
    }
    case "bool": {
      if (raw === null || raw === undefined || raw === "") return { value: null };
      if (typeof raw === "boolean") return { value: raw };
      const k = String(raw).trim().toLowerCase();
      if (!k) return { value: null };
      const mapped = col.aliases?.[k];
      if (mapped === "true") return { value: true };
      if (mapped === "false") return { value: false };
      return { value: null, error: `“${raw}” harus Ya atau Tidak` };
    }
    case "enum": {
      if (raw === null || raw === undefined || raw === "") return { value: null };
      const t = String(raw).trim();
      if (!t) return { value: null };
      const hit = (col.enumValues || []).find((e) => norm(e) === norm(t));
      if (hit) return { value: hit };
      const alias = col.aliases?.[t.toLowerCase()];
      if (alias) return { value: alias };
      return { value: null, error: `“${t}” tidak dikenal (pilihan: ${(col.enumValues || []).join(", ")})` };
    }
    default: {
      if (raw === null || raw === undefined) return { value: null };
      if (raw instanceof Date) {
        const r = parseDateValue(raw);
        return { value: r.value };
      }
      const t = typeof raw === "number" ? (Number.isInteger(raw) ? String(raw) : String(raw)) : String(raw);
      const s = t.replace(/\s+/g, " ").trim();
      return { value: s === "" ? null : s };
    }
  }
}

/** Kunci normal (huruf besar, spasi dirapikan) untuk membandingkan kode. */
export const keyOf = (v: unknown) => norm(String(v ?? ""));
