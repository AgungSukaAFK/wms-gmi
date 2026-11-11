// Definisi kartu & daftar drill-down dashboard utama, satu tempat:
// label, ikon, kolom tabel, dan link ke halaman daftar dengan filter setara.

import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeDollarSign,
  Calculator,
  CalendarClock,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  FileText,
  FileWarning,
  Handshake,
  type LucideIcon,
  PackageCheck,
  PackageSearch,
  PackageX,
  ReceiptText,
  ShoppingCart,
  Snowflake,
  Truck,
  Warehouse,
} from "lucide-react";
import type {
  ApprovalDocType,
  ListArgs,
  ListKind,
  ListScope,
  MrLevelBucket,
  PeriodKey,
  QueueKey,
} from "@/lib/dashboard/types";
import { addDays } from "@/lib/dashboard/filters";

/** Warna kartu saat angkanya > 0. */
export type Tone = "critical" | "warning" | "info" | "neutral";

export type CardDef = {
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: Tone;
};

export const QUEUE_CARDS: Record<QueueKey, CardDef> = {
  mr_open: { label: "MR menunggu approval", hint: "Belum disetujui", icon: FileText, tone: "info" },
  mr_overdue: { label: "MR lewat due date", hint: "Masih berjalan, sudah lewat tenggat", icon: CalendarClock, tone: "critical" },
  mr_frozen: { label: "MR dibekukan", hint: "Freeze karena lewat deadline", icon: Snowflake, tone: "warning" },
  mr_need_pr: { label: "MR perlu dibuatkan PR", hint: "Approved, PR belum lengkap", icon: FileSpreadsheet, tone: "warning" },
  pr_open: { label: "PR menunggu approval", hint: "Belum disetujui", icon: FileSpreadsheet, tone: "info" },
  pr_need_po: { label: "PR perlu dibuatkan PO", hint: "Approved, PO belum lengkap", icon: ShoppingCart, tone: "warning" },
  po_open: { label: "PO menunggu approval", hint: "Belum disetujui", icon: ShoppingCart, tone: "info" },
  po_not_received: { label: "PO belum diterima penuh", hint: "Approved, barang belum lengkap", icon: PackageSearch, tone: "info" },
  po_overdue: { label: "PO lewat estimasi tiba", hint: "Belum diterima penuh", icon: CalendarClock, tone: "critical" },
  ri_open: { label: "Receive Item menunggu approval", hint: "Stok belum bertambah", icon: PackageCheck, tone: "info" },
  it_open: { label: "Item Transfer menunggu approval", hint: "Belum disetujui", icon: ArrowLeftRight, tone: "info" },
  it_active: { label: "Item Transfer berjalan", hint: "Approved, belum selesai", icon: ArrowLeftRight, tone: "info" },
  dlv_ongoing: { label: "Delivery berjalan", hint: "Belum selesai diterima", icon: Truck, tone: "info" },
  stock_request_open: { label: "Request stok terbuka", hint: "Minta pengaturan min/max", icon: ClipboardList, tone: "warning" },
  supply_in_transit: { label: "Barang dalam pengiriman", hint: "Share stock menuju lokasi", icon: PackageSearch, tone: "info" },
  supply_overdue: { label: "Pengiriman lewat deadline", hint: "Belum sampai di tujuan", icon: CalendarClock, tone: "critical" },
  wo_pending: { label: "WO menunggu approval", hint: "Belum disetujui", icon: Factory, tone: "info" },
  wo_on_process: { label: "WO sedang dikerjakan", hint: "On process", icon: Factory, tone: "info" },
  jc_open: { label: "Job Costing terbuka", hint: "Belum selesai", icon: Calculator, tone: "info" },
  freeze_open: { label: "Laporan kendala MR", hint: "Belum ditindaklanjuti", icon: AlertTriangle, tone: "warning" },
  stock_low: { label: "Stok di bawah minimum", hint: "Perlu diisi ulang", icon: PackageX, tone: "critical" },
  stock_over: { label: "Stok melebihi maksimum", hint: "Overstock", icon: Warehouse, tone: "warning" },
  so_active: { label: "SO Reguler berjalan", hint: "Open atau partial", icon: Handshake, tone: "info" },
  so_overdue: { label: "SO Reguler lewat due date", hint: "Belum terkirim penuh", icon: CalendarClock, tone: "critical" },
  do_active: { label: "DO Reguler berjalan", hint: "Belum selesai", icon: Truck, tone: "info" },
  spb_belum_po: { label: "SPB belum ada PO customer", hint: "Masih tahap quotation", icon: FileWarning, tone: "warning" },
  spb_po_belum_do: { label: "SPB sudah PO, belum DO", hint: "Menunggu pengiriman", icon: Truck, tone: "info" },
  spb_do_belum_invoice: { label: "SPB sudah DO, belum invoice", hint: "Belum ditagihkan", icon: ReceiptText, tone: "warning" },
  invoice_unpaid: { label: "Invoice belum dibayar", hint: "Invoice SPB unpaid", icon: BadgeDollarSign, tone: "warning" },
  invoice_open: { label: "Invoice menunggu approval", hint: "Belum disetujui", icon: ReceiptText, tone: "info" },
};

export const PERIOD_CARDS: Record<PeriodKey, { label: string; icon: LucideIcon; kind: ListKind | null }> = {
  mr: { label: "Material Request", icon: FileText, kind: "mr_period" },
  pr: { label: "Purchase Request", icon: FileSpreadsheet, kind: "pr_period" },
  po: { label: "Purchase Order", icon: ShoppingCart, kind: "po_period" },
  ri: { label: "Receive Item", icon: PackageCheck, kind: "ri_period" },
  it: { label: "Item Transfer", icon: ArrowLeftRight, kind: "it_period" },
  wo: { label: "Working Order", icon: Factory, kind: null },
  spb: { label: "SPB", icon: FileWarning, kind: "spb_period" },
  so: { label: "SO Reguler", icon: Handshake, kind: "so_period" },
};

export const DOC_TYPE_LABEL: Record<ApprovalDocType, string> = {
  mr: "Material Request",
  pr: "Purchase Request",
  po: "Purchase Order",
  ri: "Receive Item",
  it: "Item Transfer",
  wo: "Working Order",
  spb: "SPB",
  spb_invoice: "Invoice SPB",
  return_spb: "Return SPB",
};

export const DOC_TYPE_SHORT: Record<ApprovalDocType, string> = {
  mr: "MR",
  pr: "PR",
  po: "PO",
  ri: "RI",
  it: "IT",
  wo: "WO",
  spb: "SPB",
  spb_invoice: "Invoice",
  return_spb: "Return",
};

export const AGE_BUCKETS = [
  { key: "0", field: "b0", label: "0–2 hari" },
  { key: "1", field: "b1", label: "3–7 hari" },
  { key: "2", field: "b2", label: "8–14 hari" },
  { key: "3", field: "b3", label: "> 14 hari" },
] as const;

export const MR_LEVELS: { key: MrLevelBucket; label: string; description: string }[] = [
  { key: "WAITING_APPROVAL", label: "Menunggu approval", description: "MR belum disetujui" },
  { key: "OPEN_1", label: "OPEN 1", description: "PR belum dibuat" },
  { key: "OPEN_2", label: "OPEN 2", description: "PO / WO belum dibuat" },
  { key: "OPEN_3_5", label: "OPEN 3–5", description: "PO dibuat, barang belum diterima" },
  { key: "CLOSE_1", label: "CLOSE 1", description: "Diterima sebagian" },
  { key: "CLOSE_2", label: "CLOSE 2", description: "Diterima penuh, belum ditutup" },
];

// ------------------------------------------------------------------
// Daftar drill-down
// ------------------------------------------------------------------

export type ColumnKey =
  | "kode"
  | "doc_type"
  | "tanggal"
  | "due_date"
  | "estimasi"
  | "deadline"
  | "hari_lewat"
  | "umur_hari"
  | "lokasi"
  | "rute"
  | "pic"
  | "approver"
  | "status"
  | "status_po"
  | "status_terima"
  | "level"
  | "kategori"
  | "vendor"
  | "qty_terima"
  | "nilai"
  | "part_name"
  | "qty"
  | "min_qty"
  | "max_qty"
  | "selisih"
  | "customer"
  | "tracking"
  | "catatan"
  | "alasan"
  | "mr_kode"
  | "po_kode"
  | "spb_no"
  | "no_wo"
  | "kode_unit"
  | "tahap"
  | "pembayaran"
  | "departemen";

export type ListDef = {
  title: string;
  description: string;
  /** Kata benda untuk footer & tombol, mis. "MR". */
  itemLabel: string;
  /** Label kolom "kode" (default "Kode"). */
  kodeLabel?: string;
  columns: ColumnKey[];
  /** Yang bisa dicari di kotak pencarian. */
  searchable: string[];
  /** Urutan baris dari server. */
  order: string;
  /** Halaman daftar dengan filter setara (null = tidak ada). */
  page?: (scope: ListScope, args: ListArgs) => { href: string; label: string } | null;
};

/** Query string halaman daftar: buang nilai kosong, array digabung koma. */
function listUrl(path: string, params: Record<string, string | string[] | number[] | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const str = Array.isArray(value) ? value.join(",") : (value ?? "");
    if (str) qs.set(key, str);
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

const mrParams = (scope: ListScope) => ({
  lokasi: scope.cabangIds,
  kategori: scope.kategori,
  prioritas: scope.priorities,
});
const periodParams = (scope: ListScope) => ({ dari: scope.from, sampai: scope.to });

const MR_COLUMNS: ColumnKey[] = ["kode", "tanggal", "due_date", "hari_lewat", "lokasi", "pic", "kategori", "level", "status"];
const MR_SEARCH = ["Kode MR", "PIC", "Lokasi", "Kategori"];
const PO_COLUMNS: ColumnKey[] = ["kode", "tanggal", "estimasi", "hari_lewat", "lokasi", "vendor", "qty_terima", "status_terima", "nilai", "status"];
const PO_SEARCH = ["Kode PO", "PIC", "Lokasi", "Vendor"];

export const LIST_DEFS: Record<ListKind, ListDef> = {
  // ---- Material Request
  mr_open: {
    title: "MR menunggu approval",
    description: "Material Request berstatus open, belum selesai disetujui.",
    itemLabel: "MR",
    columns: ["kode", "tanggal", "umur_hari", "due_date", "lokasi", "pic", "kategori", "status"],
    searchable: MR_SEARCH,
    order: "Paling lama menunggu di atas",
    page: (s) => ({ href: listUrl("/mr", { ...mrParams(s), status: "open" }), label: "Buka di Material Request" }),
  },
  mr_overdue: {
    title: "MR lewat due date",
    description: "MR berstatus open atau approved yang due date-nya sudah lewat.",
    itemLabel: "MR",
    columns: MR_COLUMNS,
    searchable: MR_SEARCH,
    order: "Paling lama terlambat di atas",
    page: (s) => ({ href: listUrl("/mr", { ...mrParams(s), kondisi: "lewat_due" }), label: "Buka di Material Request" }),
  },
  mr_frozen: {
    title: "MR dibekukan",
    description: "MR yang sedang di-freeze.",
    itemLabel: "MR",
    columns: ["kode", "tanggal", "due_date", "lokasi", "pic", "catatan", "status"],
    searchable: MR_SEARCH,
    order: "MR terlama di atas",
    page: (s) => ({ href: listUrl("/mr", { ...mrParams(s), kondisi: "frozen" }), label: "Buka di Material Request" }),
  },
  mr_need_pr: {
    title: "MR perlu dibuatkan PR",
    description: "MR approved yang jatah PR-nya belum atau baru sebagian dibuatkan PR.",
    itemLabel: "MR",
    columns: ["kode", "tanggal", "umur_hari", "due_date", "lokasi", "pic", "kategori", "status"],
    searchable: MR_SEARCH,
    order: "MR terlama di atas",
    page: (s) => ({
      href: listUrl("/mr", { ...mrParams(s), status: "approved", konversi: ["pending", "partial"] }),
      label: "Buka di Material Request",
    }),
  },
  mr_level: {
    title: "MR per level",
    description: "MR aktif pada level progres yang dipilih.",
    itemLabel: "MR",
    columns: MR_COLUMNS,
    searchable: MR_SEARCH,
    order: "MR terlama di atas",
    page: (s) => ({ href: listUrl("/mr", { ...mrParams(s), status: ["open", "approved"] }), label: "Buka di Material Request" }),
  },
  mr_period: {
    title: "MR pada periode ini",
    description: "Material Request dengan tanggal MR di dalam periode.",
    itemLabel: "MR",
    columns: MR_COLUMNS,
    searchable: MR_SEARCH,
    order: "Terbaru di atas",
    page: (s, a) => ({
      href: listUrl("/mr", { ...mrParams(s), ...periodParams(s), status: typeof a.status === "string" ? a.status : undefined }),
      label: "Buka di Material Request",
    }),
  },

  // ---- Purchase Request
  pr_open: {
    title: "PR menunggu approval",
    description: "Purchase Request berstatus open.",
    itemLabel: "PR",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "pic", "mr_kode", "status"],
    searchable: ["Kode PR", "PIC", "Lokasi", "Kode MR"],
    order: "Paling lama menunggu di atas",
    page: (s) => ({ href: listUrl("/pr", { lokasi: s.cabangIds, status: "open" }), label: "Buka di Purchase Request" }),
  },
  pr_need_po: {
    title: "PR perlu dibuatkan PO",
    description: "PR approved yang belum atau baru sebagian dibuatkan PO.",
    itemLabel: "PR",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "pic", "mr_kode", "status_po"],
    searchable: ["Kode PR", "PIC", "Lokasi", "Kode MR"],
    order: "PR terlama di atas",
    page: (s) => ({
      href: listUrl("/pr", { lokasi: s.cabangIds, status: "approved", status_po: ["pending", "partial"] }),
      label: "Buka di Purchase Request",
    }),
  },
  pr_period: {
    title: "PR pada periode ini",
    description: "Purchase Request dengan tanggal PR di dalam periode.",
    itemLabel: "PR",
    columns: ["kode", "tanggal", "lokasi", "pic", "mr_kode", "status_po", "status"],
    searchable: ["Kode PR", "PIC", "Lokasi", "Kode MR"],
    order: "Terbaru di atas",
    page: (s) => ({ href: listUrl("/pr", { lokasi: s.cabangIds, ...periodParams(s) }), label: "Buka di Purchase Request" }),
  },

  // ---- Purchase Order
  po_open: {
    title: "PO menunggu approval",
    description: "Purchase Order berstatus open.",
    itemLabel: "PO",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "vendor", "pic", "nilai", "status"],
    searchable: PO_SEARCH,
    order: "Paling lama menunggu di atas",
    page: (s) => ({ href: listUrl("/po", { lokasi: s.cabangIds, status: "open" }), label: "Buka di Purchase Order" }),
  },
  po_not_received: {
    title: "PO belum diterima penuh",
    description: "PO approved yang barangnya belum atau baru sebagian diterima.",
    itemLabel: "PO",
    columns: PO_COLUMNS,
    searchable: PO_SEARCH,
    order: "Paling lama lewat estimasi di atas",
    page: (s) => ({
      href: listUrl("/po", { lokasi: s.cabangIds, status: "approved", status_terima: ["pending", "partial"] }),
      label: "Buka di Purchase Order",
    }),
  },
  po_overdue: {
    title: "PO lewat estimasi tiba",
    description: "PO approved yang estimasi tibanya sudah lewat tetapi belum diterima penuh.",
    itemLabel: "PO",
    columns: PO_COLUMNS,
    searchable: PO_SEARCH,
    order: "Paling lama terlambat di atas",
    page: (s) => ({
      href: listUrl("/po", {
        lokasi: s.cabangIds,
        status: "approved",
        status_terima: ["pending", "partial"],
        estimasi_sampai: addDays(s.today, -1),
      }),
      label: "Buka di Purchase Order",
    }),
  },
  po_period: {
    title: "PO pada periode ini",
    description: "Purchase Order dengan tanggal PO di dalam periode.",
    itemLabel: "PO",
    columns: PO_COLUMNS,
    searchable: PO_SEARCH,
    order: "Terbaru di atas",
    page: (s, a) => ({
      href: listUrl("/po", {
        lokasi: s.cabangIds,
        ...periodParams(s),
        status_terima: typeof a.receive === "string" ? a.receive : undefined,
      }),
      label: "Buka di Purchase Order",
    }),
  },

  // ---- Receive Item
  ri_open: {
    title: "Receive Item menunggu approval",
    description: "Penerimaan barang yang belum disetujui, jadi stoknya belum bertambah.",
    itemLabel: "RI",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "pic", "po_kode", "status"],
    searchable: ["Kode RI", "PIC", "Lokasi", "Kode PO"],
    order: "Paling lama menunggu di atas",
    page: (s) => ({ href: listUrl("/receive", { lokasi: s.cabangIds, status: "open" }), label: "Buka di Receive Item" }),
  },
  ri_period: {
    title: "Receive Item pada periode ini",
    description: "Penerimaan barang dengan tanggal RI di dalam periode.",
    itemLabel: "RI",
    columns: ["kode", "tanggal", "lokasi", "pic", "po_kode", "status"],
    searchable: ["Kode RI", "PIC", "Lokasi", "Kode PO"],
    order: "Terbaru di atas",
    page: (s) => ({ href: listUrl("/receive", { lokasi: s.cabangIds, ...periodParams(s) }), label: "Buka di Receive Item" }),
  },

  // ---- Approval
  approval_pending: {
    title: "Dokumen menunggu approval",
    description: "Approver = orang yang gilirannya menyetujui sekarang. Umur dihitung sejak langkah sebelumnya selesai.",
    itemLabel: "dokumen",
    kodeLabel: "Dokumen",
    columns: ["doc_type", "kode", "tanggal", "lokasi", "approver", "umur_hari"],
    searchable: ["Nomor dokumen", "Approver", "Lokasi"],
    order: "Paling lama menunggu di atas",
  },

  // ---- Stok
  stock_low: {
    title: "Stok di bawah minimum",
    description: "Barang yang qty-nya kurang dari batas minimum di lokasinya.",
    itemLabel: "barang",
    kodeLabel: "Part number",
    columns: ["kode", "part_name", "lokasi", "qty", "min_qty", "max_qty", "selisih"],
    searchable: ["Part number", "Nama barang", "Lokasi"],
    order: "Kekurangan terbesar di atas",
    page: (s) => ({ href: listUrl("/stock", { cabang: s.cabangIds, status: "low" }), label: "Buka di Stock" }),
  },
  stock_over: {
    title: "Stok melebihi maksimum",
    description: "Barang yang qty-nya di atas batas maksimum di lokasinya.",
    itemLabel: "barang",
    kodeLabel: "Part number",
    columns: ["kode", "part_name", "lokasi", "qty", "min_qty", "max_qty", "selisih"],
    searchable: ["Part number", "Nama barang", "Lokasi"],
    order: "Kelebihan terbesar di atas",
    page: (s) => ({ href: listUrl("/stock", { cabang: s.cabangIds, status: "overstock" }), label: "Buka di Stock" }),
  },

  // ---- Item Transfer / Delivery
  it_open: {
    title: "Item Transfer menunggu approval",
    description: "Item Transfer berstatus open.",
    itemLabel: "IT",
    columns: ["kode", "tanggal", "umur_hari", "rute", "pic", "status"],
    searchable: ["Kode IT", "PIC", "Lokasi asal/tujuan", "No. resi"],
    order: "Paling lama menunggu di atas",
    page: (s) => ({ href: listUrl("/item-transfer", { lokasi: s.cabangIds, status: "open" }), label: "Buka di Item Transfer" }),
  },
  it_active: {
    title: "Item Transfer berjalan",
    description: "Item Transfer approved yang belum selesai diterima.",
    itemLabel: "IT",
    columns: ["kode", "tanggal", "umur_hari", "rute", "tracking", "pic"],
    searchable: ["Kode IT", "PIC", "Lokasi asal/tujuan", "No. resi"],
    order: "IT terlama di atas",
    page: (s) => ({ href: listUrl("/item-transfer", { lokasi: s.cabangIds, status: "approved" }), label: "Buka di Item Transfer" }),
  },
  it_period: {
    title: "Item Transfer pada periode ini",
    description: "Item Transfer dengan tanggal IT di dalam periode.",
    itemLabel: "IT",
    columns: ["kode", "tanggal", "rute", "tracking", "pic", "status"],
    searchable: ["Kode IT", "PIC", "Lokasi asal/tujuan", "No. resi"],
    order: "Terbaru di atas",
    page: (s) => ({ href: listUrl("/item-transfer", { lokasi: s.cabangIds, ...periodParams(s) }), label: "Buka di Item Transfer" }),
  },
  dlv_ongoing: {
    title: "Delivery berjalan",
    description: "Delivery yang belum selesai diterima.",
    itemLabel: "delivery",
    columns: ["kode", "tanggal", "umur_hari", "rute", "tracking", "pic", "status"],
    searchable: ["Kode delivery", "PIC", "Lokasi asal/tujuan", "No. resi"],
    order: "Delivery terlama di atas",
    page: () => ({ href: "/deliveries", label: "Buka di Delivery" }),
  },
  stock_request_open: {
    title: "Request stok terbuka",
    description: "Permintaan pengaturan min/max stok yang belum diselesaikan.",
    itemLabel: "request",
    kodeLabel: "Part number",
    columns: ["kode", "part_name", "lokasi", "alasan", "qty", "max_qty", "pic", "umur_hari"],
    searchable: ["Part number", "Nama barang", "Lokasi", "Pemohon"],
    order: "Paling lama menunggu di atas",
    page: () => ({ href: listUrl("/stock-requests", { status: "open" }), label: "Buka di Request Stok" }),
  },
  supply_in_transit: {
    title: "Barang dalam pengiriman",
    description: "Share stock yang sedang dikirim ke lokasi tujuan.",
    itemLabel: "barang",
    kodeLabel: "Part number",
    columns: ["kode", "part_name", "qty", "rute", "deadline", "hari_lewat", "mr_kode"],
    searchable: ["Part number", "Nama barang", "Lokasi", "Kode MR", "Kode delivery"],
    order: "Deadline paling lewat di atas",
    page: () => ({ href: listUrl("/planning-supply", { status: "in_transit" }), label: "Buka di Barang dalam Pengiriman" }),
  },
  supply_overdue: {
    title: "Pengiriman lewat deadline",
    description: "Share stock yang belum sampai padahal deadline-nya sudah lewat.",
    itemLabel: "barang",
    kodeLabel: "Part number",
    columns: ["kode", "part_name", "qty", "rute", "deadline", "hari_lewat", "mr_kode"],
    searchable: ["Part number", "Nama barang", "Lokasi", "Kode MR", "Kode delivery"],
    order: "Paling lama terlambat di atas",
    page: () => ({ href: listUrl("/planning-supply", { status: "in_transit" }), label: "Buka di Barang dalam Pengiriman" }),
  },

  // ---- Produksi
  wo_pending: {
    title: "WO menunggu approval",
    description: "Working Order yang belum disetujui.",
    itemLabel: "WO",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "departemen", "mr_kode", "pic"],
    searchable: ["Kode WO", "Departemen", "Gudang", "Kode MR"],
    order: "Paling lama menunggu di atas",
    page: () => ({ href: listUrl("/working-order", { status: "Pending Approval" }), label: "Buka di Working Order" }),
  },
  wo_on_process: {
    title: "WO sedang dikerjakan",
    description: "Working Order berstatus On Process.",
    itemLabel: "WO",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "departemen", "mr_kode", "pic"],
    searchable: ["Kode WO", "Departemen", "Gudang", "Kode MR"],
    order: "WO terlama di atas",
    page: () => ({ href: listUrl("/working-order", { status: "On Process" }), label: "Buka di Working Order" }),
  },
  jc_open: {
    title: "Job Costing terbuka",
    description: "Job Costing yang belum selesai.",
    itemLabel: "job",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "catatan"],
    searchable: ["Kode job", "Deskripsi", "Lokasi", "Finish part"],
    order: "Job terlama di atas",
    page: (s) => ({ href: listUrl("/job-costing", { lokasi: s.cabangIds, status: "open" }), label: "Buka di Job Costing" }),
  },
  freeze_open: {
    title: "Laporan kendala MR",
    description: "Laporan kendala dari MR yang dibekukan dan belum ditindaklanjuti.",
    itemLabel: "laporan",
    kodeLabel: "Kode MR",
    columns: ["kode", "tanggal", "umur_hari", "lokasi", "pic", "catatan"],
    searchable: ["Kode MR", "Kendala", "Lokasi", "Pelapor"],
    order: "Paling lama menunggu di atas",
  },

  // ---- Penjualan
  so_active: {
    title: "SO Reguler berjalan",
    description: "Sales Order berstatus open atau partial.",
    itemLabel: "SO",
    columns: ["kode", "tanggal", "due_date", "hari_lewat", "customer", "lokasi", "kategori", "status"],
    searchable: ["Kode SO", "Customer", "Lokasi", "No. PO customer"],
    order: "Due date paling dekat/lewat di atas",
    page: () => ({ href: listUrl("/so-reguler/so", { status: ["open", "partial"] }), label: "Buka di SO Reguler" }),
  },
  so_overdue: {
    title: "SO Reguler lewat due date",
    description: "Sales Order yang belum terkirim penuh padahal due date sudah lewat.",
    itemLabel: "SO",
    columns: ["kode", "tanggal", "due_date", "hari_lewat", "customer", "lokasi", "kategori", "status"],
    searchable: ["Kode SO", "Customer", "Lokasi", "No. PO customer"],
    order: "Paling lama terlambat di atas",
    page: () => ({ href: listUrl("/so-reguler/so", { status: ["open", "partial"] }), label: "Buka di SO Reguler" }),
  },
  so_period: {
    title: "SO Reguler pada periode ini",
    description: "Sales Order (selain yang dibatalkan) dengan tanggal SO di dalam periode.",
    itemLabel: "SO",
    columns: ["kode", "tanggal", "due_date", "customer", "lokasi", "kategori", "status"],
    searchable: ["Kode SO", "Customer", "Lokasi", "No. PO customer"],
    order: "Terbaru di atas",
    page: (s) => ({ href: listUrl("/so-reguler/so", periodParams(s)), label: "Buka di SO Reguler" }),
  },
  do_active: {
    title: "DO Reguler berjalan",
    description: "Delivery Order reguler yang belum selesai.",
    itemLabel: "DO",
    columns: ["kode", "tanggal", "umur_hari", "customer", "lokasi", "tracking", "pic"],
    searchable: ["Kode DO", "Customer", "Lokasi", "No. PO", "No. resi"],
    order: "DO terlama di atas",
    page: (s) => ({ href: listUrl("/so-reguler/do", { lokasi: s.cabangIds, status: "active" }), label: "Buka di DO Reguler" }),
  },
  spb_belum_po: {
    title: "SPB belum ada PO customer",
    description: "SPB aktif yang belum dibuatkan SPB PO.",
    itemLabel: "SPB",
    kodeLabel: "No. SPB",
    columns: ["kode", "tanggal", "umur_hari", "no_wo", "kode_unit", "lokasi", "pic", "status"],
    searchable: ["No. SPB", "No. WO", "Kode unit", "Lokasi", "PIC"],
    order: "SPB terlama di atas",
    page: (s) => ({ href: listUrl("/spb/dashboard", { lokasi: s.cabangIds }), label: "Buka Dashboard SPB" }),
  },
  spb_po_belum_do: {
    title: "SPB sudah PO, belum DO",
    description: "SPB yang sudah ada PO customer tetapi belum dibuatkan DO.",
    itemLabel: "SPB",
    kodeLabel: "No. SPB",
    columns: ["kode", "tanggal", "umur_hari", "no_wo", "kode_unit", "lokasi", "pic", "status"],
    searchable: ["No. SPB", "No. WO", "Kode unit", "Lokasi", "PIC"],
    order: "SPB terlama di atas",
    page: (s) => ({ href: listUrl("/spb/dashboard", { lokasi: s.cabangIds }), label: "Buka Dashboard SPB" }),
  },
  spb_do_belum_invoice: {
    title: "SPB sudah DO, belum invoice",
    description: "SPB yang sudah dikirim tetapi belum dibuatkan invoice.",
    itemLabel: "SPB",
    kodeLabel: "No. SPB",
    columns: ["kode", "tanggal", "umur_hari", "no_wo", "kode_unit", "lokasi", "pic", "status"],
    searchable: ["No. SPB", "No. WO", "Kode unit", "Lokasi", "PIC"],
    order: "SPB terlama di atas",
    page: (s) => ({ href: listUrl("/spb/dashboard", { lokasi: s.cabangIds }), label: "Buka Dashboard SPB" }),
  },
  spb_period: {
    title: "SPB pada periode ini",
    description: "SPB aktif (tanpa Cancelled) dengan tanggal SPB di dalam periode.",
    itemLabel: "SPB",
    kodeLabel: "No. SPB",
    columns: ["kode", "tanggal", "no_wo", "kode_unit", "lokasi", "pic", "tahap", "status"],
    searchable: ["No. SPB", "No. WO", "Kode unit", "Lokasi", "PIC"],
    order: "Terbaru di atas",
    page: (s) => ({ href: listUrl("/spb", { lokasi: s.cabangIds, ...periodParams(s) }), label: "Buka di SPB" }),
  },
  invoice_unpaid: {
    title: "Invoice belum dibayar",
    description: "Invoice SPB berstatus unpaid (tanpa invoice yang ditolak).",
    itemLabel: "invoice",
    kodeLabel: "No. invoice",
    columns: ["kode", "tanggal", "umur_hari", "spb_no", "no_wo", "lokasi", "status", "pembayaran"],
    searchable: ["No. invoice", "No. SPB", "No. WO", "Lokasi"],
    order: "Invoice terlama di atas",
    page: () => ({ href: "/spb/invoice", label: "Buka di Invoice SPB" }),
  },
  invoice_open: {
    title: "Invoice menunggu approval",
    description: "Invoice SPB yang belum disetujui.",
    itemLabel: "invoice",
    kodeLabel: "No. invoice",
    columns: ["kode", "tanggal", "umur_hari", "spb_no", "no_wo", "lokasi", "status"],
    searchable: ["No. invoice", "No. SPB", "No. WO", "Lokasi"],
    order: "Paling lama menunggu di atas",
    page: () => ({ href: "/spb/invoice", label: "Buka di Invoice SPB" }),
  },
};
