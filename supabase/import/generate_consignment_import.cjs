// Generator SQL import Consignment Petrosea dari "Data Cosigment Petrosea.xlsx"
// (sheet "Consign", monitoring marketing + warehouse: 1 baris = 1 barang SO
// Consignment + jejak IK ERP-nya):
//   supabase/import/consignment_dryrun.sql  -- simulasi read-only, jalankan dulu
//   supabase/import/consignment_import.sql  -- menulis data
//   supabase/import/consignment_verify.sql  -- cek pasca import (read-only)
//
//   node supabase/import/generate_consignment_import.cjs "Import 23 Oktober/Consignment Petrosea/Data Cosigment Petrosea.xlsx" [--pic=email] [--stok-sejak=YYYY-MM-DD]
//
// --pic        = email user (profiles) yang dicatat sebagai pembuat SO & IK
//                import. Kosong = created_by NULL.
// --stok-sejak = IK bertanggal sebelum ini TIDAK memotong stok (cuma dicatat).
//                Kosong = semua IK memotong stok (keputusan user 2026-10-24).
//
// Aturan (keputusan user 2026-10-24): semua SO diimport (termasuk yang sudah
// terkirim penuh) + IK ERP-nya sebagai IK import (ik_is_import) ke site
// customer SO; IK memotong stok gudang asal (boleh minus); tanpa Penerimaan.

const path = require("path");
const fs = require("fs");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--")) || "Import 23 Oktober/Consignment Petrosea/Data Cosigment Petrosea.xlsx";
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3) || null;
const picEmail = opt("pic");
const stokSejak = opt("stok-sejak");
if (stokSejak && !/^\d{4}-\d{2}-\d{2}$/.test(stokSejak)) throw new Error(`--stok-sejak harus YYYY-MM-DD: ${stokSejak}`);

const SHEET = "Consign";
const outDryrun = path.join(__dirname, "consignment_dryrun.sql");
const outImport = path.join(__dirname, "consignment_import.sql");
const outVerify = path.join(__dirname, "consignment_verify.sql");

// Nama customer di Excel (huruf besar/kecil diabaikan) -> customers.customer_no.
// Petrosea punya 4 akun aktif bernama mirip; marketing memakai "59 PETROSEA BP
// (IDR)" untuk semua SO Consignment Petrosea di prod.
const CUSTOMER_MAP = {
  "PT. PETROSEA TBK": "59 PETROSEA BP (IDR)",
};

// Kode site Excel -> nama customer_sites persis. Tanpa entri di sini, site
// dicocokkan lewat kata pertama nama site ("PSF" -> "PSF (BALIKPAPAN)",
// "(IBP)" -> "IBP (TABANG)", "BC Project" -> "BC (KALTENG)").
const SITE_MAP = {};

// Gudang asal Excel -> cabang.nama_cabang (HO = GMI-JAKARTA). Kosong -> default.
const GUDANG_MAP = { "GMI-HO": "GMI-JAKARTA", "GMI-BPP": "GMI-BPP" };
const GUDANG_DEFAULT = "GMI-BPP";

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
const ymd = (y, m, dd) => {
  const dt = new Date(Date.UTC(y, m - 1, dd));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== dd) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};
function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? ymd(p.y, p.m, p.d) : null;
  }
  const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  return m ? ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1])) : null;
}
const mostCommon = (arr) => {
  const m = new Map();
  for (const v of arr) if (v !== null && v !== undefined) m.set(v, (m.get(v) || 0) + 1);
  // Seri -> nilai terkecil (tanggal paling awal).
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
};
const distinct = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined))];
const minOf = (arr) => arr.filter(Boolean).sort()[0] || null;
// "eA" / "ROll" -> "Ea" / "Roll" (sama dengan import SO Reguler); "rol" = Roll.
const UOM_ALIAS = { ROL: "Roll" };
const normUom = (u) => {
  if (!u || !/^[A-Za-z]+$/.test(u)) return null;
  return UOM_ALIAS[K(u)] || u[0].toUpperCase() + u.slice(1).toLowerCase();
};

// ---------------------------------------------------------------------
// Baca sheet
// ---------------------------------------------------------------------
const wb = XLSX.readFile(src, { cellFormula: true });
const ws = wb.Sheets[SHEET];
if (!ws) throw new Error(`Sheet "${SHEET}" tidak ada`);
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
const hi = rows.findIndex((r) => r.some((c) => clean(c) === "No. SO"));
if (hi < 0) throw new Error(`Header "No. SO" tidak ditemukan`);
const header = rows[hi].map((c) => (clean(c) || "").replace(/\s+/g, " "));
const col = (label) => {
  const i = header.indexOf(label);
  if (i < 0) throw new Error(`Kolom "${label}" tidak ditemukan`);
  return i;
};
const C = {
  marketing: col("Marketing"),
  tgl_input: col("Tgl Input SO"),
  so: col("No. SO"),
  tgl_email: col("Tgl Email PO dari marketing"),
  tgl_po: col("Tgl PO Customer"),
  due: col("Due Date"),
  po_no: col("No. PO"),
  customer: col("Customer"),
  pn_cust: col("PN PTRO"),
  part: col("PN GMI"),
  part_name: col("Deskripsi Barang"),
  qty: col("Qty"),
  tgl_kirim: col("tanggal kirim"),
  no_ik: col("NO DOKUMEN"),
  qty_kirim: col("QTY KIRIM"),
};
// Kolom tanpa judul: UoM & site persis sesudah Qty; PIC & gudang asal persis
// sesudah QTY KIRIM.
C.uom = C.qty + 1;
C.site = C.qty + 2;
C.pic_kirim = C.qty_kirim + 1;
C.gudang = C.qty_kirim + 2;
const cellAt = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];

const report = []; // [kategori, ref, detail]
const lines = [];
rows.slice(hi + 1).forEach((r, i) => {
  const so = clean(r[C.so]);
  if (!so) return;
  const ri = hi + 1 + i; // index baris 0-based
  const g = (k) => clean(r[C[k]]);
  // No IK bisa angka desimal "33024.33636" (2 IK) -> pakai teks tampilan sel.
  const ikCell = cellAt(ri, C.no_ik);
  const ikText = ikCell ? clean(typeof ikCell.v === "number" && !Number.isInteger(ikCell.v) ? ikCell.w ?? ikCell.v : ikCell.v) : null;
  const kirimCell = cellAt(ri, C.qty_kirim);
  lines.push({
    excel_row: ri + 1,
    so_no: so,
    marketing: g("marketing"),
    tgl_input: toDate(r[C.tgl_input]),
    tgl_email: toDate(r[C.tgl_email]),
    tgl_po: toDate(r[C.tgl_po]),
    due: toDate(r[C.due]),
    po_no: g("po_no"),
    customer: g("customer"),
    pn_cust: g("pn_cust"),
    part_number: g("part"),
    part_name: g("part_name"),
    qty_raw: r[C.qty],
    uom: g("uom"),
    site: g("site"),
    tgl_kirim: toDate(r[C.tgl_kirim]),
    tgl_kirim_raw: g("tgl_kirim"),
    ik_text: ikText,
    qty_kirim_raw: r[C.qty_kirim],
    qty_kirim_formula: kirimCell?.f || null,
    pic_kirim: g("pic_kirim"),
    gudang: g("gudang"),
  });
});

// ---------------------------------------------------------------------
// SO + barang SO (1 baris Excel = 1 barang; part dobel dalam 1 SO TIDAK
// digabung -- tiap baris punya IK sendiri, dan SO Consignment tidak menolak
// part dobel)
// ---------------------------------------------------------------------
const groups = new Map();
for (const l of lines) {
  const key = K(l.so_no);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(l);
}

const docs = [];
const itemByRow = new Map();
for (const [key, ls] of groups) {
  const soNo = ls[0].so_no;
  if (!/^[A-Z0-9][A-Z0-9./-]*$/.test(key)) {
    report.push(["SKIP SO: No SO tidak valid", soNo, `baris ${ls.map((l) => l.excel_row).join(", ")}`]);
    continue;
  }
  const fields = { customer: "Customer", po_no: "No. PO", site: "Site", tgl_input: "Tgl Input SO", tgl_email: "Tgl Email PO", tgl_po: "Tgl PO Customer", due: "Due Date" };
  for (const [k, label] of Object.entries(fields)) {
    const vals = distinct(ls.map((l) => l[k]));
    if (vals.length > 1) report.push(["Header SO beda antar baris (dipakai yang terbanyak / gabungan No PO)", soNo, `${label}: ${vals.join(" | ")}`]);
  }
  const doc = {
    key,
    so_no: soNo,
    so_tanggal_input: minOf(ls.map((l) => l.tgl_input)) || minOf(ls.map((l) => l.tgl_email)) || minOf(ls.map((l) => l.tgl_po)),
    tgl_po_email_marketing: mostCommon(ls.map((l) => l.tgl_email)),
    tgl_po_customer: mostCommon(ls.map((l) => l.tgl_po)),
    due_date: mostCommon(ls.map((l) => l.due)),
    no_po: distinct(ls.map((l) => l.po_no)).join(" / ") || null,
    customer: mostCommon(ls.map((l) => l.customer)),
    site: mostCommon(ls.map((l) => l.site)),
    items: [],
  };
  if (!doc.so_tanggal_input) {
    report.push(["SKIP SO: tanggal input SO / PO tidak ada", soNo, null]);
    continue;
  }
  if (!doc.customer) {
    report.push(["SKIP SO: customer kosong", soNo, null]);
    continue;
  }
  for (const l of ls) {
    const qty = typeof l.qty_raw === "number" ? l.qty_raw : Number(String(l.qty_raw ?? "").replace(/,/g, "").trim());
    if (!Number.isInteger(qty) || qty <= 0) {
      report.push(["SKIP barang: qty tidak valid", soNo, `${l.part_number} baris ${l.excel_row} qty "${l.qty_raw}"`]);
      continue;
    }
    if (!l.part_number || l.part_number.length < 3) {
      report.push(["SKIP barang: PN GMI tidak valid", soNo, `"${l.part_number}" baris ${l.excel_row}`]);
      continue;
    }
    if (!l.pn_cust) report.push(["PN Customer (PN PTRO) kosong", soNo, `${l.part_number} baris ${l.excel_row}`]);
    const it = {
      line_no: doc.items.length + 1,
      excel_row: l.excel_row,
      part_number: l.part_number,
      part_name: l.part_name,
      satuan: normUom(l.uom),
      pn_cust: l.pn_cust,
      qty,
      line: l,
      doc,
    };
    if (l.uom && !it.satuan) report.push(["Satuan Excel tidak terbaca (pakai satuan master)", soNo, `${l.part_number} "${l.uom}"`]);
    doc.items.push(it);
    itemByRow.set(l.excel_row, it);
  }
  if (doc.items.length === 0) {
    report.push(["SKIP SO: tidak ada barang valid", soNo, null]);
    continue;
  }
  const parts = new Map();
  for (const it of doc.items) parts.set(K(it.part_number), (parts.get(K(it.part_number)) || 0) + 1);
  for (const [pk, n] of parts) if (n > 1) report.push(["Barang dobel di 1 SO (tetap baris terpisah, sesuai Excel)", soNo, `${pk} x${n}`]);
  docs.push(doc);
}

// ---------------------------------------------------------------------
// IK: kolom NO DOKUMEN bisa berisi >1 nomor IK ("34874, 35054", "33024.33636")
// -> qty dipecah sesuai rumus QTY KIRIM ("=211+389"). 1 IK ERP bisa mencakup
// beberapa SO -> di WMS 1 IK per SO (kode "<no IK>/<no SO>").
// ---------------------------------------------------------------------
const shipParts = []; // { ik_no | null, it, qty, date, gudang, pic }
for (const doc of docs) {
  for (const it of doc.items) {
    const l = it.line;
    const kirim = typeof l.qty_kirim_raw === "number" ? l.qty_kirim_raw : Number(clean(l.qty_kirim_raw) ?? 0);
    if (!kirim) {
      if (l.ik_text || l.tgl_kirim) report.push(["No IK / tgl kirim ada tapi QTY KIRIM kosong (dianggap belum kirim)", doc.so_no, `${it.part_number} baris ${it.excel_row} IK ${l.ik_text ?? "-"}`]);
      continue;
    }
    if (!Number.isInteger(kirim) || kirim < 0) {
      report.push(["QTY KIRIM tidak valid (dianggap belum kirim)", doc.so_no, `${it.part_number} baris ${it.excel_row} "${l.qty_kirim_raw}"`]);
      continue;
    }
    if (kirim > it.qty) report.push(["QTY KIRIM melebihi qty SO (IK tetap sesuai Excel)", doc.so_no, `${it.part_number} baris ${it.excel_row}: kirim ${kirim} > SO ${it.qty} (IK ${l.ik_text ?? "-"})`]);
    const gudangX = l.gudang ? K(l.gudang) : null;
    const gudang = gudangX ? GUDANG_MAP[gudangX] : GUDANG_DEFAULT;
    if (!gudang) throw new Error(`Gudang "${l.gudang}" belum ada di GUDANG_MAP (baris ${it.excel_row})`);
    if (!gudangX) report.push([`Gudang asal kosong -> ${GUDANG_DEFAULT}`, doc.so_no, `${it.part_number} baris ${it.excel_row} IK ${l.ik_text ?? "-"}`]);
    const tokens = (l.ik_text || "").replace(/^\s*IK\s*/i, "").split(/[\s,.;/&]+/).filter(Boolean);
    const bad = tokens.filter((t) => !/^\d{5,6}$/.test(t));
    if (bad.length) report.push(["No IK tidak terbaca (baris dianggap terkirim tanpa no IK)", doc.so_no, `${it.part_number} baris ${it.excel_row} "${l.ik_text}"`]);
    const ikNos = bad.length ? [] : tokens;
    // Nomor IK ERP Jul-Okt 2026 = 3xxxx; di luar itu kemungkinan salah ketik.
    for (const t of ikNos.filter((x) => !/^3\d{4}$/.test(x))) report.push(["No IK di luar pola 3xxxx (kemungkinan salah ketik, tetap dipakai apa adanya)", t, `${doc.so_no} ${it.part_number} baris ${it.excel_row}`]);
    const base = { it, date: l.tgl_kirim, gudang, pic: l.pic_kirim };
    if (ikNos.length <= 1) {
      shipParts.push({ ...base, ik_no: ikNos[0] || null, qty: kirim });
      continue;
    }
    const terms = (l.qty_kirim_formula || "").replace(/^=/, "").split("+").map((t) => Number(t.trim()));
    if (terms.length === ikNos.length && terms.every((t) => Number.isInteger(t) && t > 0) && terms.reduce((a, b) => a + b, 0) === kirim) {
      ikNos.forEach((no, i) => shipParts.push({ ...base, ik_no: no, qty: terms[i], split: `${l.qty_kirim_formula}` }));
      report.push(["1 baris Excel berisi >1 no IK -> qty dipecah sesuai rumus QTY KIRIM", doc.so_no, `${it.part_number} baris ${it.excel_row}: ${ikNos.map((no, i) => `${no}=${terms[i]}`).join(", ")}`]);
    } else {
      shipParts.push({ ...base, ik_no: ikNos[0], qty: kirim });
      report.push(["1 baris Excel berisi >1 no IK, qty tidak bisa dipecah -> semua ke IK pertama", doc.so_no, `${it.part_number} baris ${it.excel_row} "${l.ik_text}" qty ${kirim}${l.qty_kirim_formula ? ` (=${l.qty_kirim_formula})` : ""}`]);
    }
  }
}

// Tanggal & gudang per nomor IK ERP (dipakai semua SO di IK itu).
const ikNoAttr = new Map();
for (const p of shipParts.filter((x) => x.ik_no)) {
  const a = ikNoAttr.get(p.ik_no) || { dates: [], gudang: [], so: new Set() };
  if (p.date) a.dates.push(p.date);
  a.gudang.push(p.gudang);
  a.so.add(p.it.doc.key);
  ikNoAttr.set(p.ik_no, a);
}
for (const [no, a] of ikNoAttr) {
  a.date = mostCommon(a.dates);
  a.gudangPick = mostCommon(a.gudang);
  if (distinct(a.dates).length > 1) report.push(["No IK yang sama punya >1 tanggal kirim (dipakai yang terbanyak / paling awal)", no, `${distinct(a.dates).join(" | ")} -> ${a.date}`]);
  if (distinct(a.gudang).length > 1) report.push(["No IK yang sama punya >1 gudang asal (dipakai yang terbanyak)", no, `${distinct(a.gudang).join(" | ")} -> ${a.gudangPick}`]);
}

const iks = new Map(); // ik_key -> ik
for (const p of shipParts) {
  const doc = p.it.doc;
  let ikKey, ik;
  if (p.ik_no) {
    const a = ikNoAttr.get(p.ik_no);
    ikKey = `${p.ik_no}|${doc.key}`;
    ik = iks.get(ikKey) || {
      key: ikKey,
      ik_no: p.ik_no,
      kode: a.so.size > 1 ? `${p.ik_no}/${doc.so_no}` : p.ik_no,
      doc,
      tanggal: a.date,
      gudang: a.gudangPick,
      items: [],
      pics: [],
    };
  } else {
    // Terkirim tanpa no IK: 1 IK per SO + gudang + tanggal.
    ikKey = `TANPA-NO|${doc.key}|${p.gudang}|${p.date || ""}`;
    ik = iks.get(ikKey) || { key: ikKey, ik_no: null, doc, tanggal: p.date, gudang: p.gudang, items: [], pics: [] };
  }
  if (p.pic) ik.pics.push(p.pic);
  ik.items.push(p);
  iks.set(ikKey, ik);
}
// Kode IK tanpa nomor: TANPA-NO-<SO>[-2..].
const tanpaPerSo = new Map();
for (const ik of iks.values()) {
  if (ik.ik_no) continue;
  const n = (tanpaPerSo.get(ik.doc.key) || 0) + 1;
  tanpaPerSo.set(ik.doc.key, n);
  ik.kode = `TANPA-NO-${ik.doc.so_no}${n > 1 ? `-${n}` : ""}`;
  report.push(["Terkirim tanpa no IK di Excel -> IK " + "TANPA-NO-<SO>", ik.kode, ik.items.map((p) => `${p.it.part_number} ${p.qty} (baris ${p.it.excel_row})`).join(", ")]);
}
for (const ik of iks.values()) {
  if (!ik.tanggal) {
    ik.tanggal = ik.doc.so_tanggal_input;
    report.push(["Tanggal kirim kosong -> tgl IK = tgl input SO", ik.kode, ik.tanggal]);
  }
  if (ik.ik_no && ikNoAttr.get(ik.ik_no).so.size > 1) {
    report.push(["1 IK ERP mencakup >1 SO -> dipecah 1 IK per SO", ik.ik_no, `${ik.kode}: ${ik.items.map((p) => `${p.it.part_number} ${p.qty}`).join(", ")}`]);
  }
  const pics = distinct(ik.pics);
  const rowsTxt = distinct(ik.items.map((p) => p.it.excel_row)).join(", ");
  const splitTxt = distinct(ik.items.filter((p) => p.split).map((p) => `${p.it.part_number} =${p.split}`)).join("; ");
  ik.remarks = [
    `Import ${path.basename(src)} (riwayat IK ERP)`,
    ik.ik_no ? `No IK ERP ${ik.ik_no}` : "No IK kosong di Excel",
    pics.length ? `PIC kirim: ${pics.join(", ")}` : null,
    `baris Excel ${rowsTxt}`,
    splitTxt ? `qty dipecah dari rumus ${splitTxt}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}
const ikList = [...iks.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.kode.localeCompare(b.kode));
const dupKode = ikList.map((x) => K(x.kode)).filter((k, i, arr) => arr.indexOf(k) !== i);
if (dupKode.length) throw new Error(`Kode IK dobel: ${dupKode.join(", ")}`);

// ---------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------
const items = docs.flatMap((doc) => doc.items);
const ikItems = ikList.flatMap((ik) => ik.items.map((p) => ({ ik, p })));
const today = new Date().toISOString().slice(0, 10);
const stat = {
  so: docs.length,
  barang: items.length,
  qty: items.reduce((a, x) => a + x.qty, 0),
  ik: ikList.length,
  ikItem: ikItems.length,
  qtyKirim: ikItems.reduce((a, x) => a + x.p.qty, 0),
};

const dataDdl = `DROP TABLE IF EXISTS pg_temp.x_cfg;
DROP TABLE IF EXISTS pg_temp.x_cust_map;
DROP TABLE IF EXISTS pg_temp.x_site_map;
DROP TABLE IF EXISTS pg_temp.x_so;
DROP TABLE IF EXISTS pg_temp.x_so_item;
DROP TABLE IF EXISTS pg_temp.x_ik;
DROP TABLE IF EXISTS pg_temp.x_ik_item;

CREATE TEMP TABLE x_cfg (key TEXT PRIMARY KEY, value TEXT);
CREATE TEMP TABLE x_cust_map (customer_name TEXT PRIMARY KEY, customer_no TEXT NOT NULL);
CREATE TEMP TABLE x_site_map (site_code TEXT PRIMARY KEY, site_name TEXT NOT NULL);

CREATE TEMP TABLE x_so (
  so_key TEXT PRIMARY KEY,
  so_no TEXT NOT NULL,
  so_tanggal_input DATE NOT NULL,
  tgl_po_email_marketing DATE,
  tgl_po_customer DATE,
  due_date DATE,
  no_po TEXT,
  customer_name TEXT NOT NULL,
  site_code TEXT
);

CREATE TEMP TABLE x_so_item (
  excel_row INT PRIMARY KEY,
  so_key TEXT NOT NULL,
  line_no INT NOT NULL,
  part_number TEXT NOT NULL,
  part_name TEXT,
  satuan TEXT,
  part_number_customer TEXT,
  qty INT NOT NULL
);

CREATE TEMP TABLE x_ik (
  ik_key TEXT PRIMARY KEY,
  ik_kode TEXT NOT NULL UNIQUE,
  so_key TEXT NOT NULL,
  ik_tanggal DATE NOT NULL,
  gudang TEXT NOT NULL,
  remarks TEXT
);

CREATE TEMP TABLE x_ik_item (
  ik_key TEXT NOT NULL,
  excel_row INT NOT NULL,
  qty INT NOT NULL CHECK (qty > 0),
  PRIMARY KEY (ik_key, excel_row)
);

`;

let dataIns = `INSERT INTO x_cfg (key, value) VALUES
  ('pic_email', ${q(picEmail)}),
  ('stok_sejak', ${q(stokSejak)}),
  ('sumber', ${q(path.basename(src))});

`;
const mapRows = Object.entries(CUSTOMER_MAP);
if (mapRows.length) {
  dataIns += "INSERT INTO x_cust_map (customer_name, customer_no) VALUES\n";
  dataIns += mapRows.map(([n, no]) => `  (${q(K(n))}, ${q(no)})`).join(",\n") + ";\n\n";
}
const siteRows = Object.entries(SITE_MAP);
if (siteRows.length) {
  dataIns += "INSERT INTO x_site_map (site_code, site_name) VALUES\n";
  dataIns += siteRows.map(([c, n]) => `  (${q(K(c))}, ${q(n)})`).join(",\n") + ";\n\n";
}
for (const part of chunk(docs, 300)) {
  dataIns += "INSERT INTO x_so (so_key, so_no, so_tanggal_input, tgl_po_email_marketing, tgl_po_customer, due_date, no_po, customer_name, site_code) VALUES\n";
  dataIns += part
    .map((x) => `  (${q(x.key)}, ${q(x.so_no)}, ${d(x.so_tanggal_input)}, ${d(x.tgl_po_email_marketing)}, ${d(x.tgl_po_customer)}, ${d(x.due_date)}, ${q(x.no_po)}, ${q(x.customer)}, ${q(x.site)})`)
    .join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(items, 300)) {
  dataIns += "INSERT INTO x_so_item (excel_row, so_key, line_no, part_number, part_name, satuan, part_number_customer, qty) VALUES\n";
  dataIns += part
    .map((it) => `  (${it.excel_row}, ${q(it.doc.key)}, ${it.line_no}, ${q(it.part_number)}, ${q(it.part_name)}, ${q(it.satuan)}, ${q(it.pn_cust)}, ${it.qty})`)
    .join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(ikList, 300)) {
  dataIns += "INSERT INTO x_ik (ik_key, ik_kode, so_key, ik_tanggal, gudang, remarks) VALUES\n";
  dataIns += part.map((ik) => `  (${q(ik.key)}, ${q(ik.kode)}, ${q(ik.doc.key)}, ${d(ik.tanggal)}, ${q(ik.gudang)}, ${q(ik.remarks)})`).join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(ikItems, 400)) {
  dataIns += "INSERT INTO x_ik_item (ik_key, excel_row, qty) VALUES\n";
  dataIns += part.map(({ ik, p }) => `  (${q(ik.key)}, ${p.it.excel_row}, ${p.qty})`).join(",\n");
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
--   - Semua SO di sheet diimport (termasuk yang sudah terkirim penuh) +
--     IK ERP-nya sebagai riwayat. SO yang kodenya sudah ada di prod di-skip
--     beserta IK-nya (aman dijalankan ulang).
--   - 1 baris Excel = 1 barang SO (part dobel tidak digabung). PN Customer =
--     PN PTRO, satuan = UoM Excel.
--   - IK: tujuan = site customer SO (customer_sites); gudang asal GMI-BPP /
--     GMI-HO (= GMI-JAKARTA), kosong = GMI-BPP. 1 nomor IK ERP = 1 IK per SO
--     (kode = nomor IK, "<no IK>/<no SO>" kalau IK ERP mencakup >1 SO).
--     Sel berisi >1 nomor IK dipecah sesuai rumus QTY KIRIM; terkirim tanpa
--     nomor IK -> IK "TANPA-NO-<SO>".
--   - IK MEMOTONG stok gudang asal (boleh minus; stock_movements type IK)${stokSejak ? `, kecuali IK bertanggal sebelum ${stokSejak} (cuma dicatat)` : ""}.
--   - IK import (ik_is_import) tidak perlu Penerimaan; customer_stock tidak
--     diisi.
--   - Customer lewat CUSTOMER_MAP (Petrosea = 59 PETROSEA BP (IDR)); site
--     dicocokkan ke customer_sites customer itu (kata pertama nama site), tidak
--     ketemu -> site teks Excel tanpa site_id (dilaporkan).
--   - Barang yang belum ada di master dibuat otomatis (nama = Deskripsi Excel).
`;

const readTpl = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const plan = readTpl("consignment_plan_body.sqltpl");
const summary = `${stat.so} SO / ${stat.barang} barang / ${stat.ik} IK (${stat.ikItem} baris, qty ${stat.qtyKirim})`;

fs.writeFileSync(
  outDryrun,
  `-- =====================================================================
-- DRY-RUN IMPORT CONSIGNMENT (READ-ONLY) -- simulasi consignment_import.sql
-- Generated: ${today}  |  sumber: ${path.basename(src)}  |  ${summary}
-- Generator: supabase/import/generate_consignment_import.cjs
--
-- Jalankan seluruh isi file SEBELUM consignment_import.sql. Aturan skip /
-- pencocokan sama persis dengan import, tapi hanya di temp table.
${rules}-- =====================================================================

` + xReport + data + reportSql + plan + readTpl("consignment_dryrun_body.sqltpl"),
);

fs.writeFileSync(
  outImport,
  `-- =====================================================================
-- IMPORT CONSIGNMENT ("${path.basename(src)}", sheet ${SHEET})
-- Generated: ${today}  |  ${summary}
-- Generator: supabase/import/generate_consignment_import.cjs
--
-- Jalankan SEKALI di Supabase VPS (SQL Editor, seluruh isi file), SETELAH
-- migration 20261024110000_consignment_ik_site_tujuan.sql DAN kode IK baru
-- ter-deploy. Cek dulu lewat consignment_dryrun.sql. Aman dijalankan ulang:
-- SO yang kodenya sudah ada di-skip (stok tidak dipotong dua kali).
${rules}-- =====================================================================

BEGIN;

` + xReport + data + reportSql + plan + readTpl("consignment_import_body.sqltpl"),
);

fs.writeFileSync(
  outVerify,
  `-- =====================================================================
-- VERIFIKASI IMPORT CONSIGNMENT (pasca import, READ-ONLY)
-- Generated: ${today}  |  sumber: ${path.basename(src)}  |  ${summary}
-- Generator: supabase/import/generate_consignment_import.cjs
--
-- Jalankan SETELAH consignment_import.sql (Excel & opsi generator harus sama
-- dengan saat generate import). Hanya temp table. FAIL = import tidak sesuai
-- Excel; WARN = perlu dicek; INFO = catatan.
-- =====================================================================

` + data + readTpl("consignment_verify_body.sqltpl"),
);

console.log(JSON.stringify({ outDryrun, outImport, outVerify, picEmail, stokSejak, ...stat, reportRows: report.length }, null, 2));
