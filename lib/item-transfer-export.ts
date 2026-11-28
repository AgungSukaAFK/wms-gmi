// Builder file Excel export Item Transfer (3 sheet: Ringkasan, Detail Item,
// Alur Approval). Pakai exceljs (bukan xlsx/SheetJS community) karena butuh
// styling: header berwarna, border, freeze pane, autofilter, format angka.
// exceljs di-import dinamis supaya tidak ikut bundle halaman list.
// Inti styling (writeTableSheet dkk) ada di lib/excel-styled.ts; di-export
// ulang di sini supaya import lama tetap jalan.

import type { Workbook } from "exceljs";
import {
  type ColumnDef,
  formatExportedAt,
  toCellDate,
  writeTableSheet,
} from "@/lib/excel-styled";
import { summarizeApprovals } from "@/lib/approval-progress";
import {
  SHIPMENT_LABEL,
  estimasiBiayaKirim,
  parseKoliDetail,
  summarizeKoli,
} from "@/lib/shipment";

export {
  type ColumnDef,
  downloadWorkbook,
  formatExportedAt,
  toCellDate,
  writeTableSheet,
} from "@/lib/excel-styled";

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

const orNull = (v: unknown) =>
  v === null || v === undefined || v === "" ? null : v;

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
