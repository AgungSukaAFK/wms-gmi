"use client";

// Edit massal master barang (moderator). Barang terpilih tampil sebagai tabel
// input; hanya baris yang berubah yang dikirim ke bulkUpdateBarang (satu
// upsert: semua tersimpan atau tidak sama sekali). Parent me-mount dialog ini
// hanya saat dibuka, jadi draft selalu mulai dari data terbaru.

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
import { Label } from "@/components/ui/label";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { bulkUpdateBarang, type BarangBulkEditRow } from "@/services/barang-actions";

type Field = "part_number" | "part_name" | "part_satuan";
type Draft = Record<Field, string>;

export type BulkEditBarangRow = BarangBulkEditRow;

interface BulkEditBarangDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkEditBarangRow[];
  onSaved: () => void;
}

const FIELDS: Field[] = ["part_number", "part_name", "part_satuan"];

const isChanged = (original: BulkEditBarangRow, draft: Draft) =>
  FIELDS.some((f) => draft[f].trim() !== (original[f] || "").trim());

const EditRow = memo(function EditRow({
  index,
  original,
  draft,
  duplicate,
  onChange,
}: {
  index: number;
  original: BulkEditBarangRow;
  draft: Draft;
  duplicate: boolean;
  onChange: (id: number, field: Field, value: string) => void;
}) {
  const changed = isChanged(original, draft);
  return (
    <TableRow className={cn("h-11", changed && "bg-primary/5")}>
      <TableCell className="text-center font-mono text-[10px] text-muted-foreground">
        {index + 1}
      </TableCell>
      {FIELDS.map((f) => {
        const invalid = !draft[f].trim() || (f === "part_number" && duplicate);
        return (
          <TableCell key={f} className="py-1">
            <Input
              value={draft[f]}
              onChange={(e) => onChange(original.id, f, e.target.value)}
              aria-invalid={invalid}
              className={cn(
                "h-8 text-xs",
                f === "part_number" && "font-bold uppercase",
                draft[f].trim() !== (original[f] || "").trim() && "border-primary/50",
              )}
            />
          </TableCell>
        );
      })}
    </TableRow>
  );
});

export function BulkEditBarangDialog({
  open,
  onOpenChange,
  rows,
  onSaved,
}: BulkEditBarangDialogProps) {
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.id,
        { part_number: r.part_number, part_name: r.part_name, part_satuan: r.part_satuan },
      ]),
    ),
  );
  const [satuanAll, setSatuanAll] = useState("");
  const [saving, setSaving] = useState(false);

  const handleChange = useCallback((id: number, field: Field, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }, []);

  const applySatuanAll = () => {
    const value = satuanAll.trim();
    if (!value) return;
    setDrafts((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, d]) => [id, { ...d, part_satuan: value }]),
      ),
    );
  };

  const duplicatePns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of Object.values(drafts)) {
      const pn = d.part_number.trim();
      if (pn) counts.set(pn, (counts.get(pn) || 0) + 1);
    }
    return new Set(Array.from(counts).filter(([, n]) => n > 1).map(([pn]) => pn));
  }, [drafts]);

  const changedRows = useMemo(
    () => rows.filter((r) => isChanged(r, drafts[r.id])),
    [rows, drafts],
  );
  const hasEmpty = changedRows.some((r) =>
    FIELDS.some((f) => !drafts[r.id][f].trim()),
  );

  const handleSave = async () => {
    if (changedRows.length === 0) return;
    setSaving(true);
    try {
      const result = await bulkUpdateBarang(
        changedRows.map((r) => ({ id: r.id, ...drafts[r.id] })),
      );
      if (!result.success) {
        toast.error(result.error || "Gagal menyimpan perubahan");
        return;
      }
      toast.success(`${result.updated} barang berhasil diperbarui`);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit Massal Barang
          </DialogTitle>
          <DialogDescription>
            {rows.length} barang dipilih. Ubah langsung di tabel; hanya baris yang
            berubah yang disimpan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] font-black uppercase text-muted-foreground">
              Satuan untuk semua
            </Label>
            <Input
              value={satuanAll}
              onChange={(e) => setSatuanAll(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applySatuanAll();
                }
              }}
              placeholder="PCS, SET, ..."
              className="h-8 w-40 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs font-bold"
            onClick={applySatuanAll}
            disabled={!satuanAll.trim()}
          >
            Terapkan
          </Button>
        </div>

        <div className="rounded-lg border">
          <Table containerClassName="max-h-[55vh] overflow-y-auto">
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 text-center text-[10px] font-black uppercase text-muted-foreground">
                  No
                </TableHead>
                <TableHead className="w-56 text-[10px] font-black uppercase text-muted-foreground">
                  Part Number
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Nama Suku Cadang
                </TableHead>
                <TableHead className="w-32 text-[10px] font-black uppercase text-muted-foreground">
                  Satuan
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <EditRow
                  key={r.id}
                  index={i}
                  original={r}
                  draft={drafts[r.id]}
                  duplicate={duplicatePns.has(drafts[r.id].part_number.trim())}
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
            {duplicatePns.size > 0 && (
              <span className="ml-2 font-semibold text-destructive">
                · Ada part number dobel
              </span>
            )}
            {hasEmpty && (
              <span className="ml-2 font-semibold text-destructive">
                · Ada kolom kosong
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
              disabled={
                saving || changedRows.length === 0 || hasEmpty || duplicatePns.size > 0
              }
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
