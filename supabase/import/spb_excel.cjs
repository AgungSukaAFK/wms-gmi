// Parser bersama file "SPB MONITORING <site> 2026.xlsx" (folder Import 23
// Oktober/SPB). 1 file = 1 site, sheet per bulan (+ sheet "17 Okt"), 1 baris
// = 1 barang SPB beserta progres WO -> PO customer/SO -> DO -> Invoice ->
// Payment. Header ada ~15 variasi, tapi posisi kolom 0..36 sama di semua
// sheet kecuali sheet yang KODE UNIT & STATUS SPB-nya tertukar (dicek per
// sheet lewat teks header). Label kolom 2 kadang salah tulis "KODE UNIT"
// padahal isinya No SPB.

const path = require("path");
const fs = require("fs");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));

// Posisi kolom -> nama field + pola label header yang diterima.
const COLS = [
  [0, "no", /^NO$/],
  [1, "tgl_spb", /^TANGGAL SPB$/],
  [2, "spb_no", /^(NO SPB|KODE UNIT)$/],
  [3, "part_number", /^PART NUMBER$/],
  [4, "part_name", /^PART NAME$/],
  [5, "qty", /^(QTY|PART NAME)$/],
  [6, "uom", /^UOM$/],
  [7, "status_spb", /^STATUS SPB$/],
  [8, "kode_unit", /^KODE UNIT$/],
  [9, "tipe_unit", /^(TYPE|MODEL) UNIT$/],
  [10, "brand", /^(BRAND|)$/],
  [11, "hm", /^HM$/],
  [12, "ps", /^PS$/],
  [13, "remark", /^PROBLEM\/REMARK$/],
  [14, "section", /^SECTION$/],
  [15, "pic_gmi", /^PIC (GMI|GMA)$/],
  [16, "pic_cust", /^PIC (PPA|GMA)$/],
  [17, "no_wo", /^(NO WO|RESERVATION NUMBER)$/],
  [18, "tgl_wo", /^DATE INPUT$/],
  [19, "status_wo", /^(STATUS WO|NO PR)$/],
  [20, "tgl_submit_po", /^TGL SUBMIT SPB TO PO$/],
  [21, "po_no", /^NO PO$/],
  [22, "so_no", /^NO SO$/],
  [23, "tgl_so", /^DATE INPUT$/],
  [24, "status_po", /^STATUS PO$/],
  [25, "do_no", /^NO DO$/],
  [26, "tgl_do", /^DATE INPUT$/],
  [27, "status_do", /^STATUS DO$/],
  [28, "status_part", /^STATUS PART$/],
  [29, "inv_no", /^NO INVOICE$/],
  [30, "tgl_inv", /^TANGGAL INVOICE$/],
  [31, "status_inv", /^STATUS INVOICE$/],
  [32, "tgl_email", /^TANGGAL KIRIM EMAIL KE SITE$/],
  [33, "tgl_payment", /^TANGGAL PAYMENT$/],
  [34, "status_payment", /^STATUS PAYMENT$/],
  [35, "price", /^PRICE$/],
  [36, "grand_price", /^GRAND PRICE$/],
];
// Tanggal teks: kolom marketing/logistik/finance (SO, DO, invoice, email,
// payment) mayoritas MM/DD (US), kolom warehouse (SPB, WO, submit) DD/MM.
const DATE_FIELDS = {
  tgl_spb: "dmy", tgl_wo: "dmy", tgl_submit_po: "dmy",
  tgl_so: "mdy", tgl_do: "mdy", tgl_inv: "mdy", tgl_email: "mdy", tgl_payment: "mdy",
};

const H = (c) => String(c ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const clean = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" || t === "-" ? null : t;
};

const MONTHS = {};
[
  ["JANUARI", "JANUARY", "JAN"], ["FEBRUARI", "FEBRUARY", "FEB", "PEBRUARI"], ["MARET", "MARCH", "MAR"],
  ["APRIL", "APR"], ["MEI", "MAY"], ["JUNI", "JUNE", "JUN"], ["JULI", "JULY", "JUL"],
  ["AGUSTUS", "AUGUST", "AUG", "AGU", "AGT", "AGUST"], ["SEPTEMBER", "SEP", "SEPT"],
  ["OKTOBER", "OCTOBER", "OKT", "OCT"], ["NOVEMBER", "NOV", "NOPEMBER"], ["DESEMBER", "DECEMBER", "DES", "DEC"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

// Tanggal: serial Excel, teks "a/b/YYYY" (urutan sesuai `prefer`; kalau salah
// satu bagian > 12 urutannya pasti; kalau ambigu, tafsiran lain dikembalikan
// di `alt`), atau nama bulan Indonesia/Inggris. Teks lain -> null + `bad`.
const ymd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
function toDate(v, prefer = "dmy") {
  if (v === null || v === undefined || v === "") return { v: null };
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return { v: null, bad: String(v) };
    return { v: XLSX.SSF.format("yyyy-mm-dd", v) };
  }
  const t = String(v).trim();
  if (t === "" || t === "-") return { v: null };
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
    if (y < 2020) return { v: null, bad: t };
    const dmy = ymd(y, b, a);
    const mdy = ymd(y, a, b);
    if (dmy && mdy && a !== b) return prefer === "mdy" ? { v: mdy, alt: dmy, text: true } : { v: dmy, alt: mdy, text: true };
    const r = dmy || mdy;
    return r ? { v: r, text: true } : { v: null, bad: t };
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const r = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    return r ? { v: r } : { v: null, bad: t };
  }
  // "12 Agustus 2026", "12-MARET-2026", "October 9, 2026", "9 JULI 2026".
  m = t.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-,]+(\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) {
    const r = ymd(Number(m[3]), MONTHS[m[2].toUpperCase()], Number(m[1]));
    return r ? { v: r, text: true } : { v: null, bad: t };
  }
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toUpperCase()]) {
    const r = ymd(Number(m[3]), MONTHS[m[1].toUpperCase()], Number(m[2]));
    return r ? { v: r, text: true } : { v: null, bad: t };
  }
  return { v: null, bad: t };
}

function headerRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const r = (rows[i] || []).map(H);
    if (r[1] === "TANGGAL SPB" && r[3] === "PART NUMBER") return i;
  }
  return -1;
}

// Nama site dari nama file: "SPB MONITORING AMM MIFA 2026 (1).xlsx" -> "AMM MIFA".
const siteFromFile = (f) => f.replace(/^SPB MONITORING\s+/i, "").replace(/\s+2026.*$/i, "").trim();

/**
 * Baca semua file di dir. Hasil: { rows, sheets, issues }.
 * rows: 1 objek per baris barang (sudah dinormalisasi), field + file/site/sheet/excel_row.
 */
function readSpbFolder(dir) {
  const rows = [];
  const sheets = [];
  const issues = [];
  const files = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$")).sort();
  for (const file of files) {
    const site = siteFromFile(file);
    const wb = XLSX.readFile(path.join(dir, file), { cellDates: false });
    for (const sn of wb.SheetNames) {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true, blankrows: true });
      const hi = headerRowIndex(raw);
      const info = { file, site, sheet: sn, header_row: hi, rows: 0, swapped: false };
      sheets.push(info);
      if (hi < 0) {
        issues.push({ kind: "sheet tanpa header", file, sheet: sn, detail: `${raw.length} baris` });
        continue;
      }
      const hdr = (raw[hi] || []).map(H);
      // KODE UNIT & STATUS SPB tertukar?
      const map = new Map(COLS.map(([i, f]) => [f, i]));
      if (hdr[7] === "KODE UNIT" && hdr[8] === "STATUS SPB") {
        map.set("status_spb", 8);
        map.set("kode_unit", 7);
        info.swapped = true;
      }
      for (const [i, f, re] of COLS) {
        const idx = map.get(f);
        const label = hdr[idx] ?? "";
        if (!re.test(label) && !(f === "status_spb" && info.swapped) && !(f === "kode_unit" && info.swapped)) {
          // Kolom kosong di belakang (sheet yang header-nya terpotong) diterima.
          if (label === "" && idx > 24) continue;
          issues.push({ kind: "label header beda", file, sheet: sn, detail: `kolom ${idx} "${label}" (harap ${f})` });
        }
      }
      for (let r = hi + 1; r < raw.length; r++) {
        const src = raw[r] || [];
        const o = { file, site, sheet: sn.trim(), excel_row: r + 1 };
        for (const [, f] of COLS) {
          const val = src[map.get(f)];
          if (DATE_FIELDS[f]) {
            const dt = toDate(val, DATE_FIELDS[f]);
            o[f] = dt.v;
            if (dt.alt) (o._alt ||= {})[f] = dt.alt;
            if (dt.bad) (o._bad_dates ||= []).push(`${f}=${dt.bad}`);
          } else {
            o[f] = clean(val);
          }
        }
        if (!o.spb_no && !o.part_number) continue;
        o.qty_num = o.qty === null ? null : Number(String(o.qty).replace(",", "."));
        rows.push(o);
        info.rows++;
      }
    }
  }
  return { rows, sheets, issues };
}

module.exports = { readSpbFolder, toDate, siteFromFile };
