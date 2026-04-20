"use client";

import React, { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  getJobCostingById,
  updateJobCostingStatus,
  addJobCostingItem,
  deleteJobCostingItem,
} from "@/services/finance-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2,
  Building2,
  User,
  Calendar,
  Calculator,
  Trash2,
  Plus,
  CheckCircle2,
  XCircle,
  Lock,
  ListChecks,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
};

const UNITS = [
  "pcs",
  "unit",
  "set",
  "lot",
  "m",
  "m²",
  "m³",
  "kg",
  "liter",
  "jam",
  "hari",
  "ls",
];

function formatRupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n || 0);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface Props {
  jobId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRefresh: () => void;
}

export function JobCostingDetailSheet({
  jobId,
  open,
  onOpenChange,
  onRefresh,
}: Props) {
  const profile = useAuthStore((s) => s.profile);
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Add item form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newQty, setNewQty] = useState(1);
  const [newUnit, setNewUnit] = useState("pcs");
  const [newPrice, setNewPrice] = useState(0);
  const [newNotes, setNewNotes] = useState("");
  const [statusDraft, setStatusDraft] = useState("open");

  useEffect(() => {
    if (!open || !jobId) return;
    loadJob();
  }, [open, jobId]);

  useEffect(() => {
    if (job?.status) {
      setStatusDraft(job.status);
    }
  }, [job?.status]);

  async function loadJob() {
    setLoading(true);
    const result = await getJobCostingById(jobId!);
    if (result.error) toast.error(result.error);
    else setJob(result.data);
    setLoading(false);
  }

  async function handleStatusChange(status: string) {
    setActionLoading(true);
    const result = await updateJobCostingStatus(jobId!, status);
    setActionLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Status diubah ke ${status}.`);
    loadJob();
    onRefresh();
  }

  async function handleAddItem() {
    if (!newDesc.trim()) {
      toast.error("Deskripsi item wajib diisi.");
      return;
    }
    setActionLoading(true);
    const result = await addJobCostingItem(jobId!, {
      description: newDesc.trim(),
      qty: newQty,
      unit: newUnit,
      unit_price: newPrice,
      notes: newNotes.trim() || undefined,
    });
    setActionLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Item ditambahkan.");
    setNewDesc("");
    setNewQty(1);
    setNewUnit("pcs");
    setNewPrice(0);
    setNewNotes("");
    setShowAddForm(false);
    loadJob();
    onRefresh();
  }

  async function handleDeleteItem(itemId: number) {
    setActionLoading(true);
    const result = await deleteJobCostingItem(itemId, jobId!);
    setActionLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Item dihapus.");
    loadJob();
    onRefresh();
  }

  const totalCost =
    (job?.job_costing_items as any[])?.reduce(
      (s: number, i: any) => s + (i.qty ?? 0) * (i.unit_price ?? 0),
      0,
    ) ??
    job?.total_cost ??
    0;

  const roleNames = (profile?.roles || []).map((r) => r.name);
  const canManageStatus = roleNames.some((r) =>
    ["admin", "moderator"].includes(r),
  );
  const canManageItems =
    canManageStatus ||
    (profile?.id && job?.created_by && profile.id === job.created_by);

  const isEditable = job?.status === "open";

  const statusLabel: Record<string, string> = {
    open: "Open",
    approved: "Approved",
    closed: "Closed",
    rejected: "Rejected",
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full sm:max-w-2xl overflow-y-auto p-0"
        side="right"
      >
        <SheetTitle className="sr-only">Detail Job Costing</SheetTitle>

        {loading || !job ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 py-5 border-b bg-muted/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Calculator className="h-4 w-4 text-primary" />
                    <span className="font-mono text-sm font-black text-primary">
                      {job.job_kode}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold capitalize ${STATUS_COLORS[job.status] ?? ""}`}
                    >
                      {statusLabel[job.status] ?? job.status}
                    </Badge>
                  </div>
                  <p className="font-bold text-base">{job.description}</p>
                  {job.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {job.notes}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">Total Biaya</p>
                  <p className="font-black text-lg text-primary">
                    {formatRupiah(totalCost)}
                  </p>
                </div>
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{job.cabang?.nama_cabang ?? "-"}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span>{job.creator_nama ?? job.profiles?.nama ?? "-"}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  <span>{formatDate(job.created_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ListChecks className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {(job.job_costing_items as any[])?.length ?? 0} item
                  </span>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase text-muted-foreground">
                  Rincian Biaya
                </h4>
                {isEditable && canManageItems && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => setShowAddForm((v) => !v)}
                    disabled={actionLoading}
                  >
                    <Plus className="h-3 w-3" />
                    Tambah Item
                  </Button>
                )}
              </div>

              {/* Add item form */}
              {showAddForm && (
                <div className="rounded-lg border p-3 bg-muted/20 space-y-3">
                  <p className="text-xs font-bold text-muted-foreground">
                    Item Baru
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                        Deskripsi *
                      </Label>
                      <Input
                        value={newDesc}
                        onChange={(e) => setNewDesc(e.target.value)}
                        placeholder="Nama item..."
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                        Qty
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={newQty}
                        onChange={(e) =>
                          setNewQty(parseFloat(e.target.value) || 0)
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                        Satuan
                      </Label>
                      <Select value={newUnit} onValueChange={setNewUnit}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNITS.map((u) => (
                            <SelectItem key={u} value={u}>
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                        Harga Satuan (Rp)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={newPrice}
                        onChange={(e) =>
                          setNewPrice(parseFloat(e.target.value) || 0)
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                        Catatan
                      </Label>
                      <Input
                        value={newNotes}
                        onChange={(e) => setNewNotes(e.target.value)}
                        placeholder="Opsional..."
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowAddForm(false)}
                    >
                      Batal
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={handleAddItem}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      Tambah
                    </Button>
                  </div>
                </div>
              )}

              {/* Items table */}
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-[10px] font-bold uppercase">
                        Deskripsi
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase text-right">
                        Qty
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase">
                        Sat.
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase text-right">
                        Harga Sat.
                      </TableHead>
                      <TableHead className="text-[10px] font-bold uppercase text-right">
                        Total
                      </TableHead>
                      {isEditable && canManageItems && (
                        <TableHead className="w-8" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(job.job_costing_items as any[])?.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={isEditable && canManageItems ? 6 : 5}
                          className="text-center text-xs text-muted-foreground py-6"
                        >
                          Belum ada item.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (job.job_costing_items as any[])?.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-xs">
                            <p className="font-medium">{item.description}</p>
                            {item.notes && (
                              <p className="text-[10px] text-muted-foreground">
                                {item.notes}
                              </p>
                            )}
                            {item.po?.po_kode && (
                              <Badge
                                variant="outline"
                                className="text-[9px] mt-0.5"
                              >
                                PO: {item.po.po_kode}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            {item.qty}
                          </TableCell>
                          <TableCell className="text-xs">{item.unit}</TableCell>
                          <TableCell className="text-xs text-right">
                            {formatRupiah(item.unit_price)}
                          </TableCell>
                          <TableCell className="text-xs text-right font-bold">
                            {formatRupiah(item.qty * item.unit_price)}
                          </TableCell>
                          {isEditable && canManageItems && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteItem(item.id)}
                                disabled={actionLoading}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Total row */}
              <div className="flex justify-end">
                <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 min-w-45">
                  <div className="flex justify-between items-center gap-6">
                    <span className="text-xs font-bold uppercase text-muted-foreground">
                      Total
                    </span>
                    <span className="font-black text-base text-primary">
                      {formatRupiah(totalCost)}
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Status actions */}
              {canManageStatus && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase">
                    Ubah Status
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <Select value={statusDraft} onValueChange={setStatusDraft}>
                      <SelectTrigger className="h-8 text-xs w-full sm:w-45">
                        <SelectValue placeholder="Pilih status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => handleStatusChange(statusDraft)}
                      disabled={actionLoading || statusDraft === job.status}
                    >
                      {actionLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Simpan Status
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
