// Parser file upload (client). Kolom dicocokkan lewat JUDUL (bukan posisi),
// jadi urutan kolom boleh berubah. Nilai dikonversi sesuai tipe kolom; error
// per sel dikumpulkan per baris. Cek antar-baris (dobel, header dokumen beda)
// juga di sini supaya preview server hanya menerima baris yang formatnya benar.

import * as XLSX from "xlsx";
import type { ImportDefinition, ImportRow } from "./types";
import { parseCell, keyOf } from "./values";
import { META_SHEET } from "./template";
import { getImportDefinition } from "./registry";

export type ParsedFile = {
  sheetName: string;
  headerRow: number;
  rows: ImportRow[];
  /** Error per nomor baris Excel (format / wajib / dobel). */
  rowErrors: Map<number, string[]>;
  /** Masalah yang membuat file tidak bisa diproses sama sekali. */
  fatal: string[];
  warnings: string[];
};

const normHeader = (s: unknown) =>
  String(s ?? "")
    .replace(/\(info\)/gi, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const SKIP_SHEETS = new Set(["PETUNJUK", "CONTOH", "DAFTAR", META_SHEET.toUpperCase()]);

export async function parseImportFile(file: File, def: ImportDefinition): Promise<ParsedFile> {
  const res: ParsedFile = { sheetName: "", headerRow: 0, rows: [], rowErrors: new Map(), fatal: [], warnings: [] };
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  } catch {
    res.fatal.push("File tidak bisa dibaca. Pastikan formatnya .xlsx / .xls.");
    return res;
  }

  // Template WMS menyimpan jenis fitur di sheet tersembunyi _meta.
  const meta = wb.Sheets[META_SHEET];
  const metaKey = meta?.A2?.v ? String(meta.A2.v) : null;
  if (metaKey && metaKey !== def.key) {
    const other = getImportDefinition(metaKey);
    res.fatal.push(
      `File ini template “${other?.title || metaKey}”, bukan “${def.title}”. Upload di menu yang sesuai atau download template ${def.title}.`,
    );
    return res;
  }

  const sheetName =
    wb.SheetNames.find((n) => n === def.sheetName) ||
    wb.SheetNames.find((n) => !SKIP_SHEETS.has(n.trim().toUpperCase()));
  if (!sheetName) {
    res.fatal.push(`Sheet data “${def.sheetName}” tidak ditemukan.`);
    return res;
  }
  res.sheetName = sheetName;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: true });

  // Baris judul: baris (dari 10 baris pertama) yang paling banyak cocok.
  const wanted = new Map(def.columns.map((c) => [normHeader(c.header), c]));
  let best = -1;
  let bestHits = 0;
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const hits = (grid[i] || []).filter((c) => wanted.has(normHeader(c))).length;
    if (hits > bestHits) {
      best = i;
      bestHits = hits;
    }
  }
  if (best < 0) {
    res.fatal.push(`Judul kolom tidak ditemukan di sheet “${sheetName}”. Gunakan template dari WMS dan jangan ubah baris judul.`);
    return res;
  }
  res.headerRow = best + 1;
  const header = grid[best] || [];
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const col = wanted.get(normHeader(h));
    if (col && !idx.has(col.key)) idx.set(col.key, i);
    else if (normHeader(h) && !col) res.warnings.push(`Kolom “${String(h).trim()}” tidak dikenal, diabaikan.`);
  });
  const missing = def.columns.filter((c) => c.required && !c.infoOnly && !idx.has(c.key));
  if (missing.length) {
    res.fatal.push(`Kolom wajib tidak ada: ${missing.map((c) => c.header).join(", ")}.`);
    return res;
  }
  const absent = def.columns.filter((c) => !c.required && !c.infoOnly && !idx.has(c.key));
  if (absent.length) res.warnings.push(`Kolom tidak ada di file (dianggap kosong): ${absent.map((c) => c.header).join(", ")}.`);

  const addErr = (row: number, msg: string) => {
    const list = res.rowErrors.get(row) || [];
    list.push(msg);
    res.rowErrors.set(row, list);
  };

  for (let r = best + 1; r < grid.length; r++) {
    const src = grid[r] || [];
    const excelRow = r + 1;
    const values: ImportRow["values"] = {};
    let any = false;
    for (const col of def.columns) {
      const i = idx.get(col.key);
      if (i === undefined) {
        values[col.key] = null;
        continue;
      }
      const parsed = parseCell(col, src[i]);
      values[col.key] = parsed.value;
      if (parsed.value !== null && !col.infoOnly) any = true;
      if (parsed.error && !col.infoOnly) addErr(excelRow, `${col.header}: ${parsed.error}`);
    }
    if (!any) {
      res.rowErrors.delete(excelRow);
      continue;
    }
    for (const col of def.columns) {
      if (col.required && !col.infoOnly && (values[col.key] === null || values[col.key] === "") && !res.rowErrors.get(excelRow)?.some((e) => e.startsWith(`${col.header}:`))) {
        addErr(excelRow, `${col.header} wajib diisi`);
      }
    }
    res.rows.push({ row: excelRow, values });
  }

  if (!res.rows.length) res.fatal.push("Tidak ada baris data (isi mulai baris setelah judul kolom).");

  // Dobel dalam 1 file.
  if (def.uniqueKey?.length) {
    const seen = new Map<string, number>();
    for (const row of res.rows) {
      const parts = def.uniqueKey.map((k) => row.values[k]);
      if (parts.some((p) => p === null || p === "")) continue;
      const k = parts.map(keyOf).join("|");
      const first = seen.get(k);
      if (first) addErr(row.row, `dobel dengan baris ${first} (${def.uniqueKey.map((u) => def.columns.find((c) => c.key === u)?.header).join(" + ")} sama)`);
      else seen.set(k, row.row);
    }
  }

  // Header dokumen harus sama di semua baris 1 dokumen.
  if (def.docKey?.length && def.docHeader?.length) {
    const firstOf = new Map<string, ImportRow>();
    for (const row of res.rows) {
      const k = docKeyOf(def, row);
      if (!k) continue;
      const first = firstOf.get(k);
      if (!first) {
        firstOf.set(k, row);
        continue;
      }
      for (const h of def.docHeader) {
        const a = row.values[h];
        const b = first.values[h];
        if (a === null || a === "") continue;
        if (b !== null && b !== "" && keyOf(a) !== keyOf(b)) {
          const col = def.columns.find((c) => c.key === h);
          addErr(row.row, `${col?.header || h} beda dengan baris ${first.row} di dokumen yang sama (“${b}”)`);
        }
      }
    }
  }
  return res;
}

export function docKeyOf(def: ImportDefinition, row: ImportRow): string {
  if (!def.docKey?.length) return String(row.row);
  const parts = def.docKey.map((k) => row.values[k]);
  if (parts.some((p) => p === null || p === "")) return "";
  return parts.map(keyOf).join("|");
}

/** Kelompokkan baris jadi batch untuk dikirim ke server; dokumen tidak dipecah. */
export function makeBatches(def: ImportDefinition, rows: ImportRow[], maxRows = def.commitBatch || 300): ImportRow[][] {
  const groupCols = def.docKey?.length ? def.docKey : def.groupKey;
  if (!groupCols?.length) {
    const out: ImportRow[][] = [];
    for (let i = 0; i < rows.length; i += maxRows) out.push(rows.slice(i, i + maxRows));
    return out;
  }
  const docs = new Map<string, ImportRow[]>();
  for (const r of rows) {
    const parts = groupCols.map((k) => r.values[k]);
    const k = parts.some((p) => p === null || p === "") ? `#${r.row}` : parts.map(keyOf).join("|");
    if (!docs.has(k)) docs.set(k, []);
    docs.get(k)!.push(r);
  }
  // commitBatch untuk dokumen/kelompok = jumlah dokumen per batch.
  const out: ImportRow[][] = [];
  let cur: ImportRow[] = [];
  let n = 0;
  for (const list of docs.values()) {
    if (n >= maxRows && cur.length) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(...list);
    n++;
  }
  if (cur.length) out.push(cur);
  return out;
}
