"use client";

import { useState } from "react";
import { Check, ChevronDown, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ITEM_TAX_PRESETS,
  PPH_TYPE_OPTIONS,
  PPN_RATE_OPTIONS,
  formatItemTax,
  getPphDefaultRate,
  itemTaxKey,
  normalizeItemTax,
  type PoItemTax,
} from "@/lib/po-tax";
import { cn } from "@/lib/utils";

// Editor pajak satu item (atau beberapa item sekaligus lewat `trigger`):
// preset cepat (Tanpa Pajak / PPN 11% / PPN 11% + PPh 23 / ...) + atur manual
// tarif PPN & jenis/tarif PPh.
export function PoItemTaxPicker({
  value,
  onChange,
  trigger,
  disabled,
}: {
  value: PoItemTax;
  onChange: (tax: PoItemTax) => void;
  trigger?: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tax = normalizeItemTax(value);
  const currentKey = itemTaxKey(tax);
  const hasTax = tax.ppnRate > 0 || Boolean(tax.pphType);

  const apply = (next: PoItemTax) => onChange(normalizeItemTax(next));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-8 w-full justify-between gap-1 px-2 text-[10px] font-bold",
              hasTax
                ? "border-primary/40 bg-primary/5 text-primary"
                : "text-muted-foreground",
            )}
          >
            <span className="truncate">{formatItemTax(tax)}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-3" align="end">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">
            Pilihan Cepat
          </p>
          <div className="grid grid-cols-1 gap-1">
            {ITEM_TAX_PRESETS.map((p) => {
              const active = itemTaxKey(p.tax) === currentKey;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    apply(p.tax);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <Check
                    className={cn("h-3.5 w-3.5", active ? "opacity-100" : "opacity-0")}
                  />
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
            <Percent className="h-3 w-3" /> Atur Manual
          </p>
          <div className="space-y-1">
            <Label className="text-[10px] font-semibold text-muted-foreground">PPN</Label>
            <Select
              value={String(tax.ppnRate)}
              onValueChange={(v) => apply({ ...tax, ppnRate: Number(v) })}
            >
              <SelectTrigger className="h-8 text-xs font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PPN_RATE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-muted-foreground">PPh</Label>
              <Select
                value={tax.pphType || "none"}
                onValueChange={(v) =>
                  v === "none"
                    ? apply({ ...tax, pphType: null, pphRate: 0 })
                    : apply({ ...tax, pphType: v, pphRate: getPphDefaultRate(v) })
                }
              >
                <SelectTrigger className="h-8 text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa PPh</SelectItem>
                  {PPH_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold text-muted-foreground">Tarif %</Label>
              <Input
                type="number"
                min={0}
                step={0.1}
                disabled={!tax.pphType}
                value={tax.pphType ? tax.pphRate : ""}
                onChange={(e) =>
                  apply({ ...tax, pphRate: Math.max(0, Number(e.target.value) || 0) })
                }
                className="h-8 text-xs font-bold"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
