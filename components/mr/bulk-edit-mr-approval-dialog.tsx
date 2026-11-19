"use client";

// Edit massal jalur approval MR dari list (moderator). Tahap pembuat tiap MR
// tetap; tahap setelahnya diganti & semua kembali pending + notifikasi ke
// approver pertama. Hanya MR yang masih menunggu approval (open). Tiap MR yang
// berubah tercatat di riwayat moderator.

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
import { CheckCircle2, Info, Loader2, Pencil, XCircle } from "lucide-react";
import { toast } from "@/lib/toast";
import { ApprovalFlowEditor } from "@/components/moderator/approval-flow-editor";
import type { ModeratorApprovalStep } from "@/services/moderator-edit-actions";
import { bulkUpdateMRApprovals, type BulkMrResult } from "@/services/mr-bulk-actions";
import type { BulkMrRow } from "@/components/mr/bulk-cancel-mr-dialog";

interface BulkEditMrApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkMrRow[];
  onFinished: () => void;
}

export function BulkEditMrApprovalDialog({
  open,
  onOpenChange,
  rows,
  onFinished,
}: BulkEditMrApprovalDialogProps) {
  const [approvalSteps, setApprovalSteps] = useState<ModeratorApprovalStep[]>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // State tidak di-reset di sini: parent me-mount dialog ini hanya saat dibuka.
  const [results, setResults] = useState<Record<number, BulkMrResult>>({});

  const openRows = rows.filter((r) => r.mr_status === "open");
  const notOpenCount = rows.length - openRows.length;

  // Tahap pembuat tiap MR dipertahankan server; tahap "Requester" dari
  // template dibuang supaya editor hanya berisi approver setelah pembuat.
  const handleStepsChange = (steps: ModeratorApprovalStep[]) =>
    setApprovalSteps(
      steps
        .filter((s) => s.role !== "Requester")
        .map((s) => ({ ...s, status: "pending", processed_at: null, signature_url: null, notes: null })),
    );
  const approvalsValid =
    approvalSteps.length > 0 && approvalSteps.every((s) => !!s.userid && !!s.nama);
  const done = Object.keys(results).length > 0;
  const canSave = !saving && approvalsValid && openRows.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await bulkUpdateMRApprovals(
        rows.map((r) => r.id),
        {
          approvals: approvalSteps.map((s) => ({
            userid: s.userid,
            approval_role: s.approval_role,
          })),
          reason: reason.trim() || undefined,
        },
      );
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setResults(Object.fromEntries(res.results.map((r) => [r.id, r])));
      const failed = res.results.filter((r) => !r.ok).length;
      if (failed === 0) {
        toast.success(`${res.results.length} MR berhasil diperbarui.`);
        onOpenChange(false);
      } else {
        toast.warning(
          `${res.results.length - failed} diperbarui, ${failed} dilewati/gagal. Lihat keterangan di daftar.`,
        );
      }
      onFinished();
    } catch (err: any) {
      toast.error(err?.message || "Terjadi kesalahan sistem");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-primary/5 border-b border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <Pencil className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Edit Approval {rows.length} MR
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                Ganti jalur approval sekaligus
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto bg-background">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-[11px] font-medium text-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Tahap 1 (pembuat MR) tetap. Tahap di bawah ini menggantikan seluruh approver
              setelahnya dan semuanya kembali <b>pending</b> (approval diulang), lalu approver
              pertama dinotifikasi. Hanya berlaku untuk MR yang masih menunggu approval
              {notOpenCount > 0 && ` — ${notOpenCount} MR terpilih bukan status open dan akan dilewati`}
              . Setiap perubahan tercatat di riwayat moderator.
            </span>
          </div>

          {!done && (
            <div className="space-y-3">
              <div className="space-y-2 rounded-lg border border-border p-3">
                <ApprovalFlowEditor
                  steps={approvalSteps}
                  onChange={handleStepsChange}
                  templateType="Material Request"
                  hideStatus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">
                  Alasan (opsional)
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Contoh: pergantian approver cabang..."
                  className="min-h-16 text-xs"
                  disabled={saving}
                />
              </div>
            </div>
          )}

          <div className="border border-border rounded-lg divide-y divide-border">
            {rows.map((r) => {
              const result = results[r.id];
              return (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase truncate">{r.mr_kode}</p>
                    <p
                      className={
                        result && !result.ok
                          ? "text-[10px] text-destructive"
                          : "text-[10px] text-muted-foreground"
                      }
                    >
                      {result
                        ? result.message
                        : r.mr_status !== "open"
                          ? `Status ${r.mr_status} — jalur approval terkunci`
                          : "Siap diubah"}
                    </p>
                  </div>
                  {result?.ok && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
                  {result && !result.ok && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="p-5 bg-muted/30 border-t border-border gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="flex-1 h-10 font-semibold text-sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {done ? "Tutup" : "Batal"}
          </Button>
          {!done && (
            <Button
              className="flex-1 h-10 font-bold text-sm gap-2"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                `Simpan ${openRows.length} MR`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
