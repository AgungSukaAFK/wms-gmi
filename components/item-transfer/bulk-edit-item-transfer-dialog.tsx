"use client";

// Edit massal PIC & Penerima Item Transfer dari list (moderator). Hanya kolom
// orang yang diubah -- stok, item, dan approval tidak disentuh, jadi approval
// tidak diulang. Penerima IT yang sudah selesai dilewati (sama dengan aturan
// Moderator Edit). Tiap IT yang berubah tercatat di riwayat moderator.

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Info,
  Loader2,
  Pencil,
  XCircle,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  bulkUpdateItemTransferPeople,
  type BulkItemTransferPeopleResult,
} from "@/services/item-transfer-actions";

export type BulkEditItemTransferRow = {
  id: number;
  it_kode: string;
  status: string;
};

type UserOption = { id: string; nama: string };

function UserPicker({
  users,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  users: UserOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = users.find((u) => u.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-9 w-full justify-between text-xs font-bold"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground font-medium")}>
            {selected?.nama || placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Cari user..." className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs">User tidak ditemukan.</CommandEmpty>
            <CommandGroup>
              {users.map((u) => (
                <CommandItem
                  key={u.id}
                  // cmdk mencari berdasarkan value; id ditambahkan supaya nama kembar tetap unik.
                  value={`${u.nama} ${u.id}`}
                  onSelect={() => {
                    onChange(u.id);
                    setOpen(false);
                  }}
                  className="text-xs font-bold"
                >
                  {u.nama}
                  <Check
                    className={cn("ml-auto h-3.5 w-3.5", value === u.id ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface BulkEditItemTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: BulkEditItemTransferRow[];
  onFinished: () => void;
}

export function BulkEditItemTransferDialog({
  open,
  onOpenChange,
  rows,
  onFinished,
}: BulkEditItemTransferDialogProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [editPic, setEditPic] = useState(false);
  const [editReceiver, setEditReceiver] = useState(false);
  const [picUid, setPicUid] = useState("");
  const [receiverUid, setReceiverUid] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // State tidak di-reset di sini: parent me-mount dialog ini hanya saat dibuka.
  const [results, setResults] = useState<Record<number, BulkItemTransferPeopleResult>>({});

  useEffect(() => {
    createClient()
      .from("profiles")
      .select("id, nama")
      .eq("is_active", true)
      .order("nama")
      .then(({ data }) => {
        setUsers((data || []) as UserOption[]);
        setLoadingUsers(false);
      });
  }, []);

  const completedCount = rows.filter((r) => r.status === "completed").length;
  const done = Object.keys(results).length > 0;
  const canSave =
    !saving &&
    (editPic || editReceiver) &&
    (!editPic || !!picUid) &&
    (!editReceiver || !!receiverUid);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await bulkUpdateItemTransferPeople(
        rows.map((r) => r.id),
        {
          ...(editPic ? { uid_pic: picUid } : {}),
          ...(editReceiver ? { uid_receiver: receiverUid } : {}),
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
        toast.success(`${res.results.length} Item Transfer berhasil diperbarui.`);
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
              <Pencil className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Edit {rows.length} Item Transfer
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
                Ubah PIC & Penerima sekaligus
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto bg-background">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-[11px] font-medium text-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Centang field yang ingin diubah. Field yang tidak dicentang tetap seperti semula.
              Approval tidak diulang dan setiap perubahan tercatat di riwayat moderator.
              {completedCount > 0 &&
                ` Penerima pada ${completedCount} IT yang sudah selesai tidak akan diubah.`}
            </span>
          </div>

          {!done && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest cursor-pointer">
                  <Checkbox
                    checked={editPic}
                    onCheckedChange={(v) => setEditPic(v === true)}
                    disabled={saving}
                  />
                  Ubah PIC
                </label>
                <UserPicker
                  users={users}
                  value={picUid}
                  onChange={setPicUid}
                  disabled={!editPic || saving || loadingUsers}
                  placeholder={loadingUsers ? "Memuat user..." : "Pilih PIC..."}
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest cursor-pointer">
                  <Checkbox
                    checked={editReceiver}
                    onCheckedChange={(v) => setEditReceiver(v === true)}
                    disabled={saving}
                  />
                  Ubah Penerima
                </label>
                <UserPicker
                  users={users}
                  value={receiverUid}
                  onChange={setReceiverUid}
                  disabled={!editReceiver || saving || loadingUsers}
                  placeholder={loadingUsers ? "Memuat user..." : "Pilih penerima..."}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-widest">
                  Alasan (opsional)
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Contoh: pergantian PIC gudang..."
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
                    <p className="text-xs font-bold uppercase truncate">{r.it_kode}</p>
                    <p
                      className={
                        result && !result.ok
                          ? "text-[10px] text-destructive"
                          : "text-[10px] text-muted-foreground"
                      }
                    >
                      {result
                        ? result.message
                        : r.status === "completed"
                          ? "Selesai — penerima terkunci"
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
                `Simpan ${rows.length} Item Transfer`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
