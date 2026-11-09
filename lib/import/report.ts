// Laporan hasil cek / hasil proses import (client, exceljs): 1 baris per
// baris Excel yang diupload, berisi status, keterangan, peringatan, lalu data
// aslinya -- supaya baris error bisa langsung diperbaiki & diupload ulang.

import type { ImportDefinition, ImportRow, ImportRowResult } from "./types";
import { downloadWorkbook, headerLabel } from "./template";
import { detailsText, explainResult, formatRowList, groupIssues } from "./explain";

export const STATUS_LABEL: Record<ImportRowResult["status"], string> = {
  create: "Baru",
  update: "Diperbarui",
  skip: "Dilewati",
  error: "Error",
};

const STATUS_FILL: Record<ImportRowResult["status"], [string, string]> = {
  create: ["FFD1FAE5", "FF065F46"],
  update: ["FFDBEAFE", "FF1E40AF"],
  skip: ["FFF3F4F6", "FF374151"],
  error: ["FFFEE2E2", "FF991B1B"],
};

export async function downloadImportReport(
  def: ImportDefinition,
  rows: ImportRow[],
  results: Map<number, ImportRowResult>,
  stage: "cek" | "hasil",
  fileName: string,
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(stage === "cek" ? "Hasil Cek" : "Hasil Proses");
  const cols = def.columns;
  const head = ["Baris Excel", "Status", "Jenis Masalah", "Keterangan", "Rincian (isi file vs WMS)", "Saran Perbaikan", "Peringatan", ...cols.map(headerLabel)];
  const FIXED = 7;
  ws.addRow(head);
  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  for (const r of rows) {
    const res = results.get(r.row);
    const status = res?.status || "skip";
    const ex = explainResult(res);
    const row = ws.addRow([
      r.row,
      STATUS_LABEL[status],
      ex?.label || "",
      res?.message || "",
      detailsText(res),
      ex && ex.kind !== "cascade" ? ex.hint : "",
      (res?.warnings || []).join("; "),
      ...cols.map((c) => {
        const v = r.values[c.key];
        if (v === null || v === undefined) return null;
        if (c.type === "bool") return v ? "Ya" : "Tidak";
        if (c.type === "date" && typeof v === "string") {
          const [y, m, d] = v.split("-").map(Number);
          return new Date(Date.UTC(y, m - 1, d));
        }
        return v as any;
      }),
    ]);
    const [bg, fg] = STATUS_FILL[status];
    const sc = row.getCell(2);
    sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    sc.font = { bold: true, color: { argb: fg } };
    for (const c of [3, 4, 5, 6, 7]) row.getCell(c).alignment = { wrapText: true, vertical: "top" };
  }
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 55;
  ws.getColumn(5).width = 45;
  ws.getColumn(6).width = 45;
  ws.getColumn(7).width = 30;
  cols.forEach((c, i) => {
    const col = ws.getColumn(FIXED + 1 + i);
    col.width = c.width || Math.max(12, c.header.length + 4);
    if (c.type === "date") col.numFmt = "dd/mm/yyyy";
  });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
  // Ringkasan per jenis masalah (sheet ke-2).
  const groups = groupIssues(results.values());
  if (groups.length) {
    const sum = wb.addWorksheet("Ringkasan Masalah");
    sum.addRow(["Jenis Masalah", "Jumlah Baris", "Baris Excel", "Contoh Keterangan", "Saran Perbaikan"]);
    sum.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    });
    for (const g of groups) {
      const row = sum.addRow([g.label, g.rows.length, formatRowList(g.rows, 40), g.samples.map((x) => `• ${x.message}`).join("\n"), g.hint]);
      row.eachCell((c) => (c.alignment = { wrapText: true, vertical: "top" }));
    }
    [28, 12, 30, 70, 60].forEach((w, i) => (sum.getColumn(i + 1).width = w));
  }
  const base = fileName.replace(/\.[^.]+$/, "");
  await downloadWorkbook(wb, `${base}_${stage === "cek" ? "HASIL_CEK" : "HASIL_PROSES"}.xlsx`);
}
