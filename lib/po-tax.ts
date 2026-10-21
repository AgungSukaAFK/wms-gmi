export type PoDiskonMode = "percent" | "amount";
export type PoRateMode = "percent" | "amount";

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

export type PoTaxMode = "document" | "item";

export function normalizePoTaxMode(v: unknown): PoTaxMode {
  return v === "item" ? "item" : "document";
}

/** Tarif pajak satu baris item (mode pajak per item). */
export interface PoItemTax {
  ppnRate: number;
  pphType: string | null;
  pphRate: number;
}

export const NO_ITEM_TAX: PoItemTax = { ppnRate: 0, pphType: null, pphRate: 0 };

/**
 * Preset pajak per item yang umum dipakai purchasing (mirip kode pajak ERP
 * lama: kosong / T / DT). Selain preset ini tetap bisa diatur manual.
 */
export const ITEM_TAX_PRESETS: { key: string; label: string; tax: PoItemTax }[] = [
  { key: "none", label: "Tanpa Pajak", tax: NO_ITEM_TAX },
  { key: "ppn11", label: "PPN 11%", tax: { ppnRate: 11, pphType: null, pphRate: 0 } },
  { key: "ppn12", label: "PPN 12%", tax: { ppnRate: 12, pphType: null, pphRate: 0 } },
  {
    key: "ppn11_pph23",
    label: "PPN 11% + PPh 23",
    tax: { ppnRate: 11, pphType: "pph23", pphRate: 2 },
  },
  { key: "pph23", label: "PPh 23 saja", tax: { ppnRate: 0, pphType: "pph23", pphRate: 2 } },
];

export function normalizeItemTax(t: Partial<PoItemTax> | null | undefined): PoItemTax {
  const pphType = t?.pphType || null;
  return {
    ppnRate: Math.max(0, Number(t?.ppnRate) || 0),
    pphType,
    pphRate: pphType ? Math.max(0, Number(t?.pphRate) || 0) : 0,
  };
}

export function itemTaxKey(t: PoItemTax): string {
  const n = normalizeItemTax(t);
  return `${n.ppnRate}|${n.pphType ?? ""}|${n.pphRate}`;
}

/** Label singkat, mis. "PPN 11% · PPh 23 2%" atau "Tanpa Pajak". */
export function formatItemTax(t: PoItemTax): string {
  const n = normalizeItemTax(t);
  const parts: string[] = [];
  if (n.ppnRate > 0) parts.push(`PPN ${n.ppnRate}%`);
  if (n.pphType) parts.push(`${getPphShortLabel(n.pphType)} ${n.pphRate}%`);
  return parts.length ? parts.join(" · ") : "Tanpa Pajak";
}

export function getPphShortLabel(type: string | null | undefined): string {
  switch (type) {
    case "pph22":
      return "PPh 22";
    case "pph23":
      return "PPh 23";
    case "pph4a2":
      return "PPh 4(2)";
    case "lainnya":
      return "PPh";
    default:
      return "PPh";
  }
}

/** Baca tarif pajak item dari baris po_items (kolom item_*). */
export function itemTaxFromRow(row: any): PoItemTax {
  return normalizeItemTax({
    ppnRate: row?.item_ppn_rate,
    pphType: row?.item_pph_type,
    pphRate: row?.item_pph_rate,
  });
}

export interface PoTaxInput {
  /**
   * 'document' (default): PPN/PPh dari field dokumen di bawah.
   * 'item': PPN/PPh dihitung per item dari `items` (field PPN/PPh dokumen
   * diabaikan). Diskon & ongkir tetap level dokumen.
   */
  taxMode?: PoTaxMode;
  /** Wajib untuk taxMode 'item': subtotal (qty x harga) + tarif per item. */
  items?: ({ subtotal: number } & PoItemTax)[];
  subtotal: number;
  diskonMode: PoDiskonMode;
  diskonValue: number;
  hargaTermasukPajak: boolean;
  /** 'percent' -> pakai ppnRate (0/11/12). 'amount' -> pakai ppnAmountManual (Rp langsung). */
  ppnMode: PoRateMode;
  ppnRate: number;
  ppnAmountManual: number;
  ongkir: number;
  /** 'percent' -> pakai pphRate (%). 'amount' -> pakai pphAmountManual (Rp langsung). */
  pphMode: PoRateMode;
  pphRate: number;
  pphAmountManual: number;
}

export interface PoTaxBreakdownLine {
  /** PPN: "PPN 11%". PPh: "PPh 23 2%". */
  label: string;
  rate: number;
  dpp: number;
  amount: number;
}

export interface PoTaxResult {
  taxMode: PoTaxMode;
  /** Rincian per tarif (mode per item); kosong di mode dokumen. */
  ppnBreakdown: PoTaxBreakdownLine[];
  pphBreakdown: PoTaxBreakdownLine[];
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
 *
 * PPN dan PPh masing-masing bisa dihitung dari rate persen ATAU diisi
 * nominal Rupiah manual langsung (ppnMode/pphMode) -- sama seperti diskon.
 *
 * Mode pajak per item (taxMode 'item'): diskon dokumen dibagi proporsional
 * ke tiap item (DPP item = subtotal item x DPP / subtotal), lalu PPN & PPh
 * = DPP item x tarif item. "Harga termasuk pajak" tetap meniadakan PPN.
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
  const ongkirValue = Math.max(0, input.ongkir);

  if (input.taxMode === "item") {
    const ratio = subtotal > 0 ? dpp / subtotal : 0;
    const ppnMap = new Map<number, PoTaxBreakdownLine>();
    const pphMap = new Map<string, PoTaxBreakdownLine>();
    for (const it of input.items ?? []) {
      const t = normalizeItemTax(it);
      const itemDpp = Math.max(0, it.subtotal) * ratio;
      if (t.ppnRate > 0) {
        const line = ppnMap.get(t.ppnRate) ?? {
          label: `PPN ${t.ppnRate}%`,
          rate: t.ppnRate,
          dpp: 0,
          amount: 0,
        };
        line.dpp += itemDpp;
        line.amount += input.hargaTermasukPajak ? 0 : itemDpp * (t.ppnRate / 100);
        ppnMap.set(t.ppnRate, line);
      }
      if (t.pphType) {
        const key = `${t.pphType}|${t.pphRate}`;
        const line = pphMap.get(key) ?? {
          label: `${getPphShortLabel(t.pphType)} ${t.pphRate}%`,
          rate: t.pphRate,
          dpp: 0,
          amount: 0,
        };
        line.dpp += itemDpp;
        line.amount += itemDpp * (t.pphRate / 100);
        pphMap.set(key, line);
      }
    }
    const ppnBreakdown = [...ppnMap.values()].sort((a, b) => a.rate - b.rate);
    const pphBreakdown = [...pphMap.values()].sort((a, b) => a.rate - b.rate);
    const ppnAmount = ppnBreakdown.reduce((s, l) => s + l.amount, 0);
    const pphAmount = pphBreakdown.reduce((s, l) => s + l.amount, 0);
    const totalPo = dpp + ppnAmount + ongkirValue;
    return {
      taxMode: "item",
      ppnBreakdown,
      pphBreakdown,
      subtotal,
      diskonAmount,
      dpp,
      ppnAmount,
      totalPo,
      pphAmount,
      dibayarKeVendor: Math.max(0, totalPo - pphAmount),
    };
  }

  const ppnAmount = input.hargaTermasukPajak
    ? 0
    : input.ppnMode === "amount"
      ? Math.max(0, input.ppnAmountManual)
      : dpp * (input.ppnRate / 100);
  const totalPo = dpp + ppnAmount + ongkirValue;
  const pphAmount =
    input.pphMode === "amount"
      ? Math.max(0, input.pphAmountManual)
      : dpp * (input.pphRate / 100);
  const dibayarKeVendor = Math.max(0, totalPo - pphAmount);

  return {
    taxMode: "document",
    ppnBreakdown: [],
    pphBreakdown: [],
    subtotal,
    diskonAmount,
    dpp,
    ppnAmount,
    totalPo,
    pphAmount,
    dibayarKeVendor,
  };
}

/**
 * computePoTotals dari baris `pos` + `po_items` di DB (dipakai detail, sheet,
 * print, riwayat revisi). `items` boleh subset (mis. print per vendor).
 */
export function computePoTotalsFromRecord(po: any, items: any[]): PoTaxResult {
  const num = (v: unknown) => Number(v) || 0;
  const pphType = po?.po_pph_type || null;
  return computePoTotals({
    taxMode: normalizePoTaxMode(po?.po_tax_mode),
    items: (items || []).map((i) => ({
      subtotal: num(i.qty) * num(i.harga),
      ...itemTaxFromRow(i),
    })),
    subtotal: (items || []).reduce((s, i) => s + num(i.qty) * num(i.harga), 0),
    diskonMode: po?.po_diskon_mode === "amount" ? "amount" : "percent",
    diskonValue: num(po?.po_diskon_value),
    hargaTermasukPajak: Boolean(po?.po_harga_termasuk_pajak),
    ppnMode: po?.po_ppn_mode === "amount" ? "amount" : "percent",
    ppnRate: num(po?.po_ppn_rate),
    ppnAmountManual: num(po?.po_ppn_amount),
    ongkir: num(po?.po_ongkir),
    pphMode: po?.po_pph_mode === "amount" ? "amount" : "percent",
    pphRate: pphType ? num(po?.po_pph_rate) : 0,
    pphAmountManual: pphType ? num(po?.po_pph_amount) : 0,
  });
}

/**
 * Baris PPN & PPh untuk ringkasan (detail, sheet, print). Mode dokumen = 1
 * baris sesuai field dokumen; mode per item = 1 baris per tarif.
 */
export function getPoTaxLines(
  po: any,
  poTax: PoTaxResult,
): {
  ppnLines: { label: string; amount: number }[];
  pphLines: { label: string; amount: number }[];
} {
  if (poTax.taxMode === "item") {
    return {
      ppnLines: poTax.ppnBreakdown.map((l) => ({
        label: `${l.label} (per item)`,
        amount: l.amount,
      })),
      pphLines: poTax.pphBreakdown.map((l) => ({
        label: `${l.label} (per item)`,
        amount: l.amount,
      })),
    };
  }
  const hasPpn =
    po?.po_ppn_mode === "amount" ? po?.po_ppn_amount > 0 : po?.po_ppn_rate > 0;
  return {
    ppnLines: hasPpn
      ? [
          {
            label: `PPN (${po.po_ppn_mode === "amount" ? "nominal manual" : `${po.po_ppn_rate}%`})`,
            amount: poTax.ppnAmount,
          },
        ]
      : [],
    pphLines: po?.po_pph_type
      ? [
          {
            label: `PPh ${getPphTypeLabel(po.po_pph_type)} (${po.po_pph_mode === "amount" ? "nominal manual" : `${po.po_pph_rate}%`})`,
            amount: poTax.pphAmount,
          },
        ]
      : [],
  };
}
