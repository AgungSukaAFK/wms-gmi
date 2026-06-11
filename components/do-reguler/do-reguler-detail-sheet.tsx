"use client";

import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  ArrowRight,
  CheckCircle2,
  Truck,
  Package,
  User,
  Clock,
  FileText,
  XCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SHIPMENT_LABEL } from "@/lib/shipment";
import {
  deleteDoReguler,
  updateDoReguler,
  updateDoRegulerTracking,
  updateDoRegulerTrackingModerator,
  cancelDoReguler,
} from "@/services/do-reguler-actions";

const TRACKING_ORDER = [
  "created",
  "packing",
  "ready_pickup",
  "in_transit",
  "delivered",
];
const TRACKING_LABEL: Record<string, string> = {
  created: "DO Reguler Dibuat",
  packing: "Packing",
  ready_pickup: "Siap Diambil",
  in_transit: "Dalam Pengiriman",
  delivered: "Barang Diterima",
};
const isTrackingStepCompleted = (
  current: string | undefined,
  stepId: string,
) => {
  const ci = TRACKING_ORDER.indexOf(current || "created");
  const si = TRACKING_ORDER.indexOf(stepId);
  return ci > si;
};

interface Props {
  doId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUpdate?: () => void;
}

export function DoRegulerDetailSheet({
  doId,
  open,
  onOpenChange,
  onUpdate,
}: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [doRow, setDoRow] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [me, setMe] = useState<{ id: string; cabang_id: number | null } | null>(
    null,
  );
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [moderatorTrackingStatus, setModeratorTrackingStatus] =
    useState("created");
  const [moderatorTrackingNote, setModeratorTrackingNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    do_tanggal: "",
    kode_po: "",
    shipment_type: "ekspedisi",
    ekspedisi: "",
    sender_name: "",
    eksternal_provider: "",
    eksternal_id: "",
    jumlah_koli: "1",
    no_resi: "",
    estimasi_hari: "1",
    pic: "",
    remarks: "",
  });

  const fetchData = async () => {
    if (!doId) return;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("cabang_id, user_roles(roles(name))")
        .eq("id", user.id)
        .single();
      setMe({ id: user.id, cabang_id: profile?.cabang_id ?? null });
      const rNames = ((profile as any)?.user_roles || [])
        .map((row: any) => row?.roles?.name)
        .filter((name: string | undefined): name is string => Boolean(name));
      setRoleNames(rNames);
    }
    const { data: doData } = await supabase
      .from("do_reguler")
      .select(
        "*, dari:cabang!dari_cabang_id(nama_cabang), customer:customers!customer_id(customer_name, customer_no)",
      )
      .eq("id", doId)
      .single();
    setDoRow(doData);
    setModeratorTrackingStatus(doData?.tracking_status || "created");
    setModeratorTrackingNote(doData?.tracking_note || "");
    const { data: itemData } = await supabase
      .from("do_reguler_items")
      .select("*")
      .eq("do_id", doId);
    setItems(itemData || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open && doId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doId]);

  const isModerator = roleNames.some((r) => r === "moderator");
  const isModeratorOrAdmin = roleNames.some(
    (r) => r === "moderator" || r === "admin",
  );
  const isCreator = doRow?.uid_requester === me?.id;
  const isSenderStaff =
    me?.cabang_id != null && me.cabang_id === doRow?.dari_cabang_id;

  const canTrack =
    doRow?.status === "active" &&
    doRow?.tracking_status !== "delivered" &&
    (isModeratorOrAdmin || isCreator || isSenderStaff);
  const nextTracking =
    doRow && TRACKING_ORDER.indexOf(doRow.tracking_status) >= 0
      ? TRACKING_ORDER[TRACKING_ORDER.indexOf(doRow.tracking_status) + 1]
      : null;

  const refresh = async () => {
    await fetchData();
    onUpdate?.();
  };

  const openEditDialog = () => {
    if (!doRow) return;
    setEditForm({
      do_tanggal: doRow.do_tanggal ? String(doRow.do_tanggal).slice(0, 10) : "",
      kode_po: doRow.kode_po || "",
      shipment_type: doRow.shipment_type || "ekspedisi",
      ekspedisi: doRow.ekspedisi || "",
      sender_name: doRow.sender_name || "",
      eksternal_provider: doRow.eksternal_provider || "",
      eksternal_id: doRow.eksternal_id || "",
      jumlah_koli: String(doRow.jumlah_koli ?? 1),
      no_resi: doRow.no_resi || "",
      estimasi_hari: String(doRow.estimasi_hari ?? 1),
      pic: doRow.pic || "",
      remarks: doRow.remarks || "",
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!doId) return;
    setEditSaving(true);
    const res = await updateDoReguler(doId, {
      do_tanggal: editForm.do_tanggal || undefined,
      kode_po: editForm.kode_po || undefined,
      shipment_type: editForm.shipment_type,
      ekspedisi: editForm.ekspedisi || undefined,
      sender_name: editForm.sender_name || undefined,
      eksternal_provider: editForm.eksternal_provider || undefined,
      eksternal_id: editForm.eksternal_id || undefined,
      jumlah_koli: Number(editForm.jumlah_koli) || 1,
      no_resi: editForm.no_resi || undefined,
      estimasi_hari: Number(editForm.estimasi_hari) || 1,
      pic: editForm.pic || undefined,
      remarks: editForm.remarks || undefined,
    });
    setEditSaving(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("DO Reguler berhasil diperbarui");
    setEditOpen(false);
    await refresh();
  };

  const handleTrack = async () => {
    if (!doId || !nextTracking) return;
    setBusy(true);
    const res = await updateDoRegulerTracking(doId, nextTracking);
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success(`Tracking: ${TRACKING_LABEL[nextTracking]}`);
    await refresh();
  };

  const handleModeratorTrackingSave = async () => {
    if (!doId) return;
    setBusy(true);
    const res = await updateDoRegulerTrackingModerator(
      doId,
      moderatorTrackingStatus,
      moderatorTrackingNote,
    );
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("Tracking status dan catatan berhasil diperbarui");
    await refresh();
  };

  const handleCancel = async () => {
    if (!doId) return;
    const reason = window.prompt(
      "Alasan pembatalan DO (stok dikembalikan ke gudang pengirim):",
    );
    if (reason === null) return;
    setBusy(true);
    const res = await cancelDoReguler(doId, reason || "-");
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("DO Reguler dibatalkan, stok dikembalikan");
    await refresh();
  };

  const handleDelete = async () => {
    if (!doId || !doRow) return;
    const ok = window.confirm(
      `Hapus DO Reguler ${doRow.do_kode}?\n\n` +
        "Semua item detail akan ikut terhapus. Jika stok sudah keluar, stok pengirim akan dikembalikan dulu sebelum DO dihapus.",
    );
    if (!ok) return;
    setBusy(true);
    const res = await deleteDoReguler(doId);
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("DO Reguler berhasil dihapus");
    onOpenChange(false);
    await refresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-hidden">
        {loading || !doRow ? (
          <div className="flex-1 flex items-center justify-center">
            <SheetTitle className="sr-only">Memuat DO Reguler</SheetTitle>
            <SheetDescription className="sr-only">
              Memuat detail.
            </SheetDescription>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-muted/40 border-b space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" /> DO Reguler
                </span>
                <Badge
                  variant={
                    doRow.status === "cancelled"
                      ? "destructive"
                      : doRow.status === "completed"
                        ? "default"
                        : "outline"
                  }
                  className="text-[10px] uppercase font-bold"
                >
                  {doRow.status === "active"
                    ? "Aktif"
                    : doRow.status === "completed"
                      ? "Selesai"
                      : "Dibatalkan"}
                </Badge>
              </div>
              <SheetTitle className="text-xl font-bold uppercase tracking-tight">
                {doRow.do_kode}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Detail DO Reguler {doRow.do_kode}
              </SheetDescription>
              <div className="flex items-center gap-2 text-xs font-bold uppercase">
                {doRow.dari?.nama_cabang}
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <span className="text-success">
                  {doRow.customer?.customer_name}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium text-muted-foreground uppercase">
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" /> PO: {doRow.kode_po || "-"}
                </span>
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" /> PIC: {doRow.pic || "-"}
                </span>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Items */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" /> Item
                </h4>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="h-8 hover:bg-transparent">
                        <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                          Part
                        </TableHead>
                        <TableHead className="w-16 text-center text-[10px] font-black uppercase text-muted-foreground">
                          Qty
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((line) => (
                        <TableRow key={line.id} className="h-10">
                          <TableCell>
                            <span className="text-xs font-semibold">
                              {line.part_name}
                            </span>
                            <code className="block text-[10px] text-muted-foreground">
                              {line.part_number}
                            </code>
                          </TableCell>
                          <TableCell className="text-center text-xs font-bold">
                            {line.qty} {line.satuan}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Shipment */}
              <div className="text-xs space-y-1.5">
                <h4 className="text-[10px] font-black uppercase text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" /> Pengiriman
                </h4>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Jenis</span>
                  <span className="font-semibold">
                    {SHIPMENT_LABEL[doRow.shipment_type] || doRow.shipment_type}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ekspedisi/Kurir</span>
                  <span className="font-semibold">
                    {doRow.ekspedisi || "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Koli</span>
                  <span className="font-semibold">{doRow.jumlah_koli}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimasi</span>
                  <span className="font-semibold">
                    {doRow.estimasi_hari} hari
                  </span>
                </div>
                {doRow.no_resi && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">No. Resi</span>
                    <span className="font-semibold">{doRow.no_resi}</span>
                  </div>
                )}
              </div>

              {/* Tracking Timeline */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-orange-500 rounded-full" />
                  <h4 className="text-[11px] font-bold uppercase tracking-tight flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Status Pengiriman
                  </h4>
                </div>
                <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl space-y-3">
                  <div className="space-y-2.5">
                    {TRACKING_ORDER.map((stepId, idx) => {
                      const completed = isTrackingStepCompleted(
                        doRow.tracking_status,
                        stepId,
                      );
                      const current = doRow.tracking_status === stepId;
                      return (
                        <div key={stepId} className="flex items-center gap-3">
                          <div
                            className={cn(
                              "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0",
                              completed
                                ? "bg-green-500 text-white"
                                : current
                                  ? "bg-orange-500 text-white"
                                  : "bg-slate-100 text-slate-400",
                            )}
                          >
                            {completed ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <span>{idx + 1}</span>
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-xs font-bold flex-1",
                              current
                                ? "text-orange-600"
                                : completed
                                  ? "text-green-600"
                                  : "text-slate-400",
                            )}
                          >
                            {TRACKING_LABEL[stepId]}
                          </span>
                          {current && (
                            <Badge className="text-[9px] font-bold bg-orange-100 text-orange-700 border-0">
                              Sekarang
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {canTrack && nextTracking && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 text-xs font-bold border-orange-200 text-orange-700 hover:bg-orange-50"
                      disabled={busy}
                      onClick={handleTrack}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Lanjutkan ke Tahap Berikutnya
                    </Button>
                  )}

                  {doRow.status === "cancelled" && (
                    <p className="text-[10px] font-medium text-destructive bg-white border border-destructive/30 rounded-lg p-2.5">
                      DO ini sudah dibatalkan. Stok telah dikembalikan ke gudang
                      pengirim.
                      {doRow.cancel_reason
                        ? ` Alasan: ${doRow.cancel_reason}`
                        : ""}
                    </p>
                  )}

                  {doRow.tracking_note && (
                    <div className="rounded-lg border border-orange-200 bg-white p-3">
                      <p className="text-[9px] font-bold text-orange-700 uppercase mb-1">
                        Catatan Tracking
                      </p>
                      <p className="text-[11px] font-medium text-slate-700 whitespace-pre-wrap">
                        {doRow.tracking_note}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Tracking override moderator/admin */}
              {isModeratorOrAdmin && doRow.status !== "cancelled" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 bg-indigo-500 rounded-full" />
                    <h4 className="text-[11px] font-bold uppercase tracking-tight">
                      Tracking Moderator/Admin
                    </h4>
                  </div>
                  <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-3">
                    <Select
                      value={moderatorTrackingStatus}
                      onValueChange={setModeratorTrackingStatus}
                      disabled={busy}
                    >
                      <SelectTrigger className="h-10 bg-white border-indigo-200 font-bold text-xs uppercase rounded-lg">
                        <SelectValue placeholder="Pilih status tracking" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRACKING_ORDER.map((s) => (
                          <SelectItem
                            key={s}
                            value={s}
                            className="text-xs font-bold uppercase"
                          >
                            {TRACKING_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Textarea
                      value={moderatorTrackingNote}
                      onChange={(e) => setModeratorTrackingNote(e.target.value)}
                      placeholder="Catatan tracking custom (opsional)"
                      className="min-h-20 bg-white border-indigo-200 text-xs"
                      disabled={busy}
                    />

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 text-xs font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                      onClick={handleModeratorTrackingSave}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Simpan Tracking + Catatan
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            {isModerator && doRow.status !== "cancelled" && (
              <div className="border-t p-4 bg-background">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    disabled={busy}
                    onClick={openEditDialog}
                  >
                    Edit Data
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={handleDelete}
                  >
                    <XCircle className="h-4 w-4" /> Hapus
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="mt-2 w-full gap-2 text-orange-700 hover:text-orange-700"
                  disabled={busy}
                  onClick={handleCancel}
                >
                  <XCircle className="h-4 w-4" /> Batalkan DO (Kembalikan Stok)
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit DO Reguler</DialogTitle>
            <DialogDescription>
              Moderator/admin dapat memperbarui metadata DO tanpa mengubah item.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="do_tanggal">Tanggal DO</Label>
              <Input
                id="do_tanggal"
                type="date"
                value={editForm.do_tanggal}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    do_tanggal: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kode_po">Kode PO</Label>
              <Input
                id="kode_po"
                value={editForm.kode_po}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, kode_po: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shipment_type">Shipment Type</Label>
              <Input
                id="shipment_type"
                value={editForm.shipment_type}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    shipment_type: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ekspedisi">Ekspedisi</Label>
              <Input
                id="ekspedisi"
                value={editForm.ekspedisi}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    ekspedisi: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sender_name">Sender Name</Label>
              <Input
                id="sender_name"
                value={editForm.sender_name}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    sender_name: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pic">PIC</Label>
              <Input
                id="pic"
                value={editForm.pic}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, pic: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jumlah_koli">Jumlah Koli</Label>
              <Input
                id="jumlah_koli"
                type="number"
                value={editForm.jumlah_koli}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    jumlah_koli: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="estimasi_hari">Estimasi Hari</Label>
              <Input
                id="estimasi_hari"
                type="number"
                value={editForm.estimasi_hari}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    estimasi_hari: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eksternal_provider">Eksternal Provider</Label>
              <Input
                id="eksternal_provider"
                value={editForm.eksternal_provider}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    eksternal_provider: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eksternal_id">Eksternal ID</Label>
              <Input
                id="eksternal_id"
                value={editForm.eksternal_id}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    eksternal_id: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="no_resi">No Resi</Label>
              <Input
                id="no_resi"
                value={editForm.no_resi}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, no_resi: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="remarks">Remarks</Label>
              <Textarea
                id="remarks"
                value={editForm.remarks}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, remarks: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
