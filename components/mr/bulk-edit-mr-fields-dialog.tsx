"use client";

// Edit massal field MR dari list (moderator): Due Date, Unfreeze/Reset, Kategori.
// Satu dialog, tiga mode. Hasil per MR ditampilkan; tiap MR yang berubah
// tercatat di riwayat moderator (moderator_edit_logs) beserta batch-nya.

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock, CheckCircle2, Info, Loader2, Snowflake, Tag, XCircle } from "lucide-react";
import { toast } from "@/lib/toast";
import { MR_KATEGORI_OPTIONS } from "@/lib/mr-options";
import { businessToday } from "@/lib/business-date";
import {
  bulkUnfreezeMR,
  bulkUpdateMRDueDate,
  bulkUpdateMRKategori,
  type BulkMrResult,
} from "@/services/mr-bulk-actions";
import type { BulkMrRow } from "@/components/mr/bulk-cancel-mr-dialog";

export type BulkFieldMode = "due_date" | "unfreeze" | "kategori";

const MODE_META: Record<BulkFieldMode, { title: string; hint: string; icon: React.ElementType }> = {
  due_date: { title: "Edit Due Date", hint: "Ubah due date sekaligus", icon: CalendarClock },
  unfreeze: { title: "Unfreeze / Reset", hint: "Buka freeze sekaligus", icon: Snowflake },
  kategori: { title: "Ubah Kategori", hint: "Ganti kategori MR sekaligus", icon: Tag },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BulkFieldMode;
  rows: BulkMrRow[];
  onFinished: () => void;
}

export function BulkEditMrFieldsDialog({ open, onOpenChange, mode, rows, onFinished }: Props) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;
  const today = businessToday();

  const [dueMode, setDueMode] = useState<"set" | "shift">("set");
  const [date, setDate] = useState("");
  const [days, setDays] = useState("");
  const [extendOnUnfreeze, setExtendOnUnfreeze] = useState(false);
  const [kategori, setKategori] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Record<number, BulkMrResult>>({});

  const done = Object.keys(results).length > 0;
  const reasonRequired = mode !== "kategori";

  // Baris yang relevan untuk mode ini (sisanya dilewati server dengan keterangan).
  const eligible = (r: BulkMrRow) => {
    if (mode === "unfreeze") return !!r.is_frozen;
    if (mode === "due_date")
      return ["open", "approved"].includes(r.mr_status) && r.mr_type !== "scheduled";
    return r.mr_status !== "cancelled";
  };
  const skipNote = (r: BulkMrRow) => {
    if (mode === "unfreeze") return "Tidak freeze — akan dilewati";
    if (mode === "due_date")
      return r.mr_type === "scheduled"
        ? "Scheduled MR — akan dilewati"
        : `Status ${r.mr_status} — akan dilewati`;
    return "Dibatalkan — akan dilewati";
  };
  const eligibleCount = rows.filter(eligible).length;

  const daysNum = Number(days);
  const inputValid =
    mode === "due_date"
      ? dueMode === "set"
        ? !!date && date >= today
        : Number.isInteger(daysNum) && daysNum !== 0
      : mode === "unfreeze"
        ? !extendOnUnfreeze || (!!date && date >= today)
        : !!kategori;
  const canSave =
    !saving && eligibleCount > 0 && inputValid && (!reasonRequired || !!reason.trim());

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const ids = rows.map((r) => r.id);
      const res =
        mode === "due_date"
          ? await bulkUpdateMRDueDate(
              ids,
              dueMode === "set"
                ? { mode: "set", date, reason }
                : { mode: "shift", days: daysNum, reason },
            )
          : mode === "unfreeze"
            ? await bulkUnfreezeMR(ids, {
                newDueDate: extendOnUnfreeze ? date : undefined,
                reason,
              })
            : await bulkUpdateMRKategori(ids, { kategori, reason });
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
      <DialogContent className="sm:max-w-xl p-0 rounded-xl border-border shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-primary/5 border-b border-primary/20">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-xl flex items-center justify-center shadow-sm shrink-0">
              <Icon className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                {meta.title} {rows.length} MR
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                {meta.hint}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto bg-background">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-[11px] font-medium text-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {mode === "due_date" &&
                "Hanya MR open/approved (bukan Scheduled MR). Tanggal hasil tidak boleh lampau. Tidak membuka freeze — pakai Unfreeze/Reset untuk itu."}
              {mode === "unfreeze" &&
                "Hanya MR yang sedang freeze. Laporan kendala yang terbuka ikut diselesaikan dan pembuat MR dinotifikasi."}
              {mode === "kategori" && "Semua MR terpilih yang belum dibatalkan."}
              {" "}
              {eligibleCount < rows.length && `${rows.length - eligibleCount} MR terpilih akan dilewati. `}
              Setiap perubahan tercatat di riwayat moderator.
            </span>
          </div>

          {!done && (
            <div className="space-y-3">
              {mode === "due_date" && (
                <>
                  <div className="flex gap-2">
                    {(["set", "shift"] as const).map((m) => (
                      <Button
                        key={m}
                        type="button"
                        size="sm"
                        variant={dueMode === m ? "default" : "outline"}
                        className="flex-1 h-8 text-xs font-semibold"
                        onClick={() => setDueMode(m)}
                      >
                        {m === "set" ? "Set tanggal" : "Geser +/- hari"}
                      </Button>
                    ))}
                  </div>
                  {dueMode === "set" ? (
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-widest">
                        Due date baru
                      </Label>
                      <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-widest">
                        Geser (hari) — negatif untuk memajukan
                      </Label>
                      <Input
                        type="number"
                        step={1}
                        placeholder="Contoh: 7 atau -3"
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}

              {mode === "unfreeze" && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={extendOnUnfreeze}
                      onChange={(e) => setExtendOnUnfreeze(e.target.checked)}
                    />
                    Sekaligus perpanjang due date (Reset)
                  </label>
                  {extendOnUnfreeze && (
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-widest">
                        Due date baru
                      </Label>
                      <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                  )}
                </div>
              )}

              {mode === "kategori" && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase tracking-widest">Kategori baru</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {MR_KATEGORI_OPTIONS.map((k) => (
                      <Button
                        key={k}
                        type="button"
                        size="sm"
                        variant={kategori === k ? "default" : "outline"}
                        className="h-8 text-xs font-semibold"
                        onClick={() => setKategori(k)}
                      >
                        {k}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">
                  Alasan {reasonRequired ? "(wajib)" : "(opsional)"}
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Dicatat di riwayat tiap MR"
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
                      {result ? result.message : eligible(r) ? "Siap diubah" : skipNote(r)}
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
            <Button className="flex-1 h-10 font-bold text-sm gap-2" onClick={handleSave} disabled={!canSave}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                `Simpan ${eligibleCount} MR`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
