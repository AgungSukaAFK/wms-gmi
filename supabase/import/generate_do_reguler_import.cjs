// Generator SQL import DO Reguler dari export ERP "Histori Pesanan Penjualan"
// ("DO WMS 300726-161026.xls", sheet Tarikan: 1 baris = 1 baris order yang
// dikirim lewat satu DO). Hanya DO untuk SO Reguler yang ADA di WMS diimport
// -- jadi status SO import (List Penawaran) ikut benar & tidak di-DO dobel:
//   supabase/import/do_reguler_dryrun.sql  -- simulasi read-only, jalankan dulu
//   supabase/import/do_reguler_import.sql  -- menulis data
//   supabase/import/do_reguler_verify.sql  -- cek pasca import (read-only)
//
//   node supabase/import/generate_do_reguler_import.cjs "Import 23 Oktober/DO/DO WMS 300726-161026.xls" --so-list=<file> [--gudang=GMI-JAKARTA] [--tanpa-stok] [--pic=email]
//
// --so-list    = file teks berisi so_kode SO Reguler prod (1 per baris), mis.
//                hasil: psql -At -c "SELECT so_kode FROM so_reguler". File DO
//                berisi semua customer (14 ribu baris) -> disaring ke SO ini
//                supaya SQL muat di SQL Editor. Pencocokan SO & barang tetap
//                dilakukan ke data live saat SQL dijalankan.
// --gudang     = gudang pengirim (cabang.nama_cabang); file ERP tidak punya
//                kolom gudang. Default GMI-JAKARTA.
// --tanpa-stok = DO cuma dicatat (stock_released false), stok tidak dipotong.
//                Default: stok gudang pengirim dipotong (boleh minus).
// --pic        = email user pembuat DO import. Kosong = created_by NULL.

const path = require("path");
const fs = require("fs");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--")) || "Import 23 Oktober/DO/DO WMS 300726-161026.xls";
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3) || null;
const soListFile = opt("so-list");
const gudang = opt("gudang") || "GMI-JAKARTA";
const tanpaStok = args.includes("--tanpa-stok");
const picEmail = opt("pic");
if (!soListFile) throw new Error("--so-list=<file> wajib (daftar so_kode SO Reguler prod)");

const outDryrun = path.join(__dirname, "do_reguler_dryrun.sql");
const outImport = path.join(__dirname, "do_reguler_import.sql");
const outVerify = path.join(__dirname, "do_reguler_verify.sql");

const K = (s) => String(s ?? "").trim().toUpperCase();
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const d = (v) => (v ? `DATE ${q(v)}` : "NULL");
const chunk = (arr, n) => {
  const res = [];
  for (let i = 0; i < arr.length; i += n) res.push(arr.slice(i, i + n));
  return res;
};
const clean = (v) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};
// Tanggal ERP = teks "MM/DD/YYYY" (format US, header "Dari 07/30/26").
const toDate = (v) => {
  if (typeof v === "number") return XLSX.SSF.format("yyyy-mm-dd", v);
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [mm, dd, yy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};

const soList = new Set(fs.readFileSync(soListFile, "utf8").split(/\r?\n/).map(K).filter(Boolean));

// ---------------------------------------------------------------------
// Baca sheet (sheet pertama yang punya header "No. DO" -- "Tarikan" = data
// terlengkap; sheet kedua subset sampai 16/10)
// ---------------------------------------------------------------------
const wb = XLSX.readFile(src);
let sheetName = null;
let rows = null;
let hi = -1;
for (const n of wb.SheetNames) {
  const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true });
  const h = r.findIndex((x) => x && x.some((c) => clean(c) === "No. DO"));
  if (h >= 0) {
    sheetName = n;
    rows = r;
    hi = h;
    break;
  }
}
if (!sheetName) throw new Error(`Header "No. DO" tidak ditemukan`);
const header = rows[hi].map((c) => clean(c));
const col = (label) => {
  const i = header.indexOf(label);
  if (i < 0) throw new Error(`Kolom "${label}" tidak ditemukan`);
  return i;
};
const C = {
  no: col("No"),
  do_no: col("No. DO"),
  tgl_do: col("Tgl DO"),
  qty: col("Kts. DO"),
  po_no: col("No. PO"),
  so_no: col("No. SO"),
  tgl_pesan: col("Tgl Pesan"),
  customer: col("Nama Pelanggan"),
  status: col("Status"),
  part: col("No. Barang"),
  part_name: col("Keterangan Detil"),
};

const report = []; // [kategori, ref, detail]
const stat = { barisFile: 0, barisSo: 0 };
const lines = [];
rows.slice(hi + 1).forEach((r, i) => {
  if (!r || clean(r[C.do_no]) === null) return;
  stat.barisFile++;
  const so = K(r[C.so_no]);
  if (!soList.has(so)) return;
  stat.barisSo++;
  const qty = typeof r[C.qty] === "number" ? r[C.qty] : Number(String(r[C.qty] ?? "").replace(/,/g, ""));
  const line = {
    excel_row: hi + 2 + i,
    erp_no: clean(r[C.no]),
    do_no: clean(r[C.do_no]),
    tgl_do: toDate(r[C.tgl_do]),
    qty,
    po_no: clean(r[C.po_no]),
    so_no: clean(r[C.so_no]),
    so_key: so,
    tgl_pesan: toDate(r[C.tgl_pesan]),
    customer: clean(r[C.customer]),
    status: clean(r[C.status]),
    part_number: clean(r[C.part]),
    part_name: clean(r[C.part_name]),
  };
  if (!line.tgl_do) {
    report.push(["SKIP baris: Tgl DO tidak terbaca", line.do_no, `baris ${line.excel_row} "${r[C.tgl_do]}"`]);
    return;
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    report.push(["SKIP baris: Kts. DO tidak valid", line.do_no, `${line.part_number} baris ${line.excel_row} "${r[C.qty]}"`]);
    return;
  }
  if (!line.part_number) {
    report.push(["SKIP baris: No. Barang kosong", line.do_no, `baris ${line.excel_row}`]);
    return;
  }
  lines.push(line);
});

// Baris dengan DO + SO + barang sama = baris order terpisah di ERP (mis. SO
// yang barangnya dobel, di WMS sudah digabung) -> qty dijumlah.
const agg = new Map();
for (const l of lines) {
  const k = `${K(l.do_no)}|${l.so_key}|${K(l.part_number)}`;
  const a = agg.get(k) || { ...l, qty: 0, rows: [], erp_nos: [], statuses: new Set() };
  a.qty += l.qty;
  a.rows.push(l.excel_row);
  if (l.erp_no) a.erp_nos.push(l.erp_no);
  if (l.status) a.statuses.add(l.status);
  agg.set(k, a);
}
const doLines = [...agg.values()].sort((a, b) => a.tgl_do.localeCompare(b.tgl_do) || K(a.do_no).localeCompare(K(b.do_no)) || a.excel_row - b.excel_row);
for (const a of doLines) if (a.rows.length > 1) report.push(["Baris DO dobel (DO + SO + barang sama) dijumlah", a.do_no, `SO ${a.so_no} ${a.part_number}: ${a.rows.length} baris = qty ${a.qty}`]);

// ---------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const dataDdl = `DROP TABLE IF EXISTS pg_temp.x_cfg;
DROP TABLE IF EXISTS pg_temp.x_do_line;

CREATE TEMP TABLE x_cfg (key TEXT PRIMARY KEY, value TEXT);

-- 1 baris = DO ERP + SO + barang (baris order dobel sudah dijumlah).
CREATE TEMP TABLE x_do_line (
  line_id INT PRIMARY KEY,
  do_no TEXT NOT NULL,
  do_tanggal DATE NOT NULL,
  so_key TEXT NOT NULL,
  so_no TEXT NOT NULL,
  part_number TEXT NOT NULL,
  part_name TEXT,
  qty INT NOT NULL CHECK (qty > 0),
  po_no TEXT,
  tgl_pesan DATE,
  customer_erp TEXT,
  status_erp TEXT,
  excel_rows TEXT NOT NULL
);

`;
let dataIns = `INSERT INTO x_cfg (key, value) VALUES
  ('gudang', ${q(gudang)}),
  ('potong_stok', ${q(tanpaStok ? "false" : "true")}),
  ('pic_email', ${q(picEmail)}),
  ('sumber', ${q(path.basename(src))});

`;
doLines.forEach((a, i) => (a.line_id = i + 1));
for (const part of chunk(doLines, 300)) {
  dataIns += "INSERT INTO x_do_line (line_id, do_no, do_tanggal, so_key, so_no, part_number, part_name, qty, po_no, tgl_pesan, customer_erp, status_erp, excel_rows) VALUES\n";
  dataIns += part
    .map((a) =>
      `  (${a.line_id}, ${q(a.do_no)}, ${d(a.tgl_do)}, ${q(a.so_key)}, ${q(a.so_no)}, ${q(a.part_number)}, ${q(a.part_name)}, ${a.qty}, ${q(a.po_no)}, ${d(a.tgl_pesan)}, ${q(a.customer)}, ${q([...a.statuses].join("/") || null)}, ${q(a.rows.join(", "))})`)
    .join(",\n");
  dataIns += ";\n\n";
}
const data = dataDdl + dataIns;

const xReport = `DROP TABLE IF EXISTS pg_temp.x_report;
CREATE TEMP TABLE x_report (kategori TEXT NOT NULL, ref TEXT, detail TEXT);

`;
let reportSql = "";
for (const part of chunk(report, 300)) {
  reportSql += "INSERT INTO x_report (kategori, ref, detail) VALUES\n";
  reportSql += part.map(([k, r, dt]) => `  (${q(k)}, ${q(r)}, ${q(dt)})`).join(",\n");
  reportSql += ";\n\n";
}

const rules = `-- Aturan (keputusan 2026-10-24):
--   - Hanya baris DO ERP yang SO-nya ada di SO Reguler WMS DAN barangnya ada
--     di SO itu. Barang DO yang tidak ada di SO WMS (di List Penawaran sudah
--     terkirim, jadi tidak diimport sebagai barang SO) dilaporkan saja.
--   - 1 DO ERP per SO = 1 DO Reguler (kode = No. DO ERP; "<No DO>/<No SO>"
--     kalau 1 DO ERP mencakup >1 SO WMS). DO yang kodenya sudah ada di-skip
--     (aman dijalankan ulang).
--   - Qty DO dibatasi sisa SO (qty SO - DO WMS lain); kelebihan dilaporkan.
--   - Gudang pengirim ${gudang} (file ERP tidak punya kolom gudang).
--   - ${tanpaStok ? "Stok TIDAK dipotong (stock_released false)." : "Stok gudang pengirim DIPOTONG (boleh minus), stock_movements DO_REG, stock_released true."}
--   - DO = riwayat pengiriman ERP: status completed, tracking delivered,
--     jenis pengiriman "ekspedisi" (lama), remarks diawali "Import DO ERP".
--   - Status SO dihitung ulang (sama dengan refreshSoStatus).
`;

const readTpl = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const plan = readTpl("do_reguler_plan_body.sqltpl");
const summary = `${doLines.length} baris DO (dari ${stat.barisSo} baris file untuk ${soList.size} SO WMS; file ${stat.barisFile} baris)`;

fs.writeFileSync(
  outDryrun,
  `-- =====================================================================
-- DRY-RUN IMPORT DO REGULER (READ-ONLY) -- simulasi do_reguler_import.sql
-- Generated: ${today}  |  sumber: ${path.basename(src)} (sheet ${sheetName.trim()})  |  ${summary}
-- Generator: supabase/import/generate_do_reguler_import.cjs
${rules}-- =====================================================================

` + xReport + data + reportSql + plan + readTpl("do_reguler_dryrun_body.sqltpl"),
);

fs.writeFileSync(
  outImport,
  `-- =====================================================================
-- IMPORT DO REGULER ("${path.basename(src)}", sheet ${sheetName.trim()})
-- Generated: ${today}  |  ${summary}
-- Generator: supabase/import/generate_do_reguler_import.cjs
--
-- Jalankan SEKALI di Supabase VPS (SQL Editor, seluruh isi file). Cek dulu
-- lewat do_reguler_dryrun.sql. Aman dijalankan ulang: DO yang kodenya sudah
-- ada di-skip (stok tidak dipotong dua kali).
${rules}-- =====================================================================

BEGIN;

` + xReport + data + reportSql + plan + readTpl("do_reguler_import_body.sqltpl"),
);

fs.writeFileSync(
  outVerify,
  `-- =====================================================================
-- VERIFIKASI IMPORT DO REGULER (pasca import, READ-ONLY)
-- Generated: ${today}  |  sumber: ${path.basename(src)}  |  ${summary}
-- Generator: supabase/import/generate_do_reguler_import.cjs
--
-- Jalankan SETELAH do_reguler_import.sql (file & opsi generator sama). Hanya
-- temp table. FAIL = import tidak sesuai; WARN = perlu dicek; INFO = catatan.
-- =====================================================================

` + data + readTpl("do_reguler_verify_body.sqltpl"),
);

console.log(JSON.stringify({ outDryrun, outImport, outVerify, sheet: sheetName, gudang, potongStok: !tanpaStok, picEmail, soList: soList.size, ...stat, doLines: doLines.length, reportRows: report.length }, null, 2));
