"use client";

// Dialog moderator untuk override alokasi Share Stock (item + qty per cabang
// sumber + deadline) milik MR yang SUDAH approved — aksi terpisah dari
// approval flow (mr_status & riwayat approval tidak disentuh). Qty yang
// sudah aktif ter-delivery atau sudah dikonversi ke PR dikunci (floor guard)
// supaya tidak bentrok sama dokumen yang sudah jalan; validasi final tetap
// dilakukan lagi di server (services/moderator-edit-actions.ts).

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  PlusCircle,
  Trash2,
  ShieldAlert,
  Info,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { moderatorEditShareStockAllocations } from "@/services/moderator-edit-actions";

// Duplikat dari DELIVERY_ACTIVE_STATUSES (services/inventory-actions.ts) —
// dipakai di sini cuma untuk query client-side (tampilan floor guard),
// validasi otoritatif tetap di server pakai daftar yang sama.
const DELIVERY_ACTIVE_STATUSES = [
  "open",
  "approved",
  "completed",
  "done",
  "closed",
] as const;

interface ShareStockLine {
  source_cabang_id: number | "";
  qty: number;
}

interface AllocationRow {
  mr_item_id: number;
  part_id: number;
  part_number: string;
  part_name: string;
  qty_request: number;
  sharestocks: ShareStockLine[];
  deadline: string;
  // Snapshot asli (buat deteksi item mana yang benar-benar diubah + floor guard)
  originalSharestocks: ShareStockLine[];
  originalDeadline: string;
  activeBySource: Record<number, number>;
  alreadyPr: number;
}

interface EditShareStockAllocationDialogProps {
  mrId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}

function sameAllocationState(row: AllocationRow): boolean {
  const currentQty = row.sharestocks.reduce((s, l) => s + Number(l.qty || 0), 0);
  const originalQty = row.originalSharestocks.reduce(
    (s, l) => s + Number(l.qty || 0),
    0,
  );
  if (currentQty !== originalQty) return false;
  if (currentQty > 0 && row.deadline !== row.originalDeadline) return false;

  const cur = new Map(
    row.sharestocks
      .filter((l) => l.source_cabang_id !== "")
      .map((l) => [Number(l.source_cabang_id), Number(l.qty || 0)]),
  );
  const orig = new Map(
    row.originalSharestocks
      .filter((l) => l.source_cabang_id !== "")
      .map((l) => [Number(l.source_cabang_id), Number(l.qty || 0)]),
  );
  if (cur.size !== orig.size) return false;
  for (const [srcId, qty] of cur) {
    if (orig.get(srcId) !== qty) return false;
  }
  return true;
}

export function EditShareStockAllocationDialog({
  mrId,
  open,
  onOpenChange,
  onUpdated,
}: EditShareStockAllocationDialogProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mr, setMr] = useState<any>(null);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [stockByPart, setStockByPart] = useState<
    Record<number, Record<number, number>>
  >({});
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open && mrId) {
      fetchData();
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mrId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: mrData } = await supabase
        .from("mrs")
        .select("id, mr_kode, mr_due_date, cabang_id")
        .eq("id", mrId)
        .single();
      setMr(mrData);

      const { data: cabangData } = await supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang");
      setCabangs(cabangData || []);

      const { data: itemsData } = await supabase
        .from("mr_items")
        .select("id, part_id, part_number, part_name, qty_request")
        .eq("mr_id", mrId)
        .order("created_at");

      const itemIds = (itemsData || []).map((i: any) => i.id);
      if (itemIds.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const { data: allocRows } = await supabase
        .from("mr_sharestock_allocations")
        .select("mr_item_id, source_cabang_id, qty, deadline")
        .in("mr_item_id", itemIds);

      const { data: activeDlvRows } = await supabase
        .from("delivery_items")
        .select("mr_item_id, qty_on_delivery, deliveries!inner(dari_cabang_id, status)")
        .in("mr_item_id", itemIds)
        .in("deliveries.status", [...DELIVERY_ACTIVE_STATUSES]);

      const { data: prItemRows } = await supabase
        .from("pr_items")
        .select("mr_item_id, qty, prs!inner(pr_status)")
        .in("mr_item_id", itemIds);

      const partIds = Array.from(
        new Set((itemsData || []).map((i: any) => i.part_id).filter(Boolean)),
      );
      const { data: stockData } = await supabase
        .from("stock")
        .select("part_id, cabang_id, qty")
        .in("part_id", partIds);
      const stockMap: Record<number, Record<number, number>> = {};
      (stockData || []).forEach((s: any) => {
        if (!stockMap[s.part_id]) stockMap[s.part_id] = {};
        stockMap[s.part_id][s.cabang_id] = s.qty;
      });
      setStockByPart(stockMap);

      const allocByItem = new Map<number, ShareStockLine[]>();
      const deadlineByItem = new Map<number, string>();
      for (const a of allocRows || []) {
        if (!allocByItem.has(a.mr_item_id)) allocByItem.set(a.mr_item_id, []);
        allocByItem.get(a.mr_item_id)!.push({
          source_cabang_id: a.source_cabang_id,
          qty: a.qty,
        });
        if (a.deadline) deadlineByItem.set(a.mr_item_id, String(a.deadline).slice(0, 10));
      }

      const activeByItem = new Map<number, Record<number, number>>();
      for (const row of activeDlvRows || []) {
        const src = (row as any).deliveries?.dari_cabang_id;
        if (!src) continue;
        if (!activeByItem.has(row.mr_item_id)) activeByItem.set(row.mr_item_id, {});
        const m = activeByItem.get(row.mr_item_id)!;
        m[src] = (m[src] || 0) + row.qty_on_delivery;
      }

      const alreadyPrByItem = new Map<number, number>();
      for (const row of prItemRows || []) {
        const prStatus = Array.isArray((row as any).prs)
          ? (row as any).prs[0]?.pr_status
          : (row as any).prs?.pr_status;
        if (prStatus === "rejected") continue;
        alreadyPrByItem.set(
          row.mr_item_id,
          (alreadyPrByItem.get(row.mr_item_id) || 0) + row.qty,
        );
      }

      const newRows: AllocationRow[] = (itemsData || []).map((item: any) => {
        const sharestocks = allocByItem.get(item.id) || [];
        const deadline = deadlineByItem.get(item.id) || "";
        return {
          mr_item_id: item.id,
          part_id: item.part_id,
          part_number: item.part_number,
          part_name: item.part_name,
          qty_request: item.qty_request,
          sharestocks: sharestocks.map((s) => ({ ...s })),
          deadline,
          originalSharestocks: sharestocks.map((s) => ({ ...s })),
          originalDeadline: deadline,
          activeBySource: activeByItem.get(item.id) || {},
          alreadyPr: alreadyPrByItem.get(item.id) || 0,
        };
      });
      setRows(newRows);
    } catch (err) {
      console.error("Fetch allocation edit data error:", err);
      toast.error("Gagal memuat data alokasi share stock");
    } finally {
      setLoading(false);
    }
  };

  const getAvailableStock = (partId: number, cabangId: number | ""): number => {
    if (!cabangId) return 0;
    return stockByPart[partId]?.[Number(cabangId)] ?? 0;
  };

  const updateRowLines = (itemId: number, sharestocks: ShareStockLine[]) => {
    setRows((prev) =>
      prev.map((r) => (r.mr_item_id === itemId ? { ...r, sharestocks } : r)),
    );
  };

  const addLine = (itemId: number) => {
    const row = rows.find((r) => r.mr_item_id === itemId);
    if (!row) return;
    updateRowLines(itemId, [...row.sharestocks, { source_cabang_id: "", qty: 0 }]);
  };

  const removeLine = (itemId: number, index: number) => {
    const row = rows.find((r) => r.mr_item_id === itemId);
    if (!row) return;
    const line = row.sharestocks[index];
    const activeQty =
      line.source_cabang_id !== ""
        ? row.activeBySource[Number(line.source_cabang_id)] || 0
        : 0;
    if (activeQty > 0) {
      toast.error(
        `Baris ini tidak bisa dihapus — sudah ada ${activeQty} unit ter-delivery dari cabang ini.`,
      );
      return;
    }
    const newLines = [...row.sharestocks];
    newLines.splice(index, 1);
    updateRowLines(itemId, newLines);
  };

  const updateLine = (
    itemId: number,
    index: number,
    field: "source_cabang_id" | "qty",
    value: any,
  ) => {
    const row = rows.find((r) => r.mr_item_id === itemId);
    if (!row) return;
    const newLines = [...row.sharestocks];
    const line = { ...newLines[index], [field]: value };

    const cabangId = field === "source_cabang_id" ? value : line.source_cabang_id;
    const avail = getAvailableStock(row.part_id, cabangId);
    const otherRowsTotal = row.sharestocks.reduce(
      (sum, l, i) => (i === index ? sum : sum + Number(l.qty || 0)),
      0,
    );
    const remainingRequest = Math.max(0, row.qty_request - otherRowsTotal);
    const floor = cabangId ? row.activeBySource[Number(cabangId)] || 0 : 0;

    if (field === "qty") {
      const clamped = Math.max(
        floor,
        Math.min(Number(value) || 0, avail, remainingRequest),
      );
      line.qty = clamped;
    }

    newLines[index] = line;
    updateRowLines(itemId, newLines);
  };

  const updateDeadline = (itemId: number, deadline: string) => {
    const mrDueDate = mr?.mr_due_date ? String(mr.mr_due_date).slice(0, 10) : "";
    if (mrDueDate && deadline && deadline > mrDueDate) {
      toast.error(`Deadline supply tidak boleh melewati due date MR (${mrDueDate}).`);
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.mr_item_id === itemId ? { ...r, deadline } : r)),
    );
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast.error("Alasan perubahan wajib diisi");
      return;
    }

    const changedRows = rows.filter((r) => !sameAllocationState(r));
    if (changedRows.length === 0) {
      toast.error("Tidak ada perubahan alokasi untuk disimpan");
      return;
    }

    for (const row of changedRows) {
      const totalQty = row.sharestocks.reduce((s, l) => s + Number(l.qty || 0), 0);
      if (totalQty > 0 && !row.deadline) {
        toast.error(`Deadline supply wajib diisi untuk ${row.part_number}`);
        return;
      }
      if (row.sharestocks.some((l) => l.source_cabang_id === "")) {
        toast.error(`Pilih cabang sumber untuk semua baris di ${row.part_number}`);
        return;
      }
    }

    setSaving(true);
    try {
      const result = await moderatorEditShareStockAllocations(mrId, {
        reason: reason.trim(),
        items: changedRows.map((r) => ({
          mr_item_id: r.mr_item_id,
          part_number: r.part_number,
          qty_pr: Math.max(
            0,
            r.qty_request - r.sharestocks.reduce((s, l) => s + Number(l.qty || 0), 0),
          ),
          qty_sharestock_total: r.sharestocks.reduce(
            (s, l) => s + Number(l.qty || 0),
            0,
          ),
          deadline: r.deadline || null,
          sharestocks: r.sharestocks.map((l) => ({
            source_cabang_id: Number(l.source_cabang_id),
            qty: Number(l.qty || 0),
          })),
        })),
      });

      if (result.success) {
        toast.success("Alokasi share stock berhasil diubah");
        onOpenChange(false);
        onUpdated?.();
      } else {
        toast.error(result.error || "Gagal mengubah alokasi share stock");
      }
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan sistem");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-warning/5 border-b border-warning/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-warning rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <ShieldAlert className="h-5 w-5 text-warning-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Edit Alokasi Share Stock
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                Override keputusan approver terakhir — {mr?.mr_kode || "..."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto bg-background">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">
              MR ini tidak punya item.
            </p>
          ) : (
            rows.map((row) => {
              const currentTotal = row.sharestocks.reduce(
                (s, l) => s + Number(l.qty || 0),
                0,
              );
              const currentPr = Math.max(0, row.qty_request - currentTotal);
              const changed = !sameAllocationState(row);
              return (
                <div
                  key={row.mr_item_id}
                  className={`border rounded-xl p-4 space-y-3 transition-all ${
                    changed
                      ? "border-primary/50 bg-primary/5"
                      : "border-border bg-background"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-black uppercase tracking-wide font-mono">
                        {row.part_number}
                      </h4>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px] font-bold">
                          Req: {row.qty_request}
                        </Badge>
                        <Badge className="text-[9px] font-bold bg-primary/10 text-primary border-0">
                          PR: {currentPr}
                        </Badge>
                        <Badge className="text-[9px] font-bold bg-success/10 text-success border-0">
                          Share: {currentTotal}
                        </Badge>
                        {row.alreadyPr > 0 && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-bold gap-1 border-amber-300 text-amber-700"
                          >
                            <Lock className="h-2.5 w-2.5" /> Min PR: {row.alreadyPr}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs font-bold shrink-0"
                      onClick={() => addLine(row.mr_item_id)}
                    >
                      <PlusCircle className="h-3.5 w-3.5" /> Tambah Baris
                    </Button>
                  </div>

                  {row.sharestocks.length > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2.5">
                      <label className="text-[10px] font-bold text-warning uppercase tracking-widest whitespace-nowrap">
                        Deadline Supply
                      </label>
                      <Input
                        type="date"
                        className="h-9 w-full sm:w-48 text-[11px] font-bold"
                        value={row.deadline}
                        max={
                          mr?.mr_due_date
                            ? String(mr.mr_due_date).slice(0, 10)
                            : undefined
                        }
                        onChange={(e) => updateDeadline(row.mr_item_id, e.target.value)}
                      />
                    </div>
                  )}

                  {row.sharestocks.map((line, idx) => {
                    const floor =
                      line.source_cabang_id !== ""
                        ? row.activeBySource[Number(line.source_cabang_id)] || 0
                        : 0;
                    const avail = getAvailableStock(row.part_id, line.source_cabang_id);
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_100px_36px] gap-2 items-center bg-muted/40 p-2.5 rounded-lg border border-border"
                      >
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] font-bold uppercase outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                          value={line.source_cabang_id}
                          disabled={floor > 0}
                          onChange={(e) =>
                            updateLine(
                              row.mr_item_id,
                              idx,
                              "source_cabang_id",
                              Number(e.target.value),
                            )
                          }
                        >
                          <option value="">Pilih Sumber...</option>
                          {cabangs.map((c) => {
                            const isDestination = c.id === mr?.cabang_id;
                            return (
                              <option
                                key={c.id}
                                value={c.id}
                                disabled={isDestination}
                              >
                                {c.nama_cabang}
                                {isDestination ? " (gudang tujuan MR)" : ""}
                              </option>
                            );
                          })}
                        </select>
                        <Input
                          type="number"
                          min={floor}
                          max={Math.max(avail, floor) || undefined}
                          className="h-9 w-full text-center font-bold text-[11px]"
                          value={line.qty || ""}
                          onChange={(e) =>
                            updateLine(row.mr_item_id, idx, "qty", e.target.value)
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-md disabled:opacity-30"
                          disabled={floor > 0}
                          title={
                            floor > 0
                              ? `Tidak bisa dihapus — ${floor} unit sudah ter-delivery`
                              : undefined
                          }
                          onClick={() => removeLine(row.mr_item_id, idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}

          <div className="space-y-1.5 pt-2">
            <Label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
              <Info className="h-3 w-3" /> Alasan Perubahan (wajib)
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan kenapa alokasi share stock ini diubah..."
              className="min-h-20 text-xs"
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter className="p-5 bg-muted/30 border-t border-border gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="flex-1 h-10 font-semibold text-sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Batal
          </Button>
          <Button
            className="flex-1 h-10 font-bold text-sm"
            onClick={handleSubmit}
            disabled={saving || loading}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Simpan Perubahan"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
