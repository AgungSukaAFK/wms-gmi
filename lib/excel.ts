import * as XLSX from "xlsx";

/** Format tampilan kolom tanggal di file Excel hasil export. */
export const EXCEL_DATE_FORMAT = "dd/mm/yyyy";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Ubah tanggal (kolom `date` "YYYY-MM-DD" atau timestamptz) jadi serial date
 * Excel, supaya sel di Excel benar-benar bertipe tanggal (bisa di-sort, filter,
 * dihitung selisih hari, dsb) — bukan teks "01 April 2026".
 *
 * Serial dihitung manual (bukan lewat Date object SheetJS) untuk menghindari
 * bug offset LMT Asia/Jakarta di tahun 1899 yang bikin tanggal geser.
 * Timestamp diambil tanggal lokalnya (sama seperti tampilan formatDate()).
 */
export function toExcelDate(
  value?: string | number | Date | null,
): number | null {
  if (value === null || value === undefined || value === "") return null;

  let y: number, m: number, d: number;
  const ymd = typeof value === "string" ? YMD_RE.exec(value) : null;
  if (ymd) {
    y = Number(ymd[1]);
    m = Number(ymd[2]) - 1;
    d = Number(ymd[3]);
  } else {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    y = date.getFullYear();
    m = date.getMonth();
    d = date.getDate();
  }

  return (Date.UTC(y, m, d) - EXCEL_EPOCH_UTC) / MS_PER_DAY;
}

/**
 * `XLSX.utils.json_to_sheet` + pasang format tanggal di kolom-kolom yang
 * disebut di `dateColumns` (nama header). Nilai di kolom tsb harus hasil
 * `toExcelDate()`; null → sel kosong.
 */
export function jsonToSheetWithDates<T extends Record<string, unknown>>(
  rows: T[],
  dateColumns: (keyof T & string)[],
): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(rows);
  if (!ws["!ref"] || rows.length === 0) return ws;

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const wanted = new Set<string>(dateColumns);
  const cols: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const header = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    if (header && wanted.has(String(header.v))) cols.push(c);
  }

  for (const c of cols) {
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = EXCEL_DATE_FORMAT;
    }
  }

  return ws;
}
