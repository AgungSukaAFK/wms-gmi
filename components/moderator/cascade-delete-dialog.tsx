"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Loader2, Trash2, AlertTriangle, FileWarning } from "lucide-react";
import { toast } from "sonner";
import {
  previewModeratorDocumentDelete,
  moderatorDeleteDocument,
  type CascadeDeleteDocType,
  type CascadeDeletePlan,
} from "@/services/moderator-delete-actions";

const DOC_TYPE_LABEL: Record<string, string> = {
  mr: "MR",
  pr: "PR",
  po: "PO",
  receive: "Receive (RI)",
  delivery: "Delivery/Share Stock",
};

interface CascadeDeleteDialogProps {
  docType: CascadeDeleteDocType;
  docId: number;
  docLabel: string;
  onDeleted?: () => void;
  triggerClassName?: string;
  triggerLabel?: string;
}

export function CascadeDeleteDialog({
  docType,
  docId,
  docLabel,
  onDeleted,
  triggerClassName,
  triggerLabel = "Hapus Dokumen",
}: CascadeDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [plan, setPlan] = useState<CascadeDeletePlan | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadPreview = async () => {
    setLoadingPreview(true);
    setPlan(null);
    const res = await previewModeratorDocumentDelete(docType, docId);
    setLoadingPreview(false);
    if (!res.success) {
      toast.error(res.error);
      setOpen(false);
      return;
    }
    setPlan(res.data);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setReason("");
      loadPreview();
    }
  };

  const handleConfirm = async () => {
    if (!reason.trim()) {
      toast.error("Alasan penghapusan wajib diisi.");
      return;
    }
    setSubmitting(true);
    const res = await moderatorDeleteDocument(docType, docId, reason.trim());
    setSubmitting(false);
    if (!res.success) {
      toast.error(res.error);
      if (res.data) setPlan(res.data);
      return;
    }
    const relatedCount = Math.max(0, res.data.documents.length - 1);
    toast.success(
      relatedCount > 0
        ? `${DOC_TYPE_LABEL[docType] || docType} ${docLabel} dan ${relatedCount} dokumen terkait berhasil dihapus.`
        : `${DOC_TYPE_LABEL[docType] || docType} ${docLabel} berhasil dihapus.`,
    );
    setOpen(false);
    onDeleted?.();
  };

  const hasConflicts = Boolean(plan?.conflicts?.length);
  const hasBlockedReasons = Boolean(plan?.blocked_reasons?.length);
  const blocked = hasConflicts || hasBlockedReasons;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className={triggerClassName}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Hapus {DOC_TYPE_LABEL[docType] || docType} {docLabel}
          </DialogTitle>
          <DialogDescription>
            Tindakan ini permanen dan hanya bisa dilakukan moderator. Dokumen
            turunan yang berkaitan akan ikut terhapus, dan dokumen di
            atasnya (kalau ada) akan disesuaikan seolah dokumen ini belum
            pernah dibuat.
          </DialogDescription>
        </DialogHeader>

        {loadingPreview ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Memeriksa dokumen terkait...
          </div>
        ) : plan ? (
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Dokumen yang akan ikut terhapus ({plan.documents.length})
              </Label>
              <div className="mt-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {plan.documents.map((doc) => (
                  <Badge
                    key={`${doc.doc_type}-${doc.id}`}
                    variant="secondary"
                    className="font-mono text-xs"
                  >
                    {DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type}: {doc.kode}
                  </Badge>
                ))}
              </div>
            </div>

            {hasBlockedReasons && (
              <Alert variant="destructive">
                <FileWarning className="h-4 w-4" />
                <AlertTitle>Tidak bisa dihapus</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1">
                    {plan.blocked_reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {hasConflicts && (
              <Alert variant="destructive">
                <FileWarning className="h-4 w-4" />
                <AlertTitle>
                  Konflik stok — akan menjadi negatif
                </AlertTitle>
                <AlertDescription>
                  <p className="mb-2">
                    Stok berikut sudah terpakai lebih lanjut di dokumen lain
                    (di luar cascade ini), jadi reverse-nya akan membuat
                    stok minus:
                  </p>
                  <ul className="space-y-1">
                    {plan.conflicts.map((c, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-semibold">
                          {c.part_number} — {c.part_name}
                        </span>{" "}
                        @ {c.cabang_nama}: stok saat ini {c.current_qty}, butuh
                        reverse {Math.abs(c.delta)} (kurang {c.shortfall})
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {!blocked && (
              <div className="space-y-1.5">
                <Label htmlFor="cascade-delete-reason">
                  Alasan penghapusan <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="cascade-delete-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Jelaskan kenapa dokumen ini dihapus..."
                  rows={3}
                />
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Batal
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!plan || blocked || loadingPreview || submitting}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            Hapus Permanen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
