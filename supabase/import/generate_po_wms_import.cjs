// Generator SQL import "Data PO WMS.xlsx" (export ERP, update lanjutan dari
// PO OST) -> supabase/import/po_wms_import.sql.
//
//   node supabase/import/generate_po_wms_import.cjs "Data PO WMS.xlsx"
//
// Struktur Excel: 1 baris = baris PO LEFT JOIN baris faktur penerimaan (RI)
// yang mengirimnya. Kts. Dikirim = qty kumulatif yang sudah diterima per
// baris PO (bukan per faktur), jadi baris PO yang dikirim lewat beberapa
// faktur muncul berulang dengan nilai sama. Baris PO direkonstruksi dengan
// "multiset maksimum" per kunci (barang, qty, harga, kts) antar grup faktur.
//
// Keputusan user (2026-10-21): lihat header SQL yang dihasilkan.

const path = require("path");
const fs = require("fs");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));

const src = process.argv[2] || "Data PO WMS.xlsx";
const out = path.join(__dirname, "po_wms_import.sql");

const AUD_VENDORS = ["JAS Oceania Melbourne", "Auto Electrical Imports Pty Ltd"];
// Vendor luar negeri (selain AUD) = USD. Vendor lain = IDR (lokal).
const USD_VENDORS = [
  "Foshan Yongwei Lighting Electrical Co., Ltd",
  "ZHEJIANG HAIDIE ELECTRIC CO.,LTD",
  "VEISE Electronic Limited",
  "Shenzhen Top Lead Industrial CO., LTD.",
  "Zhengzhou Henan KingClima Industry Co.Ltd",
  "Changzhou Wujin Yueda Electroacoustic Equipment CO, Ltd",
  "GD JG Electronic Ltd",
  "Suzhou Arenland Automotive Technology Co., LTD",
  "Yueqing Chaochen Electronic Co.,Ltd",
  "Topbright Technology Corp. (HK) Limited",
  "Shanghai Weknown Auto Parts CO., Ltd",
  "Yueqing Aibeiken Electric Co., Ltd",
  "Guangzhou Ruchu Imp. & Exp. Co., Ltd",
  "Top Quality Auto Electric Products CO., Ltd",
  "SHANGHAI JING RUI LIGHTING CO.,LTD",
];
const CABANG = { DOSJ: "GMI-JAKARTA", DOSB: "GMI-BPP" };
const DEFAULT_CABANG = "GMI-JAKARTA";
const PAYMENT_TERM = { 0: "Cash / COD", 7: "NET 7", 14: "NET 14", 30: "NET 30", 60: "NET 60" };
// kode pajak: T & P = PPN 11; DT = PPN 11 + PPh 23 (2%); kosong = tanpa pajak.
const TAX = {
  T: { ppn: 11, pphType: null, pphRate: 0 },
  P: { ppn: 11, pphType: null, pphRate: 0 },
  DT: { ppn: 11, pphType: "pph23", pphRate: 2 },
  "": { ppn: 0, pphType: null, pphRate: 0 },
};

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, Mei: 5, Jun: 6, Jul: 7, Agu: 8, Sep: 9, Okt: 10, Nov: 11, Des: 12 };
function ymd(s) {
  const [d, m, y] = String(s).trim().split(/\s+/);
  if (!MONTHS[m]) throw new Error(`Tanggal tidak dikenal: ${s}`);
  return `${y}-${String(MONTHS[m]).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const num = (v) => {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) throw new Error(`Angka tidak valid: ${v}`);
  return n;
};
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const clean = (v) => {
  const t = String(v ?? "").replace(/\r\n?/g, "\n").trim();
  return t === "" ? null : t;
};

const rows = XLSX.utils.sheet_to_json(XLSX.readFile(src).Sheets.Sheet1, { defval: null, raw: false });
rows.forEach((r, i) => (r._row = i + 2));

const byPo = new Map();
for (const r of rows) {
  const k = String(r["No. PO"]).trim();
  if (!byPo.has(k)) byPo.set(k, []);
  byPo.get(k).push(r);
}

const pos = [];
const items = [];
const stats = { mixedCabang: [], multiFaktur: 0, mixedTax: 0, itemMode: 0 };

for (const [poKode, rs] of byPo) {
  const h = rs[0];
  const vendor = clean(h["Nama Pemasok"]);
  const currency = AUD_VENDORS.includes(vendor) ? "AUD" : USD_VENDORS.includes(vendor) ? "USD" : "IDR";

  // Faktur (RI) unik, urut tanggal lalu nomor.
  const fakturs = new Map();
  for (const r of rs) {
    const no = clean(r["No. Faktur"]);
    if (!no) continue;
    fakturs.set(no, { no, date: ymd(r["Tgl Faktur"]), prefix: no.slice(0, 4).toUpperCase() });
  }
  const fakturList = [...fakturs.values()].sort((a, b) =>
    a.date === b.date ? a.no.localeCompare(b.no) : a.date.localeCompare(b.date),
  );
  if (fakturList.length > 1) stats.multiFaktur++;
  const prefixes = new Set(fakturList.map((f) => f.prefix));
  if (prefixes.size > 1) stats.mixedCabang.push(poKode);
  for (const f of fakturList) {
    if (!CABANG[f.prefix]) throw new Error(`Prefix faktur tak dikenal: ${f.no}`);
  }
  const lastFaktur = fakturList[fakturList.length - 1] || null;

  // Rekonstruksi baris PO: multiset maksimum per kunci antar grup faktur.
  const groups = new Map();
  for (const r of rs) {
    const g = clean(r["No. Faktur"]) || "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const keyOf = (r) =>
    [String(r["No. Barang"]).trim().toUpperCase(), num(r["Kuantitas"]), num(r["Harga satuan"]), num(r["Kts. Dikirim"])].join("|");
  const lineMap = new Map(); // key -> { count, sample, fakturs:Set }
  for (const [g, grs] of groups) {
    const cnt = new Map();
    for (const r of grs) {
      const k = keyOf(r);
      cnt.set(k, (cnt.get(k) || 0) + 1);
      if (!lineMap.has(k)) lineMap.set(k, { count: 0, sample: r, fakturs: new Set(), rows: [] });
      const l = lineMap.get(k);
      if (g) l.fakturs.add(g);
      l.rows.push(r._row);
    }
    for (const [k, c] of cnt) lineMap.get(k).count = Math.max(lineMap.get(k).count, c);
  }

  const lines = [];
  for (const l of lineMap.values()) {
    for (let i = 0; i < l.count; i++) lines.push(l);
  }
  lines.sort((a, b) => a.sample._row - b.sample._row);

  const taxCodes = new Set(lines.map((l) => String(l.sample["kode pajak"] || "").trim().toUpperCase()));
  for (const c of taxCodes) if (!(c in TAX)) throw new Error(`Kode pajak tak dikenal PO ${poKode}: ${c}`);
  const taxMode = taxCodes.size > 1 ? "item" : "document";
  if (taxCodes.size > 1) stats.mixedTax++;
  if (taxMode === "item") stats.itemMode++;
  const docTax = TAX[[...taxCodes][0] || ""];

  const keterangan = clean(h["Keterangan"]);
  const days = num(h["Net Days Syarat"]);
  pos.push({
    po_kode: poKode,
    po_tanggal: ymd(h["Tgl PO"]),
    vendor_name: vendor,
    currency,
    keterangan,
    payment_term: PAYMENT_TERM[days] ?? `NET ${days}`,
    harga_incl: String(h["Termasuk Pajak"]).trim() === "1",
    tax_mode: taxMode,
    ppn_rate: taxMode === "document" ? docTax.ppn : 0,
    pph_type: taxMode === "document" ? docTax.pphType : null,
    pph_rate: taxMode === "document" ? docTax.pphRate : 0,
    cabang: lastFaktur ? CABANG[lastFaktur.prefix] : DEFAULT_CABANG,
    ri_kode: lastFaktur ? lastFaktur.no : null,
    ri_tanggal: lastFaktur ? lastFaktur.date : null,
    ri_keterangan: lastFaktur
      ? `Import ERP (Data PO WMS). Faktur: ${fakturList.map((f) => f.no).join(", ")}`
      : null,
    excel_status: clean(h["Status"]),
  });

  lines.forEach((l, idx) => {
    const r = l.sample;
    const code = String(r["kode pajak"] || "").trim().toUpperCase();
    const t = TAX[code];
    const qty = num(r["Kuantitas"]);
    const kts = num(r["Kts. Dikirim"]);
    if (!Number.isInteger(qty) || !Number.isInteger(kts)) throw new Error(`Qty pecahan PO ${poKode} baris ${r._row}`);
    if (kts > qty) throw new Error(`Kts > qty PO ${poKode} baris ${r._row}`);
    // Gudang penerima baris = faktur terakhir yang memuat baris ini.
    const lf = fakturList.filter((f) => l.fakturs.has(f.no)).pop();
    const req = clean(r["No. Requisition"]);
    const prRefs = new Set();
    if (req) prRefs.add(req);
    for (const m of String(keterangan || "").match(/PR-GMI-\d+/gi) || []) prRefs.add(m.toUpperCase());
    items.push({
      po_kode: poKode,
      line_no: idx + 1,
      part_number: String(r["No. Barang"]).trim(),
      satuan: clean(r["satuan"]) || "UNIT",
      qty,
      harga: num(r["Harga satuan"]),
      kts,
      ppn_rate: taxMode === "item" ? t.ppn : 0,
      pph_type: taxMode === "item" ? t.pphType : null,
      pph_rate: taxMode === "item" ? t.pphRate : 0,
      cabang: lf ? CABANG[lf.prefix] : null,
      pr_ref: prRefs.size ? [...prRefs].join(", ") : null,
      excel_rows: [...new Set(l.rows)].join(","),
    });
  });
}

const totalKts = items.reduce((s, i) => s + i.kts, 0);
const today = new Date().toISOString().slice(0, 10);

let sql = `-- =====================================================================
-- IMPORT DATA PO WMS ("Data PO WMS.xlsx", export ERP; update lanjutan PO OST)
-- Generated: ${today}  |  ${pos.length} PO, ${items.length} baris item, total qty diterima ${totalKts}
-- Generator: supabase/import/generate_po_wms_import.cjs
--
-- Jalankan SEKALI di Supabase VPS (SQL Editor / psql), SETELAH migration:
--   20261021100000_po_item_tax.sql
--   20261021100200_receives_ri_is_import.sql
-- Aman dijalankan ulang: PO yang sudah ada diupdate, RI hanya dibuat untuk
-- selisih qty yang belum diterima di WMS (rerun -> selisih 0 -> tidak ada RI).
--
-- Aturan (keputusan user 2026-10-20/21):
--   - Semua PO diimport (termasuk yang sudah Diterima Penuh). File ini versi
--     terbaru dari PO OST: PO Outstanding yang sudah ada DIUPDATE (header,
--     qty, harga, vendor, pajak). Link item->PR yang sudah dibuat user dan
--     approvals yang sudah diisi moderator TIDAK disentuh. Lokasi PO hanya
--     diisi kalau masih kosong.
--   - PO bernomor sama yang BUKAN PO Outstanding (dibuat langsung di WMS)
--     di-skip & dilaporkan.
--   - PO baru: jenis 'reguler', po_is_outstanding = true, status 'open'
--     (menunggu approval), approvals kosong -> moderator terapkan jalur
--     approval. Lokasi = gudang faktur terakhir (DOSJ = GMI-JAKARTA,
--     DOSB = GMI-BPP), PO tanpa faktur = GMI-JAKARTA.
--   - Mata uang: JAS Oceania & Auto Electrical = AUD, vendor luar lain = USD,
--     vendor lokal = IDR.
--   - Pajak: T & P = PPN 11%; DT = PPN 11% + PPh 23 (2%); kosong = tanpa
--     pajak. Kode pajak seragam -> pajak per dokumen; campur -> pajak per item
--     (pos.po_tax_mode = 'item'). Termasuk Pajak 1 = harga sudah termasuk pajak.
--   - Harga 0 tetap diimport 0. Net Days Syarat Pemasok diabaikan.
--   - Barang & vendor yang belum ada dibuat otomatis (barang: nama = part
--     number, satuan dari Excel -- cek & lengkapi di halaman Barang;
--     vendor_no GMI-211026NN).
--   - RI: 1 RI per PO (kode & tanggal = faktur terakhir, semua nomor faktur
--     dicatat di keterangan), status completed tanpa approval, ri_is_import =
--     true. RI MENAMBAH stok gudang penerima (+ stock_movements type RI) tapi
--     TIDAK memenuhi MR.
--   - No. Requisition / PR di Keterangan disimpan sebagai referensi
--     (po_items.ost_pr_ref), link ke PR tetap manual di panel PO.
--
-- Hasil: query di akhir file menampilkan laporan (skip, barang/vendor baru,
-- item yang dipertahankan, selisih qty) -- simpan sebagai catatan.
-- =====================================================================

BEGIN;

DROP TABLE IF EXISTS pg_temp.wms_po;
DROP TABLE IF EXISTS pg_temp.wms_item;
DROP TABLE IF EXISTS pg_temp.wms_report;
DROP TABLE IF EXISTS pg_temp.wms_map;

CREATE TEMP TABLE wms_po (
  po_kode TEXT PRIMARY KEY,
  po_tanggal DATE NOT NULL,
  vendor_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  keterangan TEXT,
  payment_term TEXT,
  harga_incl BOOLEAN NOT NULL,
  tax_mode TEXT NOT NULL,
  ppn_rate NUMERIC NOT NULL,
  pph_type TEXT,
  pph_rate NUMERIC NOT NULL,
  cabang TEXT NOT NULL,
  ri_kode TEXT,
  ri_tanggal DATE,
  ri_keterangan TEXT,
  excel_status TEXT
);

CREATE TEMP TABLE wms_item (
  po_kode TEXT NOT NULL,
  line_no INT NOT NULL,
  part_number TEXT NOT NULL,
  satuan TEXT NOT NULL,
  qty INT NOT NULL,
  harga NUMERIC NOT NULL,
  kts INT NOT NULL,
  ppn_rate NUMERIC NOT NULL,
  pph_type TEXT,
  pph_rate NUMERIC NOT NULL,
  cabang TEXT,
  pr_ref TEXT,
  excel_rows TEXT,
  PRIMARY KEY (po_kode, line_no)
);

CREATE TEMP TABLE wms_report (
  po_kode TEXT,
  kategori TEXT NOT NULL,
  detail TEXT
);

-- po_item hasil sinkron per baris sumber.
CREATE TEMP TABLE wms_map (
  po_kode TEXT NOT NULL,
  line_no INT NOT NULL,
  po_id BIGINT NOT NULL,
  po_item_id BIGINT NOT NULL,
  PRIMARY KEY (po_kode, line_no)
);

`;

const chunk = (arr, n) => {
  const outArr = [];
  for (let i = 0; i < arr.length; i += n) outArr.push(arr.slice(i, i + n));
  return outArr;
};

for (const part of chunk(pos, 200)) {
  sql += `INSERT INTO wms_po (po_kode, po_tanggal, vendor_name, currency, keterangan, payment_term, harga_incl, tax_mode, ppn_rate, pph_type, pph_rate, cabang, ri_kode, ri_tanggal, ri_keterangan, excel_status) VALUES\n`;
  sql += part
    .map(
      (p) =>
        `  (${q(p.po_kode)}, DATE ${q(p.po_tanggal)}, ${q(p.vendor_name)}, ${q(p.currency)}, ${q(p.keterangan)}, ${q(p.payment_term)}, ${p.harga_incl}, ${q(p.tax_mode)}, ${p.ppn_rate}, ${q(p.pph_type)}, ${p.pph_rate}, ${q(p.cabang)}, ${q(p.ri_kode)}, ${p.ri_tanggal ? `DATE ${q(p.ri_tanggal)}` : "NULL"}, ${q(p.ri_keterangan)}, ${q(p.excel_status)})`,
    )
    .join(",\n");
  sql += ";\n\n";
}
for (const part of chunk(items, 300)) {
  sql += `INSERT INTO wms_item (po_kode, line_no, part_number, satuan, qty, harga, kts, ppn_rate, pph_type, pph_rate, cabang, pr_ref, excel_rows) VALUES\n`;
  sql += part
    .map(
      (i) =>
        `  (${q(i.po_kode)}, ${i.line_no}, ${q(i.part_number)}, ${q(i.satuan)}, ${i.qty}, ${i.harga}, ${i.kts}, ${i.ppn_rate}, ${q(i.pph_type)}, ${i.pph_rate}, ${q(i.cabang)}, ${q(i.pr_ref)}, ${q(i.excel_rows)})`,
    )
    .join(",\n");
  sql += ";\n\n";
}

sql += fs.readFileSync(path.join(__dirname, "po_wms_import_body.sqltpl"), "utf8");

fs.writeFileSync(out, sql);
console.log(
  JSON.stringify(
    {
      out,
      pos: pos.length,
      items: items.length,
      totalKts,
      multiFaktur: stats.multiFaktur,
      mixedTaxPo: stats.mixedTax,
      mixedCabangPo: stats.mixedCabang,
      currency: pos.reduce((m, p) => ((m[p.currency] = (m[p.currency] || 0) + 1), m), {}),
      taxMode: pos.reduce((m, p) => ((m[p.tax_mode] = (m[p.tax_mode] || 0) + 1), m), {}),
      cabang: pos.reduce((m, p) => ((m[p.cabang] = (m[p.cabang] || 0) + 1), m), {}),
      withRi: pos.filter((p) => p.ri_kode).length,
    },
    null,
    2,
  ),
);
