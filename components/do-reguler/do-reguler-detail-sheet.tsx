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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-hidden">
        {loading || !doRow ? (
          <div className="flex-1 flex items-center justify-center">
            <SheetTitle className="sr-only">Memuat DO Reguler</SheetTitle>
            <SheetDescription className="sr-only">Memuat detail.</SheetDescription>
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
                <div className="flex justify-between"><span className="text-muted-foreground">Jenis</span><span className="font-semibold">{SHIPMENT_LABEL[doRow.shipment_type] || doRow.shipment_type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Ekspedisi/Kurir</span><span className="font-semibold">{doRow.ekspedisi || "-"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Koli</span><span className="font-semibold">{doRow.jumlah_koli}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Estimasi</span><span className="font-semibold">{doRow.estimasi_hari} hari</span></div>
                {doRow.no_resi && <div className="flex justify-between"><span className="text-muted-foreground">No. Resi</span><span className="font-semibold">{doRow.no_resi}</span></div>}
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
                      {doRow.cancel_reason ? ` Alasan: ${doRow.cancel_reason}` : ""}
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
                <Button
                  variant="outline"
                  className="w-full gap-2 text-destructive hover:text-destructive"
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
    </Sheet>
  );
}
