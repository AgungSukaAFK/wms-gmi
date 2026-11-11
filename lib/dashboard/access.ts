// Section dashboard per role. Role "atasan" (is_exec, ditentukan di SQL
// dashboard_viewer) melihat seluruh ringkasan; role lain melihat grup fokus
// di bawah ini, default lokasi = cabangnya sendiri.

import type { DashboardRole, PeriodKey, QueueKey } from "@/lib/dashboard/types";

export type FocusGroupKey =
  | "purchasing"
  | "warehouse"
  | "planning"
  | "production"
  | "service"
  | "sales"
  | "finance";

export type FocusGroup = {
  key: FocusGroupKey;
  title: string;
  description: string;
  /** Kartu antrian, urut dari yang paling perlu ditindak. */
  cards: QueueKey[];
  /** Aktivitas periode yang relevan (kartu dengan pembanding). */
  period: PeriodKey[];
};

export const FOCUS_GROUPS: Record<FocusGroupKey, FocusGroup> = {
  purchasing: {
    key: "purchasing",
    title: "Purchasing",
    description: "PR yang perlu dibuatkan PO dan PO yang belum selesai diterima.",
    cards: ["pr_need_po", "po_overdue", "po_not_received", "po_open", "pr_open", "mr_need_pr"],
    period: ["pr", "po"],
  },
  warehouse: {
    key: "warehouse",
    title: "Gudang & logistik",
    description: "Penerimaan, pengiriman antar lokasi, dan kondisi stok.",
    cards: [
      "ri_open",
      "po_not_received",
      "stock_low",
      "it_open",
      "it_active",
      "dlv_ongoing",
      "supply_in_transit",
      "stock_request_open",
    ],
    period: ["ri", "it"],
  },
  planning: {
    key: "planning",
    title: "Perencanaan material",
    description: "Material Request yang masih berjalan dan kendalanya.",
    cards: ["mr_overdue", "mr_open", "mr_need_pr", "mr_frozen", "freeze_open", "stock_low"],
    period: ["mr"],
  },
  production: {
    key: "production",
    title: "Produksi",
    description: "Working Order dan Job Costing yang belum selesai.",
    cards: ["wo_pending", "wo_on_process", "jc_open"],
    period: ["wo"],
  },
  service: {
    key: "service",
    title: "Service",
    description: "Permintaan material dan SPB yang masih berjalan.",
    cards: ["mr_overdue", "mr_open", "spb_belum_po", "it_active"],
    period: ["mr", "spb"],
  },
  sales: {
    key: "sales",
    title: "Penjualan",
    description: "SO Reguler, DO, dan progres SPB sampai invoice.",
    cards: [
      "so_overdue",
      "so_active",
      "do_active",
      "spb_belum_po",
      "spb_po_belum_do",
      "spb_do_belum_invoice",
    ],
    period: ["so", "spb"],
  },
  finance: {
    key: "finance",
    title: "Finance",
    description: "Invoice SPB yang belum dibayar atau belum disetujui.",
    cards: ["invoice_unpaid", "invoice_open", "spb_do_belum_invoice"],
    period: [],
  },
};

const ROLE_FOCUS: Record<string, FocusGroupKey[]> = {
  purchasing: ["purchasing"],
  logistik: ["warehouse"],
  admin: ["warehouse", "planning"],
  ppic: ["planning"],
  manufaktur: ["production"],
  service: ["service"],
  marketing: ["sales"],
  finance: ["finance"],
};

/** Grup fokus untuk user dengan role-role ini (gabungan, tanpa duplikat). */
export function focusGroupsForRoles(roles: DashboardRole[]): FocusGroup[] {
  const keys: FocusGroupKey[] = [];
  for (const role of roles) {
    for (const key of ROLE_FOCUS[role.name] ?? []) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys.map((k) => FOCUS_GROUPS[k]);
}
