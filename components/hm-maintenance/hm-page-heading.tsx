"use client";

import { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function HmPageHeading({
  label,
  title,
  subtitle,
  description,
  actions,
}: {
  label: string;
  title: string;
  subtitle?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="col-span-12 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-primary">{label}</div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function HmReloadButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      Muat Ulang
    </Button>
  );
}

export function HmLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="col-span-12 flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {message}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Coba Lagi
      </Button>
    </div>
  );
}
