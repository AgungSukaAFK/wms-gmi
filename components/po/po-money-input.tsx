"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  getPoCurrencyDecimals,
  getPoCurrencySymbol,
  type PoCurrency,
} from "@/lib/po-currency";

const groupThousands = (digits: string) =>
  digits.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function formatForInput(value: number, decimals: number): string {
  if (!value) return "";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Input nominal PO dengan prefix simbol mata uang. Format id-ID: titik =
 * ribuan, koma = desimal. IDR cuma angka bulat; USD/AUD boleh 2 desimal.
 * Selama fokus, teks mentah disimpan lokal supaya "12," tidak langsung
 * hilang komanya sebelum user selesai ngetik desimal.
 */
export function PoMoneyInput({
  value,
  onChange,
  currency,
  className,
  inputClassName,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  currency: PoCurrency;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}) {
  const decimals = getPoCurrencyDecimals(currency);
  const [draft, setDraft] = useState<string | null>(null);

  const handleChange = (raw: string) => {
    const cleaned = raw.replace(decimals > 0 ? /[^0-9,]/g : /[^0-9]/g, "");
    const commaIdx = cleaned.indexOf(",");
    const intDigits = commaIdx === -1 ? cleaned : cleaned.slice(0, commaIdx);
    const decDigits =
      commaIdx === -1
        ? ""
        : cleaned
            .slice(commaIdx + 1)
            .replace(/,/g, "")
            .slice(0, decimals);

    const text =
      groupThousands(intDigits) + (commaIdx === -1 ? "" : `,${decDigits}`);
    setDraft(text);

    const num = Number(`${intDigits || "0"}.${decDigits || "0"}`);
    onChange(Number.isFinite(num) ? num : 0);
  };

  return (
    <div
      className={cn(
        "flex items-center rounded-md border border-input bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      <span className="px-2 text-[10px] font-bold text-muted-foreground bg-muted border-r border-input h-full flex items-center shrink-0">
        {getPoCurrencySymbol(currency)}
      </span>
      <input
        type="text"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        disabled={disabled}
        className={cn(
          "flex-1 min-w-0 h-full px-2 font-bold bg-transparent outline-none",
          inputClassName,
        )}
        value={draft ?? formatForInput(value, decimals)}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
        placeholder={decimals > 0 ? "0,00" : "0"}
      />
    </div>
  );
}
