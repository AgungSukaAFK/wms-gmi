// Parser "PR WMS <tgl>.xlsx" (Import 23 Oktober/PR): sheet "MR Monitoring"
// (spreadsheet PPIC, 1 baris = 1 barang MR + jejak PR/PO/kirimnya) dan sheet
// "PR OPEN WMS" (PR yang masih jalan, 1 baris = 1 barang PR).
// Dipakai bersama oleh generator pre-check & import MR/PR.

const path = require("path");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7,
  aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

const clean = (v) => {
  const t = String(v ?? "").replace(/\r\n?/g, "\n").trim();
  return t === "" ? null : t;
};

// Tanggal Excel: serial number atau teks "02-Jan-2026" / "02 Jan 2026".
function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const m = String(v).trim().match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2,4})$/);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" tidak ada`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
}

function findHeader(rows, label) {
  const i = rows.findIndex((r) => r.some((c) => String(c ?? "").trim() === label));
  if (i < 0) throw new Error(`Header "${label}" tidak ditemukan`);
  return i;
}

// Kolom sheet "MR Monitoring" (header di baris yang memuat "MR NUMBER").
const MR_COL = {
  priority: 1, site: 2, area: 3, indicator: 4, status_ppic: 5, mr_date: 6,
  mr_kode: 9, part_number: 10, description: 11, qty_mr: 12, qty_received: 13,
  qty_os: 14, uom: 15, received_date: 16, status: 17,
  pr_date: 44, no_pr: 45, qty_pr: 46, po_date: 49, no_po: 50, qty_po: 51,
  status_mr: 60, supply_areas: 65, note_ppic: 66,
};

function parseMrMonitoring(wb) {
  const rows = sheetRows(wb, "MR Monitoring");
  const hi = findHeader(rows, "MR NUMBER");
  const out = [];
  rows.slice(hi + 1).forEach((r, i) => {
    const mrKode = clean(r[MR_COL.mr_kode]);
    if (!mrKode) return;
    const g = (k) => r[MR_COL[k]];
    out.push({
      excel_row: hi + 2 + i,
      mr_kode: mrKode,
      priority: clean(g("priority")),
      site: clean(g("site")),
      area: clean(g("area")),
      indicator: clean(g("indicator")),
      status_ppic: clean(g("status_ppic")),
      mr_date: toDate(g("mr_date")),
      part_number: clean(g("part_number")),
      description: clean(g("description")),
      qty_mr: toNum(g("qty_mr")),
      qty_received: toNum(g("qty_received")),
      qty_os: toNum(g("qty_os")),
      uom: clean(g("uom")),
      status: clean(g("status")),
      pr_date: toDate(g("pr_date")),
      no_pr: clean(g("no_pr")),
      qty_pr: toNum(g("qty_pr")),
      no_po: clean(g("no_po")),
      qty_po: toNum(g("qty_po")),
      status_mr: clean(g("status_mr")),
      supply_areas: clean(g("supply_areas")),
      note_ppic: clean(g("note_ppic")),
    });
  });
  return out;
}

// Sheet "PR OPEN WMS" (header di baris yang memuat "No Permintaan").
function parsePrOpen(wb) {
  const rows = sheetRows(wb, "PR OPEN WMS");
  const hi = findHeader(rows, "No Permintaan");
  const out = [];
  rows.slice(hi + 1).forEach((r, i) => {
    const prKode = clean(r[0]);
    if (!prKode) return;
    out.push({
      excel_row: hi + 2 + i,
      pr_kode: prKode,
      pembuat: clean(r[1]),
      pr_tanggal: toDate(r[2]),
      ref_mr: clean(r[3]),
      proyek: clean(r[4]),
      part_number: clean(r[5]),
      description: clean(r[6]),
      qty: toNum(r[7]),
    });
  });
  return out;
}

// Satuan barang PR diambil dari sheet histori PR (header memuat "No Permintaan"
// dan "satuan", mis. "PR 01072026 16102026"); kunci "PR|PART" huruf besar.
function parsePrSatuan(wb) {
  const map = new Map();
  for (const name of wb.SheetNames) {
    if (name === "PR OPEN WMS") continue;
    const rows = sheetRows(wb, name);
    const hi = rows.findIndex(
      (r) => r.some((c) => String(c ?? "").trim() === "No Permintaan") &&
        r.some((c) => String(c ?? "").trim().toLowerCase() === "satuan"),
    );
    if (hi < 0) continue;
    const h = rows[hi].map((c) => String(c ?? "").trim());
    const iPr = h.indexOf("No Permintaan");
    const iPart = h.indexOf("No. Barang");
    const iSat = h.findIndex((c) => c.toLowerCase() === "satuan");
    if (iPart < 0) continue;
    for (const r of rows.slice(hi + 1)) {
      const pr = clean(r[iPr]);
      const part = clean(r[iPart]);
      const sat = clean(r[iSat]);
      if (pr && part && sat) map.set(`${pr.toUpperCase()}|${part.toUpperCase()}`, sat);
    }
  }
  return map;
}

function readPrWms(file) {
  const wb = XLSX.readFile(file);
  return { mr: parseMrMonitoring(wb), pr: parsePrOpen(wb), prSatuan: parsePrSatuan(wb) };
}

// Kolom NO PR di MR Monitoring -> daftar kode PR baku "PR-GMI-<n>", urut sesuai
// tulisan. Format yang muncul: "PR-GMI-3451", "PR GMI-3663", "pr-gmi-3822",
// "3550", "PR-GMI-3601, PR-GMI-3890", "PR-GMI-3573 > PR-GMI-3819" (revisi),
// "PR-GMI-3680 & PR-GMI-3944 (WHS)", "PR-GMI-3601 / 3602". Teks tanpa nomor
// ("WO", "Revisi PR", "IKUT MR HO ...") -> [].
function normalizePrCodes(v) {
  const s = clean(v);
  if (!s) return [];
  if (/^\d{3,5}$/.test(s)) return [`PR-GMI-${s}`];
  if (!/PR/i.test(s)) return [];
  const nums = s.match(/\b\d{3,5}\b/g) || [];
  return [...new Set(nums.map((n) => `PR-GMI-${n}`))];
}

// Status baris MR versi spreadsheet PPIC -> kelompok kasar.
function mrGroup(indicator) {
  const s = String(indicator || "").toUpperCase();
  if (s === "COMPLETED") return "completed";
  if (s === "CLOSED") return "closed";
  return "open";
}

module.exports = { readPrWms, mrGroup, normalizePrCodes, clean, toDate, toNum };
