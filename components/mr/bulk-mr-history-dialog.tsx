"use client";

// Riwayat aksi massal MR (moderator): siapa, kapan, aksi apa, alasan, dan MR
// mana saja. Sumber: moderator_edit_logs (bulk=true), dikelompokkan per batch.

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { History, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { getBulkMrHistory, type BulkMrHistoryBatch } from "@/services/mr-bulk-actions";

const ACTION_LABEL: Record<string, string> = {
  cancel: "Batalkan",
  approval: "Edit Approval",
  due_date: "Due Date",
  unfreeze: "Unfreeze",
  reset: "Reset (Unfreeze + Due Date)",
  kategori: "Kategori",
};

export function BulkMrHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [batches, setBatches] = useState<BulkMrHistoryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    getBulkMrHistory(30).then((res) => {
      if (!active) return;
      if ("error" in res) setError(res.error);
      else setBatches(res.batches);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 rounded-xl overflow-hidden">
        <DialogHeader className="p-5 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <History className="h-5 w-5" /> Riwayat Aksi Massal MR
          </DialogTitle>
          <DialogDescription className="text-xs">
            30 aksi massal terakhir. Riwayat per MR juga tampil di halaman detail MR.
          </DialogDescription>
        </DialogHeader>
        <div className="p-5 max-h-[65vh] overflow-y-auto space-y-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">
              Belum ada aksi massal.
            </p>
          ) : (
            batches.map((b) => (
              <div key={b.key} className="rounded-lg border border-border p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-bold">
                      {ACTION_LABEL[b.action] || b.action}
                    </Badge>
                    <span className="text-xs font-bold">{b.user_nama}</span>
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                    {formatDateTime(b.created_at)}
                  </span>
                </div>
                {b.reason && (
                  <p className="text-[11px] text-muted-foreground">Alasan: {b.reason}</p>
                )}
                <button
                  type="button"
                  className="text-[11px] font-semibold text-primary hover:underline"
                  onClick={() => setExpanded(expanded === b.key ? null : b.key)}
                >
                  {b.items.length} MR {expanded === b.key ? "▲" : "▼"}
                </button>
                {expanded === b.key && (
                  <ul className="space-y-0.5 text-[11px]">
                    {b.items.map((it) => (
                      <li key={it.id}>
                        <a href={`/mr/${it.id}`} className="font-bold uppercase hover:underline">
                          {it.mr_kode}
                        </a>{" "}
                        <span className="text-muted-foreground">
                          — {it.summary.replace(/\. Alasan:.*$/, "")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
