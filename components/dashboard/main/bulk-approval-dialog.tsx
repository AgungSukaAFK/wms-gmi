"use client";

// Approval massal: centang beberapa dokumen yang gilirannya di-approve user
// ini, tanda tangan + password sekali, lalu di-approve satu per satu.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCheck, CircleAlert, CircleCheck, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { DOC_TYPE_SHORT } from "@/components/dashboard/main/config";
import { num } from "@/components/dashboard/main/primitives";
import { formatYmdShort } from "@/lib/dashboard/filters";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  approveQueuedDocument,
  getMyApprovalQueue,
  type BulkApprovalRow,
} from "@/services/bulk-approval-actions";

const rowKey = (r: Pick<BulkApprovalRow, "doc_type" | "id">) => `${r.doc_type}-${r.id}`;

type RowResult = { ok: true } | { ok: false; error: string };

function ageTone(days: number) {
  if (days > 14) return "text-destructive";
  if (days > 7) return "text-warning";
  return "text-muted-foreground";
}

export function BulkApprovalDialog({
  onOpenChange,
  onDone,
}: {
  /** Render komponen ini hanya saat dialog terbuka; tutup lewat onOpenChange(false). */
  onOpenChange: (open: boolean) => void;
  /** Dipanggil setelah proses approve selesai (untuk refresh dashboard). */
  onDone: () => void;
}) {
  const [rows, setRows] = useState<BulkApprovalRow[]>([]);
  // Komponen di-mount ulang setiap kali dialog dibuka, jadi mulai dari "loading".
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [signatureOpen, setSignatureOpen] = useState(false);

  const applyQueue = useCallback((res: Awaited<ReturnType<typeof getMyApprovalQueue>>) => {
    if (res.error !== null) {
      setLoadError(res.error);
      setRows([]);
    } else {
      setLoadError(null);
      setRows(res.data);
    }
    setSelected(new Set());
    setResults({});
    setLoading(false);
  }, []);

  const reload = () => {
    setLoading(true);
    getMyApprovalQueue().then(applyQueue);
  };

  useEffect(() => {
    let active = true;
    getMyApprovalQueue().then((res) => {
      if (active) applyQueue(res);
    });
    return () => {
      active = false;
    };
  }, [applyQueue]);

  const eligible = useMemo(
    () => rows.filter((r) => !r.blocked_reason && !results[rowKey(r)]?.ok),
    [rows, results],
  );
  const selectedRows = useMemo(
    () => eligible.filter((r) => selected.has(rowKey(r))),
    [eligible, selected],
  );
  const allSelected = eligible.length > 0 && selectedRows.length === eligible.length;
  const someSelected = selectedRows.length > 0 && !allSelected;
  const needsSignature = selectedRows.some((r) => r.needs_signature);
  const hasResults = Object.keys(results).length > 0;

  const toggle = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(eligible.map(rowKey)) : new Set());
  };

  const run = async (signatureUrl: string | null) => {
    const queue = selectedRows;
    if (queue.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: queue.length });
    let ok = 0;
    for (const row of queue) {
      const res = await approveQueuedDocument(row.doc_type, row.id, signatureUrl);
      const key = rowKey(row);
      setResults((prev) => ({
        ...prev,
        [key]: res.success ? { ok: true } : { ok: false, error: res.error },
      }));
      if (res.success) {
        ok += 1;
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setRunning(false);
    const failed = queue.length - ok;
    if (failed === 0) toast.success(`${num(ok)} dokumen berhasil di-approve`);
    else if (ok === 0) toast.error(`Semua ${num(failed)} dokumen gagal di-approve`);
    else toast.warning(`${num(ok)} berhasil, ${num(failed)} gagal di-approve`);
    if (ok > 0) onDone();
  };

  const startApprove = () => {
    if (selectedRows.length === 0) return;
    if (needsSignature) setSignatureOpen(true);
    else run(null);
  };

  return (
    <>
      <Dialog open onOpenChange={(v) => !running && onOpenChange(v)}>
        <DialogContent className="flex max-h-[90dvh] flex-col gap-4 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Approve massal</DialogTitle>
            <DialogDescription>
              Centang dokumen yang gilirannya Anda setujui, lalu approve sekaligus. Tanda tangan &amp;
              password cukup dimasukkan sekali. PR di-approve dengan semua item disetujui.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat dokumen…
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-destructive">
              <span>{loadError}</span>
              <Button variant="outline" size="sm" onClick={reload}>
                <RefreshCw /> Coba lagi
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <CircleCheck className="h-5 w-5 text-success" />
              Tidak ada dokumen yang menunggu approval Anda.
            </div>
          ) : (
            <>
              <label className="flex items-center gap-3 border-b px-2 pb-3 text-sm font-medium">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleAll(v === true)}
                  disabled={running || eligible.length === 0}
                  aria-label="Pilih semua"
                />
                Pilih semua ({num(eligible.length)})
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {num(selectedRows.length)} dipilih
                </span>
              </label>

              <ul className="-mx-2 min-h-0 flex-1 divide-y overflow-y-auto">
                {rows.map((row) => {
                  const key = rowKey(row);
                  const result = results[key];
                  const done = result?.ok === true;
                  const disabled = running || !!row.blocked_reason || done;
                  return (
                    <li key={key} className={cn("px-2 py-2", done && "opacity-60")}>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selected.has(key) && !disabled}
                          onCheckedChange={(v) => toggle(key, v === true)}
                          disabled={disabled}
                          aria-label={`Pilih ${row.kode}`}
                        />
                        <Badge variant="secondary" className="w-14 shrink-0 justify-center font-medium">
                          {DOC_TYPE_SHORT[row.doc_type] ?? row.doc_type}
                        </Badge>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs font-semibold">{row.kode}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[row.lokasi, row.tanggal ? formatYmdShort(row.tanggal) : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {done ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                            <CircleCheck className="h-4 w-4" /> Approved
                          </span>
                        ) : (
                          <span className={cn("shrink-0 text-xs font-medium tabular-nums", ageTone(row.umur_hari))}>
                            {row.umur_hari === 0 ? "Hari ini" : `${num(row.umur_hari)} hari`}
                          </span>
                        )}
                        <Link
                          href={row.href}
                          target="_blank"
                          className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={`Buka ${row.kode}`}
                          title="Buka detail di tab baru"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </div>
                      {row.blocked_reason && (
                        <p className="mt-1 pl-7 text-xs text-muted-foreground">
                          Tidak bisa massal: {row.blocked_reason}
                        </p>
                      )}
                      {result && !result.ok && (
                        <p className="mt-1 flex items-start gap-1 pl-7 text-xs text-destructive">
                          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {result.error}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {running
                ? `Memproses ${num(progress.done)} / ${num(progress.total)}…`
                : hasResults
                  ? `Selesai: ${num(Object.values(results).filter((r) => r.ok).length)} berhasil`
                  : null}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>
                Tutup
              </Button>
              <Button onClick={startApprove} disabled={running || selectedRows.length === 0}>
                {running ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                Approve {selectedRows.length > 0 ? `(${num(selectedRows.length)})` : ""}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MRSignatureDialog
        open={signatureOpen}
        onOpenChange={setSignatureOpen}
        onConfirm={(sig) => run(sig.image_url)}
      />
    </>
  );
}
