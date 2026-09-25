"use client";

import { LucideIcon, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Content } from "@/components/content";
import { cn } from "@/lib/utils";

type KpiDeltaTileProps = {
  label: string;
  value: number;
  sublabel?: string;
  icon: LucideIcon;
  iconClassName?: string;
  previous: number;
};

export function KpiDeltaTile({
  label,
  value,
  sublabel = "vs bulan lalu",
  icon: Icon,
  iconClassName,
  previous,
}: KpiDeltaTileProps) {
  const diff = value - previous;
  const pct =
    previous > 0 ? Math.round((diff / previous) * 100) : diff > 0 ? 100 : 0;
  const isUp = diff > 0;
  const isDown = diff < 0;

  return (
    <Content size="xs">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-bold text-foreground">
            {value.toLocaleString("id-ID")}
          </p>
          <div className="mt-1 flex items-center gap-1">
            {isUp ? (
              <TrendingUp className="h-3 w-3 text-emerald-600" />
            ) : isDown ? (
              <TrendingDown className="h-3 w-3 text-rose-600" />
            ) : (
              <Minus className="h-3 w-3 text-muted-foreground" />
            )}
            <span
              className={cn(
                "text-[10px] font-semibold",
                isUp && "text-emerald-600",
                isDown && "text-rose-600",
                !isUp && !isDown && "text-muted-foreground",
              )}
            >
              {diff === 0 ? "Sama seperti" : `${pct > 0 ? "+" : ""}${pct}%`}{" "}
              {sublabel}
            </span>
          </div>
        </div>
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-md",
            iconClassName,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Content>
  );
}
