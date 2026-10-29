"use client";

// Hapus banyak Item Transfer sekaligus dari list (moderator). Tiap IT dihapus
// lewat cascade delete yang sama dengan dokumen lain (moderatorDeleteDocument,
// satu transaksi Postgres per IT): stok IT yang sudah keluar dikembalikan ke
// gudang asal, IT selesai diblok. Dijalankan berurutan per IT dari client
// supaya progresnya kelihatan dan tidak kena batas waktu satu request.

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
import { CheckCircle2, Info, Loader2, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { moderatorDeleteDocument } from "@/services/moderator-delete-actions";

export type BulkDeleteItemTransferRow = {
  id: number;
  it_kode: string;
  status: string;
  stock_released: boolean;
  it_is_consignment?: boolean | null;
};

type RowResult = { ok: true } | { ok: false; error: string };

// Sama dengan yang diblok server: IT selesai (cascade delete) dan IT
// konsinyasi dalam pengiriman (trigger guard_consignment_item_transfer_delete).
function blockedReason(r: BulkDeleteItemTransferRow): string | null {
  if (r.status === "completed") return "Sudah selesai (barang diterima)";
  if (r.it_is_consignment && r.stock_released)
    return "IT konsinyasi dalam pengiriman";
  return null;
}

interface BulkDeleteItemTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkDeleteItemTransferRow[];
  onFinished: (deletedIds: number[]) => void;
}

export function BulkDeleteItemTransferDialog({
  open,
  onOpenChange,
  rows,
  onFinished,
}: BulkDeleteItemTransferDialogProps) {
  const [reason, setReason] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // State tidak di-reset di sini: parent me-mount dialog ini hanya saat dibuka.
  const [results, setResults] = useState<Record<number, RowResult>>({});

  const deletable = rows.filter((r) => !blockedReason(r));
  const blockedCount = rows.length - deletable.length;
  const done = Object.keys(results).length > 0 && !running;

  const handleDelete = async () => {
    if (!reason.trim()) {
      toast.error("Alasan penghapusan wajib diisi.");
      return;
    }
    setRunning(true);
    setProgress(0);
    const next: Record<number, RowResult> = {};
    const deletedIds: number[] = [];
    for (const [i, r] of deletable.entries()) {
      try {
        const res = await moderatorDeleteDocument("item_transfer", r.id, reason.trim());
        next[r.id] = res.success ? { ok: true } : { ok: false, error: res.error };
        if (res.success) deletedIds.push(r.id);
      } catch (err: any) {
        next[r.id] = { ok: false, error: err?.message || "Terjadi kesalahan sistem" };
      }
      setResults({ ...next });
      setProgress(i + 1);
    }
    setRunning(false);

    const failed = deletable.length - deletedIds.length;
    if (failed === 0) {
      toast.success(`${deletedIds.length} Item Transfer berhasil dihapus.`);
      onOpenChange(false);
    } else {
      toast.error(
        `${deletedIds.length} terhapus, ${failed} gagal. Lihat alasannya di daftar.`,
      );
    }
    onFinished(deletedIds);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-destructive/5 border-b border-destructive/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-destructive rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <Trash2 className="h-5 w-5 text-destructive-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Hapus {rows.length} Item Transfer
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                Permanen — tidak bisa dibatalkan
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto bg-background">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-[11px] font-medium text-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              IT yang stoknya sudah keluar (approved) dikembalikan ke gudang asal.
              Setiap penghapusan tercatat di riwayat moderator.
              {blockedCount > 0 &&
                ` ${blockedCount} IT tidak bisa dihapus dan akan dilewati.`}
            </span>
          </div>

          <div className="border border-border rounded-lg divide-y divide-border">
            {rows.map((r) => {
              const blocked = blockedReason(r);
              const result = results[r.id];
              return (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase truncate">{r.it_kode}</p>
                    <p
                      className={
                        blocked || (result && !result.ok)
                          ? "text-[10px] text-destructive"
                          : "text-[10px] text-muted-foreground"
                      }
                    >
                      {result && !result.ok
                        ? result.error
                        : blocked
                          ? `Dilewati: ${blocked}`
                          : r.stock_released
                            ? "Stok dikembalikan ke gudang asal"
                            : "Belum ada pergerakan stok"}
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
                Alasan Penghapusan (wajib)
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Jelaskan kenapa Item Transfer ini dihapus..."
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
              onClick={handleDelete}
              disabled={running || deletable.length === 0 || !reason.trim()}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menghapus {progress}/{deletable.length}...
                </>
              ) : (
                `Hapus ${deletable.length} Item Transfer`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
