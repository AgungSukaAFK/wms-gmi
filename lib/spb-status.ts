// Status turunan SPB: Base Status (kelengkapan data awal sampai PIC PPA) dan
// Completing Status (progres PO -> DO -> Invoice -> Paid). Dihitung di DB
// (computed column spb_base_status / spb_base_missing /
// spb_completing_status, migration 20261111100000_spb_base_completing_status.sql);
// file ini cuma daftar nilai + gaya badge untuk UI.

export const SPB_BASE_STATUSES = ["Lengkap", "Belum Lengkap"] as const;
export type SpbBaseStatus = (typeof SPB_BASE_STATUSES)[number];

export const SPB_COMPLETING_STATUSES = [
  "Quotation",
  "PO Customer",
  "Delivered",
  "Invoiced",
  "Paid",
  "Cancelled",
] as const;
export type SpbCompletingStatus = (typeof SPB_COMPLETING_STATUSES)[number];

export function isSpbBaseStatus(value: unknown): value is SpbBaseStatus {
  return (SPB_BASE_STATUSES as readonly unknown[]).includes(value);
}

export function isSpbCompletingStatus(
  value: unknown,
): value is SpbCompletingStatus {
  return (SPB_COMPLETING_STATUSES as readonly unknown[]).includes(value);
}

const BADGE_BASE =
  "inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase";

export function spbBaseStatusClass(status?: string | null) {
  return `${BADGE_BASE} ${
    status === "Lengkap"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
      : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
  }`;
}

const COMPLETING_CLASS: Record<SpbCompletingStatus, string> = {
  Quotation:
    "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
  "PO Customer":
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  Delivered:
    "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  Invoiced:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  Paid:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Cancelled:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export function spbCompletingStatusClass(status?: string | null) {
  return `${BADGE_BASE} ${
    isSpbCompletingStatus(status)
      ? COMPLETING_CLASS[status]
      : COMPLETING_CLASS.Quotation
  }`;
}
