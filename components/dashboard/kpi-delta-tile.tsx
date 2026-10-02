"use client";

import { LucideIcon, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Content } from "@/components/content";
import { cn } from "@/lib/utils";

type KpiDeltaTileProps = {
  label: string;
  /** null = belum ada data (ditampilkan "-"). */
  value: number | null;
  sublabel?: string;
  icon: LucideIcon;
  iconClassName?: string;
  previous: number | null;
  /** Satuan di belakang angka, mis. " hari". */
  suffix?: string;
  decimals?: number;
  /** true = makin kecil makin bagus (mis. lead time) -> warna delta dibalik. */
  invert?: boolean;
  className?: string;
};

export function KpiDeltaTile({
  label,
  value,
  sublabel = "vs bulan lalu",
  icon: Icon,
  iconClassName,
  previous,
  suffix = "",
  decimals = 0,
  invert = false,
  className,
}: KpiDeltaTileProps) {
  const hasDelta = value !== null && previous !== null;
  const diff = hasDelta ? value - previous : 0;
  const pct =
    hasDelta && previous > 0
      ? Math.round((diff / previous) * 100)
      : diff > 0
        ? 100
        : 0;
  const isUp = diff > 0;
  const isDown = diff < 0;
  const isGood = invert ? isDown : isUp;
  const isBad = invert ? isUp : isDown;

  const format = (n: number) =>
    n.toLocaleString("id-ID", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });

  return (
    <Content size="xs" className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {value === null ? "-" : format(value)}
            {value !== null && suffix && (
              <span className="ml-1 text-sm font-semibold text-muted-foreground">
                {suffix}
              </span>
            )}
          </p>
          <div className="mt-1 flex items-center gap-1">
            {!hasDelta ? (
              <span className="text-[10px] font-medium text-muted-foreground">
                Belum ada pembanding
              </span>
            ) : (
              <>
                {isUp ? (
                  <TrendingUp
                    className={cn(
                      "h-3 w-3",
                      isGood ? "text-emerald-600" : "text-rose-600",
                    )}
                  />
                ) : isDown ? (
                  <TrendingDown
                    className={cn(
                      "h-3 w-3",
                      isGood ? "text-emerald-600" : "text-rose-600",
                    )}
                  />
                ) : (
                  <Minus className="h-3 w-3 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "text-[10px] font-semibold",
                    isGood && "text-emerald-600",
                    isBad && "text-rose-600",
                    !isGood && !isBad && "text-muted-foreground",
                  )}
                >
                  {diff === 0
                    ? "Sama seperti"
                    : `${pct > 0 ? "+" : ""}${pct}%`}{" "}
                  {sublabel}
                </span>
              </>
            )}
          </div>
          {hasDelta && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Bulan lalu: {format(previous)}
              {suffix}
            </p>
          )}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
            iconClassName,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Content>
  );
}
