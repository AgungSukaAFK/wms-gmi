"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { SHIPMENT_LABEL } from "@/lib/shipment";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import {
  approveItemTransfer,
  rejectItemTransfer,
  updateItemTransferTracking,
  updateItemTransferTrackingModerator,
  finalizeItemTransfer,
} from "@/services/item-transfer-actions";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  Printer,
  RefreshCw,
  Truck,
  User,
  Users,
  Package,
  PackageCheck,
  Loader2,
  Hash,
  Boxes,
  AlertCircle,
  StickyNote,
} from "lucide-react";

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
const TRACKING_FULL_ORDER = [...TRACKING_ORDER, "completed"];
const isTrackingStepCompleted = (
  current: string | undefined,
  stepId: string,
) => {
  const ci = TRACKING_FULL_ORDER.indexOf(current || "created");
  const si = TRACKING_FULL_ORDER.indexOf(stepId);
  return ci > si;
};

export default function ItemTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: itId } = use(params);
  const supabase = createClient();

  const [it, setIt] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [me, setMe] = useState<{ id: string; cabang_id: number | null } | null>(
    null,
  );
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [sigOpen, setSigOpen] = useState(false);
  const [sigMode, setSigMode] = useState<"approve" | "finalize" | null>(null);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const [moderatorTrackingStatus, setModeratorTrackingStatus] =
    useState("created");
  const [moderatorTrackingNote, setModeratorTrackingNote] = useState("");

  useEffect(() => {
    if (itId) {
      fetchDetails();
      fetchCurrentUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itId]);

  const fetchCurrentUser = async () => {
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
  };

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const { data: itData } = await supabase
        .from("item_transfers")
        .select(
          "*, dari:cabang!dari_cabang_id(nama_cabang, kode_cabang), tujuan:cabang!ke_cabang_id(nama_cabang, kode_cabang)",
        )
        .eq("id", itId)
        .single();
      setIt(itData);
      setModeratorTrackingStatus(itData?.tracking_status || "created");
      setModeratorTrackingNote(itData?.tracking_note || "");

      const { data: itemData } = await supabase
        .from("item_transfer_items")
        .select("*")
        .eq("it_id", itId)
        .order("created_at");
      setItems(itemData || []);

      const uids = Array.from(
        new Set(
          [
            itData?.uid_requester,
            itData?.uid_pic,
            itData?.uid_receiver,
            itData?.tracking_note_updated_by,
          ].filter(Boolean),
        ),
      );
      if (uids.length > 0) {
        const { data: profRows } = await supabase
          .from("profiles")
          .select("id, nama")
          .in("id", uids);
        const map: Record<string, string> = {};
        (profRows || []).forEach((p: any) => (map[p.id] = p.nama));
        setProfilesMap(map);
      } else {
        setProfilesMap({});
      }
    } finally {
      setLoading(false);
    }
  };

  const pendingApproval =
    it?.approvals?.find((a: any) => a.status === "pending") || null;
  const canApprove =
    it?.status === "open" &&
    pendingApproval &&
    pendingApproval.user_id === me?.id;
  const isSender = me?.cabang_id != null && me.cabang_id === it?.dari_cabang_id;
  const isReceiver = me?.cabang_id != null && me.cabang_id === it?.ke_cabang_id;
  const canTrack =
    it?.status === "approved" &&
    it?.tracking_status !== "completed" &&
    isSender;
  const canFinalize =
    it?.status === "approved" &&
    it?.tracking_status === "delivered" &&
    isReceiver;
  const nextTracking =
    it && TRACKING_ORDER.indexOf(it.tracking_status) >= 0
      ? TRACKING_ORDER[TRACKING_ORDER.indexOf(it.tracking_status) + 1]
      : null;
  const isModeratorOrAdmin = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );

  const onSign = async (signature: any) => {
    if (!itId || !sigMode) return;
    setBusy(true);
    try {
      const res =
        sigMode === "approve"
          ? await approveItemTransfer(Number(itId), signature.image_url)
          : await finalizeItemTransfer(Number(itId), signature.id);
      if ((res as any).error) throw new Error((res as any).error);
      toast.success(
        sigMode === "approve"
          ? "Berhasil menyetujui"
          : "Barang dikonfirmasi diterima",
      );
      setSigMode(null);
      await fetchDetails();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("Alasan penolakan wajib diisi");
      return;
    }
    setBusy(true);
    const res = await rejectItemTransfer(Number(itId), rejectionReason);
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("Item Transfer ditolak");
    setRejectDialogOpen(false);
    setRejectionReason("");
    await fetchDetails();
  };

  const handleTrack = async () => {
    if (!nextTracking) return;
    setBusy(true);
    const res = await updateItemTransferTracking(Number(itId), nextTracking);
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success(`Tracking: ${TRACKING_LABEL[nextTracking]}`);
    await fetchDetails();
  };

  const handleModeratorTrackingSave = async () => {
    setBusy(true);
    const res = await updateItemTransferTrackingModerator(
      Number(itId),
      moderatorTrackingStatus,
      moderatorTrackingNote,
    );
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("Tracking status dan catatan berhasil diperbarui");
    await fetchDetails();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-bold text-[10px] uppercase"
          >
            Menunggu Approval
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success/10 text-success border-none font-bold text-[10px] uppercase">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="font-bold text-[10px] uppercase">
            Rejected
          </Badge>
        );
      case "completed":
      case "done":
        return (
          <Badge className="bg-foreground text-background font-bold text-[10px] uppercase">
            Selesai
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="font-bold text-[10px] uppercase">
            {status}
          </Badge>
        );
    }
  };

  if (loading && !it) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-bold uppercase tracking-widest animate-pulse">
            Memuat Item Transfer...
          </p>
        </div>
      </div>
    );
  }

  if (!loading && !it) {
    return (
      <Content>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <ArrowLeftRight className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-bold text-foreground uppercase">
              Item Transfer tidak ditemukan
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Dokumen dengan ID ini tidak ada atau sudah dihapus.
            </p>
          </div>
          <Link href="/item-transfer">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Kembali ke Daftar Item Transfer
            </Button>
          </Link>
        </div>
      </Content>
    );
  }

  const totalQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/item-transfer">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                  {it?.it_kode}
                </h1>
                {getStatusBadge(it?.status)}
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 flex items-center gap-1.5 flex-wrap">
                {it?.dari?.nama_cabang}
                <ArrowRight className="h-3 w-3 text-primary" />
                <span className="text-success">{it?.tujuan?.nama_cabang}</span>
                <span className="mx-1">·</span>
                <User className="h-3 w-3" /> {it?.pic || "-"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={() => window.open(`/item-transfer/${itId}/print`, "_blank")}
              variant="outline"
              size="sm"
              className="gap-2 font-semibold"
            >
              <Printer className="h-4 w-4" /> Cetak
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={fetchDetails}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </Content>

      <Content title="Informasi Item Transfer">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Tanggal
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              {it?.it_tanggal ? formatDate(it.it_tanggal) : "-"}
            </div>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Gudang Asal
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              {it?.dari?.nama_cabang || "-"}
            </div>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Gudang Tujuan
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-success">
              <Building2 className="h-3 w-3 text-success/70" />
              {it?.tujuan?.nama_cabang || "-"}
            </div>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              PIC
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <User className="h-3 w-3 text-muted-foreground" />
              {it?.pic || "-"}
            </div>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Penerima
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <Users className="h-3 w-3 text-muted-foreground" />
              {(it?.uid_receiver && profilesMap[it.uid_receiver]) || "-"}
            </div>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Dibuat Oleh
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <User className="h-3 w-3 text-muted-foreground" />
              {(it?.uid_requester && profilesMap[it.uid_requester]) || "-"}
            </div>
          </div>
          {it?.remarks && (
            <div className="sm:col-span-2 lg:col-span-3 bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1 flex items-center gap-1.5">
                <StickyNote className="h-3 w-3" /> Keterangan
              </p>
              <p className="text-[11px] text-foreground whitespace-pre-wrap">
                {it.remarks}
              </p>
            </div>
          )}
        </div>
      </Content>

      <Content title="Informasi Pengiriman">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Jenis Pengiriman
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <Truck className="h-3 w-3 text-muted-foreground" />
              {SHIPMENT_LABEL[it?.shipment_type] || it?.shipment_type || "-"}
            </div>
          </div>
          {it?.ekspedisi && (
            <div className="bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                Kurir / Ekspedisi
              </p>
              <p className="text-[11px] font-bold text-foreground">
                {it.ekspedisi}
              </p>
            </div>
          )}
          {it?.no_resi && (
            <div className="bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                No. Resi
              </p>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                <Hash className="h-3 w-3 text-muted-foreground" />
                {it.no_resi}
              </div>
            </div>
          )}
          {it?.sender_name && (
            <div className="bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                Nama Pengantar
              </p>
              <p className="text-[11px] font-bold text-foreground">
                {it.sender_name}
              </p>
            </div>
          )}
          {it?.eksternal_provider && (
            <div className="bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                Penyedia Handcarry
              </p>
              <p className="text-[11px] font-bold text-foreground">
                {it.eksternal_provider}
              </p>
            </div>
          )}
          {it?.eksternal_id && (
            <div className="bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                Order / Booking ID
              </p>
              <p className="text-[11px] font-bold text-foreground">
                {it.eksternal_id}
              </p>
            </div>
          )}
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Jumlah Koli
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <Boxes className="h-3 w-3 text-muted-foreground" />
              {it?.jumlah_koli ?? "-"}
            </div>
          </div>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
              Estimasi
            </p>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {it?.estimasi_hari ?? "-"} hari
            </div>
          </div>
        </div>
      </Content>

      <Content title="Status Pengiriman">
        <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl space-y-3">
          <div className="space-y-2.5">
            {TRACKING_FULL_ORDER.map((stepId, idx) => {
              const completed = isTrackingStepCompleted(
                it?.tracking_status,
                stepId,
              );
              const current = it?.tracking_status === stepId;
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

          {it?.status === "open" && (
            <p className="text-[10px] font-medium text-orange-700/80 bg-white border border-orange-200 rounded-lg p-2.5">
              Setujui Item Transfer dulu untuk mengubah status pengiriman.
            </p>
          )}

          {it?.tracking_note && (
            <div className="rounded-lg border border-orange-200 bg-white p-3">
              <p className="text-[9px] font-bold text-orange-700 uppercase mb-1">
                Catatan Tracking
              </p>
              <p className="text-[11px] font-medium text-slate-700 whitespace-pre-wrap">
                {it.tracking_note}
              </p>
              {it.tracking_note_updated_by && (
                <p className="text-[9px] text-slate-400 font-medium mt-1.5">
                  Diperbarui oleh{" "}
                  {profilesMap[it.tracking_note_updated_by] || "-"}
                  {it.tracking_note_updated_at &&
                    ` · ${formatDateTime(it.tracking_note_updated_at)}`}
                </p>
              )}
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
        </div>

        {isModeratorOrAdmin && it?.status === "approved" && (
          <div className="mt-4 space-y-3">
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
      </Content>

      {it?.approvals && it.approvals.length > 0 && (
        <Content title="Alur Approval">
          <div className="space-y-2">
            {(it.approvals as any[]).map((step: any, i: number) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-all",
                  step.status === "approved"
                    ? "bg-success/5 border-success/20"
                    : step.status === "rejected"
                      ? "bg-destructive/5 border-destructive/20"
                      : "bg-muted/40 border-border",
                )}
              >
                <div className="shrink-0">
                  {step.status === "approved" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : step.status === "rejected" ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-foreground truncate">
                    {step.step_order ? `${step.step_order}. ` : ""}
                    {step.nama}
                  </p>
                  <p className="text-[9px] text-muted-foreground font-medium uppercase">
                    {step.role}
                  </p>
                  {step.notes && (
                    <p className="text-[9px] text-destructive mt-1 italic">
                      &ldquo;{step.notes}&rdquo;
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {step.status === "pending" ? (
                    <Badge variant="outline" className="text-[9px] font-bold uppercase">
                      Menunggu
                    </Badge>
                  ) : (
                    <p className="text-[9px] text-muted-foreground font-medium">
                      {step.processed_at ? formatDate(step.processed_at) : ""}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {it.status === "rejected" && it.rejection_reason && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-[9px] font-bold uppercase text-destructive mb-1">
                  Alasan Penolakan
                </p>
                <p className="text-[11px] font-medium text-foreground whitespace-pre-wrap">
                  {it.rejection_reason}
                </p>
              </div>
            )}

            {canApprove && (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl space-y-3">
                <div className="flex items-start gap-2 text-[10px] text-primary font-bold uppercase">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  Giliran Anda untuk menyetujui Item Transfer ini
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 gap-2 font-bold text-xs uppercase"
                    disabled={busy}
                    onClick={() => {
                      setSigMode("approve");
                      setSigOpen(true);
                    }}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ThumbsUp className="h-3.5 w-3.5" />
                    )}
                    Setuju
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1 gap-2 font-bold text-xs uppercase"
                    disabled={busy}
                    onClick={() => setRejectDialogOpen(true)}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                    Tolak
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Content>
      )}

      <Content
        title="Daftar Item"
        description={`${items.length} item · Total qty ${totalQty}`}
      >
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-9 hover:bg-transparent">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground pl-4">
                  Part Number
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Nama Barang
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-right pr-4">
                  Qty
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="h-24 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Tidak ada item
                  </TableCell>
                </TableRow>
              ) : (
                items.map((line) => (
                  <TableRow key={line.id} className="h-12">
                    <TableCell className="pl-4">
                      <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-black text-foreground">
                        {line.part_number}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                        {line.part_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <span className="text-xs font-bold text-foreground">
                        {line.qty}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-1 uppercase">
                        {line.satuan}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Item Transfer</DialogTitle>
            <DialogDescription>
              Berikan alasan penolakan Item Transfer{" "}
              <strong>{it?.it_kode}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              placeholder="Alasan penolakan..."
              className="min-h-24 resize-none"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectDialogOpen(false);
                setRejectionReason("");
              }}
              disabled={busy}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={busy || !rejectionReason.trim()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Konfirmasi Tolak"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MRSignatureDialog
        open={sigOpen}
        onOpenChange={setSigOpen}
        onConfirm={onSign}
      />
    </>
  );
}
