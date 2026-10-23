// Generator PRE-CHECK import MR & PR dari "PR WMS <tgl>.xlsx" (sheet
// "MR Monitoring" + "PR OPEN WMS") -> supabase/import/mr_pr_precheck.sql.
//
//   node supabase/import/generate_mr_pr_precheck.cjs "Import 23 Oktober/PR/PR WMS 21102026.xlsx"
//
// Read-only: dijalankan di VPS SEBELUM import untuk melihat MR/PR mana yang
// sudah ada di production, pemetaan SITE -> cabang, barang yang belum ada,
// dan calon PIC. Hasilnya dipakai untuk memutuskan aturan import.

const path = require("path");
const fs = require("fs");
const { readPrWms, mrGroup } = require("./mr_pr_excel.cjs");

const src = process.argv[2] || "Import 23 Oktober/PR/PR WMS 21102026.xlsx";
const out = path.join(__dirname, "mr_pr_precheck.sql");

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const chunk = (arr, n) => {
  const res = [];
  for (let i = 0; i < arr.length; i += n) res.push(arr.slice(i, i + n));
  return res;
};

const { mr, pr } = readPrWms(src);

// Header MR = baris pertama per kode; tandai kalau tanggal/site antar baris beda.
const mrHead = new Map();
for (const r of mr) {
  const h = mrHead.get(r.mr_kode);
  if (!h) {
    mrHead.set(r.mr_kode, { ...r, n: 1, beda: false, groups: new Set([mrGroup(r.indicator)]) });
  } else {
    h.n++;
    h.groups.add(mrGroup(r.indicator));
    if (h.mr_date !== r.mr_date || h.site !== r.site) h.beda = true;
  }
}
// Kelompok MR: open kalau masih ada barang open, selain itu completed/closed.
const mrGroupOf = (h) =>
  h.groups.has("open") ? "open" : h.groups.has("completed") ? "completed" : "closed";

let sql = `-- =====================================================================
-- PRE-CHECK IMPORT MR & PR (READ-ONLY)
-- Generated: ${new Date().toISOString().slice(0, 10)}  |  sumber: ${path.basename(src)}
--   MR: ${mrHead.size} dokumen, ${mr.length} baris barang (sheet "MR Monitoring")
--   PR: ${new Set(pr.map((r) => r.pr_kode)).size} dokumen, ${pr.length} baris barang (sheet "PR OPEN WMS")
-- Generator: supabase/import/generate_mr_pr_precheck.cjs
--
-- Jalankan SELURUH isi file ini di Supabase VPS (psql / SQL Editor). Hanya
-- membuat temp table, tidak mengubah data apa pun. Hasil = 1 tabel.
-- =====================================================================

DROP TABLE IF EXISTS pg_temp.x_mr;
DROP TABLE IF EXISTS pg_temp.x_mr_item;
DROP TABLE IF EXISTS pg_temp.x_pr_item;

CREATE TEMP TABLE x_mr (
  mr_kode TEXT PRIMARY KEY,
  site TEXT,
  area TEXT,
  mr_date DATE,
  grp TEXT NOT NULL,
  n_items INT NOT NULL,
  header_beda BOOLEAN NOT NULL
);

CREATE TEMP TABLE x_mr_item (
  excel_row INT PRIMARY KEY,
  mr_kode TEXT NOT NULL,
  part_number TEXT NOT NULL,
  grp TEXT NOT NULL,
  no_pr TEXT,
  no_po TEXT
);

CREATE TEMP TABLE x_pr_item (
  excel_row INT PRIMARY KEY,
  pr_kode TEXT NOT NULL,
  pembuat TEXT,
  pr_tanggal DATE,
  ref_mr TEXT,
  proyek TEXT,
  part_number TEXT NOT NULL,
  qty NUMERIC
);

`;

for (const part of chunk([...mrHead.values()], 300)) {
  sql += "INSERT INTO x_mr (mr_kode, site, area, mr_date, grp, n_items, header_beda) VALUES\n";
  sql += part
    .map((h) => `  (${q(h.mr_kode)}, ${q(h.site)}, ${q(h.area)}, ${h.mr_date ? `DATE ${q(h.mr_date)}` : "NULL"}, ${q(mrGroupOf(h))}, ${h.n}, ${h.beda})`)
    .join(",\n");
  sql += ";\n\n";
}
for (const part of chunk(mr, 500)) {
  sql += "INSERT INTO x_mr_item (excel_row, mr_kode, part_number, grp, no_pr, no_po) VALUES\n";
  sql += part
    .map((r) => `  (${r.excel_row}, ${q(r.mr_kode)}, ${q(r.part_number)}, ${q(mrGroup(r.indicator))}, ${q(r.no_pr)}, ${q(r.no_po)})`)
    .join(",\n");
  sql += ";\n\n";
}
for (const part of chunk(pr, 500)) {
  sql += "INSERT INTO x_pr_item (excel_row, pr_kode, pembuat, pr_tanggal, ref_mr, proyek, part_number, qty) VALUES\n";
  sql += part
    .map((r) => `  (${r.excel_row}, ${q(r.pr_kode)}, ${q(r.pembuat)}, ${r.pr_tanggal ? `DATE ${q(r.pr_tanggal)}` : "NULL"}, ${q(r.ref_mr)}, ${q(r.proyek)}, ${q(r.part_number)}, ${r.qty ?? "NULL"})`)
    .join(",\n");
  sql += ";\n\n";
}

sql += fs.readFileSync(path.join(__dirname, "mr_pr_precheck_body.sqltpl"), "utf8");
fs.writeFileSync(out, sql);
console.log(JSON.stringify({ out, mr: mrHead.size, mrItems: mr.length, prItems: pr.length }, null, 2));
