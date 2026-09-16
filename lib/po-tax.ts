export type PoDiskonMode = "percent" | "amount";

export const PPN_RATE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Tanpa PPN" },
  { value: 11, label: "PPN 11%" },
  { value: 12, label: "PPN 12%" },
];

export type PphType = "pph22" | "pph23" | "pph4a2" | "lainnya";

export const PPH_TYPE_OPTIONS: {
  value: PphType;
  label: string;
  defaultRate: number;
}[] = [
  { value: "pph22", label: "PPh 22 (Pembelian Barang)", defaultRate: 1.5 },
  { value: "pph23", label: "PPh 23 (Jasa)", defaultRate: 2 },
  { value: "pph4a2", label: "PPh 4 Ayat 2 (Final)", defaultRate: 2 },
  { value: "lainnya", label: "Lainnya", defaultRate: 0 },
];

export function getPphDefaultRate(type: string | null | undefined): number {
  return PPH_TYPE_OPTIONS.find((t) => t.value === type)?.defaultRate ?? 0;
}

export function getPphTypeLabel(type: string | null | undefined): string {
  if (!type) return "Tanpa PPh";
  return PPH_TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type;
}

export interface PoTaxInput {
  subtotal: number;
  diskonMode: PoDiskonMode;
  diskonValue: number;
  hargaTermasukPajak: boolean;
  ppnRate: number;
  ongkir: number;
  pphRate: number;
}

export interface PoTaxResult {
  subtotal: number;
  diskonAmount: number;
  dpp: number;
  ppnAmount: number;
  totalPo: number;
  pphAmount: number;
  dibayarKeVendor: number;
}

/**
 * Rumus Pajak/Diskon/Ongkir PO -- satu sumber kebenaran dipakai bareng-bareng
 * oleh halaman create, detail, detail sheet, dan print supaya angkanya
 * selalu konsisten.
 *
 * Urutan: Subtotal -> (-) Diskon -> DPP -> (+) PPN [dilewati kalau harga
 * sudah termasuk pajak, karena sudah nempel di harga satuan] -> (+) Ongkir
 * -> Total PO. PPh dihitung dari DPP sebagai potongan TERPISAH (withholding
 * / potong-pungut) -- tidak mengurangi Total PO (nilai kontrak/approval
 * tetap utuh), cuma mengurangi Jumlah Dibayar ke Vendor.
 */
export function computePoTotals(input: PoTaxInput): PoTaxResult {
  const subtotal = Math.max(0, input.subtotal);
  const diskonAmount = Math.max(
    0,
    input.diskonMode === "percent"
      ? subtotal * (input.diskonValue / 100)
      : input.diskonValue,
  );
  const dpp = Math.max(0, subtotal - diskonAmount);
  const ppnAmount = input.hargaTermasukPajak
    ? 0
    : dpp * (input.ppnRate / 100);
  const ongkir = Math.max(0, input.ongkir);
  const totalPo = dpp + ppnAmount + ongkir;
  const pphAmount = dpp * (input.pphRate / 100);
  const dibayarKeVendor = Math.max(0, totalPo - pphAmount);

  return {
    subtotal,
    diskonAmount,
    dpp,
    ppnAmount,
    totalPo,
    pphAmount,
    dibayarKeVendor,
  };
}
