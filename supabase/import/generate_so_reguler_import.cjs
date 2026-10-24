// Generator SQL import SO Reguler dari "LIST PENAWARAN GMI.xlsx" (sheet
// "Monitoring PO GMI", spreadsheet marketing: 1 baris = 1 barang SO + jejak
// PO vendor / DO / invoice ERP-nya):
//   supabase/import/so_reguler_dryrun.sql  -- simulasi read-only, jalankan dulu
//   supabase/import/so_reguler_import.sql  -- menulis data
//   supabase/import/so_reguler_verify.sql  -- cek pasca import (read-only)
//
//   node supabase/import/generate_so_reguler_import.cjs "Import 23 Oktober/List Penawaran (SO Reguler)/LIST PENAWARAN GMI.xlsx" [--pic=email] [--sejak=2026-01-01]
//
// --pic   = email user (profiles) yang dicatat sebagai pembuat SO import.
//           Kosong = so_pic "IMPORT LIST PENAWARAN", created_by NULL.
// --sejak = SO dengan tanggal SO sebelum ini tidak diimport (dilaporkan).
//
// Aturan (keputusan user 2026-10-24): hanya SO yang masih punya barang belum
// terkirim; barang yang sudah terkirim / batal tidak ikut (dicatat di
// keterangan SO) supaya tidak di-DO dobel -- lihat header SQL yang dihasilkan.

const path = require("path");
const fs = require("fs");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--")) || "Import 23 Oktober/List Penawaran (SO Reguler)/LIST PENAWARAN GMI.xlsx";
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3) || null;
const picEmail = opt("pic");
const sejak = opt("sejak") || "2026-01-01";
if (!/^\d{4}-\d{2}-\d{2}$/.test(sejak)) throw new Error(`--sejak harus YYYY-MM-DD: ${sejak}`);

const SHEET = "Monitoring PO GMI";
const outDryrun = path.join(__dirname, "so_reguler_dryrun.sql");
const outImport = path.join(__dirname, "so_reguler_import.sql");
const outVerify = path.join(__dirname, "so_reguler_verify.sql");

// Nama customer di Excel (huruf besar/kecil diabaikan) -> customers.customer_no
// di prod. Isi kalau dry-run melaporkan customer tidak ketemu / ambigu.
const CUSTOMER_MAP = {
  // "PT. CONTOH NAMA": "GMI-123",
};

// Kolom NO RFQ -> kategori SO (SO_KATEGORI_OPTIONS). Nomor RFQ (GMI-xxxx /
// angka), "New Order", dan kosong -> Quotation.
const KATEGORI = {
  KONTRAK: "Kontrak",
  "REPEAT ORDER": "Repeat Order",
  RO: "Repeat Order",
  QUOTATION: "Quotation",
  INSTALASI: "Instalasi",
};
const KATEGORI_DEFAULT = "Quotation";

const K = (s) => String(s ?? "").trim().toUpperCase();
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const d = (v) => (v ? `DATE ${q(v)}` : "NULL");
const chunk = (arr, n) => {
  const res = [];
  for (let i = 0; i < arr.length; i += n) res.push(arr.slice(i, i + n));
  return res;
};
const clean = (v) => {
  const t = String(v ?? "").replace(/\r\n?/g, "\n").trim();
  return t === "" ? null : t;
};
const oneLine = (v) => (v ? v.replace(/\s*\n\s*/g, ", ") : v);

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
const ymd = (y, m, dd) => {
  const dt = new Date(Date.UTC(y, m - 1, dd));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== dd) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};
// Tanggal Excel: serial number (mayoritas) atau teks ketikan "dd/mm/yyyy",
// "dd-mm-yyyy", "6-Jul-26". Hasil null = tidak terbaca (dilaporkan).
function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? ymd(p.y, p.m, p.d) : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) return ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
}

// ---------------------------------------------------------------------
// Baca sheet
// ---------------------------------------------------------------------
const wb = XLSX.readFile(src);
const ws = wb.Sheets[SHEET];
if (!ws) throw new Error(`Sheet "${SHEET}" tidak ada`);
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
const hi = rows.findIndex((r) => r.some((c) => clean(c) === "No SO"));
if (hi < 0) throw new Error(`Header "No SO" tidak ditemukan`);
const header = rows[hi].map((c) => clean(c));
const col = (label) => {
  const i = header.indexOf(label);
  if (i < 0) throw new Error(`Kolom "${label}" tidak ditemukan`);
  return i;
};
const C = {
  rfq: col("NO RFQ"),
  marketing: col("MARKETING"),
  po_date: col("TGL PO CREATE BY CUST"),
  po_received: col("TGL PO DITERIMA VIA EMAIL"),
  so_date: col("TGL SO"),
  so: col("No SO"),
  due: col("DUE DATE"),
  customer: col("Customer"),
  po_no: col("No PO"),
  part: col("Item"),
  part_name: col("Part Name"),
  qty: col("Qty"),
  uom: col("UoM"),
  retail: col("Retail"),
  po_vendor: col("PO VENDOR"),
  progress: col("Progress"),
  etd: col("ETD (Supplier to GMI)"),
  no_do: col("NO DO"),
  tgl_kirim: col("TGL PENGIRIMAN KE CUST"),
  status: col("DONE / PENDING"),
};

const report = []; // [kategori, ref, detail]
const dateCols = { po_date: "TGL PO CREATE BY CUST", po_received: "TGL PO DITERIMA VIA EMAIL", so_date: "TGL SO", due: "DUE DATE" };

const lines = [];
rows.slice(hi + 1).forEach((r, i) => {
  const so = clean(r[C.so]);
  if (!so) return; // baris 2023 tanpa No SO + baris kosong
  const g = (k) => clean(r[C[k]]);
  const line = {
    excel_row: hi + 2 + i,
    so_kode: so,
    rfq: g("rfq"),
    marketing: g("marketing"),
    customer: g("customer"),
    po_no: g("po_no"),
    part_number: g("part"),
    part_name: g("part_name"),
    qty_raw: r[C.qty],
    uom: g("uom"),
    retail: g("retail"),
    po_vendor: oneLine(g("po_vendor")),
    progress: oneLine(g("progress")),
    etd: oneLine(g("etd")),
    no_do: oneLine(g("no_do")),
    tgl_kirim: r[C.tgl_kirim],
    status: K(g("status")),
  };
  for (const [k, label] of Object.entries(dateCols)) {
    line[k] = toDate(r[C[k]]);
    line[`${k}_raw`] = r[C[k]];
    if (line[k] === null && clean(r[C[k]]) !== null) line[`${k}_bad`] = `${label} "${clean(r[C[k]])}"`;
  }
  lines.push(line);
});

// Status baris dari bukti di sheet (kolom DONE/PENDING sering kosong padahal
// barang sudah dikirim):
//   batal : DONE/PENDING = CANCEL, atau Progress / NO DO berisi CANCEL / CLOSE
//   kirim : DONE / PROSES DELIVERY / INSTALASI, NO DO berisi nomor, tanggal
//           kirim ke customer terisi, atau NO DO "update no DO" (DO-nya ada,
//           nomornya belum ditulis)
//   open  : selain itu -> barang yang diimport
function classify(l) {
  if (l.status === "CANCEL" || /CANCEL|CLOSE/i.test(l.progress || "") || /CANCEL|CLOSE/i.test(l.no_do || "")) return "batal";
  if (["DONE", "PROSES DELIVERY", "INSTALASI"].includes(l.status)) return "kirim";
  if (/\d{3,}/.test(l.no_do || "") || /update no do/i.test(l.no_do || "")) return "kirim";
  if (clean(l.tgl_kirim) !== null) return "kirim";
  return "open";
}
for (const l of lines) {
  l.cls = classify(l);
  if (l.cls === "kirim" && /update no do/i.test(l.no_do || "") && !/\d{3,}/.test(l.no_do || "") && clean(l.tgl_kirim) === null) {
    report.push(['NO DO "update no DO" (tanpa nomor & tgl kirim) dianggap sudah kirim', l.so_kode, `${l.part_number} ${l.qty_raw} baris ${l.excel_row}`]);
  }
}

const groups = new Map();
for (const l of lines) {
  const key = K(l.so_kode);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(l);
}

const mostCommon = (arr) => {
  const m = new Map();
  for (const v of arr) if (v !== null && v !== undefined) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const distinct = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined))];
const minOf = (arr) => arr.filter(Boolean).sort()[0] || null;

const stat = { soExcel: groups.size, soSelesai: 0, soBatal: 0, soLama: 0, soKodeInvalid: 0, soTanpaBarangValid: 0 };
const docs = [];

for (const [key, ls] of groups) {
  const open = ls.filter((l) => l.cls === "open");
  if (open.length === 0) {
    if (ls.every((l) => l.cls === "batal")) stat.soBatal++;
    else stat.soSelesai++;
    continue;
  }
  const soKode = ls[0].so_kode;
  if (!/^[A-Z0-9][A-Z0-9./-]*$/.test(key)) {
    stat.soKodeInvalid++;
    report.push(["SKIP SO: No SO tidak valid", soKode, `baris ${ls.map((l) => l.excel_row).join(", ")}`]);
    continue;
  }

  const doc = { key, so_kode: soKode, lines: ls };
  doc.so_tanggal = minOf(ls.map((l) => l.so_date)) || minOf(ls.map((l) => l.po_received)) || minOf(ls.map((l) => l.po_date));
  if (!doc.so_tanggal) {
    report.push(["SKIP SO: tanggal SO / PO tidak ada", soKode, null]);
    continue;
  }
  if (!ls.some((l) => l.so_date)) {
    report.push(["Tanggal SO kosong, dipakai tanggal PO", soKode, doc.so_tanggal]);
  }
  if (doc.so_tanggal < sejak) {
    stat.soLama++;
    report.push([
      `SKIP SO: tanggal SO sebelum ${sejak} (masih ada barang open di Excel)`,
      soKode,
      `${doc.so_tanggal} ${ls[0].customer || "-"}: ${open.map((l) => `${l.part_number} ${l.qty_raw}${l.progress ? ` (${l.progress})` : ""}`).join("; ")}`,
    ]);
    continue;
  }

  for (const l of ls) {
    for (const k of Object.keys(dateCols)) {
      if (l[`${k}_bad`]) report.push(["Tanggal tidak terbaca (dikosongkan)", soKode, `baris ${l.excel_row}: ${l[`${k}_bad`]}`]);
    }
  }

  // Header SO: 1 SO = 1 header, tapi di sheet diulang per baris.
  const fields = { customer: "Customer", po_no: "No PO", marketing: "MARKETING", rfq: "NO RFQ", po_date: "TGL PO CREATE", po_received: "TGL PO DITERIMA", due: "DUE DATE" };
  for (const [k, label] of Object.entries(fields)) {
    const vals = distinct(ls.map((l) => l[k]));
    if (vals.length > 1) report.push(["Header SO beda antar baris (dipakai yang terbanyak / gabungan No PO)", soKode, `${label}: ${vals.join(" | ")}`]);
  }
  doc.customer = mostCommon(ls.map((l) => l.customer));
  if (!doc.customer) {
    report.push(["SKIP SO: customer kosong", soKode, null]);
    continue;
  }
  doc.customer_po_no = distinct(ls.map((l) => l.po_no)).join(" / ") || null;
  doc.marketing = mostCommon(ls.map((l) => l.marketing));
  doc.marketing_name = doc.marketing ? doc.marketing.toUpperCase() : null;
  doc.so_due_date = minOf(ls.map((l) => l.due));
  if (doc.so_due_date && doc.so_due_date < doc.so_tanggal) {
    report.push(["Due date < tanggal SO (due date dikosongkan, form Edit SO menolak)", soKode, `tgl SO ${doc.so_tanggal}, due ${doc.so_due_date}`]);
    doc.so_due_date = null;
  }
  doc.customer_po_date = minOf(ls.map((l) => l.po_date));
  doc.customer_po_received_date = minOf(ls.map((l) => l.po_received));
  if (doc.customer_po_date && doc.customer_po_received_date && doc.customer_po_received_date < doc.customer_po_date) {
    report.push([
      "Tgl PO diterima < tgl PO dibuat (tgl diterima dikosongkan, form Edit SO menolak)",
      soKode,
      `dibuat ${doc.customer_po_date}, diterima ${doc.customer_po_received_date}`,
    ]);
    doc.customer_po_received_date = null;
  }

  const rfq = mostCommon(ls.map((l) => l.rfq));
  const instalasi = ls.some((l) => K(l.retail) === "INSTALASI");
  doc.kategori = instalasi ? "Instalasi" : KATEGORI[K(rfq)] || KATEGORI_DEFAULT;
  if (!instalasi && !KATEGORI[K(rfq)]) {
    report.push([`Kategori: NO RFQ "${rfq ?? "(kosong)"}" -> ${KATEGORI_DEFAULT}`, soKode, null]);
  }

  // Barang = baris open. Sudah kirim / batal dicatat di keterangan SO.
  // Part number yang sama di 1 SO digabung jadi 1 barang (qty dijumlah):
  // form & fungsi Edit SO (update_so_reguler) menolak barang dobel.
  doc.items = [];
  const byPart = new Map();
  for (const l of open) {
    const qtyNum = typeof l.qty_raw === "number" ? l.qty_raw : Number(String(l.qty_raw ?? "").replace(/,/g, "").trim());
    if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
      report.push(["SKIP barang: qty tidak valid", soKode, `${l.part_number} baris ${l.excel_row} qty "${l.qty_raw}"`]);
      continue;
    }
    if (!l.part_number || !/[A-Z0-9].*[A-Z0-9]/i.test(l.part_number) || l.part_number.length < 3) {
      report.push(["SKIP barang: part number tidak valid", soKode, `"${l.part_number}" baris ${l.excel_row} qty ${qtyNum}`]);
      continue;
    }
    const pk = K(l.part_number);
    if (!byPart.has(pk)) {
      const it = { line_no: doc.items.length + 1, excel_row: l.excel_row, part_number: l.part_number, part_name: l.part_name, satuan: l.uom, qty: 0, src: [] };
      byPart.set(pk, it);
      doc.items.push(it);
    }
    const it = byPart.get(pk);
    it.qty += qtyNum;
    it.part_name = it.part_name || l.part_name;
    it.satuan = it.satuan || l.uom;
    // UoM "?" dsb. -> pakai satuan master. "eA" / "ROll" -> "Ea" / "Roll".
    if (it.satuan && !/^[A-Za-z]+$/.test(it.satuan)) it.satuan = null;
    if (it.satuan) it.satuan = it.satuan[0].toUpperCase() + it.satuan.slice(1).toLowerCase();
    it.src.push({ ...l, qty: qtyNum });
  }
  for (const it of doc.items) {
    const ds = (f) => distinct(it.src.map(f).filter((v) => v && v !== "-")).join(", ");
    it.remarks = [
      `Import List Penawaran baris ${it.src.map((l) => l.excel_row).join(", ")}`,
      it.src.length > 1 ? `gabungan qty ${it.src.map((l) => l.qty).join(" + ")}` : null,
      ds((l) => l.status) ? `Status: ${ds((l) => l.status)}` : null,
      ds((l) => l.progress) ? `Progress: ${ds((l) => l.progress)}` : null,
      ds((l) => l.po_vendor) ? `PO Vendor: ${ds((l) => l.po_vendor)}` : null,
      ds((l) => l.etd) ? `ETD: ${ds((l) => l.etd)}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    if (it.src.length > 1) {
      report.push(["Barang dobel di 1 SO digabung (qty dijumlah)", soKode, `${it.part_number}: ${it.src.map((l) => l.qty).join(" + ")} = ${it.qty} (baris ${it.src.map((l) => l.excel_row).join(", ")})`]);
    }
  }
  const sudah = ls.filter((l) => l.cls === "kirim");
  const batal = ls.filter((l) => l.cls === "batal");
  for (const l of sudah) {
    report.push(["Barang sudah dikirim di ERP, tidak diimport (dicatat di keterangan SO)", soKode, `${l.part_number} ${l.qty_raw}${l.no_do ? ` DO ${l.no_do}` : ""}`]);
  }
  for (const l of batal) {
    report.push(["Barang batal di Excel, tidak diimport (dicatat di keterangan SO)", soKode, `${l.part_number} ${l.qty_raw} (${l.status || l.progress || l.no_do})`]);
  }
  if (doc.items.length === 0) {
    stat.soTanpaBarangValid++;
    report.push(["SKIP SO: tidak ada barang open yang valid", soKode, null]);
    continue;
  }
  doc.remarks = [
    `Import ${path.basename(src)} (sheet ${SHEET})`,
    rfq && !KATEGORI[K(rfq)] ? `NO RFQ: ${rfq}` : null,
    sudah.length ? `Sudah dikirim di ERP (tidak diimport): ${sudah.map((l) => `${l.part_number} ${l.qty_raw}${l.no_do ? ` DO ${l.no_do}` : ""}`).join("; ")}` : null,
    batal.length ? `Batal: ${batal.map((l) => `${l.part_number} ${l.qty_raw}`).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  docs.push(doc);
}

stat.soImport = docs.length;
stat.barang = docs.reduce((a, x) => a + x.items.length, 0);
report.push(["Ringkasan Excel: SO selesai (semua barang terkirim) -- tidak diimport", null, String(stat.soSelesai)]);
report.push(["Ringkasan Excel: SO batal semua barang -- tidak diimport", null, String(stat.soBatal)]);

// ---------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------
const items = docs.flatMap((doc) => doc.items.map((it) => ({ doc, it })));
const today = new Date().toISOString().slice(0, 10);

const dataDdl = `DROP TABLE IF EXISTS pg_temp.x_cfg;
DROP TABLE IF EXISTS pg_temp.x_cust_map;
DROP TABLE IF EXISTS pg_temp.x_so;
DROP TABLE IF EXISTS pg_temp.x_so_item;

CREATE TEMP TABLE x_cfg (key TEXT PRIMARY KEY, value TEXT);

CREATE TEMP TABLE x_cust_map (customer_name TEXT PRIMARY KEY, customer_no TEXT NOT NULL);

CREATE TEMP TABLE x_so (
  so_key TEXT PRIMARY KEY,
  so_kode TEXT NOT NULL,
  so_tanggal DATE NOT NULL,
  so_due_date DATE,
  kategori TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_po_no TEXT,
  customer_po_date DATE,
  customer_po_received_date DATE,
  marketing_name TEXT,
  remarks TEXT
);

CREATE TEMP TABLE x_so_item (
  so_key TEXT NOT NULL,
  line_no INT NOT NULL,
  excel_row INT NOT NULL,
  part_number TEXT NOT NULL,
  part_name TEXT,
  satuan TEXT,
  qty INT NOT NULL,
  remarks TEXT,
  PRIMARY KEY (so_key, line_no)
);

`;

let dataIns = `INSERT INTO x_cfg (key, value) VALUES
  ('pic_email', ${q(picEmail)}),
  ('sumber', ${q(path.basename(src))});

`;
const mapRows = Object.entries(CUSTOMER_MAP);
if (mapRows.length) {
  dataIns += "INSERT INTO x_cust_map (customer_name, customer_no) VALUES\n";
  dataIns += mapRows.map(([n, no]) => `  (${q(K(n))}, ${q(no)})`).join(",\n") + ";\n\n";
}
for (const part of chunk(docs, 300)) {
  dataIns += "INSERT INTO x_so (so_key, so_kode, so_tanggal, so_due_date, kategori, customer_name, customer_po_no, customer_po_date, customer_po_received_date, marketing_name, remarks) VALUES\n";
  dataIns += part
    .map((x) =>
      `  (${q(x.key)}, ${q(x.so_kode)}, ${d(x.so_tanggal)}, ${d(x.so_due_date)}, ${q(x.kategori)}, ${q(x.customer)}, ${q(x.customer_po_no)}, ${d(x.customer_po_date)}, ${d(x.customer_po_received_date)}, ${q(x.marketing_name)}, ${q(x.remarks)})`)
    .join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(items, 300)) {
  dataIns += "INSERT INTO x_so_item (so_key, line_no, excel_row, part_number, part_name, satuan, qty, remarks) VALUES\n";
  dataIns += part
    .map(({ doc, it }) =>
      `  (${q(doc.key)}, ${it.line_no}, ${it.excel_row}, ${q(it.part_number)}, ${q(it.part_name)}, ${q(it.satuan)}, ${it.qty}, ${q(it.remarks)})`)
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

const rules = `-- Aturan (keputusan user 2026-10-24):
--   - Diimport hanya SO yang masih punya barang BELUM TERKIRIM. Status baris
--     dibaca dari bukti di sheet, bukan cuma kolom DONE/PENDING (sering kosong
--     padahal sudah dikirim): batal = CANCEL / Progress atau NO DO berisi
--     CANCEL/CLOSE; sudah kirim = DONE / PROSES DELIVERY / INSTALASI / NO DO
--     berisi nomor atau "update no DO" / TGL PENGIRIMAN KE CUST terisi.
--   - Barang SO = baris yang belum terkirim saja. Baris sudah kirim / batal
--     tidak jadi barang (status SO WMS dihitung dari DO/PO WMS, jadi kalau
--     ikut masuk akan tampil belum terkirim & bisa di-DO dobel) -- dicatat di
--     keterangan SO.
--   - SO bertanggal sebelum ${sejak} tidak diimport (dilaporkan).
--   - SO yang kodenya sudah ada di prod di-skip (aman dijalankan ulang).
--   - Customer dicocokkan ke master customer aktif: nama persis, lalu nama
--     mirip (tanpa PT/CV/Tbk & tanda baca); utamakan tipe non_consignment /
--     both. Tidak ketemu / ambigu -> SO di-skip; isi CUSTOMER_MAP di generator.
--   - Kategori dari NO RFQ: Kontrak / Repeat Order (RO) / Quotation; Retail =
--     Instalasi -> Instalasi; nomor RFQ / New Order / kosong -> Quotation.
--   - so_status open, tanpa lokasi (gudang dipilih saat PO/DO), prioritas
--     barang P3, so_is_import = true. Nama marketing UPPERCASE.
--   - Barang yang belum ada di master dibuat otomatis (nama = Part Name Excel).
`;

const readTpl = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const plan = readTpl("so_reguler_plan_body.sqltpl");
const summary = `${stat.soImport} SO (${stat.barang} barang) dari ${stat.soExcel} SO Excel`;

fs.writeFileSync(
  outDryrun,
  `-- =====================================================================
-- DRY-RUN IMPORT SO REGULER (READ-ONLY) -- simulasi so_reguler_import.sql
-- Generated: ${today}  |  sumber: ${path.basename(src)}  |  ${summary}
-- Generator: supabase/import/generate_so_reguler_import.cjs
--
-- Jalankan seluruh isi file di Supabase VPS SEBELUM so_reguler_import.sql.
-- Aturan skip / pencocokan customer sama persis dengan import, tapi hanya di
-- temp table. Hasil = 1 tabel.
${rules}-- =====================================================================

` + xReport + data + reportSql + plan + readTpl("so_reguler_dryrun_body.sqltpl"),
);

fs.writeFileSync(
  outImport,
  `-- =====================================================================
-- IMPORT SO REGULER ("${path.basename(src)}", sheet ${SHEET})
-- Generated: ${today}  |  ${summary}
-- Generator: supabase/import/generate_so_reguler_import.cjs
--
-- Jalankan SEKALI di Supabase VPS (psql / SQL Editor, seluruh isi file),
-- SETELAH migration 20261024100000_so_reguler_import.sql. Cek dulu hasilnya
-- lewat so_reguler_dryrun.sql. Aman dijalankan ulang: SO yang kodenya sudah
-- ada di-skip.
${rules}-- =====================================================================

BEGIN;

` + xReport + data + reportSql + plan + readTpl("so_reguler_import_body.sqltpl"),
);

fs.writeFileSync(
  outVerify,
  `-- =====================================================================
-- VERIFIKASI IMPORT SO REGULER (pasca import, READ-ONLY)
-- Generated: ${today}  |  sumber: ${path.basename(src)}  |  ${summary}
-- Generator: supabase/import/generate_so_reguler_import.cjs
--
-- Jalankan seluruh isi file di Supabase VPS SETELAH so_reguler_import.sql
-- (Excel & opsi generator harus sama dengan saat generate import). Hanya temp
-- table. FAIL = import tidak sesuai Excel; WARN = perlu dicek; INFO = catatan.
-- =====================================================================

` + data + readTpl("so_reguler_verify_body.sqltpl"),
);

console.log(JSON.stringify({ outDryrun, outImport, outVerify, picEmail, sejak, ...stat, reportRows: report.length }, null, 2));
