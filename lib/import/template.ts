// Pembentuk file template Excel (client, exceljs di-import dinamis). Sheet:
//   <Data>    : baris 1 = grup kolom, baris 2 = judul kolom (* = wajib, (info)
//               = tidak diproses), isi mulai baris 3. Catatan di tiap judul,
//               dropdown & validasi tanggal/angka, freeze pane, filter.
//   Petunjuk  : cara pakai, efek saat diproses, aturan, tabel kolom.
//   Contoh    : contoh pengisian (tidak diproses).
//   Daftar    : daftar nilai dropdown (gudang, customer, pilihan baku).
//   _meta     : (tersembunyi) penanda jenis template, dicek saat upload.

import type { Workbook, Worksheet } from "exceljs";
import type { ImportColumn, ImportDefinition, ImportRefs } from "./types";

export const TEMPLATE_VERSION = 1;
export const META_SHEET = "_meta";

const C = {
  title: "FF0F2A44",
  required: "FF1F3A5F",
  optional: "FF4B5563",
  info: "FFE5E7EB",
  infoText: "FF6B7280",
  white: "FFFFFFFF",
  border: "FFD1D5DB",
  zebra: "FFF9FAFB",
  note: "FFFFF7E6",
};
const GROUP_FILLS = ["FF1D4E89", "FF2F6B45", "FF8A4B08", "FF6B2F8A", "FF8A1F3D", "FF205E66"];
const DATA_START = 3;

export function headerLabel(col: ImportColumn) {
  return `${col.header}${col.required ? " *" : ""}${col.infoOnly ? " (info)" : ""}`;
}

function formatLabel(col: ImportColumn) {
  switch (col.type) {
    case "date":
      return "Tanggal (DD/MM/YYYY)";
    case "int":
      return col.min !== undefined ? `Bilangan bulat ≥ ${col.min}` : "Bilangan bulat";
    case "number":
      return "Angka";
    case "bool":
      return "Ya / Tidak";
    case "enum":
      return "Pilihan";
    default:
      return col.ref ? "Teks (pilih dari daftar)" : "Teks";
  }
}

function colLetter(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const REF_LABEL: Record<string, string> = {
  cabang: "Gudang (Cabang)",
  customer: "Customer (No Customer)",
  customer_consignment: "Customer Consignment",
  vendor: "Vendor (Kode)",
  satuan: "Satuan yang dipakai",
};

function thinBorder() {
  const s = { style: "thin" as const, color: { argb: C.border } };
  return { top: s, left: s, bottom: s, right: s };
}

type RefList = { name: string; title: string; values: string[] };

/** Daftar nilai dropdown + alamat rentangnya di sheet Daftar (dihitung dulu,
 *  sheet-nya dibuat paling akhir supaya urutan tab: data, petunjuk, contoh, daftar). */
function planLists(def: ImportDefinition, refs: ImportRefs) {
  const lists: RefList[] = [];
  for (const col of def.columns) {
    if (col.infoOnly) continue;
    if ((col.type === "enum" || col.type === "bool") && col.enumValues?.length) {
      lists.push({ name: `col:${col.key}`, title: col.header, values: col.enumValues });
    }
    if (col.ref && !lists.some((l) => l.name === `ref:${col.ref}`)) {
      lists.push({ name: `ref:${col.ref}`, title: REF_LABEL[col.ref] || col.ref, values: refs[col.ref] || [] });
    }
  }
  const ranges: Record<string, string> = {};
  lists.forEach((l, i) => {
    const L = colLetter(i + 1);
    ranges[l.name] = `'Daftar'!$${L}$2:$${L}$${Math.max(2, l.values.length + 1)}`;
  });
  return { lists, ranges };
}

function buildListSheet(wb: Workbook, lists: RefList[]) {
  const ws = wb.addWorksheet("Daftar", { properties: { tabColor: { argb: "FF6B7280" } } });
  if (!lists.length) {
    ws.getCell("A1").value = "Template ini tidak memakai daftar pilihan.";
    return;
  }
  lists.forEach((l, i) => {
    const c = i + 1;
    const head = ws.getCell(1, c);
    head.value = l.title;
    head.font = { bold: true, color: { argb: C.white } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.title } };
    ws.getColumn(c).width = Math.min(48, Math.max(16, l.title.length + 2, ...l.values.slice(0, 300).map((v) => String(v).length + 2)));
    l.values.forEach((v, r) => {
      ws.getCell(r + 2, c).value = v;
    });
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function buildDataSheet(
  wb: Workbook,
  def: ImportDefinition,
  ranges: Record<string, string>,
  rows: Record<string, unknown>[],
) {
  const ws = wb.addWorksheet(def.sheetName, { properties: { tabColor: { argb: "FF1D4E89" } } });
  const cols = def.columns;
  const lastCol = cols.length;

  // Baris 1: grup kolom (atau judul fitur).
  const hasGroups = cols.some((c) => c.group);
  if (hasGroups) {
    let start = 1;
    let gi = 0;
    for (let i = 1; i <= lastCol + 1; i++) {
      const prev = cols[start - 1]?.group || "";
      const cur = i <= lastCol ? cols[i - 1].group || "" : "\u0000";
      if (cur !== prev) {
        if (i - 1 > start) ws.mergeCells(1, start, 1, i - 1);
        const cell = ws.getCell(1, start);
        cell.value = prev || "";
        cell.font = { bold: true, color: { argb: C.white }, size: 11 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILLS[gi % GROUP_FILLS.length] } };
        gi++;
        start = i;
      }
    }
  } else {
    if (lastCol > 1) ws.mergeCells(1, 1, 1, lastCol);
    const cell = ws.getCell(1, 1);
    cell.value = `IMPORT ${def.title.toUpperCase()} — isi data mulai baris 3, jangan ubah baris 1–2`;
    cell.font = { bold: true, color: { argb: C.white }, size: 11 };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.title } };
  }
  ws.getRow(1).height = 20;

  // Baris 2: judul kolom + catatan.
  const head = ws.getRow(2);
  head.height = 32;
  cols.forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.value = headerLabel(col);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
    if (col.infoOnly) {
      cell.font = { bold: true, italic: true, color: { argb: C.infoText } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.info } };
    } else {
      cell.font = { bold: true, color: { argb: C.white } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col.required ? C.required : C.optional } };
    }
    const lines = [
      col.required ? "WAJIB diisi." : col.infoOnly ? "Info saja — tidak diproses saat upload." : "Opsional.",
      col.description,
      `Format: ${formatLabel(col)}.`,
    ];
    if (col.enumValues?.length) lines.push(`Pilihan: ${col.enumValues.join(", ")}.`);
    if (col.example !== undefined) lines.push(`Contoh: ${col.example}`);
    cell.note = { texts: [{ text: lines.join("\n") }], margins: { insetmode: "auto" } } as any;
    ws.getColumn(i + 1).width = col.width || Math.max(12, col.header.length + 4);
  });

  // Isi data (template berisi data saat ini).
  rows.forEach((r, ri) => {
    const row = ws.getRow(DATA_START + ri);
    cols.forEach((col, ci) => {
      const v = r[col.key];
      if (v === null || v === undefined || v === "") return;
      const cell = row.getCell(ci + 1);
      if (col.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        const [y, m, d] = v.slice(0, 10).split("-").map(Number);
        cell.value = new Date(Date.UTC(y, m - 1, d));
      } else if (col.type === "bool" && typeof v === "boolean") {
        cell.value = v ? "Ya" : "Tidak";
      } else {
        cell.value = v as any;
      }
      if (col.infoOnly) cell.font = { color: { argb: C.infoText }, italic: true };
    });
  });

  // Format & validasi per kolom (rentang, bukan per sel -> file tetap kecil).
  // exceljs mendukung alamat rentang di dataValidations.add, tapi tipenya
  // tidak diekspor.
  const dv = (ws as any).dataValidations as { add(address: string, validation: unknown): void };
  const lastRow = DATA_START + Math.max(rows.length + 500, 2000) - 1;
  cols.forEach((col, i) => {
    const L = colLetter(i + 1);
    const range = `${L}${DATA_START}:${L}${lastRow}`;
    const column = ws.getColumn(i + 1);
    if (col.type === "date") column.numFmt = "dd/mm/yyyy";
    if (col.type === "int") column.numFmt = "0";
    if (col.type === "text") column.numFmt = "@";
    if (col.infoOnly) return;
    const listRange =
      (col.type === "enum" || col.type === "bool") && col.enumValues?.length
        ? ranges[`col:${col.key}`]
        : col.ref
          ? ranges[`ref:${col.ref}`]
          : undefined;
    if (listRange) {
      dv.add(range, {
        type: "list",
        allowBlank: true,
        formulae: [listRange],
        showErrorMessage: true,
        errorStyle: col.ref ? "warning" : "stop",
        errorTitle: col.header,
        error: col.ref
          ? `Nilai tidak ada di daftar ${col.header}. Cek sheet Daftar.`
          : `Pilih salah satu: ${(col.enumValues || []).join(", ")}`,
        showInputMessage: true,
        promptTitle: col.header,
        prompt: col.description.slice(0, 250),
      });
    } else if (col.type === "date") {
      dv.add(range, {
        type: "date",
        operator: "greaterThan",
        allowBlank: true,
        formulae: [new Date(Date.UTC(2000, 0, 1))],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: col.header,
        error: "Isi tanggal yang valid (DD/MM/YYYY).",
      });
    } else if (col.type === "int" || col.type === "number") {
      dv.add(range, {
        type: col.type === "int" ? "whole" : "decimal",
        operator: "greaterThanOrEqual",
        allowBlank: true,
        formulae: [col.min ?? -999999999],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: col.header,
        error: col.type === "int" ? `Isi bilangan bulat${col.min !== undefined ? ` ≥ ${col.min}` : ""}.` : "Isi angka.",
      });
    }
  });

  ws.views = [{ state: "frozen", ySplit: 2, xSplit: def.docKey?.length ? def.docKey.length : 1 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: lastCol } };
  return ws;
}

function writeSection(ws: Worksheet, r: number, title: string, lines: string[], numbered = false) {
  const t = ws.getCell(r, 1);
  t.value = title;
  t.font = { bold: true, size: 12, color: { argb: C.title } };
  r++;
  lines.forEach((line, i) => {
    ws.mergeCells(r, 1, r, 6);
    const c = ws.getCell(r, 1);
    c.value = `${numbered ? `${i + 1}. ` : "• "}${line}`;
    c.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = Math.max(16, Math.ceil(line.length / 120) * 15);
    r++;
  });
  return r + 1;
}

function buildGuideSheet(wb: Workbook, def: ImportDefinition, prefilled: boolean) {
  const ws = wb.addWorksheet("Petunjuk", { properties: { tabColor: { argb: "FF2F6B45" } } });
  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 26;
  ws.getColumn(3).width = 9;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 70;
  ws.getColumn(6).width = 30;

  ws.mergeCells(1, 1, 1, 6);
  const title = ws.getCell(1, 1);
  title.value = `Petunjuk Import — ${def.title}`;
  title.font = { bold: true, size: 16, color: { argb: C.white } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.title } };
  title.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, 6);
  const sum = ws.getCell(2, 1);
  sum.value = def.summary;
  sum.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 32;

  let r = 4;
  r = writeSection(ws, r, "Cara pakai", [
    `Isi sheet “${def.sheetName}” mulai baris 3. Jangan ubah, geser, atau hapus baris judul (baris 1–2); urutan kolom boleh diubah selama judulnya sama.`,
    "Kolom bertanda * wajib diisi. Kolom berlabel (info) hanya untuk membantu, tidak diproses.",
    "Arahkan kursor ke judul kolom untuk melihat penjelasan & contoh. Pilih nilai dari dropdown bila ada — daftar lengkapnya di sheet “Daftar”.",
    "Tanggal: pakai format tanggal Excel atau teks DD/MM/YYYY.",
    prefilled
      ? "File ini sudah berisi data saat ini dari WMS. Ubah / lengkapi seperlunya; baris yang tidak berubah aman ikut diupload."
      : "Lihat sheet “Contoh” untuk contoh pengisian.",
    `Simpan sebagai .xlsx lalu upload di WMS → Import Data Excel → ${def.title}. WMS menampilkan preview (baris baru / diperbarui / dilewati / error) sebelum data disimpan.`,
  ], true);
  r = writeSection(ws, r, "Yang terjadi saat file diproses", def.effects);
  r = writeSection(ws, r, "Aturan pengisian", def.rules);

  const t = ws.getCell(r, 1);
  t.value = "Daftar kolom";
  t.font = { bold: true, size: 12, color: { argb: C.title } };
  r++;
  const hdr = ["No", "Kolom", "Wajib", "Format", "Keterangan", "Contoh / Pilihan"];
  hdr.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: C.white } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.optional } };
    c.border = thinBorder();
  });
  r++;
  def.columns.forEach((col, i) => {
    const vals = [
      i + 1,
      col.header,
      col.infoOnly ? "info" : col.required ? "Ya" : "-",
      formatLabel(col),
      col.description,
      col.enumValues?.length ? col.enumValues.join(" / ") : col.example !== undefined ? String(col.example) : "",
    ];
    vals.forEach((v, ci) => {
      const c = ws.getCell(r, ci + 1);
      c.value = v as any;
      c.alignment = { wrapText: true, vertical: "top" };
      c.border = thinBorder();
      if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.zebra } };
      if (ci === 2 && col.required) c.font = { bold: true, color: { argb: "FF9A1B1B" } };
    });
    ws.getRow(r).height = Math.max(18, Math.ceil(col.description.length / 85) * 15);
    r++;
  });
  r++;
  ws.mergeCells(r, 1, r, 6);
  const foot = ws.getCell(r, 1);
  foot.value = `Template WMS-GMI · ${def.key} · versi ${TEMPLATE_VERSION} · dibuat ${new Date().toLocaleString("id-ID")}`;
  foot.font = { italic: true, color: { argb: C.infoText }, size: 9 };
  return ws;
}

function buildExampleSheet(wb: Workbook, def: ImportDefinition, examples: Record<string, unknown>[]) {
  const ws = wb.addWorksheet("Contoh", { properties: { tabColor: { argb: "FF8A4B08" } } });
  ws.mergeCells(1, 1, 1, Math.max(1, def.columns.length));
  const t = ws.getCell(1, 1);
  t.value = "CONTOH PENGISIAN — sheet ini tidak diproses saat upload";
  t.font = { bold: true, color: { argb: C.white } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF8A4B08" } };
  def.columns.forEach((col, i) => {
    const c = ws.getCell(2, i + 1);
    c.value = headerLabel(col);
    c.font = { bold: true };
    c.border = thinBorder();
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.note } };
    ws.getColumn(i + 1).width = col.width || Math.max(12, col.header.length + 4);
  });
  examples.forEach((ex, ri) => {
    def.columns.forEach((col, ci) => {
      const v = ex[col.key];
      if (v === undefined || v === null) return;
      ws.getCell(3 + ri, ci + 1).value = v as any;
    });
  });
}

function defaultExamples(def: ImportDefinition): Record<string, unknown>[] {
  const one: Record<string, unknown> = {};
  for (const c of def.columns) if (c.example !== undefined && !c.infoOnly) one[c.key] = c.example;
  return [one];
}

export async function buildTemplateWorkbook(
  def: ImportDefinition,
  refs: ImportRefs,
  rows: Record<string, unknown>[] = [],
  examples?: Record<string, unknown>[],
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "WMS-GMI";
  wb.created = new Date();
  const { lists, ranges } = planLists(def, refs);
  buildDataSheet(wb, def, ranges, rows);
  buildGuideSheet(wb, def, rows.length > 0);
  buildExampleSheet(wb, def, examples?.length ? examples : def.examples?.length ? def.examples : defaultExamples(def));
  buildListSheet(wb, lists);
  const meta = wb.addWorksheet(META_SHEET, { state: "veryHidden" });
  meta.getCell("A1").value = "wms-gmi-import";
  meta.getCell("A2").value = def.key;
  meta.getCell("A3").value = TEMPLATE_VERSION;
  meta.getCell("A4").value = new Date().toISOString();
  return wb;
}

export async function downloadWorkbook(wb: Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function templateFileName(def: ImportDefinition, prefilled: boolean) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `TEMPLATE_${def.key.toUpperCase()}${prefilled ? "_DATA" : ""}_${ymd}.xlsx`;
}
