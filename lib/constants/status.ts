// Satu-satunya tempat status dokumen → warna & label default. Komponen
// tampilannya: components/status-badge.tsx.
//
// Arti warna: abu = menunggu approval, sky = aktif/proses, amber = sebagian,
// hijau = approved, emerald = selesai, merah = ditolak/dibatalkan.

const SOLID = "border-transparent text-white";

export const SOFT = {
  gray: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700",
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  sky: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  orange: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800",
  green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
} as const;

export const SOLID_TONE = {
  gray: "border-transparent bg-secondary text-secondary-foreground",
  blue: `${SOLID} bg-blue-500`,
  sky: `${SOLID} bg-cyan-500`,
  amber: `${SOLID} bg-amber-600`,
  orange: `${SOLID} bg-orange-500`,
  green: `${SOLID} bg-green-500`,
  emerald: `${SOLID} bg-emerald-600`,
  red: "border-transparent bg-destructive text-white",
} as const;

export type StatusColor = keyof typeof SOFT;

/** Nilai status di DB → warna. Status di luar daftar tampil abu-abu. */
export const STATUS_COLOR: Record<string, StatusColor> = {
  open: "gray",
  active: "sky",
  partial: "amber",
  approved: "green",
  completed: "emerald",
  // Status final lama (lihat lib/document-status.ts), setara completed.
  done: "emerald",
  closed: "emerald",
  rejected: "red",
  cancelled: "red",
};

/** Label default. Halaman yang memakai istilah lain mengirim `label`. */
export const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  active: "Aktif",
  partial: "Partial",
  approved: "Approved",
  completed: "Completed",
  done: "Completed",
  closed: "Completed",
  rejected: "Rejected",
  cancelled: "Dibatalkan",
};
