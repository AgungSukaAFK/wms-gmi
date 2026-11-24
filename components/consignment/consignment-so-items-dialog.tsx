"use client";

// Edit item SO Consignment. Aturan penjaga alur (item sudah dikirim via IK
// tidak bisa dihapus, qty >= terkirim) ditegakkan ulang di fungsi DB
// update_consignment_so_items; di sini hanya dikunci di UI + preview perubahan.

import React, { useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { Loader2, Lock, Plus, Search, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { orIlikePattern } from "@/lib/supabase/search-filter";
import { toast } from "@/lib/toast";
import { updateConsignmentSoItems } from "@/services/consignment-so-actions";

type Row = {
  key: string;
  id?: number;
  part_id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: string;
  pnc: string;
  origQty?: number;
  origPnc?: string;
  shipped: number;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  soId: number;
  soNo: string;
  /** consignment_so.updated_at apa adanya (string) untuk optimistic lock. */
  soUpdatedAt: string | null;
  items: any[];
  onSaved: () => void;
}

const fmt = (n: number) => n.toLocaleString("id-ID");

export function ConsignmentSoItemsDialog({
  open,
  onOpenChange,
  soId,
  soNo,
  soUpdatedAt,
  items,
  onSaved,
}: Props) {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Muat ulang tiap dialog dibuka: qty terkirim (IK) dihitung dari DB.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setReason("");
    setSearch("");
    setLoading(true);
    (async () => {
      const ids = items.map((i) => i.id);
      const shipped = new Map<number, number>();
      if (ids.length > 0) {
        const { data } = await supabase
          .from("consignment_ik_items")
          .select("so_item_id, qty")
          .in("so_item_id", ids);
        for (const r of data || [])
          shipped.set(r.so_item_id, (shipped.get(r.so_item_id) || 0) + Number(r.qty));
      }
      if (!active) return;
      setRows(
        items.map((i) => ({
          key: `e${i.id}`,
          id: i.id,
          part_id: i.part_id,
          part_number: i.part_number,
          part_name: i.part_name,
          satuan: i.satuan,
          qty: String(Number(i.qty)),
          pnc: i.part_number_customer || "",
          origQty: Number(i.qty),
          origPnc: i.part_number_customer || "",
          shipped: shipped.get(i.id) || 0,
        })),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cari barang untuk item baru.
  useEffect(() => {
    if (!open || debouncedSearch.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    supabase
      .from("barang")
      .select("id, part_number, part_name, part_satuan")
      .is("deleted_at", null)
      .or(
        `part_number.ilike.${orIlikePattern(debouncedSearch)},part_name.ilike.${orIlikePattern(debouncedSearch)}`,
      )
      .order("part_name")
      .limit(10)
      .then(({ data }) => {
        if (!active) return;
        setResults(data || []);
        setSearching(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, open]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addPart = (b: any) => {
    if (rows.some((r) => r.part_id === b.id)) {
      toast.error(`${b.part_number} sudah ada di SO ini.`);
      return;
    }
    setRows((prev) => [
      ...prev,
      {
        key: `n${b.id}`,
        part_id: b.id,
        part_number: b.part_number,
        part_name: b.part_name,
        satuan: b.part_satuan,
        qty: "1",
        pnc: "",
        shipped: 0,
      },
    ]);
    setSearch("");
    setResults([]);
  };

  const removedRows = useMemo(
    () => items.filter((i) => !rows.some((r) => r.id === i.id)),
    [items, rows],
  );

  const summary = useMemo(() => {
    const added = rows.filter((r) => !r.id).length;
    const qtyChanged = rows.filter(
      (r) => r.id && Number(r.qty) !== r.origQty,
    ).length;
    const pncChanged = rows.filter(
      (r) => r.id && r.pnc.trim() !== (r.origPnc || "").trim(),
    ).length;
    return { added, removed: removedRows.length, qtyChanged, pncChanged };
  }, [rows, removedRows]);
  const totalChanges =
    summary.added + summary.removed + summary.qtyChanged + summary.pncChanged;

  const validate = (): string | null => {
    if (rows.length === 0) return "SO minimal punya satu item.";
    for (const r of rows) {
      const q = Number(r.qty);
      if (!Number.isFinite(q) || q <= 0)
        return `${r.part_number}: qty harus lebih dari 0.`;
      if (q < r.shipped)
        return `${r.part_number}: qty tidak boleh di bawah ${fmt(r.shipped)} (sudah dikirim via IK).`;
      if (!r.pnc.trim()) return `${r.part_number}: PN Customer wajib diisi.`;
    }
    if (totalChanges === 0) return "Belum ada perubahan item.";
    if (!reason.trim()) return "Alasan perubahan wajib diisi.";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) return toast.error(err);
    setSaving(true);
    const res = await updateConsignmentSoItems(
      soId,
      rows.map((r) => ({
        id: r.id,
        part_id: r.part_id,
        qty: Number(r.qty),
        part_number_customer: r.pnc.trim(),
      })),
      reason,
      soUpdatedAt,
    );
    setSaving(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("Item SO Consignment berhasil diperbarui");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Item SO Consignment {soNo}</DialogTitle>
          <DialogDescription>
            Item yang sudah dikirim lewat IK tidak dapat dihapus dan qty-nya
            tidak boleh di bawah total yang sudah dikirim. Part item tidak dapat
            diganti — hapus lalu tambah item baru.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_9rem_7rem_2.5rem] gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <span>Item</span>
                <span>PN Customer</span>
                <span>Qty</span>
                <span />
              </div>
              {rows.map((r) => {
                const locked = r.shipped > 0;
                const qtyChanged = r.id && Number(r.qty) !== r.origQty;
                return (
                  <div
                    key={r.key}
                    className="grid grid-cols-[1fr_9rem_7rem_2.5rem] items-start gap-2 border-b px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 text-xs">
                      <p className="font-bold uppercase">{r.part_number}</p>
                      <p className="truncate text-muted-foreground">{r.part_name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!r.id && (
                          <Badge className="text-[10px]">Baru</Badge>
                        )}
                        {locked && (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <Lock className="h-2.5 w-2.5" />
                            Sudah dikirim {fmt(r.shipped)} {r.satuan}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Input
                      value={r.pnc}
                      onChange={(e) => update(r.key, { pnc: e.target.value })}
                      className="h-8 text-xs"
                    />
                    <div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={r.shipped > 0 ? r.shipped : 1}
                          value={r.qty}
                          onChange={(e) => update(r.key, { qty: e.target.value })}
                          className="h-8 text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {r.satuan}
                        </span>
                      </div>
                      {qtyChanged && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          semula {fmt(r.origQty!)}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={locked}
                      title={
                        locked
                          ? "Item sudah punya pengiriman (IK), tidak dapat dihapus"
                          : "Hapus item dari SO"
                      }
                      onClick={() =>
                        setRows((prev) => prev.filter((x) => x.key !== r.key))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>

            {removedRows.length > 0 && (
              <p className="text-xs text-destructive">
                Akan dihapus:{" "}
                {removedRows.map((i: any) => i.part_number).join(", ")}
              </p>
            )}

            {/* Tambah item */}
            <div className="space-y-2">
              <Label className="text-xs">Tambah Item</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Cari PN / nama barang (min. 2 huruf)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {searching && (
                <p className="text-xs text-muted-foreground">Mencari…</p>
              )}
              {results.length > 0 && (
                <ul className="max-h-44 overflow-y-auto rounded-lg border text-xs">
                  {results.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                        onClick={() => addPart(b)}
                      >
                        <span className="min-w-0">
                          <span className="font-bold uppercase">{b.part_number}</span>{" "}
                          <span className="text-muted-foreground">{b.part_name}</span>
                        </span>
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="items_reason">Alasan Perubahan *</Label>
              <Textarea
                id="items_reason"
                rows={2}
                placeholder="Mis. revisi qty sesuai PO customer terbaru"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {totalChanges === 0
                ? "Belum ada perubahan."
                : [
                    summary.added > 0 && `${summary.added} item ditambah`,
                    summary.removed > 0 && `${summary.removed} item dihapus`,
                    summary.qtyChanged > 0 && `${summary.qtyChanged} qty diubah`,
                    summary.pncChanged > 0 && `${summary.pncChanged} PN Customer diubah`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Menyimpan..." : "Simpan Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
