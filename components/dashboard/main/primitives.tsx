"use client";

// Blok dasar dashboard utama: judul section, kartu angka yang bisa diklik,
// pembanding periode, dan bar HTML ringan (tanpa library chart).

import { ArrowRight, Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { Content } from "@/components/content";
import {
  PERIOD_CARDS,
  QUEUE_CARDS,
  type Tone,
} from "@/components/dashboard/main/config";
import { useDashboard } from "@/components/dashboard/main/dashboard-context";
import type {
  CurPrev,
  DashboardPeriod,
  DashboardQueue,
  ListArgs,
  ListKind,
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
// Section
// ------------------------------------------------------------------

export function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="col-span-12 mt-2 flex scroll-mt-24 flex-wrap items-end justify-between gap-x-4 gap-y-2"
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

// ------------------------------------------------------------------
// Kartu angka
// ------------------------------------------------------------------

const TONE_ICON: Record<Tone, string> = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  info: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
};

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  active = true,
  onClick,
  actionLabel = "Lihat daftar",
  children,
  className,
}: {
  label: string;
  /** Sudah diformat. */
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** false = angkanya nol: kartu diredam. */
  active?: boolean;
  onClick?: () => void;
  actionLabel?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Content
      size="xs"
      className={cn(
        "group relative col-span-6 gap-0 py-4 transition-colors [&>[data-slot=card-content]]:px-4 sm:[&>[data-slot=card-content]]:px-5",
        onClick && "hover:border-primary/40 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium leading-snug text-muted-foreground">{label}</p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold leading-tight tracking-tight",
              !active && "text-muted-foreground",
              active && tone === "critical" && "text-destructive",
            )}
          >
            {value}
          </p>
          {hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <span
            className={cn(
              "hidden h-9 w-9 shrink-0 items-center justify-center rounded-md sm:flex",
              active ? TONE_ICON[tone] : TONE_ICON.neutral,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      {children}
      {onClick && (
        <>
          <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
            {actionLabel}
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
          {/* Seluruh kartu jadi area klik. */}
          <button
            type="button"
            onClick={onClick}
            aria-label={`${label}: ${actionLabel.toLowerCase()}`}
            className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-none"
          />
        </>
      )}
    </Content>
  );
}

/** Baris rincian kecil di dalam kartu. */
export function SubCount({ label, value }: { label: string; value: number }) {
  return (
    <p className="flex justify-between gap-2 text-xs text-muted-foreground">
      <span className="truncate">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{num(value)}</span>
    </p>
  );
}

/** Kartu antrian (state saat ini) -> membuka daftar dengan kind yang sama. */
export function QueueTile({
  queueKey,
  queue,
  label,
  children,
  className,
}: {
  queueKey: QueueKey;
  queue: DashboardQueue;
  label?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { openList } = useDashboard();
  const def = QUEUE_CARDS[queueKey];
  const value = queue[queueKey] ?? 0;
  return (
    <StatTile
      label={label ?? def.label}
      value={num(value)}
      hint={def.hint}
      icon={def.icon}
      tone={def.tone}
      active={value > 0}
      onClick={() => openList(queueKey)}
      className={className}
    >
      {children && <div className="mt-2 space-y-0.5">{children}</div>}
    </StatTile>
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
    return <span className="text-xs text-muted-foreground">Belum ada pembanding</span>;
  }
  const diff = cur - prev;
  const percent = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const good = goodWhen && diff !== 0 ? (diff > 0 ? "up" : "down") === goodWhen : null;
  const prevText = format
    ? format(prev)
    : `${prev.toLocaleString("id-ID", { maximumFractionDigits: 1 })}${suffix}`;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
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
            ? `${diff > 0 ? "+" : "−"}${
                format
                  ? format(Math.abs(diff))
                  : `${Math.abs(diff).toLocaleString("id-ID", { maximumFractionDigits: 1 })}${suffix}`
              }`
            : `${percent > 0 ? "+" : ""}${percent}%`}
      </span>
      <span>dari {prevText}</span>
    </span>
  );
}

/** Kartu jumlah dokumen pada periode + pembanding. */
export function PeriodTile({
  periodKey,
  period,
  label,
  kind,
  args,
  className,
}: {
  className?: string;
  periodKey: PeriodKey;
  period: DashboardPeriod;
  label?: string;
  kind?: ListKind | null;
  args?: ListArgs;
}) {
  const { openList } = useDashboard();
  const def = PERIOD_CARDS[periodKey];
  const data: CurPrev = period[periodKey] ?? { cur: 0, prev: null };
  const listKind = kind === undefined ? def.kind : kind;
  return (
    <StatTile
      label={label ?? `${def.label} dibuat`}
      value={num(data.cur)}
      hint={<Delta cur={data.cur} prev={data.prev} />}
      icon={def.icon}
      tone="info"
      onClick={listKind ? () => openList(listKind, args) : undefined}
      className={className}
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
      <span className="mt-1.5 block h-2.5 w-full rounded-full bg-muted/60">
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
      <div title={tooltip || undefined} className="block py-1.5">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip || undefined}
      className="-mx-2 block w-[calc(100%+1rem)] cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
      <ul className="mt-3 space-y-0.5">
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
