// Tarikan Excel Purchase Order (exceljs, styled — pola sama dengan export Item
// Transfer): sheet "Ringkasan PO" (1 baris per PO, nominal s/d Total PO
// termasuk pajak & ongkir) + sheet "Detail Item" (1 baris per item PO,
// referensi MR & PR per item, qty PO vs qty diterima). Header gelap, freeze
// pane, autofilter, format angka/tanggal, warna status.
//
// Nominal mengikuti aturan lihat harga PO (lib/po-price-access.ts): kolom
// harga/nominal hanya ikut kalau `canViewPrice` (role purchasing).
//
// Jalur referensi per item:
//   po_items.pr_item_id -> pr_items (prs.pr_kode, mr_id / mr_item_id)
//     -> mr_items.mr_id -> mrs.mr_kode
//   fallback MR: po_items.mr_id. Fallback PR: ost_pr_ref (PO Outstanding) /
//   pos.po_pr_referensi (PO Non-PR).

import type { Workbook } from "exceljs";
import {
  type ColumnDef,
  formatExportedAt,
  toCellDate,
  writeTableSheet,
} from "@/lib/item-transfer-export";
import { computePoTotalsFromRecord, formatItemTax, itemTaxFromRow } from "@/lib/po-tax";
import { normalizePoCurrency } from "@/lib/po-currency";

const CHUNK = 200;
const DATE_FMT = "dd/mm/yyyy";
const INT_FMT = "#,##0";
const MONEY_FMT = "#,##0.00";

function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

const one = (v: any) => (Array.isArray(v) ? v[0] : v);
const uniqIds = (arr: any[]) =>
  Array.from(new Set(arr.filter((v) => v !== null && v !== undefined)));
const uniqJoin = (arr: (string | null | undefined)[]) =>
  Array.from(new Set(arr.filter(Boolean) as string[])).join(", ") || null;
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const PO_STATUS_LABEL: Record<string, string> = {
  open: "Menunggu Approval",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
  done: "Completed",
  // PO 'closed' = ada item yang dibatalkan (lib/po-item-status.ts).
  closed: "Closed (Item Dibatalkan)",
};

const RECEIVE_STATUS_LABEL: Record<string, string> = {
  pending: "Belum Diterima",
  partial: "Sebagian",
  complete: "Lengkap",
};

function jenisPoLabel(po: any): string {
  if (po?.po_is_outstanding) return "Outstanding";
  if (po?.po_jenis === "non_pr") return "Non-PR";
  if (po?.po_jenis === "so") return "SO";
  return "Reguler";
}

/** Kunci warna status (STATUS_COLOR di item-transfer-export). */
function statusColorKey(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "closed") return "rejected";
  return s === "done" ? "completed" : s || undefined;
}

export async function buildPoExportWorkbook(
  supabase: any,
  /** Baris `pos` hasil query list (minimal id); urutan = urutan export. */
  poRows: any[],
  opts: { canViewPrice: boolean; filterDescription: string },
): Promise<{ workbook: Workbook; poCount: number; itemCount: number }> {
  const { canViewPrice } = opts;
  const poIds = poRows.map((p) => p.id);

  // 1. Header PO lengkap (field pajak/diskon/ongkir tidak ada di query list).
  const headerById = new Map<number, any>();
  for (const ids of chunks(poIds)) {
    const { data, error } = await supabase
      .from("pos")
      .select(
        `id, po_kode, po_tanggal, po_estimasi, po_status, po_receive_status, po_pic,
         po_payment_term, po_jenis, po_is_outstanding, po_pr_referensi, po_currency,
         po_tax_mode, po_harga_termasuk_pajak, po_ppn_mode, po_ppn_rate, po_ppn_amount,
         po_diskon_mode, po_diskon_value, po_ongkir, po_pph_type, po_pph_mode,
         po_pph_rate, po_pph_amount, cabang(nama_cabang), so_reguler(so_kode)`,
      )
      .in("id", ids);
    if (error) throw error;
    for (const row of data || []) headerById.set(row.id, row);
  }

  // 2. Item PO.
  const items: any[] = [];
  for (const ids of chunks(poIds)) {
    const { data, error } = await supabase
      .from("po_items")
      .select(
        `id, po_id, part_number, part_name, satuan, qty, qty_received, harga,
         qty_cancelled, item_detail_status, item_estimasi,
         mr_id, pr_item_id, ost_pr_ref, ost_proyek_ref,
         item_ppn_rate, item_pph_type, item_pph_rate, vendors(vendor_name)`,
      )
      .in("po_id", ids)
      .order("id", { ascending: true });
    if (error) throw error;
    items.push(...(data || []));
  }

  // 3. Qty di RI yang masih menunggu approval (belum masuk qty_received).
  const pendingByPoItem = new Map<number, number>();
  for (const ids of chunks(uniqIds(items.map((i) => i.id)))) {
    const { data, error } = await supabase
      .from("receive_items")
      .select("po_item_id, qty, receives!inner(ri_status)")
      .in("po_item_id", ids)
      .eq("receives.ri_status", "open");
    if (error) throw error;
    for (const row of data || []) {
      pendingByPoItem.set(
        row.po_item_id,
        (pendingByPoItem.get(row.po_item_id) || 0) + (Number(row.qty) || 0),
      );
    }
  }

  // 4. Item PR -> kode PR + MR asal.
  const prItemById = new Map<number, any>();
  for (const ids of chunks(uniqIds(items.map((i) => i.pr_item_id)))) {
    const { data, error } = await supabase
      .from("pr_items")
      .select("id, mr_id, mr_item_id, prs(pr_kode)")
      .in("id", ids);
    if (error) throw error;
    for (const row of data || []) prItemById.set(row.id, row);
  }

  // 5. Item MR (MR asal kalau pr_items.mr_id kosong).
  const mrIdByMrItem = new Map<number, number>();
  const mrItemIds = uniqIds(
    Array.from(prItemById.values())
      .filter((p) => !p.mr_id)
      .map((p) => p.mr_item_id),
  );
  for (const ids of chunks(mrItemIds)) {
    const { data, error } = await supabase
      .from("mr_items")
      .select("id, mr_id")
      .in("id", ids);
    if (error) throw error;
    for (const row of data || []) mrIdByMrItem.set(row.id, row.mr_id);
  }

  const resolveMrId = (item: any): number | null => {
    const prItem = prItemById.get(item.pr_item_id);
    return (
      prItem?.mr_id ?? mrIdByMrItem.get(prItem?.mr_item_id) ?? item.mr_id ?? null
    );
  };

  // 6. Kode MR.
  const mrKodeById = new Map<number, string>();
  for (const ids of chunks(uniqIds(items.map(resolveMrId)))) {
    const { data, error } = await supabase
      .from("mrs")
      .select("id, mr_kode")
      .in("id", ids);
    if (error) throw error;
    for (const row of data || []) mrKodeById.set(row.id, row.mr_kode);
  }

  const itemsByPo = new Map<number, any[]>();
  for (const item of items) {
    const list = itemsByPo.get(item.po_id) || [];
    list.push(item);
    itemsByPo.set(item.po_id, list);
  }

  // ------------------------------------------------------------- Kolom
  const summaryCols: ColumnDef[] = [
    { header: "No", width: 5, align: "center" },
    { header: "Kode PO", width: 20 },
    { header: "Jenis PO", width: 12 },
    { header: "Tanggal", width: 12, numFmt: DATE_FMT, align: "center" },
    { header: "Estimasi", width: 12, numFmt: DATE_FMT, align: "center" },
    { header: "Status PO", width: 18, statusKey: true },
    { header: "Status Terima", width: 15 },
    { header: "PIC", width: 18 },
    { header: "Lokasi", width: 20 },
    { header: "Vendor", width: 26, wrap: true },
    { header: "Ref MR", width: 22, wrap: true },
    { header: "Ref PR", width: 22, wrap: true },
    { header: "Payment Term", width: 14 },
    { header: "Jml Item", width: 8, numFmt: INT_FMT, align: "right" },
    { header: "Total Qty PO", width: 10, numFmt: INT_FMT, align: "right" },
    { header: "Total Qty Diterima", width: 10, numFmt: INT_FMT, align: "right" },
    { header: "Total Qty Sisa", width: 10, numFmt: INT_FMT, align: "right" },
  ];
  if (canViewPrice) {
    summaryCols.push(
      { header: "Mata Uang", width: 8, align: "center" },
      { header: "Subtotal", width: 16, numFmt: MONEY_FMT, align: "right" },
      { header: "Diskon", width: 14, numFmt: MONEY_FMT, align: "right" },
      { header: "DPP", width: 16, numFmt: MONEY_FMT, align: "right" },
      { header: "Harga Termasuk Pajak", width: 11, align: "center" },
      { header: "Mode Pajak", width: 10, align: "center" },
      { header: "PPN", width: 14, numFmt: MONEY_FMT, align: "right" },
      { header: "Ongkir", width: 14, numFmt: MONEY_FMT, align: "right" },
      { header: "Total PO (Incl. Pajak & Ongkir)", width: 18, numFmt: MONEY_FMT, align: "right" },
      { header: "PPh", width: 14, numFmt: MONEY_FMT, align: "right" },
      { header: "Dibayar ke Vendor", width: 18, numFmt: MONEY_FMT, align: "right" },
    );
  }

  const itemCols: ColumnDef[] = [
    { header: "No", width: 5, align: "center" },
    { header: "Kode PO", width: 20 },
    { header: "Jenis PO", width: 12 },
    { header: "Tanggal PO", width: 12, numFmt: DATE_FMT, align: "center" },
    { header: "Status PO", width: 18, statusKey: true },
    { header: "Vendor", width: 24, wrap: true },
    { header: "Kode MR", width: 20 },
    { header: "Kode PR", width: 20 },
    { header: "Proyek", width: 16, wrap: true },
    { header: "Part Number", width: 20 },
    { header: "Nama Barang", width: 34, wrap: true },
    { header: "Satuan", width: 8, align: "center" },
    { header: "Qty PO", width: 9, numFmt: INT_FMT, align: "right" },
    { header: "Qty Diterima", width: 9, numFmt: INT_FMT, align: "right" },
    { header: "Qty Sisa", width: 9, numFmt: INT_FMT, align: "right" },
    { header: "Qty RI Menunggu Approval", width: 11, numFmt: INT_FMT, align: "right" },
    { header: "Status Terima Item", width: 13, align: "center" },
    { header: "Qty Dibatalkan", width: 10, numFmt: INT_FMT, align: "right" },
    { header: "Status Progres", width: 22, wrap: true },
    { header: "Estimasi Item", width: 12, numFmt: DATE_FMT, align: "center" },
  ];
  if (canViewPrice) {
    itemCols.push(
      { header: "Mata Uang", width: 8, align: "center" },
      { header: "Harga Satuan", width: 16, numFmt: MONEY_FMT, align: "right" },
      { header: "Subtotal", width: 16, numFmt: MONEY_FMT, align: "right" },
      { header: "Pajak Item", width: 18 },
    );
  }

  // ------------------------------------------------------------- Baris
  const summaryRows: unknown[][] = [];
  const summaryStatus: (string | undefined)[][] = [];
  const itemRows: unknown[][] = [];
  const itemStatus: (string | undefined)[][] = [];
  const statusColIdxSummary = summaryCols.findIndex((c) => c.statusKey);
  const statusColIdxItem = itemCols.findIndex((c) => c.statusKey);

  poRows.forEach((listRow, index) => {
    const po = headerById.get(listRow.id) || listRow;
    const poItems = itemsByPo.get(listRow.id) || [];
    const currency = normalizePoCurrency(po.po_currency);
    const totals = computePoTotalsFromRecord(po, poItems);
    const isItemTaxMode = totals.taxMode === "item";
    const soRef = po.po_jenis === "so" ? `SO ${one(po.so_reguler)?.so_kode || "-"}` : null;

    const refPr = (item: any) =>
      soRef ||
      one(prItemById.get(item.pr_item_id)?.prs)?.pr_kode ||
      item.ost_pr_ref ||
      po.po_pr_referensi ||
      null;
    const refMr = (item: any) => mrKodeById.get(resolveMrId(item) as number) || null;

    const qtyPo = poItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    const qtyDiterima = poItems.reduce((s, i) => s + (Number(i.qty_received) || 0), 0);
    const statusLabel = PO_STATUS_LABEL[po.po_status] || po.po_status || null;
    const statusKey = statusColorKey(po.po_status);

    const summary: unknown[] = [
      index + 1,
      po.po_kode || null,
      jenisPoLabel(po),
      toCellDate(po.po_tanggal),
      toCellDate(po.po_estimasi),
      statusLabel,
      RECEIVE_STATUS_LABEL[po.po_receive_status] || po.po_receive_status || null,
      po.po_pic || null,
      one(po.cabang)?.nama_cabang || null,
      uniqJoin(poItems.map((i) => one(i.vendors)?.vendor_name)),
      uniqJoin(poItems.map(refMr)),
      uniqJoin(poItems.map(refPr)),
      po.po_payment_term || null,
      poItems.length,
      qtyPo,
      qtyDiterima,
      Math.max(0, qtyPo - qtyDiterima),
    ];
    if (canViewPrice) {
      summary.push(
        currency,
        round2(totals.subtotal),
        round2(totals.diskonAmount),
        round2(totals.dpp),
        po.po_harga_termasuk_pajak ? "Ya" : "Tidak",
        isItemTaxMode ? "Per Item" : "Dokumen",
        round2(totals.ppnAmount),
        round2(Number(po.po_ongkir) || 0),
        round2(totals.totalPo),
        round2(totals.pphAmount),
        round2(totals.dibayarKeVendor),
      );
    }
    summaryRows.push(summary);
    const sKeys: (string | undefined)[] = [];
    sKeys[statusColIdxSummary] = statusKey;
    summaryStatus.push(sKeys);

    for (const item of poItems) {
      const qty = Number(item.qty) || 0;
      const received = Number(item.qty_received) || 0;
      const row: unknown[] = [
        itemRows.length + 1,
        po.po_kode || null,
        jenisPoLabel(po),
        toCellDate(po.po_tanggal),
        statusLabel,
        one(item.vendors)?.vendor_name || null,
        refMr(item),
        refPr(item),
        item.ost_proyek_ref || null,
        item.part_number || null,
        item.part_name || null,
        item.satuan || null,
        qty,
        received,
        Math.max(0, qty - received),
        pendingByPoItem.get(item.id) || 0,
        Number(item.qty_cancelled) > 0
          ? received > 0
            ? "Sebagian, sisa batal"
            : "Dibatalkan"
          : received <= 0
            ? "Belum"
            : received >= qty
              ? "Lengkap"
              : "Sebagian",
        Number(item.qty_cancelled) || 0,
        item.item_detail_status || null,
        toCellDate(item.item_estimasi),
      ];
      if (canViewPrice) {
        row.push(
          currency,
          round2(Number(item.harga) || 0),
          round2(qty * (Number(item.harga) || 0)),
          isItemTaxMode ? formatItemTax(itemTaxFromRow(item)) : "Ikut dokumen",
        );
      }
      itemRows.push(row);
      const iKeys: (string | undefined)[] = [];
      iKeys[statusColIdxItem] = statusKey;
      itemStatus.push(iKeys);
    }
  });

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "WMS-GMI";
  wb.created = new Date();

  const subtitle = `Diekspor: ${formatExportedAt(new Date())}  •  ${poRows.length} PO, ${itemRows.length} baris item  •  Filter: ${opts.filterDescription}${canViewPrice ? "" : "  •  Nominal disembunyikan (khusus Purchasing)"}`;

  writeTableSheet(
    wb.addWorksheet("Ringkasan PO"),
    "RINGKASAN PURCHASE ORDER",
    subtitle,
    summaryCols,
    summaryRows,
    { freezeCols: 2, statusKeys: summaryStatus },
  );
  writeTableSheet(
    wb.addWorksheet("Detail Item"),
    "DETAIL ITEM PURCHASE ORDER",
    subtitle,
    itemCols,
    itemRows,
    { freezeCols: 2, statusKeys: itemStatus },
  );

  return { workbook: wb, poCount: poRows.length, itemCount: itemRows.length };
}
