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
  XCircle,
  Truck,
  Package,
  User,
  Clock,
  PackageCheck,
  Printer,
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
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import {
  approveItemTransfer,
  rejectItemTransfer,
  updateItemTransferTracking,
  updateItemTransferTrackingModerator,
  finalizeItemTransfer,
} from "@/services/item-transfer-actions";

const TRACKING_ORDER = [
  "created",
  "packing",
  "ready_pickup",
  "in_transit",
  "delivered",
];
const TRACKING_LABEL: Record<string, string> = {
  created: "Item Transfer Dibuat",
  packing: "Packing",
  ready_pickup: "Siap Diambil",
  in_transit: "Dalam Pengiriman",
  delivered: "Barang Diterima",
  completed: "Selesai Final",
};
// Timeline lengkap (termasuk "completed") - mirip Delivery
const TRACKING_FULL_ORDER = [...TRACKING_ORDER, "completed"];
const isTrackingStepCompleted = (
  current: string | undefined,
  stepId: string,
) => {
  const ci = TRACKING_FULL_ORDER.indexOf(current || "created");
  const si = TRACKING_FULL_ORDER.indexOf(stepId);
  return ci > si;
};

interface Props {
  itId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUpdate?: () => void;
}

export function ItemTransferDetailSheet({
  itId,
  open,
  onOpenChange,
  onUpdate,
}: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [it, setIt] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [me, setMe] = useState<{ id: string; cabang_id: number | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigMode, setSigMode] = useState<"approve" | "finalize" | null>(null);
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [moderatorTrackingStatus, setModeratorTrackingStatus] =
    useState("created");
  const [moderatorTrackingNote, setModeratorTrackingNote] = useState("");

  const fetchData = async () => {
    if (!itId) return;
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
    const { data: itData } = await supabase
      .from("item_transfers")
      .select(
        "*, dari:cabang!dari_cabang_id(nama_cabang), tujuan:cabang!ke_cabang_id(nama_cabang)",
      )
      .eq("id", itId)
      .single();
    setIt(itData);
    setModeratorTrackingStatus(itData?.tracking_status || "created");
    setModeratorTrackingNote(itData?.tracking_note || "");
    const { data: itemData } = await supabase
      .from("item_transfer_items")
      .select("*")
      .eq("it_id", itId);
    setItems(itemData || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open && itId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itId]);

  const pendingApproval =
    it?.approvals?.find((a: any) => a.status === "pending") || null;
  const canApprove =
    it?.status === "open" && pendingApproval && pendingApproval.user_id === me?.id;
  const isSender = me?.cabang_id != null && me.cabang_id === it?.dari_cabang_id;
  const isReceiver = me?.cabang_id != null && me.cabang_id === it?.ke_cabang_id;
  const canTrack =
    it?.status === "approved" && it?.tracking_status !== "completed" && isSender;
  const canFinalize =
    it?.status === "approved" &&
    it?.tracking_status === "delivered" &&
    isReceiver;
  const nextTracking =
    it && TRACKING_ORDER.indexOf(it.tracking_status) >= 0
      ? TRACKING_ORDER[TRACKING_ORDER.indexOf(it.tracking_status) + 1]
      : null;

  const refresh = async () => {
    await fetchData();
    onUpdate?.();
  };

  const onSign = async (signature: any) => {
    if (!itId || !sigMode) return;
    setBusy(true);
    try {
      const res =
        sigMode === "approve"
          ? await approveItemTransfer(itId, signature.image_url)
          : await finalizeItemTransfer(itId, signature.id);
      if ((res as any).error) throw new Error((res as any).error);
      toast.success(
        sigMode === "approve" ? "Berhasil menyetujui" : "Barang dikonfirmasi diterima",
      );
      setSigMode(null);
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!itId) return;
    const reason = window.prompt("Alasan penolakan:");
    if (reason === null) return;
    setBusy(true);
    const res = await rejectItemTransfer(itId, reason || "-");
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("Item Transfer ditolak");
    await refresh();
  };

  const handleTrack = async () => {
    if (!itId || !nextTracking) return;
    setBusy(true);
    const res = await updateItemTransferTracking(itId, nextTracking);
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success(`Tracking: ${TRACKING_LABEL[nextTracking]}`);
    await refresh();
  };

  const isModeratorOrAdmin = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );

  const handleModeratorTrackingSave = async () => {
    if (!itId) return;
    setBusy(true);
    const res = await updateItemTransferTrackingModerator(
      itId,
      moderatorTrackingStatus,
      moderatorTrackingNote,
    );
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("Tracking status dan catatan berhasil diperbarui");
    await refresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-hidden">
        {loading || !it ? (
          <div className="flex-1 flex items-center justify-center">
            <SheetTitle className="sr-only">Memuat Item Transfer</SheetTitle>
            <SheetDescription className="sr-only">Memuat detail.</SheetDescription>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-muted/40 border-b space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" /> Item Transfer
                </span>
                <Badge
                  variant={
                    it.status === "rejected"
                      ? "destructive"
                      : it.status === "completed"
                        ? "default"
                        : "outline"
                  }
                  className="text-[10px] uppercase font-bold"
                >
                  {it.status}
                </Badge>
              </div>
              <SheetTitle className="text-xl font-bold uppercase tracking-tight">
                {it.it_kode}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Detail Item Transfer {it.it_kode}
              </SheetDescription>
              <div className="flex items-center gap-2 text-xs font-bold uppercase">
                {it.dari?.nama_cabang}
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <span className="text-success">{it.tujuan?.nama_cabang}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase">
                <User className="h-3 w-3" /> PIC: {it.pic || "-"}
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
                        <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                        <TableHead className="w-16 text-center text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((line) => (
                        <TableRow key={line.id} className="h-10">
                          <TableCell>
                            <span className="text-xs font-semibold">{line.part_name}</span>
                            <code className="block text-[10px] text-muted-foreground">{line.part_number}</code>
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
                <div className="flex justify-between"><span className="text-muted-foreground">Jenis</span><span className="font-semibold">{it.shipment_type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Ekspedisi/Kurir</span><span className="font-semibold">{it.ekspedisi || "-"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Koli</span><span className="font-semibold">{it.jumlah_koli}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Estimasi</span><span className="font-semibold">{it.estimasi_hari} hari</span></div>
                {it.no_resi && <div className="flex justify-between"><span className="text-muted-foreground">No. Resi</span><span className="font-semibold">{it.no_resi}</span></div>}
              </div>

              {/* Tracking Timeline (mirip Delivery) */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-orange-500 rounded-full" />
                  <h4 className="text-[11px] font-bold uppercase tracking-tight flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Status Pengiriman
                  </h4>
                </div>
                <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl space-y-3">
                  <div className="space-y-2.5">
                    {TRACKING_FULL_ORDER.map((stepId, idx) => {
                      const completed = isTrackingStepCompleted(
                        it.tracking_status,
                        stepId,
                      );
                      const current = it.tracking_status === stepId;
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

                  {it.status === "open" && (
                    <p className="text-[10px] font-medium text-orange-700/80 bg-white border border-orange-200 rounded-lg p-2.5">
                      Setujui Item Transfer dulu untuk mengubah status
                      pengiriman.
                    </p>
                  )}

                  {it.tracking_note && (
                    <div className="rounded-lg border border-orange-200 bg-white p-3">
                      <p className="text-[9px] font-bold text-orange-700 uppercase mb-1">
                        Catatan Tracking
                      </p>
                      <p className="text-[11px] font-medium text-slate-700 whitespace-pre-wrap">
                        {it.tracking_note}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Tracking override moderator/admin (mirip Delivery) - hanya setelah approved */}
              {isModeratorOrAdmin && it.status === "approved" && (
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

              {/* Approval timeline */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approval
                </h4>
                <div className="space-y-2">
                  {(it.approvals || []).map((a: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        {a.step_order}. {a.nama}
                        <span className="ml-1 text-[10px] text-muted-foreground">({a.role})</span>
                      </span>
                      <Badge
                        variant={
                          a.status === "approved"
                            ? "default"
                            : a.status === "rejected"
                              ? "destructive"
                              : "outline"
                        }
                        className="text-[9px] uppercase"
                      >
                        {a.status}
                      </Badge>
                    </div>
                  ))}
                </div>
                {it.status === "rejected" && it.rejection_reason && (
                  <p className="mt-2 text-[11px] text-destructive font-medium">
                    Alasan: {it.rejection_reason}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="border-t p-4 space-y-2 bg-background">
                {canApprove && (
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 gap-2"
                      disabled={busy}
                      onClick={() => {
                        setSigMode("approve");
                        setSigOpen(true);
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Setujui
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 gap-2 text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={handleReject}
                    >
                      <XCircle className="h-4 w-4" /> Tolak
                    </Button>
                  </div>
                )}
                {canFinalize && (
                  <Button
                    className="w-full gap-2 bg-success text-success-foreground hover:bg-success/90"
                    disabled={busy}
                    onClick={() => {
                      setSigMode("finalize");
                      setSigOpen(true);
                    }}
                  >
                    <PackageCheck className="h-4 w-4" /> Konfirmasi Barang Diterima
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() =>
                    itId && window.open(`/item-transfer/${itId}/print`, "_blank")
                  }
                >
                  <Printer className="h-4 w-4" /> Cetak
                </Button>
              </div>
          </>
        )}
      </SheetContent>

      <MRSignatureDialog
        open={sigOpen}
        onOpenChange={setSigOpen}
        onConfirm={onSign}
      />
    </Sheet>
  );
}
