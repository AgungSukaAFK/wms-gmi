// Export Excel Material Request (1 sheet, 1 baris per item MR) pakai style
// seragam lib/excel-styled.ts. Urutan & nama header HARUS tetap sama dengan
// export lama (dipakai user untuk "tarikan MR").

import {
  CELL_COLORS,
  DOC_STATUS_COLORS,
  PRIORITY_COLORS,
  type StyledColumn,
  downloadStyledExcel,
  exportSubtitle,
} from "@/lib/excel-styled";

export interface MrExportRow {
  NO: number;
  "KODE MR": string;
  KATEGORI: string;
  COMPANY: string;
  PRIORITAS: string;
  PIC: string;
  LOKASI: string;
  "TUJUAN SITE": string;
  /** "YYYY-MM-DD" / timestamptz mentah — dikonversi ke tanggal Excel. */
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

export const STATUS_BARANG_COLORS = {
  Menunggu: CELL_COLORS.amber,
  "Proses PO": CELL_COLORS.blue,
  "Dalam Pengiriman": CELL_COLORS.indigo,
  Selesai: CELL_COLORS.green,
  Ditolak: CELL_COLORS.red,
};

const COLUMNS: StyledColumn[] = [
  { header: "NO", width: 7, type: "int", align: "center" },
  { header: "KODE MR", width: 20 },
  { header: "KATEGORI", width: 14, align: "center" },
  { header: "COMPANY", width: 10, align: "center" },
  { header: "PRIORITAS", width: 11, colors: PRIORITY_COLORS },
  { header: "PIC", width: 20, wrap: true },
  { header: "LOKASI", width: 22, wrap: true },
  { header: "TUJUAN SITE", width: 22, wrap: true },
  { header: "TANGGAL REQUEST", width: 13, type: "date" },
  { header: "DUE DATE", width: 13, type: "date" },
  { header: "STATUS", width: 13, colors: DOC_STATUS_COLORS },
  { header: "FROZEN", width: 9, align: "center" },
  { header: "PART NUMBER", width: 22 },
  { header: "NAMA BARANG", width: 40, wrap: true },
  { header: "SATUAN", width: 9, align: "center" },
  { header: "QTY REQUEST", width: 11, type: "number" },
  { header: "QTY PR", width: 9, type: "number" },
  { header: "QTY SHARE STOCK", width: 11, type: "number" },
  { header: "STATUS BARANG", width: 18, colors: STATUS_BARANG_COLORS },
  { header: "CATATAN", width: 30, wrap: true },
  { header: "KETERANGAN TOLAK", width: 26, wrap: true },
  { header: "KODE PR", width: 20, wrap: true },
  { header: "KODE PO", width: 20, wrap: true },
  { header: "KODE DELIVERY", width: 20, wrap: true },
];

export async function downloadMrExcel(
  rows: MrExportRow[],
  info: { mode: string; mrCount: number; fileName: string },
) {
  await downloadStyledExcel(info.fileName, [
    {
      name: "Material Request",
      title: "LAPORAN MATERIAL REQUEST — DETAIL ITEM",
      subtitle: exportSubtitle({
        scope: info.mode,
        count: rows.length,
        unit: "item",
        extra: `${info.mrCount.toLocaleString("id-ID")} MR`,
      }),
      columns: COLUMNS,
      rows: rows as unknown as Record<string, unknown>[],
      freezeCols: 2,
    },
  ]);
}
