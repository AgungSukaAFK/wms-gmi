// PO Outstanding: PO yang masih berjalan dari ERP lama ("PO OST.xls"),
// diimport lewat supabase/import/po_ost_import.sql. Jenis tetap 'reguler'
// tapi boleh tanpa PR; item dihubungkan ke item PR per baris belakangan
// (services/po-outstanding-actions.ts). Lihat
// supabase/migrations/20261019100000_po_outstanding.sql.

export function isOutstandingPo(
  po: { po_is_outstanding?: boolean | null } | null | undefined,
) {
  return Boolean(po?.po_is_outstanding);
}

// Filter list PO.
export type OutstandingFilter = "all" | "unlinked" | "linked";

export const OUTSTANDING_FILTER_OPTIONS: { value: OutstandingFilter; label: string }[] = [
  { value: "all", label: "Semua PO Outstanding" },
  { value: "unlinked", label: "Outstanding – belum terhubung" },
  { value: "linked", label: "Outstanding – sudah terhubung" },
];

// Kode PR yang disebut di teks referensi Excel, mis.
// "PR-GMI-4052, 4106, 3824" -> ["PR-GMI-4052", "PR-GMI-4106", "PR-GMI-3824"].
// Angka tanpa prefix ikut prefix kode sebelumnya.
export function parsePrRefCodes(ref: string | null | undefined): string[] {
  if (!ref) return [];
  const out: string[] = [];
  let prefix = "";
  for (const token of ref.split(/[\s,&/]+/)) {
    const full = token.match(/^([A-Za-z]+(?:-[A-Za-z]+)*-)(\d+)$/);
    if (full) {
      prefix = full[1].toUpperCase();
      out.push(`${prefix}${full[2]}`);
    } else if (prefix && /^\d+$/.test(token)) {
      out.push(`${prefix}${token}`);
    }
  }
  return Array.from(new Set(out));
}
