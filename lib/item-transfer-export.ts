// Builder file Excel export Item Transfer (3 sheet: Ringkasan, Detail Item,
// Alur Approval). Pakai exceljs (bukan xlsx/SheetJS community) karena butuh
// styling: header berwarna, border, freeze pane, autofilter, format angka.
// exceljs di-import dinamis supaya tidak ikut bundle halaman list.

import type { Workbook, Worksheet, Cell } from "exceljs";
import { summarizeApprovals } from "@/lib/approval-progress";
import {
  SHIPMENT_LABEL,
  estimasiBiayaKirim,
  parseKoliDetail,
  summarizeKoli,
} from "@/lib/shipment";

export const IT_STATUS_LABEL: Record<string, string> = {
  open: "Menunggu Approval",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Selesai",
  done: "Selesai",
};

export const IT_TRACKING_LABEL: Record<string, string> = {
  created: "Item Transfer Dibuat",
  packing: "Packing",
  ready_pickup: "Siap Diambil",
  in_transit: "Dalam Pengiriman",
  delivered: "Barang Diterima",
  completed: "Selesai Final",
};

const APPROVAL_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
};

// Warna status (ARGB) untuk sel status: [background, font].
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

const DATE_FMT = "dd/mm/yyyy";
const DATETIME_FMT = "dd/mm/yyyy hh:mm";
const INT_FMT = "#,##0";
const DEC_FMT = "#,##0.00";
const RP_FMT = '"Rp" #,##0';

export interface ItExportItem {
  it_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  mr_kode?: string | null;
  ri_kode?: string | null;
}

export interface ItExportInput {
  // Baris item_transfers + join dari/tujuan (nama_cabang, kode_cabang).
  transfers: any[];
  items: ItExportItem[];
  profilesMap: Record<string, string>;
  filterDescription: string;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * exceljs menulis Date sebagai UTC. Kolom `date` ("YYYY-MM-DD") dijadikan
 * tengah malam UTC; timestamptz diambil jam lokalnya lalu "dipalsukan" jadi
 * UTC supaya di Excel tampil sama dengan jam di aplikasi (WIB/WITA/WIT).
 */
function toCellDate(value?: string | null): Date | null {
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

const orNull = (v: unknown) =>
  v === null || v === undefined || v === "" ? null : v;

interface ColumnDef {
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
function writeTableSheet(
  ws: Worksheet,
  title: string,
  subtitle: string,
  columns: ColumnDef[],
  rows: unknown[][],
  opts: { freezeCols?: number; statusKeys?: (string | undefined)[][] } = {},
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
      const statusColor = statusKey ? STATUS_COLOR[statusKey] : undefined;
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

function formatExportedAt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function buildItemTransferWorkbook({
  transfers,
  items,
  profilesMap,
  filterDescription,
}: ItExportInput): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "WMS-GMI";
  wb.created = new Date();

  const subtitle = `Diekspor: ${formatExportedAt(new Date())}  •  ${transfers.length} dokumen, ${items.length} baris item  •  Filter: ${filterDescription}`;
  const person = (uid?: string | null) =>
    (uid && profilesMap[uid]) || null;

  const itemsByIt = new Map<number, ItExportItem[]>();
  for (const item of items) {
    const list = itemsByIt.get(item.it_id) || [];
    list.push(item);
    itemsByIt.set(item.it_id, list);
  }

  // ---------------------------------------------------------------- Ringkasan
  const summaryCols: ColumnDef[] = [
    { header: "No", width: 5, align: "center" },
    { header: "Kode IT", width: 16 },
    { header: "Tanggal", width: 12, numFmt: DATE_FMT, align: "center" },
    { header: "Dari Gudang", width: 22, wrap: true },
    { header: "Ke Gudang", width: 22, wrap: true },
    { header: "Status", width: 18, statusKey: true },
    { header: "Tracking", width: 20 },
    { header: "Progress Approval", width: 12, align: "center" },
    { header: "Menunggu Approval Dari", width: 22, wrap: true },
    { header: "Jml Jenis Item", width: 10, numFmt: INT_FMT, align: "right" },
    { header: "Total Qty", width: 10, numFmt: INT_FMT, align: "right" },
    { header: "Ref MR", width: 20, wrap: true },
    { header: "Ref RI", width: 20, wrap: true },
    { header: "Jenis Pengiriman", width: 18 },
    { header: "Kurir / Ekspedisi", width: 18, wrap: true },
    { header: "Layanan Kurir", width: 14 },
    { header: "No. Resi", width: 18 },
    { header: "Nama Pengantar", width: 18 },
    { header: "Penyedia Handcarry", width: 18 },
    { header: "Order / Booking ID", width: 18 },
    { header: "Jumlah Koli", width: 9, numFmt: INT_FMT, align: "right" },
    { header: "Berat Aktual (kg)", width: 11, numFmt: DEC_FMT, align: "right" },
    { header: "Berat Tagih (kg)", width: 11, numFmt: DEC_FMT, align: "right" },
    { header: "Rate / kg", width: 13, numFmt: RP_FMT, align: "right" },
    { header: "Estimasi Biaya Kirim", width: 16, numFmt: RP_FMT, align: "right" },
    { header: "Estimasi (hari)", width: 9, numFmt: INT_FMT, align: "right" },
    { header: "PIC", width: 18 },
    { header: "Requester", width: 18 },
    { header: "Penerima", width: 18 },
    { header: "Keterangan", width: 30, wrap: true },
    { header: "Catatan Tracking", width: 30, wrap: true },
    { header: "Alasan Penolakan", width: 30, wrap: true },
    { header: "Dibuat Pada", width: 16, numFmt: DATETIME_FMT, align: "center" },
  ];
  const statusCol = summaryCols.findIndex((c) => c.header === "Status");

  const summaryRows: unknown[][] = [];
  const summaryStatus: (string | undefined)[][] = [];
  transfers.forEach((it, idx) => {
    const lines = itemsByIt.get(it.id) || [];
    const approval = summarizeApprovals(it.approvals);
    const koliRows = parseKoliDetail(it.koli_detail);
    const koli = summarizeKoli(koliRows, it.shipment_type);
    const rate = it.rate_per_kg != null ? Number(it.rate_per_kg) : null;
    const uniq = (vals: (string | null | undefined)[]) =>
      Array.from(new Set(vals.filter((v): v is string => !!v && v !== "-")))
        .join(", ") || null;

    summaryRows.push([
      idx + 1,
      it.it_kode,
      toCellDate(it.it_tanggal),
      it.dari?.nama_cabang ?? null,
      it.tujuan?.nama_cabang ?? null,
      IT_STATUS_LABEL[it.status] || it.status,
      IT_TRACKING_LABEL[it.tracking_status] || it.tracking_status || null,
      approval.totalCount > 0
        ? `${approval.approvedCount}/${approval.totalCount}`
        : null,
      it.status === "open" ? (approval.pendingApprover?.nama ?? null) : null,
      lines.length,
      lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
      uniq(lines.map((l) => l.mr_kode)),
      uniq(lines.map((l) => l.ri_kode)),
      SHIPMENT_LABEL[it.shipment_type] || it.shipment_type || null,
      orNull(it.ekspedisi),
      orNull(it.layanan_kurir),
      orNull(it.no_resi),
      orNull(it.sender_name),
      orNull(it.eksternal_provider),
      orNull(it.eksternal_id),
      it.jumlah_koli ?? null,
      koliRows.length > 0 ? koli.beratAktual : null,
      koliRows.length > 0 ? koli.beratTagih : null,
      rate,
      estimasiBiayaKirim(koliRows, rate, it.shipment_type),
      it.estimasi_hari ?? null,
      orNull(it.pic),
      person(it.uid_requester),
      person(it.uid_receiver),
      orNull(it.remarks),
      orNull(it.tracking_note),
      orNull(it.rejection_reason),
      toCellDate(it.created_at),
    ]);
    const statusRow: (string | undefined)[] = [];
    statusRow[statusCol] = it.status;
    summaryStatus.push(statusRow);
  });

  writeTableSheet(
    wb.addWorksheet("Ringkasan"),
    "LAPORAN ITEM TRANSFER — RINGKASAN DOKUMEN",
    subtitle,
    summaryCols,
    summaryRows,
    { freezeCols: 2, statusKeys: summaryStatus },
  );

  // -------------------------------------------------------------- Detail Item
  const itemCols: ColumnDef[] = [
    { header: "No", width: 6, align: "center" },
    { header: "Kode IT", width: 16 },
    { header: "Tanggal", width: 12, numFmt: DATE_FMT, align: "center" },
    { header: "Dari Gudang", width: 22, wrap: true },
    { header: "Ke Gudang", width: 22, wrap: true },
    { header: "Status", width: 18, statusKey: true },
    { header: "Tracking", width: 20 },
    { header: "Part Number", width: 20 },
    { header: "Nama Barang", width: 40, wrap: true },
    { header: "Qty", width: 9, numFmt: INT_FMT, align: "right" },
    { header: "Satuan", width: 9, align: "center" },
    { header: "Ref MR", width: 18 },
    { header: "Ref RI", width: 18 },
  ];
  const itemStatusCol = itemCols.findIndex((c) => c.header === "Status");

  const itemRows: unknown[][] = [];
  const itemStatus: (string | undefined)[][] = [];
  for (const it of transfers) {
    for (const l of itemsByIt.get(it.id) || []) {
      itemRows.push([
        itemRows.length + 1,
        it.it_kode,
        toCellDate(it.it_tanggal),
        it.dari?.nama_cabang ?? null,
        it.tujuan?.nama_cabang ?? null,
        IT_STATUS_LABEL[it.status] || it.status,
        IT_TRACKING_LABEL[it.tracking_status] || it.tracking_status || null,
        l.part_number,
        l.part_name,
        Number(l.qty) || 0,
        l.satuan,
        orNull(l.mr_kode),
        orNull(l.ri_kode),
      ]);
      const statusRow: (string | undefined)[] = [];
      statusRow[itemStatusCol] = it.status;
      itemStatus.push(statusRow);
    }
  }

  writeTableSheet(
    wb.addWorksheet("Detail Item"),
    "LAPORAN ITEM TRANSFER — DETAIL ITEM",
    subtitle,
    itemCols,
    itemRows,
    { freezeCols: 2, statusKeys: itemStatus },
  );

  // ----------------------------------------------------------- Alur Approval
  const apprCols: ColumnDef[] = [
    { header: "Kode IT", width: 16 },
    { header: "Tanggal IT", width: 12, numFmt: DATE_FMT, align: "center" },
    { header: "Urutan", width: 8, align: "center" },
    { header: "Approver", width: 24 },
    { header: "Role", width: 18 },
    { header: "Status", width: 13, statusKey: true },
    { header: "Diproses Pada", width: 16, numFmt: DATETIME_FMT, align: "center" },
    { header: "Catatan", width: 36, wrap: true },
  ];
  const apprStatusCol = apprCols.findIndex((c) => c.header === "Status");

  const apprRows: unknown[][] = [];
  const apprStatus: (string | undefined)[][] = [];
  for (const it of transfers) {
    ((it.approvals as any[]) || []).forEach((step, i) => {
      apprRows.push([
        it.it_kode,
        toCellDate(it.it_tanggal),
        step.step_order ?? i + 1,
        orNull(step.nama),
        orNull(step.role),
        APPROVAL_STATUS_LABEL[step.status] || step.status || null,
        toCellDate(step.processed_at),
        orNull(step.notes),
      ]);
      const statusRow: (string | undefined)[] = [];
      statusRow[apprStatusCol] = step.status;
      apprStatus.push(statusRow);
    });
  }

  writeTableSheet(
    wb.addWorksheet("Alur Approval"),
    "LAPORAN ITEM TRANSFER — ALUR APPROVAL",
    subtitle,
    apprCols,
    apprRows,
    { freezeCols: 1, statusKeys: apprStatus },
  );

  return wb;
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
