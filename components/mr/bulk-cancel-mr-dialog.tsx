"use client";

// Batalkan banyak MR sekaligus dari list (moderator). Soft cancel: status MR
// jadi 'cancelled', data tetap ada. Hanya MR yang belum punya dokumen turunan
// (PR/PO/Share Stock/Delivery/IT/WO/Job Costing) yang dibatalkan; sisanya
// dilewati server dengan keterangan.

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Ban, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { toast } from "@/lib/toast";
import { bulkCancelMR, type BulkMrResult } from "@/services/mr-bulk-actions";

export type BulkMrRow = {
  id: number;
  mr_kode: string;
  mr_status: string;
  is_frozen?: boolean;
  mr_type?: string | null;
};

const FINAL_STATUSES = ["cancelled", "completed", "done", "closed"];

function blockedReason(r: BulkMrRow): string | null {
  const s = (r.mr_status || "").toLowerCase();
  if (s === "cancelled") return "Sudah dibatalkan";
  if (FINAL_STATUSES.includes(s)) return "MR sudah selesai";
  return null;
}

interface BulkCancelMrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkMrRow[];
  onFinished: (cancelledIds: number[]) => void;
}

export function BulkCancelMrDialog({
  open,
  onOpenChange,
  rows,
  onFinished,
}: BulkCancelMrDialogProps) {
  const [reason, setReason] = useState("");
  const [running, setRunning] = useState(false);
  // State tidak di-reset di sini: parent me-mount dialog ini hanya saat dibuka.
  const [results, setResults] = useState<Record<number, BulkMrResult>>({});

  const cancellable = rows.filter((r) => !blockedReason(r));
  const blockedCount = rows.length - cancellable.length;
  const done = Object.keys(results).length > 0;

  const handleCancel = async () => {
    if (!reason.trim()) {
      toast.error("Alasan pembatalan wajib diisi.");
      return;
    }
    setRunning(true);
    try {
      const res = await bulkCancelMR(
        cancellable.map((r) => r.id),
        reason.trim(),
      );
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setResults(Object.fromEntries(res.results.map((r) => [r.id, r])));
      const cancelledIds = res.results.filter((r) => r.ok).map((r) => r.id);
      const failed = res.results.length - cancelledIds.length;
      if (failed === 0) {
        toast.success(`${cancelledIds.length} MR berhasil dibatalkan.`);
        onOpenChange(false);
      } else {
        toast.warning(
          `${cancelledIds.length} dibatalkan, ${failed} dilewati/gagal. Lihat keterangan di daftar.`,
        );
      }
      onFinished(cancelledIds);
    } catch (err: any) {
      toast.error(err?.message || "Terjadi kesalahan sistem");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-destructive/5 border-b border-destructive/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-destructive dark:bg-destructive/60 rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <Ban className="h-5 w-5 text-destructive-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Batalkan {rows.length} Material Request
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                Status MR menjadi Dibatalkan
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto bg-background">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-[11px] font-medium text-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Data MR tidak dihapus, hanya statusnya menjadi Dibatalkan sehingga tidak bisa
              di-approve atau diproses ke PR/Share Stock lagi. Hanya MR yang belum punya dokumen
              turunan (PR, PO, Share Stock, Delivery, Item Transfer, Working Order, Job Costing)
              yang dibatalkan; sisanya dilewati. Setiap pembatalan tercatat di riwayat moderator.
              {blockedCount > 0 &&
                ` ${blockedCount} MR sudah selesai/dibatalkan dan akan dilewati.`}
            </span>
          </div>

          <div className="border border-border rounded-lg divide-y divide-border">
            {rows.map((r) => {
              const blocked = blockedReason(r);
              const result = results[r.id];
              return (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase truncate">{r.mr_kode}</p>
                    <p
                      className={
                        blocked || (result && !result.ok)
                          ? "text-[10px] text-destructive"
                          : "text-[10px] text-muted-foreground"
                      }
                    >
                      {result
                        ? result.message
                        : blocked
                          ? `Dilewati: ${blocked}`
                          : `Status ${r.mr_status} — akan dicek dokumen turunannya`}
                    </p>
                  </div>
                  {result?.ok && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
                  {result && !result.ok && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                </div>
              );
            })}
          </div>

          {!done && (
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-widest">
                Alasan Pembatalan (wajib)
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Jelaskan kenapa MR ini dibatalkan..."
                className="min-h-20 text-xs"
                disabled={running}
              />
            </div>
          )}
        </div>

        <DialogFooter className="p-5 bg-muted/30 border-t border-border gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="flex-1 h-10 font-semibold text-sm"
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            {done ? "Tutup" : "Batal"}
          </Button>
          {!done && (
            <Button
              variant="destructive"
              className="flex-1 h-10 font-bold text-sm gap-2"
              onClick={handleCancel}
              disabled={running || cancellable.length === 0 || !reason.trim()}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Membatalkan...
                </>
              ) : (
                `Batalkan ${cancellable.length} MR`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
