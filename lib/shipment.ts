// Konstanta & helper jenis pengiriman, dipakai bersama oleh semua fitur yang
// memakai pengiriman (Delivery, Item Transfer, DO Reguler).
//
// Revisi: kategori "Ekspedisi" dipecah menjadi dua —
//   - Ekspedisi Laut  (default estimasi 14 hari)
//   - Ekspedisi Udara (default estimasi 5 hari)
// Nilai lama 'ekspedisi' tetap dikenali untuk data historis (label "Ekspedisi").

export type ShipmentType =
  | "handcarry_internal"
  | "handcarry_eksternal"
  | "ekspedisi_laut"
  | "ekspedisi_udara";

export const SHIPMENT_LABEL: Record<string, string> = {
  handcarry_internal: "Handcarry Internal",
  handcarry_eksternal: "Handcarry Eksternal",
  ekspedisi_laut: "Ekspedisi Laut",
  ekspedisi_udara: "Ekspedisi Udara",
  ekspedisi: "Ekspedisi", // legacy (data lama sebelum dipecah laut/udara)
};

/** TRUE untuk semua varian ekspedisi (laut/udara + nilai lama 'ekspedisi'). */
export const isEkspedisi = (t?: string | null) =>
  t === "ekspedisi_laut" || t === "ekspedisi_udara" || t === "ekspedisi";

/** Estimasi hari default per jenis pengiriman (bisa di-override manual). */
export const defaultEstimasiHari = (t: string) =>
  t === "ekspedisi_laut" ? 14 : t === "ekspedisi_udara" ? 5 : 1;
