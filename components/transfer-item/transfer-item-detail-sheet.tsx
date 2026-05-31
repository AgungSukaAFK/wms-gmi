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
} from "lucide-react";
import { toast } from "sonner";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import {
  approveTransferItem,
  rejectTransferItem,
  updateTransferItemTracking,
  finalizeTransferItem,
} from "@/services/transfer-actions";

const TRACKING_ORDER = [
  "created",
  "packing",
  "ready_pickup",
  "in_transit",
  "delivered",
];
const TRACKING_LABEL: Record<string, string> = {
  created: "Dibuat",
  packing: "Packing",
  ready_pickup: "Siap Diambil",
  in_transit: "Dalam Perjalanan",
  delivered: "Barang Diterima",
  completed: "Selesai",
};

interface Props {
  tiId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUpdate?: () => void;
}

export function TransferItemDetailSheet({
  tiId,
  open,
  onOpenChange,
  onUpdate,
}: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [ti, setTi] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [me, setMe] = useState<{ id: string; cabang_id: number | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [sigMode, setSigMode] = useState<"approve" | "finalize" | null>(null);

  const fetchData = async () => {
    if (!tiId) return;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("cabang_id")
        .eq("id", user.id)
        .single();
      setMe({ id: user.id, cabang_id: profile?.cabang_id ?? null });
    }
    const { data: tiData } = await supabase
      .from("transfer_items")
      .select(
        "*, dari:cabang!dari_cabang_id(nama_cabang), tujuan:cabang!ke_cabang_id(nama_cabang)",
      )
      .eq("id", tiId)
      .single();
    setTi(tiData);
    const { data: itemData } = await supabase
      .from("transfer_item_items")
      .select("*")
      .eq("ti_id", tiId);
    setItems(itemData || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open && tiId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tiId]);

  const pendingApproval =
    ti?.approvals?.find((a: any) => a.status === "pending") || null;
  const canApprove =
    ti?.status === "open" && pendingApproval && pendingApproval.user_id === me?.id;
  const isSender = me?.cabang_id != null && me.cabang_id === ti?.dari_cabang_id;
  const isReceiver = me?.cabang_id != null && me.cabang_id === ti?.ke_cabang_id;
  const canTrack =
    ti?.status === "approved" && ti?.tracking_status !== "completed" && isSender;
  const canFinalize =
    ti?.status === "approved" &&
    ti?.tracking_status === "delivered" &&
    isReceiver;
  const nextTracking =
    ti && TRACKING_ORDER.indexOf(ti.tracking_status) >= 0
      ? TRACKING_ORDER[TRACKING_ORDER.indexOf(ti.tracking_status) + 1]
      : null;

  const refresh = async () => {
    await fetchData();
    onUpdate?.();
  };

  const onSign = async (signature: any) => {
    if (!tiId || !sigMode) return;
    setBusy(true);
    try {
      const res =
        sigMode === "approve"
          ? await approveTransferItem(tiId, signature.image_url)
          : await finalizeTransferItem(tiId, signature.id);
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
    if (!tiId) return;
    const reason = window.prompt("Alasan penolakan:");
    if (reason === null) return;
    setBusy(true);
    const res = await rejectTransferItem(tiId, reason || "-");
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("Transfer Item ditolak");
    await refresh();
  };

  const handleTrack = async () => {
    if (!tiId || !nextTracking) return;
    setBusy(true);
    const res = await updateTransferItemTracking(tiId, nextTracking);
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success(`Tracking: ${TRACKING_LABEL[nextTracking]}`);
    await refresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-hidden">
        {loading || !ti ? (
          <div className="flex-1 flex items-center justify-center">
            <SheetTitle className="sr-only">Memuat Transfer Item</SheetTitle>
            <SheetDescription className="sr-only">Memuat detail.</SheetDescription>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-muted/40 border-b space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" /> Transfer Item
                </span>
                <Badge
                  variant={
                    ti.status === "rejected"
                      ? "destructive"
                      : ti.status === "completed"
                        ? "default"
                        : "outline"
                  }
                  className="text-[10px] uppercase font-bold"
                >
                  {ti.status}
                </Badge>
              </div>
              <SheetTitle className="text-xl font-bold uppercase tracking-tight">
                {ti.ti_kode}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Detail Transfer Item {ti.ti_kode}
              </SheetDescription>
              <div className="flex items-center gap-2 text-xs font-bold uppercase">
                {ti.dari?.nama_cabang}
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <span className="text-success">{ti.tujuan?.nama_cabang}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase">
                <User className="h-3 w-3" /> PIC: {ti.pic || "-"}
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
                      {items.map((it) => (
                        <TableRow key={it.id} className="h-10">
                          <TableCell>
                            <span className="text-xs font-semibold">{it.part_name}</span>
                            <code className="block text-[10px] text-muted-foreground">{it.part_number}</code>
                          </TableCell>
                          <TableCell className="text-center text-xs font-bold">
                            {it.qty} {it.satuan}
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
                <div className="flex justify-between"><span className="text-muted-foreground">Jenis</span><span className="font-semibold">{ti.shipment_type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Ekspedisi/Kurir</span><span className="font-semibold">{ti.ekspedisi || "-"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Koli</span><span className="font-semibold">{ti.jumlah_koli}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Estimasi</span><span className="font-semibold">{ti.estimasi_hari} hari</span></div>
                {ti.no_resi && <div className="flex justify-between"><span className="text-muted-foreground">No. Resi</span><span className="font-semibold">{ti.no_resi}</span></div>}
              </div>

              {/* Tracking */}
              {ti.status === "approved" && (
                <div>
                  <h4 className="text-[10px] font-black uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Tracking
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {TRACKING_ORDER.map((t) => {
                      const idx = TRACKING_ORDER.indexOf(t);
                      const cur = TRACKING_ORDER.indexOf(ti.tracking_status);
                      const done = ti.tracking_status === "completed" || idx <= cur;
                      return (
                        <Badge key={t} variant={done ? "default" : "outline"} className="text-[9px] uppercase">
                          {TRACKING_LABEL[t]}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Approval timeline */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approval
                </h4>
                <div className="space-y-2">
                  {(ti.approvals || []).map((a: any, i: number) => (
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
                {ti.status === "rejected" && ti.rejection_reason && (
                  <p className="mt-2 text-[11px] text-destructive font-medium">
                    Alasan: {ti.rejection_reason}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            {(canApprove || canTrack || canFinalize) && (
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
                {canTrack && nextTracking && (
                  <Button className="w-full gap-2" variant="outline" disabled={busy} onClick={handleTrack}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                    Lanjut ke: {TRACKING_LABEL[nextTracking]}
                  </Button>
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
              </div>
            )}
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
