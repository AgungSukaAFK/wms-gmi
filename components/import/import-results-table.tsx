"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/import/report";
import type { ImportDefinition, ImportRow, ImportRowResult } from "@/lib/import/types";

const STATUS_CLASS: Record<ImportRowResult["status"], string> = {
  create: "bg-success/15 text-success border-success/30",
  update: "bg-primary/10 text-primary border-primary/30",
  skip: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30",
};

type Filter = "all" | ImportRowResult["status"] | "warning";
const PAGE = 100;

export function ImportResultsTable({
  def,
  rows,
  results,
}: {
  def: ImportDefinition;
  rows: ImportRow[];
  results: Map<number, ImportRowResult>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  const counts = useMemo(() => {
    const c = { all: rows.length, create: 0, update: 0, skip: 0, error: 0, warning: 0 };
    for (const r of rows) {
      const res = results.get(r.row);
      if (!res) continue;
      c[res.status]++;
      if (res.warnings?.length) c.warning++;
    }
    return c;
  }, [rows, results]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const res = results.get(r.row);
        if (filter === "all") return true;
        if (filter === "warning") return !!res?.warnings?.length;
        return res?.status === filter;
      }),
    [rows, results, filter],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const view = filtered.slice(page * PAGE, page * PAGE + PAGE);
  // Kolom kunci yang ditampilkan di tabel (selain status).
  const keyCols = useMemo(() => {
    const keys = [...(def.docKey || []), ...(def.uniqueKey || []), ...(def.groupKey || [])];
    const cols = def.columns.filter((c) => keys.includes(c.key) || c.key === "part_number");
    return (cols.length ? cols : def.columns.filter((c) => c.required)).slice(0, 3);
  }, [def]);

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "Semua" },
    { key: "error", label: "Error" },
    { key: "create", label: "Baru" },
    { key: "update", label: "Diperbarui" },
    { key: "skip", label: "Dilewati" },
    { key: "warning", label: "Peringatan" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter hasil">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            onClick={() => {
              setFilter(t.key);
              setPage(0);
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              filter === t.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
            )}
          >
            {t.label} <span className="tabular-nums opacity-80">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      <div className="max-h-[520px] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 font-semibold w-16">Baris</th>
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 font-semibold w-24">Status</th>
              {keyCols.map((c) => (
                <th key={c.key} className="sticky top-0 z-10 bg-muted px-2 py-2 font-semibold">
                  {c.header}
                </th>
              ))}
              <th className="sticky top-0 z-10 bg-muted px-2 py-2 font-semibold">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const res = results.get(r.row);
              return (
                <tr key={r.row} className="border-t border-border align-top">
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                  <td className="px-2 py-1.5">
                    {res ? (
                      <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold", STATUS_CLASS[res.status])}>
                        {STATUS_LABEL[res.status]}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">…</span>
                    )}
                  </td>
                  {keyCols.map((c) => (
                    <td key={c.key} className="px-2 py-1.5 font-mono text-[11px] break-all">
                      {String(r.values[c.key] ?? "")}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <div className={cn(res?.status === "error" && "text-destructive")}>{res?.message || ""}</div>
                    {res?.warnings?.map((w, i) => (
                      <div key={i} className="mt-0.5 text-warning">
                        ⚠ {w}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
            {!view.length && (
              <tr>
                <td colSpan={3 + keyCols.length} className="px-2 py-6 text-center text-muted-foreground">
                  Tidak ada baris untuk filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {page * PAGE + 1}–{Math.min(filtered.length, (page + 1) * PAGE)} dari {filtered.length} baris
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Sebelumnya
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Berikutnya
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
