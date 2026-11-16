"use client";

// Panel "Status per Barang" di detail PO: status sistem tiap barang (turunan
// dari status PO + qty), status progres yang bisa diedit, estimasi per item,
// dan pembatalan item (PO full approved -> PO jadi CLOSED). Aturan lengkap:
// lib/po-item-status.ts.

import React, { useEffect, useState } from "react";
import {
  Ban,
  CalendarClock,
  History,
  Loader2,
  PackageCheck,
  Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "@/lib/toast";
import { cn, formatDate } from "@/lib/utils";
import { SOFT } from "@/lib/constants/status";
import {
  PO_CANCELLABLE_STATUSES,
  PO_ITEM_DETAIL_STATUS_PRESETS,
  PO_ITEM_SYSTEM_STATUS_LABEL,
  type PoItemSystemStatus,
  poItemOutstanding,
  poItemSystemStatus,
  qtyOriginal,
} from "@/lib/po-item-status";
import {
  cancelPoItem,
  getPoItemStatusLogs,
  updatePoItemStatus,
} from "@/services/po-item-actions";

const SYSTEM_TONE: Record<PoItemSystemStatus, string> = {
  menunggu_approval: SOFT.gray,
  ditolak: SOFT.red,
  menunggu_terima: SOFT.sky,
  partial: SOFT.amber,
  diterima: SOFT.emerald,
  dibatalkan: SOFT.red,
  partial_dibatalkan: SOFT.orange,
};

const CUSTOM = "__custom__";

export type PoItemStatusRow = {
  id: number;
  part_number: string;
  part_name: string;
  satuan: string;
  qty: number;
  qty_received: number;
  qty_cancelled?: number | null;
  cancel_reason?: string | null;
  cancelled_by_nama?: string | null;
  cancelled_at?: string | null;
  item_detail_status?: string | null;
  item_estimasi?: string | null;
  item_status_note?: string | null;
  item_status_updated_by_nama?: string | null;
  item_status_updated_at?: string | null;
  vendors?: { vendor_name?: string | null } | null;
};

export function PoItemStatusPanel({
  poId,
  poStatus,
  poJenis,
  items,
  canManage,
  onChanged,
  pendingRiQty,
}: {
  poId: number;
  poStatus: string | null | undefined;
  poJenis?: string | null;
  items: PoItemStatusRow[];
  /** Approver PO ini / purchasing / moderator. */
  canManage: boolean;
  onChanged: () => void | Promise<void>;
  /** Qty per po_item yang masih di RI menunggu approval. */
  pendingRiQty?: Record<number, number>;
}) {
  const [editItem, setEditItem] = useState<PoItemStatusRow | null>(null);
  const [cancelItem, setCancelItem] = useState<PoItemStatusRow | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsKey, setLogsKey] = useState(0);

  useEffect(() => {
    if (!showLogs) return;
    getPoItemStatusLogs(poId).then((res) => setLogs(res.data || []));
  }, [poId, showLogs, logsKey]);

  const canCancelInStatus = (PO_CANCELLABLE_STATUSES as readonly string[]).includes(
    poStatus || "",
  );
  const isKonsinyasi = poJenis === "konsinyasi";
  const canEditStatus = canManage && poStatus !== "rejected";
  const cancelledCount = items.filter((i) => Number(i.qty_cancelled) > 0).length;
  const partByItem = new Map(items.map((i) => [i.id, i.part_number]));

  const afterChange = async () => {
    setLogsKey((k) => k + 1);
    await onChanged();
  };

  return (
    <div className="space-y-3">
      {poStatus === "closed" && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-orange-800 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-200">
          PO ini <strong>CLOSED</strong> karena {cancelledCount} item dibatalkan.
          Item yang masih aktif tetap bisa diterima lewat Receive Item sampai
          lengkap. PO closed tidak bisa diedit lagi.
        </div>
      )}
      {canManage && poStatus === "approved" && !isKonsinyasi && (
        <p className="text-[10px] text-muted-foreground font-medium">
          Membatalkan satu item akan langsung membuat PO berstatus{" "}
          <strong>CLOSED</strong>. Qty yang dibatalkan dikembalikan ke PR / SO
          sumbernya dan bisa di-PO ulang.
        </p>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <Table className="w-full min-w-[860px]" containerClassName="overflow-x-auto">
          <TableHeader className="bg-muted/40">
            <TableRow className="h-8 hover:bg-transparent">
              <TableHead className="text-[9px] font-bold uppercase text-muted-foreground pl-4">
                Barang
              </TableHead>
              <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right w-20">
                Qty PO
              </TableHead>
              <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right w-20">
                Diterima
              </TableHead>
              <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right w-20">
                Batal
              </TableHead>
              <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right w-20">
                Sisa
              </TableHead>
              <TableHead className="text-[9px] font-bold uppercase text-muted-foreground w-40">
                Status Sistem
              </TableHead>
              <TableHead className="text-[9px] font-bold uppercase text-muted-foreground w-56">
                Status Progres
              </TableHead>
              {canManage && (
                <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right pr-4 w-28">
                  Aksi
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const sys = poItemSystemStatus(item, poStatus);
              const cancelled = Number(item.qty_cancelled) || 0;
              const outstanding = poItemOutstanding(item);
              const pendingRi = pendingRiQty?.[item.id] || 0;
              const cancellable =
                canManage &&
                canCancelInStatus &&
                !isKonsinyasi &&
                outstanding > 0;
              return (
                <TableRow key={item.id} className="border-b border-border/40 align-top">
                  <TableCell className="pl-4 py-2.5">
                    <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-black text-foreground break-all">
                      {item.part_number}
                    </span>
                    <p
                      className="text-[10px] text-muted-foreground font-medium mt-0.5 truncate max-w-[260px]"
                      title={item.part_name}
                    >
                      {item.part_name}
                    </p>
                    {item.vendors?.vendor_name && (
                      <p className="text-[9px] text-muted-foreground/80 font-semibold uppercase">
                        {item.vendors.vendor_name}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right py-2.5 text-[11px] font-bold">
                    {qtyOriginal(item)}
                    <span className="text-[9px] text-muted-foreground font-medium ml-1">
                      {item.satuan}
                    </span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right py-2.5 text-[11px] font-bold",
                      item.qty_received > 0 ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {item.qty_received}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right py-2.5 text-[11px] font-bold",
                      cancelled > 0 ? "text-destructive" : "text-muted-foreground/50",
                    )}
                  >
                    {cancelled || "-"}
                  </TableCell>
                  <TableCell className="text-right py-2.5 text-[11px] font-bold">
                    {outstanding}
                    {pendingRi > 0 && (
                      <p className="text-[9px] font-semibold text-warning">
                        {pendingRi} di RI pending
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] font-bold uppercase whitespace-normal text-left", SYSTEM_TONE[sys])}
                    >
                      {PO_ITEM_SYSTEM_STATUS_LABEL[sys]}
                    </Badge>
                    {cancelled > 0 && (
                      <p className="text-[9px] text-muted-foreground mt-1 leading-snug">
                        Dibatalkan {item.cancelled_by_nama || "-"}
                        {item.cancelled_at ? ` · ${formatDate(item.cancelled_at)}` : ""}
                        {item.cancel_reason && (
                          <span className="block italic">&ldquo;{item.cancel_reason}&rdquo;</span>
                        )}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5">
                    {item.item_detail_status ? (
                      <p className="text-[11px] font-bold text-foreground leading-tight">
                        {item.item_detail_status}
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">Belum diisi</p>
                    )}
                    {item.item_estimasi && (
                      <p className="text-[9px] font-semibold text-primary flex items-center gap-1 mt-0.5">
                        <CalendarClock className="h-3 w-3" /> Estimasi {formatDate(item.item_estimasi)}
                      </p>
                    )}
                    {item.item_status_note && (
                      <p className="text-[9px] text-muted-foreground mt-0.5 whitespace-pre-wrap">
                        {item.item_status_note}
                      </p>
                    )}
                    {item.item_status_updated_at && (
                      <p className="text-[8px] text-muted-foreground/70 mt-0.5 uppercase font-semibold">
                        {item.item_status_updated_by_nama || "-"} · {formatDate(item.item_status_updated_at)}
                      </p>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="py-2.5 pr-4">
                      <div className="flex flex-col items-end gap-1">
                        {canEditStatus && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[9px] font-bold uppercase gap-1"
                            onClick={() => setEditItem(item)}
                          >
                            <Pencil className="h-3 w-3" /> Status
                          </Button>
                        )}
                        {cancellable && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[9px] font-bold uppercase gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={() => setCancelItem(item)}
                          >
                            <Ban className="h-3 w-3" /> Batalkan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] font-bold uppercase gap-1.5 text-muted-foreground"
          onClick={() => setShowLogs((v) => !v)}
        >
          <History className="h-3.5 w-3.5" />
          {showLogs ? "Sembunyikan" : "Lihat"} riwayat status barang
        </Button>
        {showLogs && (
          <div className="mt-2 space-y-1.5">
            {logs.length === 0 ? (
              <p className="text-[10px] text-muted-foreground italic px-2">
                Belum ada perubahan status barang.
              </p>
            ) : (
              logs.map((l) => (
                <div
                  key={l.id}
                  className="rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-[10px]"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-black">
                      {partByItem.get(l.po_item_id) || "-"}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[8px] font-bold uppercase",
                        l.action === "cancel" ? SOFT.red : SOFT.sky,
                      )}
                    >
                      {l.action === "cancel" ? "Dibatalkan" : "Status diubah"}
                    </Badge>
                    <span className="font-bold">{l.changed_by_nama || "-"}</span>
                    <span className="text-muted-foreground">{formatDate(l.created_at)}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">{describeLog(l)}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <EditStatusDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={afterChange}
      />
      <CancelItemDialog
        key={cancelItem?.id ?? "none"}
        item={cancelItem}
        poStatus={poStatus}
        pendingRi={cancelItem ? pendingRiQty?.[cancelItem.id] || 0 : 0}
        onClose={() => setCancelItem(null)}
        onSaved={afterChange}
      />
    </div>
  );
}

function describeLog(l: any): string {
  if (l.action === "cancel") {
    const d = l.detail || {};
    return `Batal ${d.qty_cancelled ?? "-"} (qty ${d.qty_before ?? "-"}, sudah diterima ${d.qty_received ?? 0})${l.note ? ` — ${l.note}` : ""}`;
  }
  const b = l.detail?.before || {};
  const a = l.detail?.after || {};
  const parts: string[] = [];
  const show = (v: any) => (v ? String(v) : "-");
  if (b.item_detail_status !== a.item_detail_status)
    parts.push(`Status: ${show(b.item_detail_status)} → ${show(a.item_detail_status)}`);
  if (b.item_estimasi !== a.item_estimasi)
    parts.push(
      `Estimasi: ${b.item_estimasi ? formatDate(b.item_estimasi) : "-"} → ${a.item_estimasi ? formatDate(a.item_estimasi) : "-"}`,
    );
  if (b.item_status_note !== a.item_status_note)
    parts.push(`Catatan: ${show(b.item_status_note)} → ${show(a.item_status_note)}`);
  return parts.join(" · ") || "-";
}

function EditStatusDialog({
  item,
  onClose,
  onSaved,
}: {
  item: PoItemStatusRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      {item && (
        <EditStatusBody key={item.id} item={item} onClose={onClose} onSaved={onSaved} />
      )}
    </Dialog>
  );
}

function EditStatusBody({
  item,
  onClose,
  onSaved,
}: {
  item: PoItemStatusRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const initial = item.item_detail_status || "";
  const initialIsPreset = (PO_ITEM_DETAIL_STATUS_PRESETS as readonly string[]).includes(initial);
  const [preset, setPreset] = useState(initial ? (initialIsPreset ? initial : CUSTOM) : "");
  const [custom, setCustom] = useState(initialIsPreset ? "" : initial);
  const [estimasi, setEstimasi] = useState(
    item.item_estimasi ? String(item.item_estimasi).slice(0, 10) : "",
  );
  const [note, setNote] = useState(item.item_status_note || "");
  const [saving, setSaving] = useState(false);

  const statusValue = preset === CUSTOM ? custom : preset;

  const save = async () => {
    setSaving(true);
    const res = await updatePoItemStatus(item.id, {
      item_detail_status: statusValue,
      item_estimasi: estimasi || null,
      item_status_note: note,
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(res.unchanged ? "Tidak ada perubahan." : "Status barang disimpan.");
    onClose();
    await onSaved();
  };

  return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Status Barang</DialogTitle>
          <DialogDescription>
            <span className="font-mono font-bold">{item.part_number}</span> — {item.part_name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">
              Status Progres
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {PO_ITEM_DETAIL_STATUS_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(preset === p ? "" : p)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[10px] font-bold transition-colors",
                    preset === p
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted",
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset(preset === CUSTOM ? "" : CUSTOM)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[10px] font-bold transition-colors",
                  preset === CUSTOM
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-dashed border-border bg-background hover:bg-muted",
                )}
              >
                Lainnya…
              </button>
            </div>
            {preset === CUSTOM && (
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Tulis status progres"
                className="h-9 text-xs"
                maxLength={120}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">
              Estimasi Diterima
            </Label>
            <Input
              type="date"
              value={estimasi}
              onChange={(e) => setEstimasi(e.target.value)}
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">
              Catatan
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opsional, mis. no. resi, info dari vendor"
              className="min-h-16 resize-none text-xs"
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={save} disabled={saving || (preset === CUSTOM && !custom.trim())}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
  );
}

function CancelItemDialog({
  item,
  poStatus,
  pendingRi,
  onClose,
  onSaved,
}: {
  item: PoItemStatusRow | null;
  poStatus: string | null | undefined;
  pendingRi: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!item) return null;
  const received = Number(item.qty_received) || 0;
  const cancelQty = poItemOutstanding(item);

  const submit = async () => {
    setSaving(true);
    const res = await cancelPoItem(item.id, reason);
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`${res.cancelledQty} ${item.satuan} ${item.part_number} dibatalkan. PO menjadi CLOSED.`);
    onClose();
    await onSaved();
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Ban className="h-4 w-4" /> Batalkan Item PO
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono font-bold">{item.part_number}</span> — {item.part_name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border p-2">
              <p className="text-[9px] font-bold uppercase text-muted-foreground">Qty PO</p>
              <p className="text-sm font-black">{item.qty}</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="text-[9px] font-bold uppercase text-muted-foreground">Diterima</p>
              <p className="text-sm font-black text-success">{received}</p>
            </div>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2">
              <p className="text-[9px] font-bold uppercase text-destructive">Dibatalkan</p>
              <p className="text-sm font-black text-destructive">{cancelQty}</p>
            </div>
          </div>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            {received > 0 && (
              <li>
                {received} {item.satuan} yang sudah diterima tetap tercatat; hanya sisa{" "}
                {cancelQty} {item.satuan} yang dibatalkan.
              </li>
            )}
            <li>Qty yang dibatalkan dikembalikan ke PR / SO sumber dan bisa di-PO ulang.</li>
            <li>
              PO {poStatus === "closed" ? "tetap" : "langsung menjadi"} <strong>CLOSED</strong>{" "}
              dan tidak bisa diedit lagi. Item lain yang aktif tetap bisa diterima lewat RI.
            </li>
            <li>Pembatalan tidak bisa di-undo.</li>
          </ul>
          {pendingRi > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] font-semibold text-warning">
              Item ini masih ada di RI yang menunggu approval ({pendingRi} {item.satuan}).
              Selesaikan atau tolak RI tersebut dulu sebelum membatalkan.
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">
              Alasan Pembatalan <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Mis. vendor tidak sanggup supply, barang discontinue"
              className="min-h-20 resize-none text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Kembali
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={saving || !reason.trim() || pendingRi > 0 || cancelQty <= 0}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            Batalkan &amp; Close PO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
