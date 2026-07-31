"use client";

// Dialog Moderator Edit generik untuk dokumen turunan SPB (spb_po, spb_do,
// spb_invoice, return_spb). Dipakai dari masing-masing halaman list
// (app/(With Sidebar)/spb/po|do|invoice/page.tsx dan return-spb/page.tsx)
// karena dokumen-dokumen ini tidak punya halaman/sheet detail sendiri —
// approve/reject-nya pun sudah dilakukan langsung dari baris tabel.

import React, { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, ShieldAlert, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApprovalFlowEditor } from "@/components/moderator/approval-flow-editor";
import { ModeratorEditLogPanel } from "@/components/moderator/moderator-edit-log-panel";
import type { ModeratorApprovalStep } from "@/services/moderator-edit-actions";
import {
  getStockOutApprovalTemplateOptions,
  previewStockOutApprovalFromTemplate,
} from "@/services/spb-actions";

export type StockOutModeratorEditField = {
  key: string;
  label: string;
  type: "text" | "date" | "textarea";
  value: string;
  onChange: (value: string) => void;
};

type StockOutTemplateOption = { id: number; name: string | null; cabang_id: number | null };

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
  currentTemplateId: number | null;
  onTemplateIdChange: (id: number) => void;
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
  currentTemplateId,
  onTemplateIdChange,
}: StockOutModeratorEditDialogProps) {
  const willReject = approvals.some((a) => a.status === "rejected");

  // Ubah/perbarui template — dipakai kalau template approval sudah direvisi
  // setelah dokumen ini dibuat (langkah/approver-nya jadi tidak sinkron lagi
  // dengan snapshot di `approvals`), atau moderator mau pindah ke template
  // lain sama sekali. Hasilnya cuma preview di form ini — belum tersimpan
  // sampai "Simpan Moderator Edit" ditekan.
  //
  // `pendingTemplateId` sengaja dipisah dari `currentTemplateId` (yang
  // dikirim ke server saat Simpan): memilih template di dropdown TIDAK
  // langsung meng-commit approval_template_id, supaya approval_template_id
  // yang tersimpan tidak pernah lepas sinkron dari isi `approvals` — keduanya
  // baru di-commit bersamaan lewat onTemplateIdChange begitu "Perbarui dari
  // Template" berhasil.
  const [templateOptions, setTemplateOptions] = useState<StockOutTemplateOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<number | null>(currentTemplateId);

  useEffect(() => {
    if (!open) return;
    setPendingTemplateId(currentTemplateId);
    setLoadingTemplates(true);
    getStockOutApprovalTemplateOptions(docType, docId)
      .then((res) => {
        if (res.error) {
          toast.error(res.error);
          setTemplateOptions([]);
          return;
        }
        setTemplateOptions(res.data || []);
      })
      .finally(() => setLoadingTemplates(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docType, docId]);

  const handleApplyTemplate = async () => {
    if (!pendingTemplateId) {
      toast.error("Pilih template terlebih dahulu.");
      return;
    }
    setApplyingTemplate(true);
    const res = await previewStockOutApprovalFromTemplate(docType, docId, pendingTemplateId);
    setApplyingTemplate(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    onApprovalsChange(res.data as ModeratorApprovalStep[]);
    onTemplateIdChange(pendingTemplateId);
    toast.success("Jalur approval diperbarui dari template. Cek dulu sebelum menyimpan.");
  };

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
              Template Approval
            </Label>
            <div className="flex items-center gap-2">
              <Select
                value={pendingTemplateId ? String(pendingTemplateId) : undefined}
                onValueChange={(v) => setPendingTemplateId(Number(v))}
                disabled={loadingTemplates || templateOptions.length === 0}
              >
                <SelectTrigger className="h-9 text-sm flex-1">
                  <SelectValue
                    placeholder={loadingTemplates ? "Memuat template..." : "Pilih template"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name || `Template #${t.id}`}
                      {t.cabang_id === null ? " (Global)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-[11px] font-bold shrink-0"
                onClick={handleApplyTemplate}
                disabled={applyingTemplate || !pendingTemplateId}
              >
                {applyingTemplate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                Perbarui dari Template
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Pilih template yang sama untuk menyinkronkan ulang jalur approval
              kalau templatenya sudah direvisi (langkah/approver berubah), atau
              pilih template lain untuk ganti jalur sepenuhnya. Ini cuma
              mengganti daftar di bawah — status semua tahap kembali ke
              pending dan belum tersimpan sampai &ldquo;Simpan Moderator
              Edit&rdquo; ditekan.
            </p>
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
