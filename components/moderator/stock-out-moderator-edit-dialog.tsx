"use client";

// Dialog Moderator Edit generik untuk dokumen turunan SPB (spb_po, spb_do,
// spb_invoice, return_spb). Dipakai dari masing-masing halaman list
// (app/(With Sidebar)/spb/po|do|invoice/page.tsx dan return-spb/page.tsx)
// karena dokumen-dokumen ini tidak punya halaman/sheet detail sendiri —
// approve/reject-nya pun sudah dilakukan langsung dari baris tabel.

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApprovalFlowEditor } from "@/components/moderator/approval-flow-editor";
import { ModeratorEditLogPanel } from "@/components/moderator/moderator-edit-log-panel";
import type { ModeratorApprovalStep } from "@/services/moderator-edit-actions";

export type StockOutModeratorEditField = {
  key: string;
  label: string;
  type: "text" | "date" | "textarea";
  value: string;
  onChange: (value: string) => void;
};

interface StockOutModeratorEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  docType: "spb_po" | "spb_do" | "spb_invoice" | "return_spb";
  docId: number;
  fields: StockOutModeratorEditField[];
  approvals: ModeratorApprovalStep[];
  onApprovalsChange: (steps: ModeratorApprovalStep[]) => void;
  rejectionReason: string;
  onRejectionReasonChange: (v: string) => void;
  downgradeLocked: boolean;
  downgradeLockedMessage: string;
  blockedDowngrade: boolean;
  saving: boolean;
  onSave: () => void;
}

export function StockOutModeratorEditDialog({
  open,
  onOpenChange,
  title,
  docType,
  docId,
  fields,
  approvals,
  onApprovalsChange,
  rejectionReason,
  onRejectionReasonChange,
  downgradeLocked,
  downgradeLockedMessage,
  blockedDowngrade,
  saving,
  onSave,
}: StockOutModeratorEditDialogProps) {
  const willReject = approvals.some((a) => a.status === "rejected");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <ShieldAlert className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription>
            Edit bebas di luar giliran approval normal. Perubahan tercatat di
            Riwayat Moderator Edit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div
                key={f.key}
                className={cn("space-y-1.5", f.type === "textarea" && "col-span-2")}
              >
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  {f.label}
                </Label>
                {f.type === "textarea" ? (
                  <Textarea
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    className="min-h-20 resize-none text-sm"
                  />
                ) : (
                  <Input
                    type={f.type}
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    className="h-9 text-sm"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] font-bold uppercase text-muted-foreground">
              Jalur Approval
            </Label>
            {downgradeLocked && (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-[11px] font-semibold leading-relaxed",
                  blockedDowngrade
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
                )}
              >
                {blockedDowngrade
                  ? `Tidak bisa disimpan: ${downgradeLockedMessage} Kembalikan semua tahap ke approved, atau bereskan dulu turunannya sebelum menurunkan status.`
                  : downgradeLockedMessage}
              </div>
            )}
            <ApprovalFlowEditor steps={approvals} onChange={onApprovalsChange} />
            {willReject && (
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Alasan Penolakan
                </Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => onRejectionReasonChange(e.target.value)}
                  placeholder="Wajib diisi karena ada tahap berstatus rejected..."
                  className="h-20 resize-none text-sm"
                />
              </div>
            )}
          </div>

          <ModeratorEditLogPanel docType={docType} docId={docId} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button
            className="gap-2 bg-amber-500 hover:bg-amber-600 text-white"
            onClick={onSave}
            disabled={saving || blockedDowngrade}
            title={
              blockedDowngrade
                ? `Tidak bisa disimpan: ${downgradeLockedMessage}`
                : undefined
            }
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan Moderator Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
