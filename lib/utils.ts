import { clsx, type ClassValue } from "clsx";
import { isValid } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jum'at", "Sabtu"];
const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function toValidDate(date?: string | number | Date | null): Date | null {
  if (date === null || date === undefined || date === "") return null;
  const d = date instanceof Date ? date : new Date(date);
  return isValid(d) ? d : null;
}

/**
 * Format tanggal standar aplikasi (tanpa nama hari).
 * Dipakai untuk tampilan biasa: tabel, detail, form, dsb.
 * @example formatDate("2026-04-01") // "01 April 2026"
 */
export const formatDate = (date?: string | number | Date | null): string => {
  const d = toValidDate(date);
  if (!d) return "-";
  const day = String(d.getDate()).padStart(2, "0");
  return `${day} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
};

/**
 * Format tanggal untuk dokumen resmi (dengan nama hari).
 * Dipakai di halaman cetak: SPB, PO, DO, Invoice, MR, PR, Item Transfer, dsb.
 * @example formatDateDocument("2026-04-15") // "Jum'at, 15 April 2026"
 */
export const formatDateDocument = (date?: string | number | Date | null): string => {
  const d = toValidDate(date);
  if (!d) return "-";
  return `${HARI_ID[d.getDay()]}, ${formatDate(d)}`;
};

/**
 * Format tanggal + jam WIB, untuk timestamp audit trail / log approval.
 * @example formatDateTime("2026-04-01T07:30:00Z") // "01 April 2026, 14.30 WIB"
 */
export const formatDateTime = (date?: string | number | Date | null): string => {
  const d = toValidDate(date);
  if (!d) return "-";
  const time = d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
  return `${formatDate(d)}, ${time} WIB`;
};

export function toYmdLocal(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ymdToLocalStartIso(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) {
    return new Date(ymd).toISOString();
  }

  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

export function parseCSV(csv: string): string[][] {
  return csv
    .trim()
    .split("\n")
    .map(
      (line) =>
        line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()), // buang tanda kutip
    );
}

export function validateCSV(csv: string) {
  const rows = parseCSV(csv);
  const [header, ...data] = rows;

  const expected = ["part_number", "part_name", "category", "uom", "vendor"];
  if (header.join(",") !== expected.join(",")) {
    return { valid: false, errors: ["Header CSV tidak sesuai"], rows: [] };
  }

  const seen = new Set<string>();
  const uniqueRows: string[][] = [];
  const errors: string[] = [];

  data.forEach((cols, i) => {
    const partNumber = cols[0];
    if (!partNumber) {
      errors.push(`Baris ${i + 2}: part_number kosong`);
      return;
    }
    if (seen.has(partNumber)) {
      errors.push(`Duplikat di CSV pada baris ${i + 2}: ${partNumber}`);
      return;
    }
    seen.add(partNumber);
    uniqueRows.push(cols);
  });

  return { valid: errors.length === 0, errors, rows: uniqueRows };
}

/**
 * Memformat angka atau string angka menjadi format mata uang Rupiah.
 * @param value Angka atau string yang akan diformat
 * @returns String mata uang yang diformat, cth: "Rp 1.500.000"
 */
export const formatCurrency = (value?: string | number): string => {
  const numericValue = Number(value);
  if (value === null || value === undefined || isNaN(numericValue))
    return "Rp 0";

  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(numericValue);
};

export const calculatePriority = (
  dueDate: Date | string | undefined | null,
  startDate?: Date | string | undefined | null,
): string => {
  // 1. Jika due date kosong, kembalikan default P4 (paling rendah)
  if (!dueDate) return "P4";

  // 2. Tentukan Start Date (Hari ini atau Created At)
  const start = startDate ? new Date(startDate) : new Date();
  start.setHours(0, 0, 0, 0); // Reset jam ke 00:00

  // 3. Tentukan Due Date
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0); // Reset jam ke 00:00

  // Validasi tanggal
  if (isNaN(due.getTime()) || isNaN(start.getTime())) return "P4";

  // 4. Hitung Selisih (dalam milidetik)
  const diffTime = due.getTime() - start.getTime();
  // Konversi ke hari (pembulatan ke atas)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // <= 2 Hari -> P0
  if (diffDays <= 2) return "P0";

  // 3 sampai 10 Hari -> P1
  if (diffDays <= 10) return "P1";

  // 11 sampai 15 Hari -> P2
  if (diffDays <= 15) return "P2";

  // 16 sampai 25 Hari -> P3
  if (diffDays <= 25) return "P3";

  // > 25 Hari -> P4
  return "P4";
};

// Helper untuk mendapatkan warna badge berdasarkan prioritas (Opsional)
export const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "P0":
      return "destructive"; // Merah
    case "P1":
      return "orange-500"; // Orange (custom class)
    case "P2":
      return "yellow-500"; // Kuning
    case "P3":
      return "blue-500"; // Biru
    default:
      return "secondary"; // Abu-abu
  }
};
