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
import { toast } from "sonner";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { SHIPMENT_LABEL } from "@/lib/shipment";
import { KoliDetailView } from "@/components/shipment/koli-detail-view";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { ItemTransferTrackingControl } from "@/components/item-transfer/item-transfer-tracking-control";
import { EditItemTransferDialog } from "@/components/item-transfer/edit-item-transfer-dialog";
import { ModeratorEditLogPanel } from "@/components/moderator/moderator-edit-log-panel";
import {
  approveItemTransfer,
  rejectItemTransfer,
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
  Pencil,
  ShieldAlert,
  History,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";

const STATUS_LABELS: Record<string, string> = { open: "Menunggu Approval", completed: "Selesai", done: "Selesai" };

export default function ItemTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: itId } = use(params);
  const supabase = createClient();

  const [it, setIt] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [kodeHistory, setKodeHistory] = useState<any[]>([]);
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

  const [editMode, setEditMode] = useState<"regular" | "moderator" | null>(null);
  const [modLogRefreshKey, setModLogRefreshKey] = useState(0);

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
          "*, dari:cabang!dari_cabang_id(nama_cabang, kode_cabang), tujuan:cabang!ke_cabang_id(nama_cabang, kode_cabang), vendor:vendors!it_vendor_id(vendor_name)",
        )
        .eq("id", itId)
        .single();
      setIt(itData);

      const { data: itemData } = await supabase
        .from("item_transfer_items")
        .select("*")
        .eq("it_id", itId)
        .order("created_at");
      setItems(itemData || []);

      // Error diabaikan: DB yang belum menjalankan migration 20261029110000
      // belum punya tabel ini.
      const { data: kodeRows, error: kodeErr } = await supabase
        .from("item_transfer_kode_history")
        .select("id, old_kode, new_kode, stock_movements_updated, consignment_movements_updated, changed_by, changed_at")
        .eq("it_id", itId)
        .order("changed_at", { ascending: false });
      const history = kodeErr ? [] : kodeRows || [];
      setKodeHistory(history);

      const uids = Array.from(
        new Set(
          [
            itData?.uid_requester,
            itData?.uid_pic,
            itData?.uid_receiver,
            itData?.tracking_note_updated_by,
            ...history.map((h: any) => h.changed_by),
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
    ["in_transit", "delivered"].includes(it?.tracking_status) &&
    isReceiver;
  const isModeratorOrAdmin = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );
  const isModerator = roleNames.includes("moderator");
  // Edit biasa (seperti Edit Isi MR): pembuat atau approver "menyetujui" yang
  // sedang giliran, selama stok belum keluar.
  const pendingIsMe =
    !!me &&
    !!pendingApproval &&
    (pendingApproval.user_id === me.id || pendingApproval.userid === me.id);
  const canEditRegular =
    it?.status === "open" &&
    !it?.stock_released &&
    !!me &&
    (it?.uid_requester === me.id ||
      it?.created_by === me.id ||
      (pendingIsMe &&
        (pendingApproval.level ?? pendingApproval.approval_role ?? "menyetujui") !==
          "mengetahui"));

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
                <StatusBadge status={it?.status} label={STATUS_LABELS[it?.status ?? ""]} tone="solid" />
                {it?.it_is_consignment && (
                  <Badge variant="outline" className="text-[10px] font-bold border-violet-300 text-violet-700">
                    Konsinyasi · {it?.vendor?.vendor_name}
                  </Badge>
                )}
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
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {canEditRegular && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 font-semibold border-blue-200 text-blue-600 hover:bg-blue-50"
                onClick={() => setEditMode("regular")}
              >
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            {isModerator && it && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 font-semibold border-warning/40 text-warning hover:bg-warning/10"
                onClick={() => setEditMode("moderator")}
              >
                <ShieldAlert className="h-4 w-4" /> Moderator Edit
              </Button>
            )}
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
          {kodeHistory.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-3 bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <History className="h-3 w-3" /> Riwayat Kode
              </p>
              <div className="space-y-1">
                {kodeHistory.map((h) => {
                  const refCount =
                    (h.stock_movements_updated || 0) + (h.consignment_movements_updated || 0);
                  return (
                    <div key={h.id} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="font-mono font-bold text-muted-foreground line-through">
                        {h.old_kode}
                      </span>
                      <ArrowRight className="h-3 w-3 text-primary" />
                      <span className="font-mono font-bold text-foreground">{h.new_kode}</span>
                      <span className="text-[10px] text-muted-foreground">
                        · {(h.changed_by && profilesMap[h.changed_by]) || "-"} ·{" "}
                        {formatDateTime(h.changed_at)}
                        {refCount > 0 && ` · ${refCount} riwayat stok ikut diperbarui`}
                      </span>
                    </div>
                  );
                })}
              </div>
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
        <KoliDetailView
          className="mt-3"
          koliDetail={it?.koli_detail}
          layananKurir={it?.layanan_kurir}
          ratePerKg={it?.rate_per_kg}
          shipmentType={it?.shipment_type}
        />
      </Content>

      <Content title="Status Pengiriman">
        <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl space-y-3">
          {it && (
            <ItemTransferTrackingControl
              itId={Number(itId)}
              trackingStatus={it.tracking_status}
              trackingNote={it.tracking_note}
              canTrack={!!canTrack}
              canOverride={isModeratorOrAdmin && it.status === "approved"}
              onSaved={fetchDetails}
            />
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

      <Content>
        <ModeratorEditLogPanel
          docType="item_transfer"
          docId={Number(itId)}
          refreshKey={modLogRefreshKey}
        />
      </Content>

      {editMode && (
        <EditItemTransferDialog
          itId={Number(itId)}
          mode={editMode}
          open={!!editMode}
          onOpenChange={(o) => {
            if (!o) setEditMode(null);
          }}
          onSaved={() => {
            setModLogRefreshKey((k) => k + 1);
            fetchDetails();
          }}
        />
      )}

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
