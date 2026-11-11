"use client";

// Blok dasar dashboard utama.
// - Panel      : <Content> dengan padding padat; tinggi ikut baris (h-full).
// - MetricGrid : grid sel angka di dalam panel. Jumlah kolom mengikuti LEBAR
//                PANEL (container query), dipilih supaya habis dibagi jumlah
//                sel -> tidak ada sel yatim di baris terakhir.
// - MetricCell : sel angka yang bisa diklik (membuka daftar sumber datanya).
// - Bar HTML ringan untuk peringkat/komposisi (tanpa library chart).

import { use } from "react";
import {
  AlertCircle,
  ChevronRight,
  Minus,
  RotateCw,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Content } from "@/components/content";
import { PERIOD_CARDS, QUEUE_CARDS, type Tone } from "@/components/dashboard/main/config";
import { useDashboard } from "@/components/dashboard/main/dashboard-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CurPrev,
  DashboardPeriodPart,
  DashboardQueue,
  ListArgs,
  ListKind,
  PartResult,
  PeriodKey,
  QueueKey,
} from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

export const num = (n: number | null | undefined) => Number(n || 0).toLocaleString("id-ID");

export const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/** 12.300.000 -> "Rp 12,3 jt"; angka kecil ditulis penuh. */
export function compactRupiah(value: number, currency = "IDR") {
  const prefix = currency === "IDR" ? "Rp" : currency;
  const abs = Math.abs(value);
  const fmt = (n: number, unit: string) =>
    `${prefix} ${n.toLocaleString("id-ID", { maximumFractionDigits: n >= 100 ? 0 : 1 })} ${unit}`;
  if (abs >= 1e12) return fmt(value / 1e12, "T");
  if (abs >= 1e9) return fmt(value / 1e9, "M");
  if (abs >= 1e6) return fmt(value / 1e6, "jt");
  return `${prefix} ${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

// ------------------------------------------------------------------
// Panel & section
// ------------------------------------------------------------------

/** Lebar panel di grid 12 kolom halaman (mobile selalu penuh). */
const SPAN: Record<number, string> = {
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

const PANEL_CLASS =
  "h-full gap-3 py-4 sm:py-5 [&>[data-slot=card-header]]:px-4 sm:[&>[data-slot=card-header]]:px-5 [&>[data-slot=card-content]]:px-4 sm:[&>[data-slot=card-content]]:px-5 [&_[data-slot=card-title]]:text-[0.95rem] [&_[data-slot=card-description]]:text-xs";

export function Panel({
  span = 12,
  title,
  description,
  action,
  fill = false,
  className,
  children,
}: {
  span?: 4 | 5 | 6 | 7 | 8 | 12;
  /** Isi meregang mengisi tinggi panel (dipakai bersama MetricGrid fill). */
  fill?: boolean;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Content
      title={title}
      description={description}
      cardAction={action}
      className={cn(PANEL_CLASS, SPAN[span], fill && "[&>[data-slot=card-content]]:flex-1", className)}
    >
      {children}
    </Content>
  );
}

export function SectionHeading({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  description?: string;
}) {
  return (
    <div id={id} className="col-span-12 -mb-1 mt-1 scroll-mt-24">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Kartu error satu bagian (bagian lain tetap tampil). */
export function PartError({ message, compact = false }: { message: string; compact?: boolean }) {
  const { refresh, pending } = useDashboard();
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 text-sm",
        compact ? "p-3" : "p-4",
      )}
    >
      <span className="flex items-start gap-2 text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="font-medium">Bagian ini gagal dimuat.</span>
      </span>
      <span className="text-xs break-words text-muted-foreground">{message}</span>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={refresh} disabled={pending}>
        <RotateCw className={cn(pending && "animate-spin")} /> Coba lagi
      </Button>
    </div>
  );
}

/** Panel skeleton dengan tinggi kira-kira isi aslinya. */
export function PanelSkeleton({
  span = 12,
  title,
  rows = 4,
}: {
  span?: 4 | 5 | 6 | 7 | 8 | 12;
  title?: string;
  rows?: number;
}) {
  return (
    <Panel span={span} title={title}>
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------
// Grid sel angka
// ------------------------------------------------------------------

// Ditulis lengkap supaya terbaca Tailwind. Ukuran container: @sm 24rem,
// @xl 36rem, @2xl 42rem, @3xl 48rem, @4xl 56rem, @5xl 64rem.
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-1 @sm:grid-cols-3",
  4: "grid-cols-2 @3xl:grid-cols-4",
  5: "grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-5",
  6: "grid-cols-2 @xl:grid-cols-3 @5xl:grid-cols-6",
  7: "grid-cols-2 @xl:grid-cols-4",
  8: "grid-cols-2 @2xl:grid-cols-4",
  9: "grid-cols-2 @xl:grid-cols-3",
  10: "grid-cols-2 @3xl:grid-cols-5",
};
const GRID_DEFAULT = "grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-4";

export function MetricGrid({
  count,
  fill = false,
  children,
}: {
  count: number;
  /** Baris meregang rata mengisi tinggi panel (Panel fill). */
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("@container", fill && "h-full")}>
      <div className={cn("grid gap-2", fill && "h-full auto-rows-fr", GRID_COLS[count] ?? GRID_DEFAULT)}>
        {children}
      </div>
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  critical: "text-destructive",
  warning: "text-warning",
  info: "text-primary",
  neutral: "text-muted-foreground",
};

const CELL_CLASS =
  "group relative flex h-full min-w-0 flex-col rounded-lg border bg-background p-3 text-left";

export function MetricCell({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  active = true,
  onClick,
  children,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** false = nilainya nol / tidak ada: sel diredam. */
  active?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex min-h-[2.75em] min-w-0 items-start gap-1.5 text-xs font-medium leading-snug text-muted-foreground">
        {Icon && (
          <Icon
            className={cn("mt-px h-3.5 w-3.5 shrink-0", active ? TONE_TEXT[tone] : "text-muted-foreground/70")}
          />
        )}
        <span className="line-clamp-2 min-w-0 flex-1">{label}</span>
        {onClick && (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-visible:opacity-100" />
        )}
      </span>
      <span
        className={cn(
          "mt-1 text-xl font-semibold leading-none tracking-tight",
          !active && "text-muted-foreground",
          active && tone === "critical" && "text-destructive",
        )}
      >
        {value}
      </span>
      {hint && (
        <span className="mt-1 block truncate text-[11px] leading-snug text-muted-foreground">{hint}</span>
      )}
      {children && (
        <span className="mt-auto block pt-2">
          <span className="block space-y-0.5 border-t pt-1.5">{children}</span>
        </span>
      )}
    </>
  );

  if (!onClick) return <div className={CELL_CLASS}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CELL_CLASS,
        "cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      {body}
    </button>
  );
}

export function CellSkeleton() {
  return (
    <div className={cn(CELL_CLASS, "gap-2")} aria-busy="true">
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="mt-3 h-5 w-1/3" />
      <Skeleton className="h-2.5 w-1/2" />
    </div>
  );
}

/** Baris rincian kecil di dalam sel. */
export function SubCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="truncate">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{num(value)}</span>
    </span>
  );
}

/** Sel antrian (state saat ini) -> membuka daftar dengan kind yang sama. */
export function QueueCell({
  queueKey,
  queue,
  label,
  children,
}: {
  queueKey: QueueKey;
  queue: DashboardQueue;
  label?: string;
  children?: React.ReactNode;
}) {
  const { openList } = useDashboard();
  const def = QUEUE_CARDS[queueKey];
  const value = queue[queueKey] ?? 0;
  return (
    <MetricCell
      label={label ?? def.label}
      value={num(value)}
      hint={def.hint}
      icon={def.icon}
      tone={def.tone}
      active={value > 0}
      onClick={() => openList(queueKey)}
    >
      {children}
    </MetricCell>
  );
}

// ------------------------------------------------------------------
// Pembanding periode
// ------------------------------------------------------------------

export function Delta({
  cur,
  prev,
  goodWhen = null,
  suffix = "",
  format,
}: {
  cur: number | null;
  prev: number | null;
  /** Arah yang dianggap baik. null = netral (volume dokumen). */
  goodWhen?: "up" | "down" | null;
  suffix?: string;
  /** Format angka pembanding, mis. compactRupiah. */
  format?: (n: number) => string;
}) {
  if (cur === null || prev === null) {
    return <span className="text-muted-foreground">Belum ada pembanding</span>;
  }
  const diff = cur - prev;
  const percent = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const good = goodWhen && diff !== 0 ? (diff > 0 ? "up" : "down") === goodWhen : null;
  const fmt = (n: number) =>
    format ? format(n) : `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })}${suffix}`;

  return (
    <span className="inline-flex max-w-full items-center gap-1 text-muted-foreground">
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          good === true && "text-success",
          good === false && "text-destructive",
        )}
      />
      <span
        className={cn(
          "font-medium",
          good === true && "text-success",
          good === false && "text-destructive",
          good === null && "text-foreground",
        )}
      >
        {diff === 0
          ? "Sama"
          : percent === null
            ? `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`
            : `${percent > 0 ? "+" : ""}${percent}%`}
      </span>
      <span className="truncate">vs {fmt(prev)}</span>
    </span>
  );
}

/** Sel jumlah dokumen periode + pembanding (data dari bagian "period"). */
export function PeriodCell({
  periodKey,
  label,
  kind,
  args,
}: {
  periodKey: PeriodKey;
  label?: string;
  kind?: ListKind | null;
  args?: ListArgs;
}) {
  const { parts } = useDashboard();
  const result = use(parts.period);
  return <PeriodCellView result={result} periodKey={periodKey} label={label} kind={kind} args={args} />;
}

function PeriodCellView({
  result,
  periodKey,
  label,
  kind,
  args,
}: {
  result: PartResult<DashboardPeriodPart>;
  periodKey: PeriodKey;
  label?: string;
  kind?: ListKind | null;
  args?: ListArgs;
}) {
  const { openList } = useDashboard();
  const def = PERIOD_CARDS[periodKey];
  const data: CurPrev | null = result.data?.period?.[periodKey] ?? null;
  const listKind = kind === undefined ? def.kind : kind;
  return (
    <MetricCell
      label={label ?? `${def.label} dibuat`}
      value={data ? num(data.cur) : "-"}
      hint={data ? <Delta cur={data.cur} prev={data.prev} /> : "Gagal dimuat"}
      icon={def.icon}
      tone="info"
      active={!!data && data.cur > 0}
      onClick={data && listKind ? () => openList(listKind, args) : undefined}
    />
  );
}

// ------------------------------------------------------------------
// Bar HTML
// ------------------------------------------------------------------

/**
 * Satu baris "label ...... nilai" + bar tipis. Dipakai untuk peringkat
 * (satu warna) maupun bar bersusun (beberapa segmen dengan celah 2px).
 */
export function BarRow({
  label,
  sublabel,
  valueText,
  segments,
  max,
  onClick,
  title,
}: {
  label: string;
  sublabel?: string;
  valueText: React.ReactNode;
  segments: { value: number; className: string; name?: string }[];
  /** Nilai yang setara lebar penuh. */
  max: number;
  onClick?: () => void;
  title?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const width = max > 0 ? (total / max) * 100 : 0;
  const tooltip =
    title ??
    segments
      .filter((s) => s.name)
      .map((s) => `${s.name}: ${num(s.value)}`)
      .join(" · ");

  const body = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm">
          <span className="font-medium">{label}</span>
          {sublabel && <span className="ml-2 text-xs text-muted-foreground">{sublabel}</span>}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{valueText}</span>
      </span>
      <span className="mt-1 block h-2 w-full rounded-full bg-muted/60">
        <span
          className="flex h-full gap-0.5 overflow-hidden rounded-full"
          style={{ width: `${Math.max(width, total > 0 ? 1.5 : 0)}%` }}
        >
          {segments
            .filter((s) => s.value > 0)
            .map((s, i) => (
              <span
                key={i}
                className={cn("h-full min-w-0.5", s.className)}
                style={{ flexGrow: s.value, flexBasis: 0 }}
              />
            ))}
        </span>
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div title={tooltip || undefined} className="block py-1">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip || undefined}
      className="-mx-2 block w-[calc(100%+1rem)] cursor-pointer rounded-md px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {body}
    </button>
  );
}

export function LegendDots({ items }: { items: { label: string; className: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-sm", item.className)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Satu keseluruhan dibagi beberapa bagian; angka ada di daftar di bawahnya. */
export function SegmentedBar({
  parts,
  onSelect,
}: {
  parts: { key: string; label: string; value: number; className: string }[];
  onSelect?: (key: string) => void;
}) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return (
    <div>
      <div
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted/60"
        role="img"
        aria-label={parts.map((p) => `${p.label} ${num(p.value)}`).join(", ")}
      >
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.key}
              className={cn("h-full min-w-0.5", p.className)}
              style={{ flexGrow: p.value, flexBasis: 0 }}
            />
          ))}
      </div>
      <ul className="mt-2 space-y-0.5">
        {parts.map((p) => {
          const row = (
            <>
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", p.className)} />
                <span className="truncate">{p.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{num(p.value)}</span> ·{" "}
                {pct(p.value, total)}%
              </span>
            </>
          );
          return (
            <li key={p.key}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(p.key)}
                  className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 py-1 text-sm">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
