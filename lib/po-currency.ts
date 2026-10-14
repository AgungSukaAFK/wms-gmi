export type PoCurrency = "IDR" | "USD" | "AUD";

export const PO_CURRENCY_OPTIONS: {
  value: PoCurrency;
  label: string;
  symbol: string;
  /** Desimal minimum yang selalu ditampilkan. */
  decimals: number;
  /** Desimal maksimum yang boleh diinput & ditampilkan. */
  maxDecimals: number;
}[] = [
  {
    value: "IDR",
    label: "IDR — Rupiah",
    symbol: "Rp",
    decimals: 0,
    maxDecimals: 0,
  },
  {
    value: "USD",
    label: "USD — US Dollar",
    symbol: "US$",
    decimals: 2,
    maxDecimals: 10,
  },
  {
    value: "AUD",
    label: "AUD — Australian Dollar",
    symbol: "AU$",
    decimals: 2,
    maxDecimals: 10,
  },
];

/** PO lama (sebelum ada kolom po_currency) selalu dianggap IDR. */
export function normalizePoCurrency(
  value: string | null | undefined,
): PoCurrency {
  return PO_CURRENCY_OPTIONS.some((c) => c.value === value)
    ? (value as PoCurrency)
    : "IDR";
}

function getOption(currency: string | null | undefined) {
  const code = normalizePoCurrency(currency);
  return PO_CURRENCY_OPTIONS.find((c) => c.value === code)!;
}

export function getPoCurrencySymbol(
  currency: string | null | undefined,
): string {
  return getOption(currency).symbol;
}

export function getPoCurrencyDecimals(
  currency: string | null | undefined,
): number {
  return getOption(currency).decimals;
}

export function getPoCurrencyMaxDecimals(
  currency: string | null | undefined,
): number {
  return getOption(currency).maxDecimals;
}

/**
 * Format nominal PO sesuai mata uang dokumen. Tetap pakai locale id-ID
 * (titik = ribuan, koma = desimal) supaya konsisten dengan seluruh app.
 * IDR tanpa desimal; USD/AUD minimal 2, maksimal 10 desimal (harga valas
 * per unit bisa sangat presisi, mis. 0,0012345678).
 */
export function formatPoMoney(
  value: number,
  currency: string | null | undefined,
): string {
  const code = normalizePoCurrency(currency);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: code,
    minimumFractionDigits: getPoCurrencyDecimals(code),
    maximumFractionDigits: getPoCurrencyMaxDecimals(code),
  }).format(Number(value) || 0);
}
