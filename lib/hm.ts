// Periodic Maintenance (modul HM Maintenance): tipe, aturan status, format
// tampilan, dan ekspor CSV. Mengikuti hm.md §3, §7, §8, §12 apa adanya —
// hitungan dueHm/remainingHm/status/replacedThisInterval sendiri dilakukan
// di view DB (hm_part_views), fungsi di sini dipakai untuk UI & CSV.

export type HmStatus = "aman" | "segera" | "lewat";
export type HmServiceKind = "rutin" | "perbaikan" | "inspeksi";

export type HmUnit = {
  id: number;
  code: string;
  name: string;
  model: string;
  current_hm: number;
  cabang_id: number | null;
};

export type HmUnitSummary = HmUnit & {
  part_count: number;
  aman_count: number;
  segera_count: number;
  lewat_count: number;
  not_replaced_count: number;
};

export type HmPartView = {
  id: number;
  unit_id: number;
  barang_id: number | null;
  code: string;
  name: string;
  interval_hm: number;
  last_replacement_hm: number;
  due_hm: number;
  remaining_hm: number;
  status: HmStatus;
  status_rank: number;
  replaced_this_interval: boolean;
  /** null = part belum di-link ke master barang. */
  stock_on_hand: number | null;
  unit_code: string | null;
  unit_name: string | null;
};

export type HmReplacement = {
  id: number;
  part_id: number;
  unit_id: number;
  hm: number;
  date: string;
  note: string;
  qty_used: number;
  cabang_id: number | null;
};

export type HmServiceRecord = {
  id: number;
  unit_id: number;
  kind: HmServiceKind;
  date: string;
  hm: number;
  note: string;
};

export type HmHistoryRow = {
  kind: string;
  unit_code: string;
  unit_name: string;
  part_name: string;
  /** Part number (hm_parts.code); undefined di DB lama sebelum migration 20261007100000. */
  part_code?: string;
  service_kind: string;
  date: string;
  hm: number;
  note: string;
};

export const SOON_THRESHOLD = 50;

export const STATUS_LABEL: Record<HmStatus, string> = {
  aman: "Aman",
  segera: "Segera",
  lewat: "Lewat",
};

export const SERVICE_KIND_LABEL: Record<HmServiceKind, string> = {
  rutin: "Servis Rutin",
  perbaikan: "Perbaikan",
  inspeksi: "Inspeksi",
};

export function computeStatus(remainingHm: number): HmStatus {
  if (remainingHm <= 0) return "lewat";
  if (remainingHm <= SOON_THRESHOLD) return "segera";
  return "aman";
}

export function worstStatus(s: Pick<HmUnitSummary, "lewat_count" | "segera_count">): HmStatus {
  if (s.lewat_count > 0) return "lewat";
  if (s.segera_count > 0) return "segera";
  return "aman";
}

export function replacementState(part: Pick<HmPartView, "replaced_this_interval" | "status">): {
  state: "replaced" | "pending";
  overdue: boolean;
} {
  if (part.replaced_this_interval) return { state: "replaced", overdue: false };
  return { state: "pending", overdue: part.status === "lewat" };
}

// ---------- Format (§7) ----------

export const formatHm = (v: number) => `${v.toLocaleString("id-ID")} HM`;
export const formatRemaining = (v: number) =>
  `${v > 0 ? "+" : ""}${v.toLocaleString("id-ID")} HM`;
export const formatCount = (v: number) => v.toLocaleString("id-ID");

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMAT.format(date);
}

/** Buang semua non-digit: "1.250" -> 1250, "-5" -> 5, "" / "abc" -> null. */
export function parseHmInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d]/g, "");
  return cleaned === "" ? null : Number(cleaned);
}

export function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" -> tengah malam waktu lokal pada tanggal itu. */
export function fromDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------- CSV (§8) ----------

export const CSV_HEADERS = [
  "Jenis",
  "Kode Unit",
  "Nama Unit",
  "Part Number",
  "Deskripsi Part",
  "Jenis Servis",
  "Tanggal",
  "HM",
  "Catatan",
];

const escapeField = (v: string) =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

const toCsv = (rows: string[][]) =>
  rows.map((r) => r.map(escapeField).join(",")).join("\r\n");

function historyRowToCsv(row: HmHistoryRow): string[] {
  const isRep = row.kind.trim().toLowerCase().startsWith("penggantian");
  return [
    isRep ? "Penggantian Part" : "Servis Umum",
    row.unit_code,
    row.unit_name,
    isRep ? (row.part_code ?? "") : "",
    isRep ? row.part_name : "",
    isRep ? "" : row.service_kind,
    formatDate(row.date),
    String(row.hm),
    row.note,
  ];
}

export const buildHistoryCsv = (rows: HmHistoryRow[]) =>
  `﻿${toCsv([CSV_HEADERS, ...rows.map(historyRowToCsv)])}`;

export const buildCsvFilename = (d = new Date()) =>
  `riwayat-servis-${toDateInputValue(d)}.csv`;
