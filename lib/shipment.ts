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

// ---------------------------------------------------------------------------
// Detail koli + layanan/rate kurir (kolom koli_detail, layanan_kurir,
// rate_per_kg di item_transfers / deliveries / do_reguler).
// ---------------------------------------------------------------------------

/** 1 baris = sekelompok koli yang sama berat & dimensinya. */
export interface KoliRow {
  qty: number;
  berat_kg: number; // berat per koli
  panjang_cm: number;
  lebar_cm: number;
  tinggi_cm: number;
}

/**
 * Pembagi berat volume per jenis pengiriman: P x L x T (cm) / pembagi.
 *   - Udara 6000 (standar IATA, 1 m3 ~ 167 kg; dipakai kurir paket umumnya)
 *   - Laut 4000 (umum dipakai cargo laut/darat)
 * Nilai lain (legacy 'ekspedisi', handcarry) pakai 6000; handcarry tidak
 * menampilkan estimasi biaya, jadi pembagi hanya memengaruhi berat volume.
 */
export const VOLUMETRIC_DIVISOR: Record<string, number> = {
  ekspedisi_udara: 6000,
  ekspedisi_laut: 4000,
};
export const DEFAULT_VOLUMETRIC_DIVISOR = 6000;

export const volumetricDivisor = (t?: string | null) =>
  (t && VOLUMETRIC_DIVISOR[t]) || DEFAULT_VOLUMETRIC_DIVISOR;

export const emptyKoliRow = (): KoliRow => ({
  qty: 1,
  berat_kg: 0,
  panjang_cm: 0,
  lebar_cm: 0,
  tinggi_cm: 0,
});

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Normalisasi nilai JSONB dari DB (bisa null / data lama) jadi KoliRow[]. */
export const parseKoliDetail = (raw: unknown): KoliRow[] =>
  Array.isArray(raw)
    ? raw.map((r: Record<string, unknown> | null) => ({
        qty: Math.floor(num(r?.qty)),
        berat_kg: num(r?.berat_kg),
        panjang_cm: num(r?.panjang_cm),
        lebar_cm: num(r?.lebar_cm),
        tinggi_cm: num(r?.tinggi_cm),
      }))
    : [];

/** Berat volume 1 koli (kg); 0 kalau dimensi tidak lengkap. */
export const beratVolumeKoli = (r: KoliRow, shipmentType?: string | null) =>
  (r.panjang_cm * r.lebar_cm * r.tinggi_cm) / volumetricDivisor(shipmentType);

export const hasDimensi = (r: KoliRow) =>
  r.panjang_cm > 0 && r.lebar_cm > 0 && r.tinggi_cm > 0;

export interface KoliSummary {
  totalKoli: number;
  beratAktual: number; // kg, total semua koli
  beratVolume: number; // kg, total semua koli
  beratTagih: number; // kg, per koli diambil max(aktual, volume) lalu dijumlah
}

export const summarizeKoli = (
  rows: KoliRow[],
  shipmentType?: string | null,
): KoliSummary =>
  rows.reduce<KoliSummary>(
    (acc, r) => {
      const vol = beratVolumeKoli(r, shipmentType);
      acc.totalKoli += r.qty;
      acc.beratAktual += r.qty * r.berat_kg;
      acc.beratVolume += r.qty * vol;
      acc.beratTagih += r.qty * Math.max(r.berat_kg, vol);
      return acc;
    },
    { totalKoli: 0, beratAktual: 0, beratVolume: 0, beratTagih: 0 },
  );

/** Estimasi biaya kirim = rate/kg x berat tagih. null kalau rate kosong. */
export const estimasiBiayaKirim = (
  rows: KoliRow[],
  ratePerKg: number | null | undefined,
  shipmentType?: string | null,
) =>
  ratePerKg && ratePerKg > 0 && rows.length > 0
    ? Math.round(summarizeKoli(rows, shipmentType).beratTagih * ratePerKg)
    : null;

/**
 * Validasi baris koli sebelum simpan. Berat per koli wajib untuk ekspedisi
 * (dipakai hitung biaya); dimensi opsional tapi kalau diisi harus lengkap.
 */
export const validateKoliRows = (
  rows: KoliRow[],
  opts: { requireBerat: boolean },
): string | null => {
  if (rows.length === 0) return "Tambahkan minimal satu baris koli.";
  for (const [i, r] of rows.entries()) {
    const label = `Koli baris ${i + 1}`;
    if (r.qty < 1) return `${label}: jumlah koli minimal 1.`;
    if (opts.requireBerat && r.berat_kg <= 0)
      return `${label}: berat per koli wajib diisi.`;
    const dims = [r.panjang_cm, r.lebar_cm, r.tinggi_cm].filter((d) => d > 0);
    if (dims.length > 0 && dims.length < 3)
      return `${label}: dimensi P x L x T harus diisi lengkap.`;
  }
  return null;
};

/** Format angka kg/cm tanpa trailing ,00 (locale id-ID). */
export const fmtNum = (n: number, maxFrac = 2) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: maxFrac });

// ---------------------------------------------------------------------------
// State form koli. Checkbox "Dengan detail koli" (default on); kalau off,
// user cukup isi jumlah koli dan koli_detail disimpan kosong ([]).
// Tidak ada kolom DB untuk toggle-nya: koli_detail kosong = tanpa detail.
// ---------------------------------------------------------------------------

export interface KoliFormState {
  withDetail: boolean;
  jumlahKoli: number; // dipakai saat withDetail = false
  rows: KoliRow[]; // dipakai saat withDetail = true
}

export const initialKoliForm = (): KoliFormState => ({
  withDetail: true,
  jumlahKoli: 1,
  rows: [emptyKoliRow()],
});

/** State form dari dokumen tersimpan (dokumen lama = tanpa detail). */
export const koliFormFromDoc = (doc: {
  koli_detail?: unknown;
  jumlah_koli?: number | null;
}): KoliFormState => {
  const rows = parseKoliDetail(doc.koli_detail);
  return rows.length > 0
    ? { withDetail: true, jumlahKoli: summarizeKoli(rows).totalKoli, rows }
    : {
        withDetail: false,
        jumlahKoli: Math.max(1, doc.jumlah_koli || 1),
        rows: [emptyKoliRow()],
      };
};

/** Kolom yang disimpan: jumlah_koli selalu terisi (backward-compat). */
export const koliFormPayload = (f: KoliFormState) =>
  f.withDetail
    ? { jumlah_koli: summarizeKoli(f.rows).totalKoli, koli_detail: f.rows }
    : { jumlah_koli: f.jumlahKoli, koli_detail: [] as KoliRow[] };

export const validateKoliForm = (
  f: KoliFormState,
  opts: { requireBerat: boolean },
): string | null =>
  f.withDetail
    ? validateKoliRows(f.rows, opts)
    : f.jumlahKoli < 1
      ? "Jumlah koli minimal 1."
      : null;
