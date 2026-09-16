"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const PR_CONVERT_STATUS_LABEL: Record<string, string> = {
  pending: "Belum PO",
  partial: "Partial PO",
  complete: "PO Lengkap",
};

const PR_CONVERT_STATUS_CLASS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600 border-slate-300",
  partial: "bg-amber-100 text-amber-700 border-amber-300",
  complete: "bg-success/10 text-success border-success/30",
};

/**
 * Badge status konversi PR -> PO (prs.pr_convert_status: pending/partial/
 * complete), dihitung ulang server-side tiap kali PO dibuat/direject
 * (_applyPrConversionStatus di services/procurement-actions.ts). Dipakai di
 * list PR, picker "Pilih PR" saat bikin PO, dan widget Dashboard supaya
 * konsisten satu label/warna di semua tempat.
 */
export function PrConvertStatusBadge({
  status,
  className,
}: {
  status?: string | null;
  className?: string;
}) {
  const key = status || "pending";
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[9px] font-bold uppercase",
        PR_CONVERT_STATUS_CLASS[key] || PR_CONVERT_STATUS_CLASS.pending,
        className,
      )}
    >
      {PR_CONVERT_STATUS_LABEL[key] || PR_CONVERT_STATUS_LABEL.pending}
    </Badge>
  );
}
