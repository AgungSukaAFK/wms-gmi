// Elemen visual status Periodic Maintenance (hm.md §3.2, §3.4, §16):
// badge pill bertitik, rail 3px, legenda, dan strip angka ringkasan.

"use client";

import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount, HmStatus, replacementState, STATUS_LABEL, HmPartView } from "@/lib/hm";
import { Skeleton } from "@/components/ui/skeleton";

export const STATUS_BG: Record<HmStatus, string> = {
  aman: "bg-success",
  segera: "bg-warning",
  lewat: "bg-destructive",
};

export const STATUS_TEXT: Record<HmStatus, string> = {
  aman: "text-success",
  segera: "text-warning",
  lewat: "text-destructive",
};

const STATUS_PILL: Record<HmStatus, string> = {
  aman: "border-success/40 bg-success/10 text-success",
  segera: "border-warning/40 bg-warning/10 text-warning",
  lewat: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function StatusDot({ status, className }: { status: HmStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        STATUS_BG[status],
        status === "lewat" && "animate-pulse",
        className,
      )}
    />
  );
}

export function StatusBadge({ status }: { status: HmStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        STATUS_PILL[status],
      )}
    >
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Kolom "Penggantian" (hm.md §3.4). */
export function ReplacementBadge({ part }: { part: Pick<HmPartView, "replaced_this_interval" | "status"> }) {
  const { state, overdue } = replacementState(part);
  if (state === "replaced") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Sudah diganti
      </span>
    );
  }
  if (overdue) {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-destructive"
        title="Part sudah lewat jatuh tempo dan belum ada catatan penggantian pada interval berjalan."
        aria-label="Belum diganti — part sudah lewat jatuh tempo tanpa catatan penggantian"
      >
        <AlertTriangle className="h-3.5 w-3.5 animate-pulse" />
        Belum diganti
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
      <Circle className="h-3.5 w-3.5" />
      Belum diganti
    </span>
  );
}

/** Rail warna 3px di kiri baris tabel. */
export function RailCell({ status }: { status: HmStatus }) {
  return <td aria-hidden className={cn("w-[3px] min-w-[3px] p-0", STATUS_BG[status])} />;
}

export function StatusLegend() {
  return (
    <div className="col-span-12 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide text-foreground">Legenda Status</span>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot status="aman" /> Aman — sisa &gt; 50 HM
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot status="segera" /> Segera — sisa 0–50 HM
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot status="lewat" /> Lewat — sisa ≤ 0 HM
      </span>
    </div>
  );
}

export type SummaryStat = { label: string; value: number; status?: HmStatus };

export function SummaryStrip({ stats, loading }: { stats: SummaryStat[]; loading?: boolean }) {
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-lg border bg-border",
        stats.length >= 5 ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {stats.map((s) => (
        <div key={s.label} className="bg-card px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {s.status && <StatusDot status={s.status} />}
            {s.label}
          </div>
          {loading ? (
            <Skeleton className="mt-1.5 h-7 w-12" />
          ) : (
            <div
              className={cn(
                "mt-0.5 font-mono text-2xl font-bold tabular-nums",
                s.status && STATUS_TEXT[s.status],
              )}
            >
              {formatCount(s.value)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
