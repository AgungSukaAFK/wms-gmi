// Filter dashboard utama: semua disimpan di query string URL.
//   ?periode=bulan_ini|hari_ini|7_hari|30_hari|bulan_lalu|tahun_ini|custom
//   ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD   (dipakai saat periode=custom)
//   ?lokasi=1,2 | all                    (kosong = default per hak akses)
//   ?kategori=...&prioritas=...          (hanya angka MR)
// Tanggal dihitung sebagai string YMD lewat UTC supaya tidak tergeser zona
// waktu server (Vercel = UTC, bisnis = WIB).

export type PeriodPreset =
  | "hari_ini"
  | "7_hari"
  | "30_hari"
  | "bulan_ini"
  | "bulan_lalu"
  | "tahun_ini"
  | "custom";

export const PERIOD_PRESETS: { value: Exclude<PeriodPreset, "custom">; label: string }[] = [
  { value: "hari_ini", label: "Hari ini" },
  { value: "7_hari", label: "7 hari" },
  { value: "30_hari", label: "30 hari" },
  { value: "bulan_ini", label: "Bulan ini" },
  { value: "bulan_lalu", label: "Bulan lalu" },
  { value: "tahun_ini", label: "Tahun ini" },
];

export const DEFAULT_PRESET: PeriodPreset = "bulan_ini";

export const MR_KATEGORI_OPTIONS = ["New Item", "Replace Item", "Fix & Repair", "Upgrade"];
export const MR_PRIORITY_OPTIONS = ["P1", "P2", "P3", "P4"];

export type DashboardFilters = {
  preset: PeriodPreset;
  /** Rentang periode, inklusif. */
  from: string;
  to: string;
  /** Periode pembanding (null = tidak ada). */
  prevFrom: string | null;
  prevTo: string | null;
  /** Awal jendela chart tren (>= 30 hari supaya trennya terbaca). */
  trendFrom: string;
  /** Lokasi dari URL. Kosong + lokasiAll=false = pakai default hak akses. */
  cabangIds: number[];
  /** true = user memilih "Semua lokasi" secara eksplisit. */
  lokasiAll: boolean;
  kategori: string[];
  priorities: string[];
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

const toUtc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (ymd: string, days: number) => fromUtc(toUtc(ymd) + days * DAY);
export const diffDays = (a: string, b: string) => Math.round((toUtc(a) - toUtc(b)) / DAY);

/** Tanggal `day` di bulan (y, m0); dijepit ke hari terakhir bulan itu. */
function ymdClamped(y: number, m0: number, day: number) {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, m0, Math.min(day, last)));
}

function isYmd(v: unknown): v is string {
  return typeof v === "string" && YMD_RE.test(v) && !Number.isNaN(toUtc(v));
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const csv = (v: string | string[] | undefined) =>
  first(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Rentang + pembanding untuk satu preset. */
export function presetRange(
  preset: Exclude<PeriodPreset, "custom">,
  today: string,
): { from: string; to: string; prevFrom: string; prevTo: string } {
  const t = new Date(toUtc(today));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const d = t.getUTCDate();

  switch (preset) {
    case "hari_ini":
      return { from: today, to: today, prevFrom: addDays(today, -1), prevTo: addDays(today, -1) };
    case "7_hari":
      return {
        from: addDays(today, -6),
        to: today,
        prevFrom: addDays(today, -13),
        prevTo: addDays(today, -7),
      };
    case "30_hari":
      return {
        from: addDays(today, -29),
        to: today,
        prevFrom: addDays(today, -59),
        prevTo: addDays(today, -30),
      };
    case "bulan_ini":
      // Dibanding tanggal yang sama bulan lalu (1 s/d hari ini).
      return {
        from: ymdClamped(y, m, 1),
        to: today,
        prevFrom: ymdClamped(y, m - 1, 1),
        prevTo: ymdClamped(y, m - 1, d),
      };
    case "bulan_lalu":
      return {
        from: ymdClamped(y, m - 1, 1),
        to: ymdClamped(y, m - 1, 31),
        prevFrom: ymdClamped(y, m - 2, 1),
        prevTo: ymdClamped(y, m - 2, 31),
      };
    case "tahun_ini":
      return {
        from: ymdClamped(y, 0, 1),
        to: today,
        prevFrom: ymdClamped(y - 1, 0, 1),
        prevTo: ymdClamped(y - 1, m, d),
      };
  }
}

type RawParams = Record<string, string | string[] | undefined>;

export function resolveDashboardFilters(params: RawParams, today: string): DashboardFilters {
  const rawPreset = first(params.periode) as PeriodPreset;
  const dari = first(params.dari);
  const sampai = first(params.sampai);
  const hasCustom = isYmd(dari) || isYmd(sampai);

  let preset: PeriodPreset = PERIOD_PRESETS.some((p) => p.value === rawPreset)
    ? rawPreset
    : hasCustom
      ? "custom"
      : DEFAULT_PRESET;
  if (rawPreset === "custom") preset = hasCustom ? "custom" : DEFAULT_PRESET;

  let from: string;
  let to: string;
  let prevFrom: string | null;
  let prevTo: string | null;

  if (preset === "custom") {
    to = isYmd(sampai) ? sampai : today;
    // Hanya "sampai" diisi -> mulai dari awal bulan tanggal itu.
    from = isYmd(dari) ? dari : `${to.slice(0, 8)}01`;
    if (from > to) [from, to] = [to, from];
    // Pembanding: rentang sama panjang tepat sebelumnya.
    const len = diffDays(to, from) + 1;
    prevTo = addDays(from, -1);
    prevFrom = addDays(prevTo, -(len - 1));
  } else {
    ({ from, to, prevFrom, prevTo } = presetRange(preset, today));
  }

  const span = diffDays(to, from) + 1;
  const trendFrom = span >= 30 ? from : addDays(to, -29);

  const lokasiRaw = first(params.lokasi);
  const lokasiAll = lokasiRaw === "all";
  const cabangIds = lokasiAll
    ? []
    : csv(params.lokasi)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);

  return {
    preset,
    from,
    to,
    prevFrom,
    prevTo,
    trendFrom,
    cabangIds,
    lokasiAll,
    kategori: csv(params.kategori).filter((k) => MR_KATEGORI_OPTIONS.includes(k)),
    priorities: csv(params.prioritas).filter((p) => MR_PRIORITY_OPTIONS.includes(p)),
  };
}

const BULAN_PENDEK = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

/** "2026-11-01" -> "01 Nov 2026" (tahun bisa disembunyikan). */
export function formatYmdShort(ymd: string | null | undefined, withYear = true) {
  if (!ymd || !YMD_RE.test(ymd.slice(0, 10))) return "-";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d} ${BULAN_PENDEK[Number(m) - 1]}${withYear ? ` ${y}` : ""}`;
}

/** "01 – 11 Nov 2026", "28 Okt – 03 Nov 2026", atau satu tanggal. */
export function formatRangeLabel(from: string, to: string) {
  if (from === to) return formatYmdShort(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
  if (sameMonth) return `${from.slice(8, 10)} – ${formatYmdShort(to)}`;
  return `${formatYmdShort(from, !sameYear)} – ${formatYmdShort(to)}`;
}
