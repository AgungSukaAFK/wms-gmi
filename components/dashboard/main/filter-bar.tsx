"use client";

// Baris filter dashboard: periode (preset dulu, lalu rentang bebas), lokasi,
// kategori & prioritas MR. Satu baris di atas semua yang difilternya.

import { MapPin, RotateCcw } from "lucide-react";
import { DatePickerString } from "@/components/date-picker-string";
import { useDashboard } from "@/components/dashboard/main/dashboard-context";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  DEFAULT_PRESET,
  formatRangeLabel,
  MR_KATEGORI_OPTIONS,
  MR_PRIORITY_OPTIONS,
  PERIOD_PRESETS,
} from "@/lib/dashboard/filters";
import { cn } from "@/lib/utils";

export function DashboardFilterBar({
  cabangOptions,
  isExec,
}: {
  cabangOptions: { id: number; nama: string }[];
  isExec: boolean;
}) {
  const { filters, scope, setParams, resetFilters, pending } = useDashboard();

  const hasFilter =
    filters.preset !== DEFAULT_PRESET ||
    filters.cabangIds.length > 0 ||
    filters.lokasiAll ||
    filters.kategori.length > 0 ||
    filters.priorities.length > 0;

  const setLokasi = (values: string[]) => {
    // Kosong = semua lokasi. Untuk user non-atasan itu harus eksplisit,
    // karena default mereka adalah cabangnya sendiri.
    if (values.length === 0) setParams({ lokasi: isExec ? null : "all" });
    else setParams({ lokasi: values });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Periode"
          className="flex max-w-full gap-1 overflow-x-auto rounded-lg border bg-muted/50 p-1 dark:bg-muted/10"
        >
          {PERIOD_PRESETS.map((preset) => {
            const active = filters.preset === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                aria-pressed={active}
                onClick={() => setParams({ periode: preset.value, dari: null, sampai: null })}
                className={cn(
                  "h-7 shrink-0 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 sm:flex sm:w-auto">
          <DatePickerString
            value={filters.from}
            onChange={(v) => v && setParams({ periode: "custom", dari: v, sampai: filters.to })}
            placeholder="Dari"
            className="h-9 min-w-0 overflow-hidden px-2.5 text-xs sm:w-40 sm:px-3"
          />
          <span className="text-muted-foreground">–</span>
          <DatePickerString
            value={filters.to}
            onChange={(v) => v && setParams({ periode: "custom", dari: filters.from, sampai: v })}
            placeholder="Sampai"
            className="h-9 min-w-0 overflow-hidden px-2.5 text-xs sm:w-40 sm:px-3"
          />
        </div>

        <MultiSelect
          className="w-full sm:w-48"
          placeholder="Semua lokasi"
          icon={<MapPin className="h-3.5 w-3.5 text-muted-foreground" />}
          searchable
          selected={scope.cabangIds.map(String)}
          onChange={setLokasi}
          options={cabangOptions.map((c) => ({ label: c.nama, value: String(c.id) }))}
        />
        <MultiSelect
          className="w-[calc(50%-0.25rem)] sm:w-40"
          placeholder="Kategori MR"
          selected={filters.kategori}
          onChange={(values) => setParams({ kategori: values })}
          options={MR_KATEGORI_OPTIONS.map((k) => ({ label: k, value: k }))}
        />
        <MultiSelect
          className="w-[calc(50%-0.25rem)] sm:w-36"
          placeholder="Prioritas MR"
          selected={filters.priorities}
          onChange={(values) => setParams({ prioritas: values })}
          options={MR_PRIORITY_OPTIONS.map((p) => ({ label: p, value: p }))}
        />

        {hasFilter && (
          <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={resetFilters}>
            <RotateCcw /> Reset
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {pending ? (
          "Memperbarui data..."
        ) : (
          <>
            Periode <span className="font-medium text-foreground">{formatRangeLabel(filters.from, filters.to)}</span>
            {filters.prevFrom && filters.prevTo && (
              <> · dibandingkan dengan {formatRangeLabel(filters.prevFrom, filters.prevTo)}</>
            )}
            {(filters.kategori.length > 0 || filters.priorities.length > 0) && (
              <> · kategori & prioritas hanya memfilter angka MR</>
            )}
          </>
        )}
      </p>
    </div>
  );
}
