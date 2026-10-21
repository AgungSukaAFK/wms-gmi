"use client";

import { maskedPriceText } from "@/lib/po-price-access";
import { getPoTaxLines, type PoTaxResult } from "@/lib/po-tax";

// Ringkasan Subtotal -> Diskon -> PPN -> Ongkir -> Total PO -> PPh ->
// Dibayar ke Vendor. Dipakai bareng detail PO & detail sheet. Mode pajak per
// item menampilkan rincian per tarif (PPN 11%, PPh 23 2%, ...).
export function PoTaxSummary({
  po,
  poTax,
  canViewPrice,
  formatCurrency,
}: {
  po: any;
  poTax: PoTaxResult;
  canViewPrice: boolean;
  formatCurrency: (n: number) => string;
}) {
  const money = (n: number) => maskedPriceText(canViewPrice, formatCurrency(n));
  const isItemMode = poTax.taxMode === "item";
  const inclTax = Boolean(po.po_harga_termasuk_pajak);
  const row =
    "flex items-center justify-between text-[10px] font-bold uppercase text-muted-foreground";

  const { ppnLines, pphLines } = getPoTaxLines(po, poTax);

  return (
    <div className="p-4 bg-muted/40 border border-border rounded-xl space-y-1.5">
      {isItemMode && (
        <p className="text-[9px] font-bold uppercase text-primary">
          Pajak dihitung per item
        </p>
      )}
      <div className={row}>
        <span>Subtotal</span>
        <span className="text-foreground">{money(poTax.subtotal)}</span>
      </div>
      {poTax.diskonAmount > 0 && (
        <div className={row}>
          <span>
            Diskon
            {po.po_diskon_mode === "percent" ? ` (${po.po_diskon_value}%)` : ""}
          </span>
          <span className="text-destructive">- {money(poTax.diskonAmount)}</span>
        </div>
      )}
      {ppnLines.map((l) => (
        <div key={l.label} className={row}>
          <span>
            {l.label}
            {inclTax ? " — sudah termasuk harga" : ""}
          </span>
          <span className="text-foreground">
            {inclTax ? "-" : `+ ${money(l.amount)}`}
          </span>
        </div>
      ))}
      {po.po_ongkir > 0 && (
        <div className={row}>
          <span>Ongkos Kirim</span>
          <span className="text-foreground">+ {money(po.po_ongkir)}</span>
        </div>
      )}
      <div className="flex items-center justify-between text-sm font-black uppercase pt-2 border-t border-border">
        <span>Total PO</span>
        <span className="text-primary">{money(poTax.totalPo)}</span>
      </div>
      {pphLines.length > 0 && (
        <>
          {pphLines.map((l, i) => (
            <div key={l.label} className={`${row} ${i === 0 ? "pt-1" : ""}`}>
              <span>{l.label}</span>
              <span className="text-destructive">- {money(l.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs font-black uppercase pt-1.5 border-t border-dashed border-border">
            <span>Dibayar ke Vendor</span>
            <span className="text-foreground">{money(poTax.dibayarKeVendor)}</span>
          </div>
        </>
      )}
    </div>
  );
}
