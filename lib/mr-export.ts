// Builder file Excel export Material Request (1 sheet, 1 baris per item MR).
// Pakai exceljs lewat writeTableSheet (pola sama dgn export Item Transfer):
// header gelap, border, zebra, freeze pane, autofilter, format tanggal, dan
// warna sel STATUS / STATUS BARANG / PRIORITAS. Urutan & nama header HARUS
// tetap sama dengan export lama (dipakai user untuk "tarikan MR").

import type { Workbook } from "exceljs";
import {
  type ColumnDef,
  formatExportedAt,
  toCellDate,
  writeTableSheet,
} from "@/lib/item-transfer-export";

export interface MrExportRow {
  NO: number;
  "KODE MR": string;
  KATEGORI: string;
  COMPANY: string;
  PRIORITAS: string;
  PIC: string;
  LOKASI: string;
  "TUJUAN SITE": string;
  /** "YYYY-MM-DD" / timestamptz mentah — dikonversi ke Date di sini. */
  "TANGGAL REQUEST": string | null;
  "DUE DATE": string | null;
  STATUS: string;
  FROZEN: string;
  "PART NUMBER": string;
  "NAMA BARANG": string;
  SATUAN: string;
  "QTY REQUEST": number;
  "QTY PR": number;
  "QTY SHARE STOCK": number;
  "STATUS BARANG": string;
  CATATAN: string;
  "KETERANGAN TOLAK": string;
  "KODE PR": string;
  "KODE PO": string;
  "KODE DELIVERY": string;
}

const DATE_FMT = "dd/mm/yyyy";

const COLUMNS: (ColumnDef & { key: keyof MrExportRow; date?: boolean })[] = [
  { key: "NO", header: "NO", width: 7, align: "center" },
  { key: "KODE MR", header: "KODE MR", width: 20 },
  { key: "KATEGORI", header: "KATEGORI", width: 14, align: "center" },
  { key: "COMPANY", header: "COMPANY", width: 10, align: "center" },
  { key: "PRIORITAS", header: "PRIORITAS", width: 11, statusKey: true },
  { key: "PIC", header: "PIC", width: 20, wrap: true },
  { key: "LOKASI", header: "LOKASI", width: 22, wrap: true },
  { key: "TUJUAN SITE", header: "TUJUAN SITE", width: 22, wrap: true },
  {
    key: "TANGGAL REQUEST",
    header: "TANGGAL REQUEST",
    width: 13,
    numFmt: DATE_FMT,
    align: "center",
    date: true,
  },
  {
    key: "DUE DATE",
    header: "DUE DATE",
    width: 13,
    numFmt: DATE_FMT,
    align: "center",
    date: true,
  },
  { key: "STATUS", header: "STATUS", width: 13, statusKey: true },
  { key: "FROZEN", header: "FROZEN", width: 9, align: "center" },
  { key: "PART NUMBER", header: "PART NUMBER", width: 22 },
  { key: "NAMA BARANG", header: "NAMA BARANG", width: 40, wrap: true },
  { key: "SATUAN", header: "SATUAN", width: 9, align: "center" },
  {
    key: "QTY REQUEST",
    header: "QTY REQUEST",
    width: 11,
    align: "right",
  },
  { key: "QTY PR", header: "QTY PR", width: 9, align: "right" },
  {
    key: "QTY SHARE STOCK",
    header: "QTY SHARE STOCK",
    width: 11,
    align: "right",
  },
  { key: "STATUS BARANG", header: "STATUS BARANG", width: 18, statusKey: true },
  { key: "CATATAN", header: "CATATAN", width: 30, wrap: true },
  { key: "KETERANGAN TOLAK", header: "KETERANGAN TOLAK", width: 26, wrap: true },
  { key: "KODE PR", header: "KODE PR", width: 20, wrap: true },
  { key: "KODE PO", header: "KODE PO", width: 20, wrap: true },
  { key: "KODE DELIVERY", header: "KODE DELIVERY", width: 20, wrap: true },
];

// Kunci warna diberi prefix per kolom supaya nilai yang sama di kolom beda
// (mis. "rejected" vs "Ditolak") tetap bisa diwarnai mandiri.
const AMBER: [string, string] = ["FFFEF3C7", "FF92400E"];
const GREEN: [string, string] = ["FFD1FAE5", "FF065F46"];
const RED: [string, string] = ["FFFEE2E2", "FF991B1B"];
const GRAY: [string, string] = ["FFE5E7EB", "FF111827"];
const BLUE: [string, string] = ["FFDBEAFE", "FF1E40AF"];
const INDIGO: [string, string] = ["FFE0E7FF", "FF3730A3"];
const ORANGE: [string, string] = ["FFFFEDD5", "FF9A3412"];

const STATUS_COLORS: Record<string, [string, string]> = {
  "st:open": AMBER,
  "st:approved": GREEN,
  "st:rejected": RED,
  "st:cancelled": RED,
  "st:completed": GRAY,
  "st:done": GRAY,
  "st:closed": GRAY,
  "sb:Menunggu": AMBER,
  "sb:Proses PO": BLUE,
  "sb:Dalam Pengiriman": INDIGO,
  "sb:Selesai": GREEN,
  "sb:Ditolak": RED,
  "pr:P1": RED,
  "pr:P2": ORANGE,
  "pr:P3": BLUE,
  "pr:P4": GRAY,
};

const STATUS_PREFIX: Partial<Record<keyof MrExportRow, string>> = {
  STATUS: "st:",
  "STATUS BARANG": "sb:",
  PRIORITAS: "pr:",
};

export async function buildMrWorkbook(
  rows: MrExportRow[],
  info: { modeLabel: string; mrCount: number },
): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "WMS-GMI";
  wb.created = new Date();

  const cellRows: unknown[][] = [];
  const statusKeys: (string | undefined)[][] = [];
  for (const row of rows) {
    cellRows.push(
      COLUMNS.map((c) => {
        const v = row[c.key];
        if (c.date) return toCellDate(v as string | null);
        return v;
      }),
    );
    statusKeys.push(
      COLUMNS.map((c) => {
        const prefix = STATUS_PREFIX[c.key];
        return prefix ? `${prefix}${row[c.key]}` : undefined;
      }),
    );
  }

  const subtitle = `Diekspor ${formatExportedAt(new Date())} · ${info.modeLabel} · ${rows.length.toLocaleString("id-ID")} item dari ${info.mrCount.toLocaleString("id-ID")} MR`;

  writeTableSheet(
    wb.addWorksheet("Material Request"),
    "LAPORAN MATERIAL REQUEST — DETAIL ITEM",
    subtitle,
    COLUMNS,
    cellRows,
    { freezeCols: 2, statusKeys, statusColors: STATUS_COLORS },
  );

  return wb;
}
