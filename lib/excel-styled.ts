// Export Excel ber-style yang seragam untuk semua halaman (exceljs):
// judul + info export di atas, header gelap, border, zebra, freeze pane,
// autofilter, format tanggal/angka, dan warna sel status.
//
// Pakai API tingkat tinggi `downloadStyledExcel()` (kolom + baris ber-key
// nama header). `writeTableSheet()` tingkat rendah dipakai export lama
// (Item Transfer, PO) yang menyusun baris sebagai array.
//
// exceljs di-import dinamis supaya tidak ikut bundle halaman list.

import type { Workbook, Worksheet, Cell } from "exceljs";

// Warna status bawaan (ARGB) untuk sel status: [background, font].
const STATUS_COLOR: Record<string, [string, string]> = {
  open: ["FFFEF3C7", "FF92400E"],
  pending: ["FFFEF3C7", "FF92400E"],
  approved: ["FFD1FAE5", "FF065F46"],
  rejected: ["FFFEE2E2", "FF991B1B"],
  completed: ["FFE5E7EB", "FF111827"],
  done: ["FFE5E7EB", "FF111827"],
};

const HEADER_FILL = "FF1F2937";
const ZEBRA_FILL = "FFF9FAFB";
const BORDER_COLOR = "FFD1D5DB";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * exceljs menulis Date sebagai UTC. Kolom `date` ("YYYY-MM-DD") dijadikan
 * tengah malam UTC; timestamptz diambil jam lokalnya lalu "dipalsukan" jadi
 * UTC supaya di Excel tampil sama dengan jam di aplikasi (WIB/WITA/WIT).
 */
export function toCellDate(value?: string | null): Date | null {
  if (!value) return null;
  const ymd = YMD_RE.exec(value);
  if (ymd) {
    return new Date(
      Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])),
    );
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
    ),
  );
}


export interface ColumnDef {
  header: string;
  width: number;
  numFmt?: string;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  /** Kolom status → sel diberi warna sesuai kunci status mentah. */
  statusKey?: boolean;
}

/**
 * Tulis 1 sheet tabel: judul + info export di atas, header gelap, border,
 * zebra, freeze pane di header (+ `freezeCols` kolom kiri), dan autofilter.
 * `rows` berisi nilai sel; `statusKeys[i]` (opsional) = status mentah baris i
 * untuk pewarnaan kolom bertanda `statusKey`.
 */
export function writeTableSheet(
  ws: Worksheet,
  title: string,
  subtitle: string,
  columns: ColumnDef[],
  rows: unknown[][],
  opts: {
    freezeCols?: number;
    statusKeys?: (string | undefined)[][];
    /** Tambahan/override warna status ([background, font] ARGB). */
    statusColors?: Record<string, [string, string]>;
  } = {},
) {
  const HEADER_ROW = 4;
  const lastCol = columns.length;

  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  ws.getRow(1).height = 22;

  ws.mergeCells(2, 1, 2, lastCol);
  const subCell = ws.getCell(2, 1);
  subCell.value = subtitle;
  subCell.font = { italic: true, size: 9, color: { argb: "FF6B7280" } };

  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  const border = {
    top: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    left: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    bottom: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    right: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  };

  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.values = columns.map((c) => c.header);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = border;
  });

  rows.forEach((values, r) => {
    const row = ws.getRow(HEADER_ROW + 1 + r);
    row.values = values.map((v) => (v === undefined ? null : v)) as any[];
    for (let c = 1; c <= lastCol; c++) {
      const def = columns[c - 1];
      const cell: Cell = row.getCell(c);
      cell.border = border;
      cell.font = { size: 10 };
      cell.alignment = {
        vertical: "top",
        horizontal: def.align,
        wrapText: def.wrap,
      };
      if (def.numFmt) cell.numFmt = def.numFmt;

      const statusKey = def.statusKey
        ? opts.statusKeys?.[r]?.[c - 1]
        : undefined;
      const statusColor = statusKey
        ? (opts.statusColors?.[statusKey] ?? STATUS_COLOR[statusKey])
        : undefined;
      if (statusColor) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: statusColor[0] },
        };
        cell.font = { size: 10, bold: true, color: { argb: statusColor[1] } };
        cell.alignment = { vertical: "top", horizontal: "center" };
      } else if (r % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: ZEBRA_FILL },
        };
      }
    }
  });

  ws.views = [
    {
      state: "frozen",
      xSplit: opts.freezeCols ?? 0,
      ySplit: HEADER_ROW,
      activeCell: `A${HEADER_ROW + 1}`,
    },
  ];
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW + Math.max(rows.length, 1), column: lastCol },
  };
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
  };
}

export function formatExportedAt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


/** Trigger download workbook di browser. */
export async function downloadWorkbook(wb: Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// ------------------------------------------------------------------ API umum

export type CellColor = [background: string, font: string];

export const CELL_COLORS = {
  amber: ["FFFEF3C7", "FF92400E"] as CellColor,
  green: ["FFD1FAE5", "FF065F46"] as CellColor,
  red: ["FFFEE2E2", "FF991B1B"] as CellColor,
  gray: ["FFE5E7EB", "FF111827"] as CellColor,
  blue: ["FFDBEAFE", "FF1E40AF"] as CellColor,
  indigo: ["FFE0E7FF", "FF3730A3"] as CellColor,
  orange: ["FFFFEDD5", "FF9A3412"] as CellColor,
};

/** Status dokumen mentah (open/approved/...) yang dipakai lintas modul. */
export const DOC_STATUS_COLORS: Record<string, CellColor> = {
  open: CELL_COLORS.amber,
  pending: CELL_COLORS.amber,
  approved: CELL_COLORS.green,
  rejected: CELL_COLORS.red,
  cancelled: CELL_COLORS.red,
  completed: CELL_COLORS.gray,
  done: CELL_COLORS.gray,
  closed: CELL_COLORS.gray,
};

export const PRIORITY_COLORS: Record<string, CellColor> = {
  P1: CELL_COLORS.red,
  P2: CELL_COLORS.orange,
  P3: CELL_COLORS.blue,
  P4: CELL_COLORS.gray,
};

export const STYLED_DATE_FMT = "dd/mm/yyyy";
export const STYLED_DATETIME_FMT = "dd/mm/yyyy hh:mm";
export const STYLED_INT_FMT = "#,##0";

export interface StyledColumn {
  /** Nama header (juga key di objek baris). */
  header: string;
  width?: number;
  /**
   * text (default) | date ("YYYY-MM-DD"/timestamptz → tanggal Excel) |
   * datetime | number (angka apa adanya) | int / money (pemisah ribuan).
   */
  type?: "text" | "date" | "datetime" | "number" | "int" | "money";
  align?: "left" | "center" | "right";
  wrap?: boolean;
  /** Warna sel berdasarkan nilai sel (cocok persis). */
  colors?: Record<string, CellColor>;
}

export interface StyledSheet {
  /** Nama tab sheet (maks 31 karakter). */
  name: string;
  title: string;
  subtitle?: string;
  columns: StyledColumn[];
  rows: Record<string, unknown>[];
  /** Jumlah kolom kiri yang ikut dibekukan (default 0). */
  freezeCols?: number;
}

/** Baris info di bawah judul: waktu export, cakupan data, jumlah baris. */
export function exportSubtitle(opts: {
  /** "all" / "filtered" / teks bebas. */
  scope?: string;
  count: number;
  unit?: string;
  extra?: string;
}) {
  const scope =
    opts.scope === "all"
      ? "Semua data"
      : opts.scope === "filtered"
        ? "Sesuai filter aktif"
        : opts.scope;
  return [
    `Diekspor ${formatExportedAt(new Date())}`,
    scope,
    `${opts.count.toLocaleString("id-ID")} ${opts.unit ?? "baris"}`,
    opts.extra,
  ]
    .filter(Boolean)
    .join(" · ");
}

function toCellValue(col: StyledColumn, v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  if (col.type === "date" || col.type === "datetime") {
    if (v instanceof Date) return v;
    if (typeof v === "string") return toCellDate(v) ?? v;
    return v;
  }
  if (col.type === "number" || col.type === "int" || col.type === "money") {
    if (typeof v === "number") return v;
    const n = Number(v);
    return typeof v === "string" && v.trim() !== "" && Number.isFinite(n)
      ? n
      : v;
  }
  return v;
}

function toColumnDef(col: StyledColumn): ColumnDef {
  const base: ColumnDef = {
    header: col.header,
    width: col.width ?? 14,
    align: col.align,
    wrap: col.wrap,
    statusKey: !!col.colors,
  };
  switch (col.type) {
    case "date":
      return { ...base, numFmt: STYLED_DATE_FMT, align: col.align ?? "center" };
    case "datetime":
      return {
        ...base,
        numFmt: STYLED_DATETIME_FMT,
        align: col.align ?? "center",
      };
    case "int":
    case "money":
      return { ...base, numFmt: STYLED_INT_FMT, align: col.align ?? "right" };
    case "number":
      return { ...base, align: col.align ?? "right" };
    default:
      return base;
  }
}

/** Isi 1 worksheet dari definisi StyledSheet. */
export function writeStyledSheet(ws: Worksheet, sheet: StyledSheet) {
  const { columns, rows } = sheet;
  if (rows.length > 0) {
    const rowKeys = Object.keys(rows[0]).join("|");
    const headers = columns.map((c) => c.header).join("|");
    if (rowKeys !== headers) {
      console.warn(
        `[excel-styled] Sheet "${sheet.name}": key baris tidak sama dengan header kolom.`,
        { rowKeys, headers },
      );
    }
  }
  const statusColors: Record<string, [string, string]> = {};
  columns.forEach((c, ci) => {
    for (const [k, color] of Object.entries(c.colors || {})) {
      statusColors[`${ci}|${k}`] = color;
    }
  });
  const cellRows = rows.map((row) =>
    columns.map((c) => toCellValue(c, row[c.header])),
  );
  const statusKeys = rows.map((row) =>
    columns.map((c, ci) =>
      c.colors ? `${ci}|${String(row[c.header] ?? "")}` : undefined,
    ),
  );
  writeTableSheet(
    ws,
    sheet.title,
    sheet.subtitle ?? exportSubtitle({ count: rows.length }),
    columns.map(toColumnDef),
    cellRows,
    { freezeCols: sheet.freezeCols ?? 0, statusKeys, statusColors },
  );
}

export async function buildStyledWorkbook(
  sheets: StyledSheet[],
): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "WMS-GMI";
  wb.created = new Date();
  for (const sheet of sheets) {
    const name = sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    writeStyledSheet(wb.addWorksheet(name), sheet);
  }
  return wb;
}

/** Susun workbook ber-style lalu langsung download di browser. */
export async function downloadStyledExcel(
  fileName: string,
  sheets: StyledSheet[],
) {
  const wb = await buildStyledWorkbook(sheets);
  await downloadWorkbook(wb, fileName);
}
