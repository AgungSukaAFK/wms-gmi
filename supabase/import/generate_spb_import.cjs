// Generator SQL import riwayat SPB dari "SPB MONITORING <site> 2026.xlsx"
// (folder Import 23 Oktober/SPB, 1 file per site, sheet per bulan). Semua SPB
// 2026 masuk lengkap dengan SPB-PO / SPB-DO / Invoice / status payment; SPB
// yang sudah ada di WMS (dibuat lewat form) tidak diubah, cuma dilengkapi
// turunannya. Keluaran:
//   supabase/import/spb_dryrun.sql   -- simulasi read-only (psql, 1 file)
//   supabase/import/spb_import.sql   -- menulis data (psql, 1 file)
//   supabase/import/spb_verify.sql   -- cek pasca import (read-only, psql)
//   supabase/import/spb_studio_*.sql -- versi SQL Editor: staging dipecah
//                                       <=400 KB, lalu dry-run/import/verify
//
//   node supabase/import/generate_spb_import.cjs ["Import 23 Oktober/SPB"] [--do-erp=<xls>] [--stok-sejak=2026-07-29] [--pic=email]
//
// --do-erp     = export ERP "Histori Pesanan Penjualan" (dipakai melengkapi
//                No DO yang kosong lewat No SO + part). Default file DO
//                Import 23 Oktober.
// --stok-sejak = SPB baru (belum ada di WMS) bertanggal >= ini memotong stok
//                gudang site (boleh minus); sebelum itu riwayat saja.
// --pic        = email user pembuat SPB import. Kosong = created_by NULL.

const path = require("path");
const fs = require("fs");
const XLSX = require(path.join(__dirname, "../../node_modules/xlsx"));
const { readSpbFolder } = require(path.join(__dirname, "spb_excel.cjs"));

const ROOT = path.join(__dirname, "../..");
const args = process.argv.slice(2);
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || "").slice(name.length + 3) || null;
const srcDir = path.resolve(ROOT, args.find((a) => !a.startsWith("--")) || "Import 23 Oktober/SPB");
const doErpFile = path.resolve(ROOT, opt("do-erp") || "Import 23 Oktober/DO/DO WMS 300726-161026.xls");
const stokSejak = opt("stok-sejak") || "2026-07-29";
const picEmail = opt("pic");
const TODAY = new Date().toISOString().slice(0, 10);

// File (site) -> gudang WMS (cabang.nama_cabang). Prefix No SPB di prod:
// GMIAMMDMP=DIZA, GMIAMMIPT=IPT, GMIAMM=MIFA, GMIAMMSBS=TAL, GMIAMI=AMI,
// GMITJE=BA, GMIBIB=BIB, GMILHT=MIP, GMIUT=LKP (UT Manado).
const SITE_GUDANG = {
  "AMM DIZA": "GMI-DIZA",
  "AMM IPT": "GMI-IPT",
  "AMM MIFA": "GMI-MIFA",
  "AMM TAL": "GMI-TAL",
  "PPA AMI": "GMI-AMI",
  "PPA BA": "GMI-BA",
  "PPA BIB": "GMI-BIB",
  "PPA MIP": "GMI-MIP",
  "UT MANADO": "GMI-LKP",
};
const SITE_SHORT = {
  "AMM DIZA": "DIZA", "AMM IPT": "IPT", "AMM MIFA": "MIFA", "AMM TAL": "TAL", "PPA AMI": "AMI",
  "PPA BA": "BA", "PPA BIB": "BIB", "PPA MIP": "MIP", "UT MANADO": "UT",
};

const K = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const d = (v) => (v ? q(v) : "NULL");
const b = (v) => (v ? "true" : "false");
const n = (v) => (v === null || v === undefined || Number.isNaN(v) ? "NULL" : String(v));
const chunk = (arr, size) => {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
};
const addDays = (s, days) => {
  const dt = new Date(`${s}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

const report = []; // [kategori, ref, detail]
const rep = (k, r, dt) => report.push([k, r ?? null, dt ?? null]);

// ---------------------------------------------------------------------
// 1. Baca Excel SPB
// ---------------------------------------------------------------------
const { rows: rawRows, issues } = readSpbFolder(srcDir);
for (const i of issues) rep(`Excel: ${i.kind}`, `${i.file} / ${i.sheet}`, i.detail);
for (const s of Object.keys(SITE_GUDANG)) {
  if (!rawRows.some((r) => r.site === s)) throw new Error(`File site ${s} tidak ditemukan di ${srcDir}`);
}
for (const s of new Set(rawRows.map((r) => r.site))) {
  if (!SITE_GUDANG[s]) throw new Error(`Site "${s}" belum dipetakan ke gudang (SITE_GUDANG)`);
}

const sheetOrder = new Map(); // file#sheet -> urutan baca
const refOf = (r) => `${SITE_SHORT[r.site]} ${r.sheet}:${r.excel_row}`;

const rows = [];
for (const r of rawRows) {
  const key = r.file + "#" + r.sheet;
  if (!sheetOrder.has(key)) sheetOrder.set(key, sheetOrder.size);
  if (!r.spb_no || /^(NO SPB|TRUE)$/i.test(r.spb_no) || /^(PART NUMBER|TRUE)$/i.test(r.part_number || "")) {
    rep("Excel: baris header/sampah dibuang", refOf(r), `${r.spb_no} / ${r.part_number}`);
    continue;
  }
  rows.push(r);
}

// SPB yang muncul di >1 sheet (akhir bulan tersalin ke sheet bulan berikutnya):
// ambil satu sheet saja -- yang progresnya paling lengkap, seri -> sheet terakhir.
const DOC_FIELDS = ["po_no", "so_no", "do_no", "inv_no", "status_payment"];
const bySpbSheet = new Map();
for (const r of rows) {
  const k = K(r.spb_no);
  if (!bySpbSheet.has(k)) bySpbSheet.set(k, new Map());
  const m = bySpbSheet.get(k);
  const sk = r.file + "#" + r.sheet;
  if (!m.has(sk)) m.set(sk, []);
  m.get(sk).push(r);
}
const keepSheet = new Map();
for (const [k, m] of bySpbSheet) {
  if (m.size === 1) {
    keepSheet.set(k, [...m.keys()][0]);
    continue;
  }
  const score = (list) => list.reduce((a, r) => a + DOC_FIELDS.filter((f) => r[f]).length, 0);
  const best = [...m.entries()].sort((x, y) => score(y[1]) - score(x[1]) || sheetOrder.get(y[0]) - sheetOrder.get(x[0]))[0][0];
  keepSheet.set(k, best);
  const [file] = best.split("#");
  rep(
    "SPB tercatat di >1 sheet -> dipakai 1 sheet",
    k,
    [...m.keys()].map((s) => s.split("#")[1] + (s === best ? " (dipakai)" : "")).join(", ") +
      (new Set([...m.keys()].map((s) => s.split("#")[0])).size > 1 ? ` | beda file! ${file}` : ""),
  );
}
const lines0 = rows.filter((r) => keepSheet.get(K(r.spb_no)) === r.file + "#" + r.sheet);

// ---------------------------------------------------------------------
// 2. Bersihkan nilai per baris
// ---------------------------------------------------------------------
const NO_VALUE = /^(WAITING|DONE|DONE QUOT|-|0|N\/A|NA|#N\/A|NULL)$/i;
const isCancelText = (v) => /\bCANCEL/i.test(String(v ?? ""));
const docVal = (v) => {
  const t = v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim();
  if (!t || NO_VALUE.test(t) || isCancelText(t)) return null;
  return t;
};
const cleanPn = (v) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/\s*-\s*/g, "-");

const DATE_COLS = ["tgl_so", "tgl_do", "tgl_inv", "tgl_email", "tgl_payment"];
for (const r of lines0) {
  r.ref = refOf(r);
  // Tahun salah ketik (SPB 2027 di sheet 2026).
  if (r.tgl_spb && r.tgl_spb > TODAY && r.tgl_spb.startsWith("2027")) {
    rep("Tanggal SPB tahun 2027 -> 2026", r.ref, `${r.spb_no} ${r.tgl_spb}`);
    r.tgl_spb = "2026" + r.tgl_spb.slice(4);
  }
  // Tanggal teks ambigu: pilih tafsiran yang tidak sebelum tanggal SPB.
  for (const f of DATE_COLS) {
    const alt = r._alt?.[f];
    if (alt && r[f] && r.tgl_spb && r[f] < addDays(r.tgl_spb, -3) && alt >= addDays(r.tgl_spb, -3)) {
      rep("Tanggal teks ambigu ditukar hari/bulan", r.ref, `${f} ${r[f]} -> ${alt} (SPB ${r.tgl_spb})`);
      r[f] = alt;
    }
  }
  for (const bad of r._bad_dates || []) {
    if (/^(tgl_so|tgl_do|tgl_inv|tgl_email|tgl_payment)=/.test(bad) && !/=(WAITING|DONE|CANCEL|0)$/i.test(bad)) {
      rep("Tanggal tidak terbaca -> dikosongkan", r.ref, `${r.spb_no} ${bad}`);
    }
  }
  r.cancel = [r.po_no, r.so_no, r.do_no, r.inv_no, r.status_wo, r.status_po].some(isCancelText);
  r.pn = cleanPn(r.part_number);
  if (r.pn !== String(r.part_number).trim()) rep("Part number dirapikan (spasi/simbol)", r.ref, `"${r.part_number}" -> ${r.pn}`);

  let qty = r.qty_num;
  if (!Number.isFinite(qty) && /^\d+[oO]$/.test(String(r.qty))) qty = Number(String(r.qty).replace(/[oO]/g, "0"));
  if (Number.isFinite(qty) && !Number.isInteger(qty)) {
    rep("Qty desimal -> dibulatkan", r.ref, `${r.spb_no} ${r.pn} ${r.qty} -> ${Math.round(qty)}`);
    qty = Math.round(qty);
  } else if (Number.isFinite(qty) && String(qty) !== String(r.qty)) {
    rep("Qty salah ketik -> dibetulkan", r.ref, `${r.spb_no} ${r.pn} "${r.qty}" -> ${qty}`);
  }
  r.qty_int = Number.isInteger(qty) && qty > 0 ? qty : null;

  r.po = docVal(r.po_no);
  if (r.po && /^NOTE\b/i.test(r.po)) {
    rep("No PO berisi catatan -> dikosongkan", r.ref, `${r.spb_no}: ${r.po}`);
    r.po = null;
  }
  r.so = docVal(r.so_no);
  r.do = docVal(r.do_no);
  if (r.do) r.do = r.do.replace(/^DO\.?\s*/i, "");
  r.do_src = r.do ? "X" : null;
  r.inv = docVal(r.inv_no);
  r.paid = K(r.status_payment) === "PAID" || !!r.tgl_payment;
}

// ---------------------------------------------------------------------
// 3. Lengkapi No DO kosong dari export DO ERP (No SO + part, hanya kalau 1 DO)
// ---------------------------------------------------------------------
const erpDate = (v) => {
  if (typeof v === "number") return XLSX.SSF.format("yyyy-mm-dd", v);
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
const erpBySoPart = new Map();
const erpByDo = new Map();
if (fs.existsSync(doErpFile)) {
  const wb = XLSX.readFile(doErpFile);
  let data = null;
  let hi = -1;
  for (const nm of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: null, raw: true });
    const h = r.findIndex((x) => x && x.some((c) => String(c ?? "").trim() === "No. DO"));
    if (h >= 0) {
      data = r;
      hi = h;
      break;
    }
  }
  if (!data) throw new Error(`Header "No. DO" tidak ada di ${doErpFile}`);
  const hdr = data[hi].map((c) => String(c ?? "").trim());
  const ci = (l) => {
    const i = hdr.indexOf(l);
    if (i < 0) throw new Error(`Kolom ${l} tidak ada di file DO ERP`);
    return i;
  };
  const C = { do: ci("No. DO"), so: ci("No. SO"), part: ci("No. Barang"), tgl: ci("Tgl DO") };
  for (const r of data.slice(hi + 1)) {
    if (!r || !r[C.do]) continue;
    const doNo = K(r[C.do]);
    const tgl = erpDate(r[C.tgl]);
    const k = K(r[C.so]) + "|" + K(cleanPn(r[C.part]));
    if (!erpBySoPart.has(k)) erpBySoPart.set(k, new Map());
    erpBySoPart.get(k).set(doNo, tgl);
    if (!erpByDo.has(doNo)) erpByDo.set(doNo, { tgl, so: K(r[C.so]) });
  }
} else {
  console.warn(`File DO ERP tidak ada (${doErpFile}) -- No DO kosong tidak dilengkapi.`);
}
for (const r of lines0) {
  if (r.cancel) continue;
  if (!r.do && r.so) {
    const m = erpBySoPart.get(K(r.so) + "|" + K(r.pn));
    if (m && m.size === 1) {
      const [doNo, tgl] = [...m.entries()][0];
      r.do = doNo;
      r.do_src = "E";
      if (!r.tgl_do) r.tgl_do = tgl;
      rep("No DO kosong dilengkapi dari DO ERP (No SO + part)", r.ref, `${r.spb_no} ${r.pn} SO ${r.so} -> DO ${doNo}`);
    }
  }
  if (r.do && !r.tgl_do && erpByDo.has(K(r.do))) r.tgl_do = erpByDo.get(K(r.do)).tgl;
  if (r.do && r.so && erpByDo.has(K(r.do)) && erpByDo.get(K(r.do)).so !== K(r.so)) {
    rep("No SO di Excel beda dengan DO ERP (info, dipakai versi Excel)", r.ref, `DO ${r.do}: SO Excel ${r.so} vs ERP ${erpByDo.get(K(r.do)).so}`);
  }
  // Penanda untuk turunan yang lompat tahap (WMS butuh rantai PO -> DO -> Invoice).
  if (r.inv && !r.do) {
    r.do = `TANPA-DO-${r.so || r.inv}`;
    r.do_src = "P";
    if (!r.tgl_do) r.tgl_do = r.tgl_inv;
    rep("Invoice tanpa No DO -> DO penanda TANPA-DO", r.ref, `${r.spb_no} ${r.pn} inv ${r.inv}`);
  }
  if ((r.do || r.inv) && !r.po) {
    r.po = "TANPA-PO";
    rep("DO/Invoice tanpa No PO -> PO penanda TANPA-PO", r.ref, `${r.spb_no} ${r.pn} DO ${r.do || "-"}`);
  }
}

// ---------------------------------------------------------------------
// 4. Header SPB, rantai dokumen, baris barang
// ---------------------------------------------------------------------
const first = (list, f) => {
  for (const r of list) if (r[f] !== null && r[f] !== undefined && r[f] !== "") return r[f];
  return null;
};
const bySpb = new Map();
for (const r of lines0) {
  const k = K(r.spb_no);
  if (!bySpb.has(k)) bySpb.set(k, []);
  bySpb.get(k).push(r);
}

const spbList = [];
const docKey = new Map();
const docList = [];
const lineList = [];
const pnInfo = new Map();
for (const [k, list] of bySpb) {
  const sid = spbList.length + 1;
  const tgls = [...new Set(list.map((r) => r.tgl_spb).filter(Boolean))].sort();
  if (tgls.length > 1) rep("SPB dengan >1 tanggal di Excel -> dipakai yang paling awal", k, tgls.join(", "));
  const usable = list.filter((r) => r.qty_int);
  for (const r of list.filter((x) => !x.qty_int)) rep("SKIP baris: qty kosong/tidak valid", r.ref, `${r.spb_no} ${r.pn} qty "${r.qty}"`);
  if (!usable.length) {
    rep("SKIP SPB: tidak ada baris barang valid", k, list[0].ref);
    continue;
  }
  const cancel = usable.every((r) => r.cancel);
  if (cancel) rep("SPB CANCEL di Excel -> dibuat CANCELLED (tanpa stok/turunan)", k, usable.map((r) => r.ref).join(", "));
  else for (const r of usable.filter((x) => x.cancel)) rep("Baris CANCEL di SPB aktif -> barang ikut, turunan dilewati", r.ref, `${r.spb_no} ${r.pn}`);

  const hmRaw = first(list, "hm");
  const hm = hmRaw !== null && /^-?\d+(\.\d+)?$/.test(String(hmRaw).replace(",", ".")) ? Number(String(hmRaw).replace(",", ".")) : null;
  let remark = first(list, "remark");
  const ps = first(list, "ps");
  if (ps && !K(remark).includes(K(ps))) remark = remark ? `${remark} (PS: ${ps})` : `PS: ${ps}`;
  spbList.push({
    sid,
    spb_no: String(list[0].spb_no).replace(/\s+/g, " ").trim(),
    site: list[0].site,
    tgl: tgls[0] || null,
    no_wo: first(list, "no_wo"),
    section: first(list, "section"),
    pic_gmi: first(list, "pic_gmi"),
    pic_cust: first(list, "pic_cust"),
    kode_unit: first(list, "kode_unit"),
    tipe_unit: first(list, "tipe_unit"),
    brand: first(list, "brand"),
    hm,
    remark,
    cancel,
    ref: list[0].ref,
  });
  if (!tgls[0]) throw new Error(`SPB ${k} tanpa tanggal (${list[0].ref})`);

  usable.forEach((r, i) => {
    let cid = null;
    if (!r.cancel && r.po) {
      const dk = [r.po, r.so, r.tgl_so, r.do, r.do_src, r.tgl_do, r.inv, r.tgl_inv, r.tgl_email, r.paid].join("|");
      if (!docKey.has(dk)) {
        docKey.set(dk, docList.length + 1);
        docList.push({
          cid: docList.length + 1,
          po_no: r.po,
          so_no: r.so,
          tgl_so: r.tgl_so,
          do_no: r.do,
          do_src: r.do_src,
          tgl_do: r.tgl_do,
          inv_no: r.inv,
          tgl_inv: r.tgl_inv,
          tgl_email: r.tgl_email,
          paid: r.paid,
        });
      }
      cid = docKey.get(dk);
    }
    lineList.push({ lid: lineList.length + 1, sid, seq: i + 1, cid, pn: r.pn, uom: r.uom, qty: r.qty_int, ref: r.ref });
    const pk = K(r.pn);
    if (!pnInfo.has(pk)) pnInfo.set(pk, { pn: r.pn, name: r.part_name || r.pn, uom: r.uom });
  });
}

const stat = {
  spb: spbList.length,
  spbCancel: spbList.filter((s) => s.cancel).length,
  baris: lineList.length,
  dokumen: docList.length,
  partNumber: pnInfo.size,
  doDariErp: lines0.filter((r) => r.do_src === "E").length,
  doPenanda: lines0.filter((r) => r.do_src === "P").length,
};

// ---------------------------------------------------------------------
// 5. SQL data
// ---------------------------------------------------------------------
const TABLES = ["x_cfg", "x_site", "x_spb", "x_doc", "x_line", "x_pn"];
const dataDdl = `${TABLES.map((t) => `DROP TABLE IF EXISTS pg_temp.${t};`).join("\n")}

CREATE TEMP TABLE x_cfg (key TEXT PRIMARY KEY, value TEXT);
CREATE TEMP TABLE x_site (site TEXT PRIMARY KEY, gudang TEXT NOT NULL);
CREATE TEMP TABLE x_spb (
  sid INT PRIMARY KEY, spb_no TEXT NOT NULL, site TEXT NOT NULL, tgl DATE NOT NULL, no_wo TEXT, section TEXT,
  pic_gmi TEXT, pic_cust TEXT, kode_unit TEXT, tipe_unit TEXT, brand TEXT, hm NUMERIC, remark TEXT,
  cancel BOOLEAN NOT NULL, ref TEXT
);
CREATE TEMP TABLE x_doc (
  cid INT PRIMARY KEY, po_no TEXT NOT NULL, so_no TEXT, tgl_so DATE, do_no TEXT, do_src TEXT, tgl_do DATE,
  inv_no TEXT, tgl_inv DATE, tgl_email DATE, paid BOOLEAN NOT NULL
);
CREATE TEMP TABLE x_line (lid INT PRIMARY KEY, sid INT NOT NULL, seq INT NOT NULL, cid INT, pn TEXT NOT NULL, uom TEXT, qty INT NOT NULL, ref TEXT);
CREATE TEMP TABLE x_pn (pn TEXT PRIMARY KEY, name TEXT NOT NULL, uom TEXT);

`;
const cfg = {
  sumber: `SPB Monitoring 2026 (${fs.readdirSync(srcDir).filter((f) => /\.xlsx$/i.test(f)).length} file)`,
  stok_sejak: stokSejak,
  pic_email: picEmail,
  generated: TODAY,
};
let dataIns = `INSERT INTO x_cfg (key, value) VALUES\n${Object.entries(cfg)
  .map(([k, v]) => `  (${q(k)}, ${q(v)})`)
  .join(",\n")};\n\n`;
dataIns += `INSERT INTO x_site (site, gudang) VALUES\n${Object.entries(SITE_GUDANG)
  .map(([s, g]) => `  (${q(s)}, ${q(g)})`)
  .join(",\n")};\n\n`;
for (const part of chunk(spbList, 500)) {
  dataIns += "INSERT INTO x_spb (sid, spb_no, site, tgl, no_wo, section, pic_gmi, pic_cust, kode_unit, tipe_unit, brand, hm, remark, cancel, ref) VALUES\n";
  dataIns += part
    .map((s) =>
      `(${s.sid},${q(s.spb_no)},${q(s.site)},${d(s.tgl)},${q(s.no_wo)},${q(s.section)},${q(s.pic_gmi)},${q(s.pic_cust)},${q(s.kode_unit)},${q(s.tipe_unit)},${q(s.brand)},${n(s.hm)},${q(s.remark)},${b(s.cancel)},${q(s.ref)})`,
    )
    .join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(docList, 800)) {
  dataIns += "INSERT INTO x_doc (cid, po_no, so_no, tgl_so, do_no, do_src, tgl_do, inv_no, tgl_inv, tgl_email, paid) VALUES\n";
  dataIns += part
    .map((c) => `(${c.cid},${q(c.po_no)},${q(c.so_no)},${d(c.tgl_so)},${q(c.do_no)},${q(c.do_src)},${d(c.tgl_do)},${q(c.inv_no)},${d(c.tgl_inv)},${d(c.tgl_email)},${b(c.paid)})`)
    .join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk(lineList, 1000)) {
  dataIns += "INSERT INTO x_line (lid, sid, seq, cid, pn, uom, qty, ref) VALUES\n";
  dataIns += part.map((l) => `(${l.lid},${l.sid},${l.seq},${n(l.cid)},${q(l.pn)},${q(l.uom)},${l.qty},${q(l.ref)})`).join(",\n");
  dataIns += ";\n\n";
}
for (const part of chunk([...pnInfo.values()], 500)) {
  dataIns += "INSERT INTO x_pn (pn, name, uom) VALUES\n";
  dataIns += part.map((p) => `(${q(p.pn)},${q(p.name)},${q(p.uom)})`).join(",\n");
  dataIns += " ON CONFLICT (pn) DO NOTHING;\n\n";
}
const dataIdx = `CREATE INDEX ON x_line (sid);
CREATE INDEX ON x_line (cid);
ANALYZE x_spb;
ANALYZE x_doc;
ANALYZE x_line;
ANALYZE x_pn;

`;

const xReport = `DROP TABLE IF EXISTS pg_temp.x_report;
CREATE TEMP TABLE x_report (kategori TEXT NOT NULL, ref TEXT, detail TEXT);

`;
let reportSql = "";
for (const part of chunk(report, 400)) {
  reportSql += "INSERT INTO x_report (kategori, ref, detail) VALUES\n";
  reportSql += part.map(([k, r, dt]) => `(${q(k)},${q(r)},${q(dt)})`).join(",\n");
  reportSql += ";\n\n";
}

const readTpl = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const setMode = (m) => `DELETE FROM x_cfg WHERE key = 'mode';\nINSERT INTO x_cfg (key, value) VALUES ('mode', '${m}');\n\n`;
const plan = readTpl("spb_plan_body.sqltpl");
const head = (judul, extra = "") => `-- =====================================================================
-- ${judul}
-- Generated: ${TODAY}  |  ${stat.spb} SPB (${stat.spbCancel} cancel), ${stat.baris} baris barang, ${stat.dokumen} rantai PO/DO/Invoice
-- Sumber: ${path.relative(ROOT, srcDir)} (${cfg.sumber}); DO ERP: ${path.relative(ROOT, doErpFile)}
-- Generator: supabase/import/generate_spb_import.cjs
--
-- Aturan (keputusan user 2026-10-24):
--   - Semua SPB 2026 di Excel. 1 file = 1 gudang site (${Object.entries(SITE_GUDANG).map(([s, g]) => `${SITE_SHORT[s]}=${g}`).join(", ")}).
--   - SPB yang No SPB-nya sudah ada di WMS tidak diubah; barangnya dicocokkan
--     per part number lalu turunannya (SPB-PO/DO/Invoice) dilengkapi.
--   - SPB baru: spb_is_import = true, approval completed tanpa approvals.
--     Stok gudang site DIPOTONG (SPB_OUT, boleh minus) hanya untuk SPB
--     bertanggal >= ${stokSejak}; sebelum itu riwayat saja (stok sudah
--     tercermin di SOH 28 Jul / 2 Agu).
--   - SPB-PO per (SPB, No PO); SPB-DO per (SPB-PO, No DO); Invoice per
--     (SPB-DO, No Invoice) -- butuh migration 20261024120000_spb_import.sql
--     (No DO / invoice tidak lagi unik global). No DO kosong dilengkapi dari
--     DO ERP (No SO + part); invoice tanpa DO -> DO penanda "TANPA-DO-<SO>",
--     DO/invoice tanpa PO -> PO penanda "TANPA-PO".
--   - Status payment paid = STATUS PAYMENT "PAID" atau TANGGAL PAYMENT terisi.
--   - Status SPB dihitung seperti refreshSpbStatus (Invoice -> DONE QUOT,
--     DO -> DO_ATTACH, PO -> PO_ATTACH). SPB yang semua barisnya CANCEL ->
--     CANCELLED. Barang yang belum ada di master dibuat otomatis.
--   - Aman dijalankan ulang: SPB/dokumen yang sudah ada dipakai ulang.
${extra}-- =====================================================================

`;

const out = path.join(__dirname, "spb_import.sql");
const outDryrun = path.join(__dirname, "spb_dryrun.sql");
const outVerify = path.join(__dirname, "spb_verify.sql");
const data = dataDdl + dataIns + dataIdx;
fs.writeFileSync(
  out,
  head("IMPORT SPB (menulis data) -- jalankan SEKALI setelah migration 20261024120000 & deploy kode", "--\n-- Cek dulu lewat spb_dryrun.sql (read-only).\n") +
    "BEGIN;\n\n" + xReport + data + reportSql + setMode("import") + plan + readTpl("spb_import_body.sqltpl"),
);
fs.writeFileSync(outDryrun, head("DRY-RUN IMPORT SPB (READ-ONLY) -- simulasi spb_import.sql") + xReport + data + reportSql + setMode("dryrun") + plan + readTpl("spb_dryrun_body.sqltpl"));
fs.writeFileSync(outVerify, head("VERIFIKASI IMPORT SPB (pasca import, READ-ONLY)") + data + readTpl("spb_verify_body.sqltpl"));

// ---------------------------------------------------------------------
// 6. Versi Supabase SQL Editor: data Excel dimuat ke schema staging
//    import_spb lewat beberapa file kecil, lalu dry-run / import / verify
//    menyalinnya ke temp table yang sama.
// ---------------------------------------------------------------------
const STAGE = "import_spb";
const STUDIO_MAX = 400 * 1024;
const studioFile = (name) => path.join(__dirname, `spb_studio_${name}.sql`);
for (const f of fs.readdirSync(__dirname)) {
  if (/^spb_studio_.*\.sql$/.test(f)) fs.unlinkSync(path.join(__dirname, f));
}
const stageDdl =
  `DROP SCHEMA IF EXISTS ${STAGE} CASCADE;\nCREATE SCHEMA ${STAGE};\n\n` +
  dataDdl
    .replace(/DROP TABLE IF EXISTS pg_temp\.x_\w+;\n/g, "")
    .replace(/CREATE TEMP TABLE x_/g, `CREATE TABLE ${STAGE}.x_`) +
  `CREATE TABLE ${STAGE}.x_report_seed (kategori TEXT NOT NULL, ref TEXT, detail TEXT);\n\n`;
const stageStmts = (dataIns + reportSql)
  .split(";\n\n")
  .filter((st) => st.trim())
  .map((st) => {
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
  fs.writeFileSync(
    studioFile(`1_stage_${String(i + 1).padStart(2, "0")}`),
    `-- SPB import via SQL Editor -- STAGING bagian ${i + 1} dari ${stageParts.length}
-- Generated: ${TODAY}
-- Jalankan berurutan bagian 1 s/d ${stageParts.length}, masing-masing SEKALI (bagian 1
-- menghapus & membuat ulang schema ${STAGE}). Lalu spb_studio_3_import.sql.

` + body,
  );
});

const expect = { x_cfg: Object.keys(cfg).length, x_site: Object.keys(SITE_GUDANG).length, x_spb: spbList.length, x_doc: docList.length, x_line: lineList.length, x_pn: pnInfo.size, x_report_seed: report.length };
const copyFromStage = `DO $$
DECLARE
  v_n BIGINT;
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES ${Object.entries(expect).map(([t, c]) => `('${t}', ${c})`).join(", ")}) v(t, n) LOOP
    IF to_regclass('${STAGE}.' || r.t) IS NULL THEN
      RAISE EXCEPTION 'Tabel staging ${STAGE}.% belum ada: jalankan semua spb_studio_1_stage_*.sql dulu.', r.t;
    END IF;
    EXECUTE format('SELECT count(*) FROM ${STAGE}.%I', r.t) INTO v_n;
    IF v_n <> r.n THEN
      RAISE EXCEPTION 'Staging ${STAGE}.% berisi % baris, seharusnya %: jalankan ulang semua spb_studio_1_stage_*.sql dari bagian 1.', r.t, v_n, r.n;
    END IF;
  END LOOP;
END $$;

${TABLES.map((t) => `DROP TABLE IF EXISTS pg_temp.${t};\nCREATE TEMP TABLE ${t} AS SELECT * FROM ${STAGE}.${t};`).join("\n")}
${dataIdx}`;
const reportFromStage = xReport + `INSERT INTO x_report SELECT * FROM ${STAGE}.x_report_seed;\n\n`;
fs.writeFileSync(studioFile("2_dryrun"), head("SPB via SQL Editor -- DRY-RUN (read-only), data dari schema staging " + STAGE) + copyFromStage + reportFromStage + setMode("dryrun") + plan + readTpl("spb_dryrun_body.sqltpl"));
fs.writeFileSync(studioFile("3_import"), head("SPB via SQL Editor -- IMPORT (menulis data), data dari schema staging " + STAGE) + "BEGIN;\n\n" + copyFromStage + reportFromStage + setMode("import") + plan + readTpl("spb_import_body.sqltpl"));
fs.writeFileSync(studioFile("4_verify"), head("SPB via SQL Editor -- VERIFIKASI (read-only), data dari schema staging " + STAGE) + copyFromStage + readTpl("spb_verify_body.sqltpl"));
fs.writeFileSync(studioFile("5_drop_stage"), `-- SPB import via SQL Editor -- BERSIHKAN staging (jalankan setelah verifikasi selesai)\nDROP SCHEMA IF EXISTS ${STAGE} CASCADE;\n`);

const kb = (f) => Math.round(fs.statSync(f).size / 1024) + " KB";
console.log(
  JSON.stringify(
    { ...stat, reportRows: report.length, stageParts: stageParts.length, import: kb(out), dryrun: kb(outDryrun), verify: kb(outVerify), studioImport: kb(studioFile("3_import")), stokSejak, picEmail },
    null,
    2,
  ),
);
