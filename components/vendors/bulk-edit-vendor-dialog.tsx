"use client";

// Edit massal vendor (moderator). Vendor terpilih tampil sebagai tabel input;
// hanya baris yang berubah yang dikirim ke bulkUpdateVendors (satu upsert:
// semua tersimpan atau tidak sama sekali). Kode vendor tidak bisa diubah.
// Parent me-mount dialog ini hanya saat dibuka.

import React, { memo, useCallback, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { bulkUpdateVendors } from "@/services/master-actions";

type TextField = "vendor_name" | "address" | "telephone" | "email" | "pic_name";
type Draft = Record<TextField, string> & { is_active: boolean };

export type BulkEditVendorRow = {
  id: number;
  vendor_no: string;
  vendor_name: string;
  address: string | null;
  telephone: string | null;
  email: string | null;
  pic_name: string | null;
  is_active: boolean;
};

interface BulkEditVendorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkEditVendorRow[];
  onSaved: () => void;
}

const TEXT_FIELDS: { key: TextField; label: string; className: string }[] = [
  { key: "vendor_name", label: "Nama Vendor", className: "min-w-52" },
  { key: "address", label: "Alamat", className: "min-w-60" },
  { key: "telephone", label: "Telepon", className: "w-36" },
  { key: "email", label: "Email", className: "w-48" },
  { key: "pic_name", label: "PIC", className: "w-36" },
];

const toDraft = (r: BulkEditVendorRow): Draft => ({
  vendor_name: r.vendor_name || "",
  address: r.address || "",
  telephone: r.telephone || "",
  email: r.email || "",
  pic_name: r.pic_name || "",
  is_active: Boolean(r.is_active),
});

const fieldChanged = (original: BulkEditVendorRow, draft: Draft, key: TextField) =>
  draft[key].trim() !== (original[key] || "").trim();

const isChanged = (original: BulkEditVendorRow, draft: Draft) =>
  TEXT_FIELDS.some((f) => fieldChanged(original, draft, f.key)) ||
  draft.is_active !== Boolean(original.is_active);

const EditRow = memo(function EditRow({
  original,
  draft,
  onChange,
}: {
  original: BulkEditVendorRow;
  draft: Draft;
  onChange: (id: number, patch: Partial<Draft>) => void;
}) {
  return (
    <TableRow className={cn("h-11", isChanged(original, draft) && "bg-primary/5")}>
      <TableCell className="font-mono text-[11px] font-bold text-primary">
        {original.vendor_no}
      </TableCell>
      {TEXT_FIELDS.map((f) => (
        <TableCell key={f.key} className="py-1">
          <Input
            value={draft[f.key]}
            onChange={(e) => onChange(original.id, { [f.key]: e.target.value })}
            aria-invalid={f.key === "vendor_name" && !draft.vendor_name.trim()}
            className={cn(
              "h-8 text-xs",
              f.key === "vendor_name" && "font-bold uppercase",
              fieldChanged(original, draft, f.key) && "border-primary/50",
            )}
          />
        </TableCell>
      ))}
      <TableCell className="text-center">
        <Switch
          checked={draft.is_active}
          onCheckedChange={(v) => onChange(original.id, { is_active: v })}
          aria-label={`Status ${original.vendor_no}`}
        />
      </TableCell>
    </TableRow>
  );
});

export function BulkEditVendorDialog({
  open,
  onOpenChange,
  rows,
  onSaved,
}: BulkEditVendorDialogProps) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, toDraft(r)])),
  );
  const [saving, setSaving] = useState(false);

  const handleChange = useCallback((id: number, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const setAllActive = (is_active: boolean) =>
    setDrafts((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, d]) => [id, { ...d, is_active }]),
      ),
    );

  const changedRows = useMemo(
    () => rows.filter((r) => isChanged(r, drafts[r.id])),
    [rows, drafts],
  );
  const hasEmptyName = changedRows.some((r) => !drafts[r.id].vendor_name.trim());

  const handleSave = async () => {
    if (changedRows.length === 0) return;
    setSaving(true);
    try {
      const result = await bulkUpdateVendors(
        changedRows.map((r) => ({ id: r.id, ...drafts[r.id] })),
      );
      if (!result.success) {
        toast.error(result.error || "Gagal menyimpan perubahan");
        return;
      }
      toast.success(`${result.updated} vendor berhasil diperbarui`);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-7xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit Massal Vendor
          </DialogTitle>
          <DialogDescription>
            {rows.length} vendor dipilih. Ubah langsung di tabel; hanya baris yang
            berubah yang disimpan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase text-muted-foreground">
            Status untuk semua:
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs font-bold"
            onClick={() => setAllActive(true)}
          >
            Aktifkan semua
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs font-bold"
            onClick={() => setAllActive(false)}
          >
            Nonaktifkan semua
          </Button>
        </div>

        <div className="rounded-lg border">
          <Table containerClassName="max-h-[55vh] overflow-y-auto">
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-28 text-[10px] font-black uppercase text-muted-foreground">
                  Kode
                </TableHead>
                {TEXT_FIELDS.map((f) => (
                  <TableHead
                    key={f.key}
                    className={cn(
                      "text-[10px] font-black uppercase text-muted-foreground",
                      f.className,
                    )}
                  >
                    {f.label}
                  </TableHead>
                ))}
                <TableHead className="w-16 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Aktif
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <EditRow
                  key={r.id}
                  original={r}
                  draft={drafts[r.id]}
                  onChange={handleChange}
                />
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{changedRows.length}</span>{" "}
            baris berubah
            {hasEmptyName && (
              <span className="ml-2 font-semibold text-destructive">
                · Nama vendor wajib diisi
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || changedRows.length === 0 || hasEmptyName}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Simpan {changedRows.length > 0 ? `(${changedRows.length})` : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
