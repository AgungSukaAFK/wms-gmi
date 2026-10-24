// Laporan hasil cek / hasil proses import (client, exceljs): 1 baris per
// baris Excel yang diupload, berisi status, keterangan, peringatan, lalu data
// aslinya -- supaya baris error bisa langsung diperbaiki & diupload ulang.

import type { ImportDefinition, ImportRow, ImportRowResult } from "./types";
import { downloadWorkbook, headerLabel } from "./template";

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
  const head = ["Baris Excel", "Status", "Keterangan", "Peringatan", ...cols.map(headerLabel)];
  ws.addRow(head);
  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  for (const r of rows) {
    const res = results.get(r.row);
    const status = res?.status || "skip";
    const row = ws.addRow([
      r.row,
      STATUS_LABEL[status],
      res?.message || "",
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
    row.getCell(3).alignment = { wrapText: true, vertical: "top" };
  }
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 60;
  ws.getColumn(4).width = 36;
  cols.forEach((c, i) => {
    const col = ws.getColumn(5 + i);
    col.width = c.width || Math.max(12, c.header.length + 4);
    if (c.type === "date") col.numFmt = "dd/mm/yyyy";
  });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } };
  const base = fileName.replace(/\.[^.]+$/, "");
  await downloadWorkbook(wb, `${base}_${stage === "cek" ? "HASIL_CEK" : "HASIL_PROSES"}.xlsx`);
}
