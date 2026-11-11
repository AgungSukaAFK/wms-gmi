// Bentuk JSON dari RPC get_main_dashboard_summary / get_main_dashboard_list
// (supabase/migrations/20261111120000_main_dashboard.sql).

export type DashboardRole = { name: string; label: string };

export type DashboardViewer = {
  id: string;
  nama: string | null;
  cabang_id: number | null;
  cabang: string | null;
  roles: DashboardRole[];
  /** Boleh melihat analitik seluruh perusahaan (moderator/manager/spv/pjo/gl). */
  is_exec: boolean;
  /** Boleh melihat nilai Rupiah PO (purchasing). */
  can_value: boolean;
};

/** Angka antrian (state saat ini). Key = "kind" daftar drill-down-nya. */
export type QueueKey =
  | "mr_open"
  | "mr_overdue"
  | "mr_frozen"
  | "mr_need_pr"
  | "pr_open"
  | "pr_need_po"
  | "po_open"
  | "po_not_received"
  | "po_overdue"
  | "ri_open"
  | "it_open"
  | "it_active"
  | "dlv_ongoing"
  | "stock_request_open"
  | "supply_in_transit"
  | "supply_overdue"
  | "wo_pending"
  | "wo_on_process"
  | "jc_open"
  | "freeze_open"
  | "stock_low"
  | "stock_over"
  | "so_active"
  | "so_overdue"
  | "do_active"
  | "spb_belum_po"
  | "spb_po_belum_do"
  | "spb_do_belum_invoice"
  | "invoice_unpaid"
  | "invoice_open";

export type DashboardQueue = Record<QueueKey, number> & {
  it_packing: number;
  it_in_transit: number;
  it_delivered: number;
  stock_tracked: number;
};

export type CurPrev = { cur: number; prev: number | null };
export type LeadTime = { cur: number | null; prev: number | null; n: number };

export type PeriodKey = "mr" | "pr" | "po" | "ri" | "it" | "wo" | "spb" | "so";

export type DashboardPeriod = Record<PeriodKey, CurPrev> & {
  mr_status: { open: number; approved: number; completed: number; rejected: number };
  po_receive: { pending: number; partial: number; complete: number };
  mr_fulfillment: { qty_request: number; qty_received: number };
};

export type ApprovalDocType =
  | "mr"
  | "pr"
  | "po"
  | "ri"
  | "it"
  | "wo"
  | "spb"
  | "spb_invoice"
  | "return_spb";

export type MyApprovalRow = {
  doc_type: ApprovalDocType;
  id: number;
  kode: string;
  href: string;
  lokasi: string | null;
  tanggal: string | null;
  umur_hari: number;
};

export type AgingRow = {
  doc_type: ApprovalDocType;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  total: number;
  oldest: number;
};

export type ApproverRow = {
  id: string | null;
  nama: string;
  jumlah: number;
  terlama: number;
  rata: number;
};

export type DashboardApproval = {
  total: number;
  mine: number;
  mine_rows: MyApprovalRow[];
  stale: number;
  aging: AgingRow[] | null;
  approvers: ApproverRow[] | null;
};

export type TrendPoint = { d: string; mr: number; pr: number; po: number; ri: number };

export type MrLevelBucket =
  | "WAITING_APPROVAL"
  | "OPEN_1"
  | "OPEN_2"
  | "OPEN_3_5"
  | "CLOSE_1"
  | "CLOSE_2";

export type DashboardExec = {
  lead_time: { mr_pr: LeadTime; pr_po: LeadTime; po_ri: LeadTime };
  trend: TrendPoint[];
  trend_from: string;
  mr_pipeline: Partial<Record<MrLevelBucket, number>>;
  mr_by_cabang: {
    cabang_id: number | null;
    nama: string;
    aktif: number;
    overdue: number;
    periode: number;
  }[];
  mr_by_kategori: { nama: string; jumlah: number }[];
  mr_by_priority: { nama: string; jumlah: number }[];
  stock_by_cabang: {
    cabang_id: number;
    nama: string;
    low: number;
    over: number;
    normal: number;
  }[];
  top_vendors: { nama: string; po: number; item: number; nilai: number | null }[];
  top_parts: {
    part_number: string;
    part_name: string | null;
    mr: number;
    qty: number;
    satuan: string | null;
  }[];
};

export type PoValueRow = {
  currency: string;
  cur: number;
  prev: number | null;
  outstanding: number;
};

export type DashboardSummary = {
  viewer: DashboardViewer | null;
  /** Lokasi yang benar-benar dipakai (kosong = semua). */
  cabang_ids: number[];
  cabang_options: { id: number; nama: string }[];
  today: string;
  date_from: string;
  date_to: string;
  prev_from: string | null;
  prev_to: string | null;
  queue: DashboardQueue;
  approval: DashboardApproval;
  period: DashboardPeriod;
  /** null = user tidak berhak melihat nilai Rupiah. */
  po_value: PoValueRow[] | null;
  /** null = user bukan atasan. */
  exec: DashboardExec | null;
};

/** Jenis daftar drill-down (p_kind di get_main_dashboard_list). */
export type ListKind =
  | QueueKey
  | "approval_pending"
  | "mr_level"
  | "mr_period"
  | "pr_period"
  | "po_period"
  | "ri_period"
  | "it_period"
  | "so_period"
  | "spb_period";

export type ListArgs = Record<string, string | boolean>;

export type ListRow = Record<string, string | number | null> & {
  id: number;
  kode: string | null;
  href: string;
};

export type ListResult = { total: number; rows: ListRow[] };

/** Filter yang dikirim ke RPC daftar (sudah final, hasil resolve di server). */
export type ListScope = {
  /** Hari ini (WIB), untuk link halaman daftar yang butuh batas tanggal. */
  today: string;
  cabangIds: number[];
  from: string;
  to: string;
  kategori: string[];
  priorities: string[];
};
