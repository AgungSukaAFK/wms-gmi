// Grid kartu unit (hm.md §9.5). Seluruh kartu = tautan ke detail unit.

"use client";

import Link from "next/link";
import { ArrowRight, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount, formatHm, HmUnitSummary, worstStatus } from "@/lib/hm";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_BG, StatusBadge } from "./hm-status";

export function HmUnitCard({ unit }: { unit: HmUnitSummary }) {
  const worst = worstStatus(unit);
  return (
    <Link
      href={`/maintenance/unit/${unit.id}`}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-lg border bg-card p-4 pl-5 transition-colors hover:bg-muted/40"
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", STATUS_BG[worst])} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-bold">{unit.code}</div>
          <div className="truncate text-sm text-muted-foreground">{unit.name}</div>
          <div className="truncate text-xs text-muted-foreground">{unit.model}</div>
        </div>
        <StatusBadge status={worst} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            HM Terkini
          </div>
          <div className="font-mono font-semibold tabular-nums">{formatHm(unit.current_hm)}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Part
          </div>
          <div className="font-mono font-semibold tabular-nums">{formatCount(unit.part_count)}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t pt-2 text-xs">
        <span className="text-success">{unit.aman_count} Aman</span>
        <span className="text-warning">{unit.segera_count} Segera</span>
        <span className="text-destructive">{unit.lewat_count} Lewat</span>
        <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export function HmUnitGrid({ units, loading }: { units: HmUnitSummary[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-lg" />
        ))}
      </div>
    );
  }
  if (units.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed py-10 text-center">
        <Truck className="h-8 w-8 text-muted-foreground" />
        <div className="font-semibold">Belum ada unit terdaftar</div>
        <div className="text-sm text-muted-foreground">
          Masuk sebagai admin untuk menambahkan unit dan daftar part-nya.
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {units.map((u) => (
        <HmUnitCard key={u.id} unit={u} />
      ))}
    </div>
  );
}
