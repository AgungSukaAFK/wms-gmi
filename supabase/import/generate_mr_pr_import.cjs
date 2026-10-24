// Generator SQL import MR & PR dari "PR WMS <tgl>.xlsx" (sheet "MR Monitoring"
// spreadsheet PPIC + sheet "PR OPEN WMS") -> supabase/import/mr_pr_import.sql,
// simulasi read-only sebelum import -> supabase/import/mr_pr_dryrun.sql, dan
// query verifikasi pasca import -> supabase/import/mr_pr_verify.sql.
//
//   node supabase/import/generate_mr_pr_import.cjs "Import 23 Oktober/PR/PR WMS 21102026.xlsx" [--pic=email]
//
// --pic = email user (profiles) yang jadi PIC MR & PR import. Kosong = user
// yang namanya sama dengan "Pembuat PR" di sheet PR OPEN WMS (harus tepat 1).
//
// Keputusan user (2026-10-23): lihat header SQL yang dihasilkan.

const path = require("path");
const fs = require("fs");
const { readPrWms, mrGroup, normalizePrCodes } = require("./mr_pr_excel.cjs");

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--")) || "Import 23 Oktober/PR/PR WMS 21102026.xlsx";
const picEmail = (args.find((a) => a.startsWith("--pic=")) || "").slice("--pic=".length) || null;
const out = path.join(__dirname, "mr_pr_import.sql");
const outVerify = path.join(__dirname, "mr_pr_verify.sql");
const outDryrun = path.join(__dirname, "mr_pr_dryrun.sql");

// SITE MR -> nama cabang. Selain yang terdaftar: "GMI-<SITE>".
const SITE_CABANG = {
  KM10: "GMI-JAKARTA",
  HO: "GMI-JAKARTA",
  MARKETING: "GMI-JAKARTA",
  MANADO: "GMI-JAKARTA",
  BPN: "GMI-BPP",
};
// Lokasi PR & MR penampung (PR dibuat purchasing HO).
const PR_CABANG = "GMI-JAKARTA";
// Kolom "Supply Areas" -> gudang sumber share stock.
const SUPPLY_CABANG = {
  "GMI-HO": "GMI-JAKARTA",
  "GMI--HO": "GMI-JAKARTA",
  "GMI-BPN": "GMI-BPP",
  "GMI-BPP": "GMI-BPP",
  "GMI-ENIM": "GMI-ENIM",
};
// WMS hanya kenal P1 (Emergency) .. P4 (Low).
const PRIORITY = { P0: "P1", P1: "P1", P2: "P2", P3: "P3", P4: "P4", STOCK: "P4" };

const K = (s) => String(s ?? "").trim().toUpperCase();
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const d = (v) => (v ? `DATE ${q(v)}` : "NULL");
const minDate = (arr) => arr.filter(Boolean).sort()[0] || null;
const chunk = (arr, n) => {
  const res = [];
  for (let i = 0; i < arr.length; i += n) res.push(arr.slice(i, i + n));
  return res;
};

const { mr, pr, prSatuan } = readPrWms(src);
const report = []; // catatan dari sisi Excel: [kategori, ref, detail]

// ---------------------------------------------------------------------
// MR: dokumen yang masih punya barang open + yang dirujuk PR OPEN.
// ---------------------------------------------------------------------
const refKeys = new Set(pr.filter((r) => r.ref_mr).map((r) => K(r.ref_mr)));
const openKeys = new Set(mr.filter((r) => mrGroup(r.indicator) === "open").map((r) => K(r.mr_kode)));

const docs = new Map();
for (const r of mr) {
  const key = K(r.mr_kode);
  if (!openKeys.has(key) && !refKeys.has(key)) continue;
  if (!docs.has(key)) docs.set(key, { key, mr_kode: r.mr_kode.trim(), site: r.site, area: r.area, rows: [] });
  docs.get(key).rows.push(r);
}

for (const doc of docs.values()) {
  doc.rows.sort((a, b) => a.excel_row - b.excel_row);
  doc.mr_tanggal = minDate(doc.rows.map((r) => r.mr_date));
  doc.cabang = SITE_CABANG[K(doc.site)] || (doc.site ? `GMI-${K(doc.site)}` : PR_CABANG);
  doc.items = [];
  for (const r of doc.rows) {
    const qty = r.qty_mr;
    if (qty === null || !Number.isInteger(qty) || qty <= 0) {
      report.push(["SKIP baris MR: qty MR kosong/tidak valid", doc.mr_kode, `${r.part_number} baris ${r.excel_row} qty ${r.qty_mr}`]);
      continue;
    }
    // Salah ketik di sheet: kolom NO. BARANG berisi kode MR / 1-2 huruf.
    if (K(r.part_number) === doc.key || r.part_number.length < 3) {
      report.push(["SKIP baris MR: part number tidak valid", doc.mr_kode, `"${r.part_number}" baris ${r.excel_row} qty ${qty}`]);
      continue;
    }
    const g = mrGroup(r.indicator);
    const prCodes = normalizePrCodes(r.no_pr);
    if (r.no_pr && prCodes.length === 0) {
      report.push(["NO PR bukan nomor PR (diabaikan)", doc.mr_kode, `${r.part_number}: "${r.no_pr}"`]);
    }
    doc.items.push({
      line_no: doc.items.length + 1,
      row: r,
      part_number: r.part_number,
      qty,
      rec: g === "completed" ? qty : Math.max(0, Math.min(qty, Math.round(r.qty_received || 0))),
      rejected: g === "closed",
      prCodes,
      usedBy: new Set(),
      prLinked: 0,
    });
  }
  if (doc.items.length === 0) {
    report.push(["SKIP MR: tidak ada barang valid", doc.mr_kode, null]);
    docs.delete(doc.key);
  }
}

// ---------------------------------------------------------------------
// PR: (a) baris sheet PR OPEN WMS, (b) baris PR dari kolom NO PR MR Monitoring
// yang tidak muncul di PR OPEN (PR lama / baris PR yang sudah selesai).
// ---------------------------------------------------------------------
const prItems = [];
for (const r of pr) {
  if (!Number.isInteger(r.qty) || r.qty <= 0) {
    report.push(["SKIP baris PR: qty tidak valid", r.pr_kode, `${r.part_number} baris ${r.excel_row} qty ${r.qty}`]);
    continue;
  }
  const code = K(r.pr_kode);
  let mrKey = null;
  let mrLine = null;
  const doc = r.ref_mr ? docs.get(K(r.ref_mr)) : null;
  if (doc) {
    const cands = doc.items.filter((i) => K(i.part_number) === K(r.part_number));
    const pick =
      cands.find((i) => i.prCodes.includes(code) && !i.usedBy.has(code)) ||
      cands.find((i) => !i.usedBy.has(code)) ||
      cands[0];
    if (pick) {
      mrKey = doc.key;
      mrLine = pick.line_no;
      pick.usedBy.add(code);
      pick.prLinked += r.qty;
    }
  }
  prItems.push({
    pr_kode: r.pr_kode.trim(),
    src: "open",
    excel_row: r.excel_row,
    mr_kode: r.ref_mr,
    mr_key: mrKey,
    mr_line: mrLine,
    part_number: r.part_number,
    part_name: r.description,
    satuan: prSatuan.get(`${code}|${K(r.part_number)}`) || null,
    qty: r.qty,
    pr_tanggal: r.pr_tanggal,
    pembuat: r.pembuat,
    keterangan: [r.proyek ? `Nama Proyek: ${r.proyek}` : null, r.ref_mr ? `Ref MR: ${r.ref_mr}` : "Tanpa Referensi MR"]
      .filter(Boolean)
      .join(" | "),
  });
}

for (const doc of docs.values()) {
  for (const it of doc.items) {
    if (it.prCodes.length === 0) continue;
    // Sudah tertaut lewat baris PR OPEN dengan salah satu PR-nya -> cukup.
    if (it.prCodes.some((c) => it.usedBy.has(c))) continue;
    // "A > B" (revisi) / "A, B": pakai PR terakhir, qty PR dari kolom QTY PR.
    const code = it.prCodes[it.prCodes.length - 1];
    if (it.prCodes.length > 1) {
      report.push(["NO PR berisi >1 PR, dipakai yang terakhir", doc.mr_kode, `${it.part_number}: "${it.row.no_pr}" -> ${code}`]);
    }
    const qtyPr = Number.isInteger(it.row.qty_pr) && it.row.qty_pr > 0 ? it.row.qty_pr : it.qty;
    it.usedBy.add(code);
    it.prLinked += qtyPr;
    prItems.push({
      pr_kode: code,
      src: "mr",
      excel_row: it.row.excel_row,
      mr_kode: doc.mr_kode,
      mr_key: doc.key,
      mr_line: it.line_no,
      part_number: it.part_number,
      part_name: it.row.description,
      satuan: it.row.uom,
      qty: qtyPr,
      pr_tanggal: it.row.pr_date || doc.mr_tanggal,
      pembuat: null,
      keterangan: `Dari MR Monitoring baris ${it.row.excel_row}`,
    });
  }
}

const prDocs = new Map();
for (const it of prItems) {
  const key = K(it.pr_kode);
  if (!prDocs.has(key)) prDocs.set(key, { pr_kode: it.pr_kode, items: [] });
  prDocs.get(key).items.push(it);
}
for (const p of prDocs.values()) {
  const open = p.items.filter((i) => i.src === "open");
  p.pr_status = open.length > 0 ? "approved" : "closed";
  p.pr_tanggal = minDate((open.length > 0 ? open : p.items).map((i) => i.pr_tanggal));
  p.pembuat = open.find((i) => i.pembuat)?.pembuat || null;
  p.items.sort((a, b) => (a.src === b.src ? a.excel_row - b.excel_row : a.src === "open" ? -1 : 1));
  p.items.forEach((it, i) => (it.line_no = i + 1));
}

// ---------------------------------------------------------------------
// Jatah PR / share stock per barang MR + status MR.
// ---------------------------------------------------------------------
for (const doc of docs.values()) {
  for (const it of doc.items) {
    const r = it.row;
    const remaining = it.qty - it.rec;
    it.priority = PRIORITY[K(r.priority)] || "P3";
    it.qty_pr = 0;
    it.qty_share = 0;
    it.alloc = null;
    if (it.rejected) {
      it.reject_reason = `CLOSED by PPIC (import MR Monitoring)${r.note_ppic ? `: ${r.note_ppic}` : ""}`;
    } else if (remaining <= 0) {
      it.qty_pr = Math.min(it.prLinked, it.qty);
    } else if (it.prLinked > 0) {
      it.qty_pr = it.qty;
    } else {
      const supply = SUPPLY_CABANG[K(r.supply_areas)] || null;
      if (K(r.indicator) === "MR CREATED" && !supply) {
        it.qty_pr = it.qty;
      } else {
        // Disuplai dari stok gudang lain / sudah dikirim di luar WMS: bukan
        // jatah PR supaya tidak dibeli dobel.
        it.qty_share = remaining;
        it.alloc = supply && supply !== doc.cabang ? supply : null;
        if (!it.alloc) {
          report.push([
            "Share stock tanpa gudang sumber (atur di Moderator Edit)",
            doc.mr_kode,
            `${it.part_number}: sisa ${remaining}, supply "${r.supply_areas || "-"}", status ${r.indicator}`,
          ]);
        }
      }
    }
    it.remarks = [
      `Import MR Monitoring baris ${r.excel_row}`,
      `Status: ${r.indicator || "-"}${r.status_ppic ? ` / ${r.status_ppic}` : ""}`,
      r.supply_areas && r.supply_areas !== "-" ? `Supply: ${r.supply_areas}` : null,
      r.no_pr ? `NO PR: ${r.no_pr}` : null,
      r.qty_received !== null && r.qty_received !== it.rec ? `Qty received sheet: ${r.qty_received}` : null,
      r.note_ppic ? `Note PPIC: ${r.note_ppic}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
  }
  const active = doc.items.filter((i) => !i.rejected);
  doc.mr_status =
    active.length === 0 ? "rejected" : active.every((i) => i.rec >= i.qty) ? "completed" : "approved";
  doc.rejection_reason = doc.mr_status === "rejected" ? "CLOSED by PPIC (import MR Monitoring)" : null;
  doc.remarks = `Import MR Monitoring (${path.basename(src)}); SITE ${doc.site || "-"}, AREA ${doc.area || "-"}`;
}

// ---------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------
const docList = [...docs.values()];
const mrItemRows = docList.flatMap((doc) => doc.items.map((it) => ({ doc, it })));
const prList = [...prDocs.values()];
const prItemRows = prList.flatMap((p) => p.items);
const cabangNames = [...new Set([PR_CABANG, ...docList.map((x) => x.cabang), ...mrItemRows.map((x) => x.it.alloc).filter(Boolean)])];
const stat = {
  mr: docList.length,
  mrItems: mrItemRows.length,
  mrStatus: docList.reduce((m, x) => ((m[x.mr_status] = (m[x.mr_status] || 0) + 1), m), {}),
  pr: prList.length,
  prStatus: prList.reduce((m, x) => ((m[x.pr_status] = (m[x.pr_status] || 0) + 1), m), {}),
  prItems: prItemRows.length,
  prItemsSrc: prItemRows.reduce((m, x) => ((m[x.src] = (m[x.src] || 0) + 1), m), {}),
  prItemsTanpaMr: prItemRows.filter((x) => !x.mr_key).length,
  shareItems: mrItemRows.filter((x) => x.it.qty_share > 0).length,
  shareAlloc: mrItemRows.filter((x) => x.it.alloc).length,
};

const today = new Date().toISOString().slice(0, 10);

// Data Excel sebagai temp table -- dipakai bersama oleh import & verifikasi.
const dataDdl = `DROP TABLE IF EXISTS pg_temp.x_cfg;
DROP TABLE IF EXISTS pg_temp.x_mr;
DROP TABLE IF EXISTS pg_temp.x_mr_item;
DROP TABLE IF EXISTS pg_temp.x_pr;
DROP TABLE IF EXISTS pg_temp.x_pr_item;

CREATE TEMP TABLE x_cfg (key TEXT PRIMARY KEY, value TEXT);

CREATE TEMP TABLE x_mr (
  mr_key TEXT PRIMARY KEY,
  mr_kode TEXT NOT NULL,
  cabang TEXT NOT NULL,
  mr_tanggal DATE,
  mr_status TEXT NOT NULL,
  rejection_reason TEXT,
  remarks TEXT
);

CREATE TEMP TABLE x_mr_item (
  mr_key TEXT NOT NULL,
  line_no INT NOT NULL,
  excel_row INT NOT NULL,
  part_number TEXT NOT NULL,
  part_name TEXT,
  satuan TEXT,
  qty_request INT NOT NULL,
  qty_received_import INT NOT NULL,
  qty_pr INT NOT NULL,
  qty_share INT NOT NULL,
  alloc_cabang TEXT,
  item_status TEXT NOT NULL,
  reject_reason TEXT,
  priority TEXT NOT NULL,
  remarks TEXT,
  PRIMARY KEY (mr_key, line_no)
);

CREATE TEMP TABLE x_pr (
  pr_kode TEXT PRIMARY KEY,
  pr_tanggal DATE NOT NULL,
  pr_status TEXT NOT NULL,
  pembuat TEXT
);

CREATE TEMP TABLE x_pr_item (
  pr_kode TEXT NOT NULL,
  line_no INT NOT NULL,
  src TEXT NOT NULL,           -- open = sheet PR OPEN WMS, mr = kolom NO PR MR Monitoring
  excel_row INT NOT NULL,
  mr_kode TEXT,                -- referensi MR (teks Excel)
  mr_key TEXT,                 -- MR Excel yang ikut diimport (NULL = cari di prod / penampung)
  mr_line INT,
  part_number TEXT NOT NULL,
  part_name TEXT,
  satuan TEXT,
  qty INT NOT NULL,
  keterangan TEXT,
  PRIMARY KEY (pr_kode, line_no)
);

`;

let dataIns = `INSERT INTO x_cfg (key, value) VALUES
  ('pic_email', ${q(picEmail)}),
  ('pr_cabang', ${q(PR_CABANG)}),
  ('cabang_names', ${q(cabangNames.join("|"))});

`;
for (const part of chunk(docList, 300)) {
  dataIns += "INSERT INTO x_mr (mr_key, mr_kode, cabang, mr_tanggal, mr_status, rejection_reason, remarks) VALUES\n";
  dataIns += part
    .map((x) => `  (${q(x.key)}, ${q(x.mr_kode)}, ${q(x.cabang)}, ${d(x.mr_tanggal)}, ${q(x.mr_status)}, ${q(x.rejection_reason)}, ${q(x.remarks)})`)
    .join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(mrItemRows, 300)) {
  dataIns += "INSERT INTO x_mr_item (mr_key, line_no, excel_row, part_number, part_name, satuan, qty_request, qty_received_import, qty_pr, qty_share, alloc_cabang, item_status, reject_reason, priority, remarks) VALUES\n";
  dataIns += part
    .map(({ doc, it }) =>
      `  (${q(doc.key)}, ${it.line_no}, ${it.row.excel_row}, ${q(it.part_number)}, ${q(it.row.description)}, ${q(it.row.uom)}, ${it.qty}, ${it.rec}, ${it.qty_pr}, ${it.qty_share}, ${q(it.alloc)}, ${q(it.rejected ? "rejected" : "active")}, ${q(it.reject_reason || null)}, ${q(it.priority)}, ${q(it.remarks)})`)
    .join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(prList, 300)) {
  dataIns += "INSERT INTO x_pr (pr_kode, pr_tanggal, pr_status, pembuat) VALUES\n";
  dataIns += part.map((p) => `  (${q(p.pr_kode)}, ${d(p.pr_tanggal)}, ${q(p.pr_status)}, ${q(p.pembuat)})`).join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(prItemRows, 300)) {
  dataIns += "INSERT INTO x_pr_item (pr_kode, line_no, src, excel_row, mr_kode, mr_key, mr_line, part_number, part_name, satuan, qty, keterangan) VALUES\n";
  dataIns += part
    .map((i) =>
      `  (${q(i.pr_kode)}, ${i.line_no}, ${q(i.src)}, ${i.excel_row}, ${q(i.mr_kode)}, ${q(i.mr_key)}, ${i.mr_line ?? "NULL"}, ${q(i.part_number)}, ${q(i.part_name)}, ${q(i.satuan)}, ${i.qty}, ${q(i.keterangan)})`)
    .join(",\n");
  dataIns += ";\n\n";
}

const data = dataDdl + dataIns;

let sql = `-- =====================================================================
-- IMPORT MR & PR ("${path.basename(src)}": sheet MR Monitoring + PR OPEN WMS)
-- Generated: ${today}  |  ${stat.mr} MR (${stat.mrItems} barang), ${stat.pr} PR (${stat.prItems} barang)
-- Generator: supabase/import/generate_mr_pr_import.cjs
--
-- Jalankan SEKALI di Supabase VPS (psql / SQL Editor, seluruh isi file),
-- SETELAH migration 20261023100000_mr_pr_import.sql DAN frontend versi
-- terbaru (lib/mr-fulfillment.ts menghitung qty_received_import) ter-deploy.
-- Aman dijalankan ulang: MR/PR yang kodenya sudah ada di-skip.
-- Cek dulu hasilnya lewat mr_pr_dryrun.sql (aturan sama, read-only).
--
-- Aturan (keputusan user 2026-10-23):
--   - MR yang diimport: yang masih punya barang open di MR Monitoring + MR
--     yang dirujuk sheet PR OPEN WMS. MR yang kodenya sudah ada di prod
--     di-skip (dilaporkan). Status approved / completed (semua barang
--     terpenuhi) / rejected (semua barang CLOSED by PPIC), tanpa approvals,
--     mrs.mr_is_import = true.
--   - Lokasi MR dari SITE: KM10/HO/MARKETING/MANADO = GMI-JAKARTA, BPN =
--     GMI-BPP, lainnya GMI-<SITE>. PR & MR penampung: ${PR_CABANG}.
--   - Barang: qty MR = QTY MR; qty sudah diterima (COMPLETED = penuh, selain
--     itu QTY RECEIVED) disimpan di mr_items.qty_received_import (sumber
--     pemenuhan #8). CLOSED by PPIC = item ditolak. Prioritas P0 -> P1,
--     STOCK -> P4. Jatah PR: barang ber-PR = penuh; barang selesai = qty yang
--     ber-PR; barang open tanpa PR yang disuplai dari gudang lain / sudah
--     dikirim = share stock sisa qty (+ alokasi gudang Supply Areas kalau ada).
--   - PR: baris sheet PR OPEN WMS (status approved) + baris PR dari kolom
--     NO PR / QTY PR / PR DATE MR Monitoring yang tidak ada di PR OPEN
--     (PR lama -> status closed; baris PR selesai di PR yang masih open ikut
--     masuk ke PR tsb). prs.pr_is_import = true, accurate = true, approvals
--     kosong. Baris PR tanpa MR yang bisa dirujuk -> MR penampung per PR
--     (<No PR>-TANPA-MR, approved). Link PO Outstanding -> PR dikerjakan di
--     langkah terpisah.
--   - PR yang kodenya sudah ada di prod di-skip utuh; barang MR import yang
--     PR-nya ternyata sudah ada di prod tidak bisa ditautkan, jadi jatah
--     PR-nya dikurangi qty baris PR itu (tidak ditawarkan lagi di form PR).
--   - Baris PR OPEN yang MR-nya sudah ada di prod ditautkan ke barang MR prod
--     (part number sama); yang tidak ketemu -> MR penampung.
--   - Baris MR dengan QTY MR 0 / part number tidak valid di-skip.
--   - Barang yang belum ada di master dibuat otomatis (nama = deskripsi Excel).
-- =====================================================================

`;

const xReport = `DROP TABLE IF EXISTS pg_temp.x_report;
CREATE TEMP TABLE x_report (kategori TEXT NOT NULL, ref TEXT, detail TEXT);

`;
let reportSql = "";
for (const part of chunk(report, 300)) {
  reportSql += "INSERT INTO x_report (kategori, ref, detail) VALUES\n";
  reportSql += part.map(([k, r, dt]) => `  (${q(k)}, ${q(r)}, ${q(dt)})`).join(",\n");
  reportSql += ";\n\n";
}
const readTpl = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const plan = readTpl("mr_pr_plan_body.sqltpl");

sql += "BEGIN;\n\n" + xReport + data + reportSql + plan + readTpl("mr_pr_import_body.sqltpl");
fs.writeFileSync(out, sql);

const dryrun = `-- =====================================================================
-- DRY-RUN IMPORT MR & PR (READ-ONLY) -- simulasi mr_pr_import.sql
-- Generated: ${today}  |  sumber: ${path.basename(src)}
-- Generator: supabase/import/generate_mr_pr_import.cjs
--
-- Jalankan seluruh isi file di Supabase VPS SEBELUM mr_pr_import.sql.
-- Menjalankan aturan skip / tautan / penyesuaian yang sama persis dengan
-- import terhadap data prod, tapi hanya di temp table. Hasil = 1 tabel.
-- =====================================================================

`;
fs.writeFileSync(outDryrun, dryrun + xReport + data + reportSql + plan + readTpl("mr_pr_dryrun_body.sqltpl"));

const verifyBody = path.join(__dirname, "mr_pr_verify_body.sqltpl");
if (fs.existsSync(verifyBody)) {
  const verify = `-- =====================================================================
-- VERIFIKASI IMPORT MR & PR (pasca import, READ-ONLY)
-- Generated: ${today}  |  sumber: ${path.basename(src)}  |  ${stat.mr} MR, ${stat.pr} PR
-- Generator: supabase/import/generate_mr_pr_import.cjs
--
-- Jalankan seluruh isi file di Supabase VPS SETELAH mr_pr_import.sql (Excel
-- harus sama dengan yang dipakai generate import). Hanya temp table.
-- FAIL = import tidak sesuai Excel; WARN = perlu dicek; INFO = catatan.
-- =====================================================================

`;
  fs.writeFileSync(outVerify, verify + data + fs.readFileSync(verifyBody, "utf8"));
}


// ---------------------------------------------------------------------
// Versi Supabase SQL Editor (batas ukuran query): data Excel dimuat dulu ke
// schema staging import_mrpr lewat beberapa file kecil, lalu dry-run /
// import / verify menyalinnya ke temp table yang sama.
// ---------------------------------------------------------------------
const STAGE = "import_mrpr";
const STUDIO_MAX = 400 * 1024;
const studioFile = (name) => path.join(__dirname, `mr_pr_studio_${name}.sql`);
for (const f of fs.readdirSync(__dirname)) {
  if (/^mr_pr_studio_.*\.sql$/.test(f)) fs.unlinkSync(path.join(__dirname, f));
}

const stageDdl =
  `CREATE SCHEMA IF NOT EXISTS ${STAGE};\n\n` +
  dataDdl
    .replace(/DROP TABLE IF EXISTS pg_temp\.x_/g, `DROP TABLE IF EXISTS ${STAGE}.x_`)
    .replace(/CREATE TEMP TABLE x_/g, `CREATE TABLE ${STAGE}.x_`) +
  `DROP TABLE IF EXISTS ${STAGE}.x_report_seed;\nCREATE TABLE ${STAGE}.x_report_seed (kategori TEXT NOT NULL, ref TEXT, detail TEXT);\n\n`;
const stageStmts = (dataIns + reportSql)
  .split(";\n\n")
  .filter((st) => st.trim())
  .map((st) => {
    // Pengaman: potongan yang tidak diawali INSERT = ada teks Excel berisi ";\n\n".
    if (!/^INSERT INTO x_/.test(st.trimStart())) throw new Error(`Gagal memecah statement staging: ${st.slice(0, 80)}`);
    return st.replace(/^INSERT INTO x_report /m, `INSERT INTO ${STAGE}.x_report_seed `).replace(/^INSERT INTO x_/m, `INSERT INTO ${STAGE}.x_`) + ";\n\n";
  });
const stageParts = [];
let cur = stageDdl;
for (const st of stageStmts) {
  if (cur.length + st.length > STUDIO_MAX && cur !== stageDdl) {
    stageParts.push(cur);
    cur = "";
  }
  cur += st;
}
stageParts.push(cur);
stageParts.forEach((body, i) => {
  const head = `-- MR/PR import via SQL Editor -- STAGING bagian ${i + 1} dari ${stageParts.length}
-- Generated: ${today}  |  sumber: ${path.basename(src)}
-- Jalankan berurutan bagian 1 s/d ${stageParts.length}, masing-masing SEKALI (bagian 1
-- mengosongkan & membuat ulang schema ${STAGE}). Lalu mr_pr_studio_2_dryrun.sql.

`;
  fs.writeFileSync(studioFile(`1_stage_${i + 1}`), head + body);
});

const expect = { x_cfg: 3, x_mr: docList.length, x_mr_item: mrItemRows.length, x_pr: prList.length, x_pr_item: prItemRows.length, x_report_seed: report.length };
const copyFromStage = `DO $$
DECLARE
  v_n BIGINT;
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES ${Object.entries(expect).map(([t, n]) => `('${t}', ${n})`).join(", ")}) v(t, n) LOOP
    IF to_regclass('${STAGE}.' || r.t) IS NULL THEN
      RAISE EXCEPTION 'Tabel staging ${STAGE}.% belum ada: jalankan semua mr_pr_studio_1_stage_*.sql dulu.', r.t;
    END IF;
    EXECUTE format('SELECT count(*) FROM ${STAGE}.%I', r.t) INTO v_n;
    IF v_n <> r.n THEN
      RAISE EXCEPTION 'Staging ${STAGE}.% berisi % baris, seharusnya %: jalankan ulang semua mr_pr_studio_1_stage_*.sql dari bagian 1.', r.t, v_n, r.n;
    END IF;
  END LOOP;
END $$;

${["x_cfg", "x_mr", "x_mr_item", "x_pr", "x_pr_item"].map((t) => `DROP TABLE IF EXISTS pg_temp.${t};\nCREATE TEMP TABLE ${t} AS SELECT * FROM ${STAGE}.${t};`).join("\n")}

`;
const reportFromStage = xReport + `INSERT INTO x_report SELECT * FROM ${STAGE}.x_report_seed;\n\n`;
const studioNote = (judul) => `-- MR/PR import via SQL Editor -- ${judul}
-- Generated: ${today}  |  sumber: ${path.basename(src)}
-- Data Excel dibaca dari schema staging ${STAGE} (mr_pr_studio_1_stage_*.sql).

`;
fs.writeFileSync(studioFile("2_dryrun"), studioNote("DRY-RUN (read-only)") + copyFromStage + reportFromStage + plan + readTpl("mr_pr_dryrun_body.sqltpl"));
fs.writeFileSync(studioFile("3_import"), studioNote("IMPORT (menulis data)") + "BEGIN;\n\n" + copyFromStage + reportFromStage + plan + readTpl("mr_pr_import_body.sqltpl"));
fs.writeFileSync(studioFile("4_verify"), studioNote("VERIFIKASI (read-only)") + copyFromStage + readTpl("mr_pr_verify_body.sqltpl"));
fs.writeFileSync(studioFile("5_drop_stage"), studioNote("BERSIHKAN staging (jalankan setelah verifikasi selesai)") + `DROP SCHEMA IF EXISTS ${STAGE} CASCADE;\n`);

console.log(JSON.stringify({ out, outDryrun, outVerify, studioStageParts: stageParts.length, picEmail, ...stat, reportRows: report.length }, null, 2));
