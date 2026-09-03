"use client";

import { useState } from "react";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePickerString } from "@/components/date-picker-string";
import {
  ScrollText,
  Plus,
  Pencil,
  Trash2,
  X,
  Sparkles,
  Wrench,
  Zap,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  getUpdateLogs,
  createUpdateLog,
  updateUpdateLog,
  deleteUpdateLog,
  type UpdateLog,
  type UpdateLogChange,
  type UpdateLogChangeType,
} from "@/services/update-logs-actions";
import { formatDate } from "@/lib/utils";

const CHANGE_TYPE_META: Record<
  UpdateLogChangeType,
  { label: string; icon: typeof Sparkles; className: string }
> = {
  feature: {
    label: "Fitur Baru",
    icon: Sparkles,
    className: "border-success/30 bg-success/10 text-success",
  },
  fix: {
    label: "Perbaikan",
    icon: Wrench,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  improvement: {
    label: "Peningkatan",
    icon: Zap,
    className: "border-primary/30 bg-primary/10 text-primary",
  },
};

function toYmd(date: Date) {
  return date.toLocaleDateString("sv-SE");
}

function emptyForm(): {
  version: string;
  title: string;
  release_date: string;
  changes: UpdateLogChange[];
} {
  return {
    version: "",
    title: "",
    release_date: toYmd(new Date()),
    changes: [{ type: "feature", description: "" }],
  };
}

export default function UpdateLogsClient({
  initialLogs,
}: {
  initialLogs: UpdateLog[];
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (log: UpdateLog) => {
    setEditingId(log.id);
    setForm({
      version: log.version,
      title: log.title,
      release_date: log.release_date,
      changes:
        log.changes.length > 0
          ? log.changes
          : [{ type: "feature", description: "" }],
    });
    setOpen(true);
  };

  const refresh = async () => {
    const res = await getUpdateLogs();
    if (res.success) setLogs(res.logs);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    const payload = {
      version: form.version.trim(),
      title: form.title.trim(),
      release_date: form.release_date,
      changes: form.changes,
    };
    const res = editingId
      ? await updateUpdateLog(editingId, payload)
      : await createUpdateLog(payload);
    setSubmitting(false);

    if (!res.success) {
      toast.error(res.error || "Gagal menyimpan.");
      return;
    }
    toast.success(editingId ? "Update log diperbarui." : "Update log ditambahkan.");
    setOpen(false);
    await refresh();
  };

  const handleDelete = async (log: UpdateLog) => {
    if (!confirm(`Hapus update log versi ${log.version}?`)) return;
    const res = await deleteUpdateLog(log.id);
    if (!res.success) {
      toast.error(res.error || "Gagal menghapus.");
      return;
    }
    toast.success("Update log dihapus.");
    await refresh();
  };

  const setChangeRow = (idx: number, patch: Partial<UpdateLogChange>) => {
    setForm((f) => ({
      ...f,
      changes: f.changes.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  };

  const addChangeRow = () => {
    setForm((f) => ({
      ...f,
      changes: [...f.changes, { type: "feature", description: "" }],
    }));
  };

  const removeChangeRow = (idx: number) => {
    setForm((f) => ({
      ...f,
      changes: f.changes.filter((_, i) => i !== idx),
    }));
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              <ScrollText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                UPDATE LOGS
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Riwayat perubahan aplikasi per versi
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={openCreate}
            className="gap-2 text-xs font-bold uppercase shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Tambah Versi
          </Button>
        </div>
      </Content>

      <Content>
        {logs.length === 0 ? (
          <div className="py-16 text-center text-sm italic text-muted-foreground">
            Belum ada update log.
          </div>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-xl border border-border p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge className="rounded-md px-2.5 py-1 text-xs font-black">
                      v{log.version}
                    </Badge>
                    <h2 className="text-sm font-bold text-foreground sm:text-base">
                      {log.title}
                    </h2>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {formatDate(log.release_date)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(log)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(log)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <ul className="mt-3 space-y-1.5">
                  {log.changes.map((c, i) => {
                    const meta = CHANGE_TYPE_META[c.type];
                    const Icon = meta.icon;
                    return (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span
                          className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.className}`}
                        >
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                        <span className="text-foreground">{c.description}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Content>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl p-6">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold">
              {editingId ? "Edit Update Log" : "Tambah Update Log"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Format versi: x.xx.xxx (contoh: 1.00.000).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">
                  Versi
                </Label>
                <Input
                  placeholder="1.00.000"
                  value={form.version}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, version: e.target.value }))
                  }
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">
                  Tanggal Rilis
                </Label>
                <DatePickerString
                  value={form.release_date}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, release_date: v }))
                  }
                  className="h-9 w-full text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase text-muted-foreground">
                Judul
              </Label>
              <Input
                placeholder="Contoh: Update SOH & Sortable Table"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase text-muted-foreground">
                Daftar Perubahan
              </Label>
              <div className="space-y-2">
                {form.changes.map((c, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Select
                      value={c.type}
                      onValueChange={(v) =>
                        setChangeRow(i, { type: v as UpdateLogChangeType })
                      }
                    >
                      <SelectTrigger className="h-9 w-32 shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="feature">Fitur Baru</SelectItem>
                        <SelectItem value="fix">Perbaikan</SelectItem>
                        <SelectItem value="improvement">Peningkatan</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Deskripsi perubahan..."
                      value={c.description}
                      onChange={(e) =>
                        setChangeRow(i, { description: e.target.value })
                      }
                      className="h-9 flex-1 text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeChangeRow(i)}
                      disabled={form.changes.length === 1}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addChangeRow}
                className="h-8 gap-1.5 text-xs font-bold"
              >
                <Plus className="h-3.5 w-3.5" /> Tambah Baris
              </Button>
            </div>
          </div>

          <DialogFooter className="mt-6 flex items-center gap-3 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 rounded-xl font-bold text-muted-foreground"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 rounded-xl font-bold shadow-md shadow-primary/20"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingId ? (
                "Simpan Perubahan"
              ) : (
                "Tambah"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
