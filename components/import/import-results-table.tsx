"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lightbulb, ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/import/report";
import { ISSUE_INFO, explainResult, formatRowList, groupIssues } from "@/lib/import/explain";
import type { ImportDefinition, ImportIssueKind, ImportRow, ImportRowResult } from "@/lib/import/types";

const STATUS_CLASS: Record<ImportRowResult["status"], string> = {
  create: "bg-success/15 text-success border-success/30",
  update: "bg-primary/10 text-primary border-primary/30",
  skip: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/30",
};

type Filter = "all" | ImportRowResult["status"] | "warning";
const PAGE = 100;

function display(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Ya" : "Tidak";
  return String(v);
}

/** Ringkasan error per jenis masalah: apa, berapa baris, kenapa, cara beresin. */
function IssueSummary({
  results,
  active,
  onPick,
}: {
  results: Map<number, ImportRowResult>;
  active: ImportIssueKind | null;
  onPick: (k: ImportIssueKind | null) => void;
}) {
  const groups = useMemo(() => groupIssues(results.values()), [results]);
  if (!groups.length) return null;
  const causes = groups.filter((g) => g.kind !== "cascade");
  const cascade = groups.find((g) => g.kind === "cascade");
  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-destructive">Ringkasan masalah</div>
        {active && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onPick(null)}>
            <X className="mr-1 h-3.5 w-3.5" /> Hapus filter jenis
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {causes.map((g) => (
          <div
            key={g.kind}
            className={cn("rounded-md border bg-background p-2.5 text-xs", active === g.kind ? "border-destructive ring-1 ring-destructive/40" : "border-border")}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-semibold text-foreground">{g.label}</span>{" "}
                <span className="text-muted-foreground">
                  · {g.rows.length.toLocaleString("id-ID")} baris{g.docs.size > 1 ? ` di ${g.docs.size} dokumen` : ""}
                </span>
              </div>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onPick(active === g.kind ? null : g.kind)}>
                <ListFilter className="mr-1 h-3 w-3" /> {active === g.kind ? "Tampilkan semua" : "Lihat barisnya"}
              </Button>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-foreground/90">
              {g.samples.map((s, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="shrink-0 tabular-nums text-muted-foreground">baris {formatRowList(s.rows, 6)}:</span>
                  <span className="min-w-0 break-words">{s.message}</span>
                </li>
              ))}
              {g.rows.length > g.samples.reduce((t, s) => t + s.rows.length, 0) && (
                <li className="text-muted-foreground">…dan baris lain dengan masalah serupa</li>
              )}
            </ul>
            <div className="mt-1.5 flex gap-1.5 text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{g.hint}</span>
            </div>
          </div>
        ))}
        {cascade && (
          <button
            type="button"
            onClick={() => onPick(active === "cascade" ? null : "cascade")}
            className={cn(
              "w-full rounded-md border border-dashed bg-background p-2 text-left text-xs text-muted-foreground hover:bg-muted/50",
              active === "cascade" ? "border-destructive" : "border-border",
            )}
          >
            <b className="text-foreground">{cascade.rows.length.toLocaleString("id-ID")} baris lain</b> sebenarnya benar, tapi {ISSUE_INFO.cascade.label.toLowerCase()} — otomatis ikut beres
            kalau baris penyebab di atas diperbaiki.
          </button>
        )}
      </div>
    </div>
  );
}

function RowDetail({ def, row, res }: { def: ImportDefinition; row: ImportRow; res?: ImportRowResult }) {
  return (
    <div className="grid gap-x-4 gap-y-1 p-2 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
      {def.columns
        .filter((c) => !c.infoOnly)
        .map((c) => {
          const flagged = !!res?.message && (res.message.includes(`${c.header}:`) || res.details?.some((d) => d.label === c.header));
          return (
            <div key={c.key} className={cn("flex min-w-0 gap-1.5", flagged && "font-semibold text-destructive")}>
              <span className="shrink-0 text-muted-foreground">{c.header}:</span>
              <span className="min-w-0 break-all font-mono">{display(row.values[c.key])}</span>
            </div>
          );
        })}
      {res?.ref && (
        <div className="flex gap-1.5">
          <span className="text-muted-foreground">Dokumen:</span>
          <span className="font-mono">{res.ref}</span>
        </div>
      )}
    </div>
  );
}

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
  const [kind, setKind] = useState<ImportIssueKind | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
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
        if (kind) return explainResult(res)?.kind === kind;
        if (filter === "all") return true;
        if (filter === "warning") return !!res?.warnings?.length;
        return res?.status === filter;
      }),
    [rows, results, filter, kind],
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

  const toggle = (row: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(row)) n.delete(row);
      else n.add(row);
      return n;
    });

  return (
    <div className="space-y-3">
      <IssueSummary
        results={results}
        active={kind}
        onPick={(k) => {
          setKind(k);
          setFilter(k ? "error" : "all");
          setPage(0);
        }}
      />
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter hasil">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key && !kind}
            onClick={() => {
              setFilter(t.key);
              setKind(null);
              setPage(0);
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              filter === t.key && !kind ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
            )}
          >
            {t.label} <span className="tabular-nums opacity-80">{counts[t.key]}</span>
          </button>
        ))}
        {kind && (
          <span className="inline-flex items-center gap-1 rounded-md border border-destructive bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
            {ISSUE_INFO[kind].label} <span className="tabular-nums opacity-80">{filtered.length}</span>
            <button type="button" aria-label="Hapus filter jenis" onClick={() => setKind(null)} className="ml-0.5">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Klik baris untuk melihat seluruh isi baris tersebut di file.</p>
      <div className="max-h-[560px] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="sticky top-0 z-10 w-16 bg-muted px-2 py-2 font-semibold">Baris</th>
              <th className="sticky top-0 z-10 w-24 bg-muted px-2 py-2 font-semibold">Status</th>
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
              const ex = explainResult(res);
              const isOpen = open.has(r.row);
              return (
                <Fragment key={r.row}>
                  <tr className={cn("cursor-pointer border-t border-border align-top hover:bg-muted/40", isOpen && "bg-muted/30")} onClick={() => toggle(r.row)}>
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5">
                        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {r.row}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {res ? (
                        <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold", STATUS_CLASS[res.status])}>{STATUS_LABEL[res.status]}</span>
                      ) : (
                        <span className="text-muted-foreground">…</span>
                      )}
                    </td>
                    {keyCols.map((c) => (
                      <td key={c.key} className="break-all px-2 py-1.5 font-mono text-[11px]">
                        {String(r.values[c.key] ?? "")}
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      {ex && (
                        <span
                          className={cn(
                            "mb-0.5 mr-1 inline-block rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
                            ex.kind === "cascade" ? "bg-muted text-muted-foreground" : "bg-destructive/15 text-destructive",
                          )}
                        >
                          {ex.label}
                        </span>
                      )}
                      <div className={cn(res?.status === "error" && ex?.kind !== "cascade" && "text-destructive", ex?.kind === "cascade" && "text-muted-foreground")}>
                        {res?.message || ""}
                      </div>
                      {!!res?.details?.length && (
                        <div className="mt-1 overflow-hidden rounded border border-border bg-background">
                          <table className="w-full text-[11px]">
                            <thead className="bg-muted/50 text-muted-foreground">
                              <tr>
                                <th className="px-1.5 py-0.5 text-left font-medium" />
                                <th className="px-1.5 py-0.5 text-left font-medium">Di file</th>
                                <th className="px-1.5 py-0.5 text-left font-medium">Di WMS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {res.details.map((d, i) => (
                                <tr key={i} className="border-t border-border">
                                  <td className="px-1.5 py-0.5 text-muted-foreground">{d.label}</td>
                                  <td className="px-1.5 py-0.5 font-mono">{display(d.file)}</td>
                                  <td className="px-1.5 py-0.5 font-mono">{display(d.wms)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {ex && ex.kind !== "cascade" && (
                        <div className="mt-1 flex gap-1 text-muted-foreground">
                          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                          <span>{ex.hint}</span>
                        </div>
                      )}
                      {res?.warnings?.map((w, i) => (
                        <div key={i} className="mt-0.5 text-warning">
                          ⚠ {w}
                        </div>
                      ))}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-dashed border-border bg-muted/20">
                      <td colSpan={3 + keyCols.length}>
                        <RowDetail def={def} row={r} res={res} />
                      </td>
                    </tr>
                  )}
                </Fragment>
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
