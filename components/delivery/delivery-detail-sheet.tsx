"use client";

import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  FileText,
  User,
  Building2,
  Calendar,
  Package,
  CheckCircle2,
  Clock,
  X,
  RefreshCw,
  FileBox,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateDeliveryDocument,
  updateDeliveryTracking,
  updateDeliveryTrackingModerator,
  finalizeDelivery,
  cancelDelivery,
} from "@/services/inventory-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { Textarea } from "@/components/ui/textarea";
import { normalizeDocumentStatus } from "@/lib/document-status";

interface DeliveryDetailSheetProps {
  deliveryId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

export function DeliveryDetailSheet({
  deliveryId,
  open,
  onOpenChange,
  onUpdate,
}: DeliveryDetailSheetProps) {
  const supabase = createClient();
  const [delivery, setDelivery] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [receiverSignOpen, setReceiverSignOpen] = useState(false);
  const [currentUserCabangId, setCurrentUserCabangId] = useState<number | null>(
    null,
  );
  const [currentUserRoleNames, setCurrentUserRoleNames] = useState<string[]>(
    [],
  );
  const [finalizing, setFinalizing] = useState(false);
  const [moderatorTrackingStatus, setModeratorTrackingStatus] = useState("");
  const [moderatorTrackingNote, setModeratorTrackingNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (open && deliveryId) {
      fetchDetails();
    }
  }, [open, deliveryId]);

  useEffect(() => {
    const fetchCurrentUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id || "");
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("cabang_id, user_roles(roles(name))")
          .eq("id", user.id)
          .single();
        setCurrentUserCabangId(profile?.cabang_id ?? null);
        const roleNames = (profile?.user_roles || [])
          .map((row: any) => row?.roles?.name)
          .filter((name: string | undefined): name is string => Boolean(name));
        setCurrentUserRoleNames(roleNames);
      }
    };
    fetchCurrentUser();
  }, []);

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const { data: dlvData } = await supabase
        .from("deliveries")
        .select(
          `*, 
          cabang_dari:cabang!deliveries_dari_cabang_id_fkey(nama_cabang), 
          cabang_ke:cabang!deliveries_ke_cabang_id_fkey(nama_cabang),
          sender:profiles!deliveries_uid_sender_fkey(id, nama),
          receiver:profiles!deliveries_uid_receiver_fkey(id, nama),
          pic:profiles!deliveries_uid_pic_fkey(id, nama),
          signature_sender:user_signatures!deliveries_signature_sender_id_fkey(id, image_url, label, printed_name),
          signature_receiver:user_signatures!deliveries_signature_receiver_id_fkey(id, image_url, label, printed_name)`,
        )
        .eq("id", deliveryId)
        .single();
      setDelivery(dlvData);
      setModeratorTrackingStatus(dlvData?.tracking_status || "created");
      setModeratorTrackingNote(dlvData?.tracking_note || "");

      const { data: itemsData } = await supabase
        .from("delivery_items")
        .select(
          "*, barang(part_number, part_name, part_satuan), mr_items(qty_sharestock_total)",
        )
        .eq("dlv_id", deliveryId)
        .order("created_at");
      setItems(itemsData || []);
    } catch (err) {
      console.error("Fetch Details Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!delivery) return;
    setUpdating(true);
    try {
      const result = await updateDeliveryDocument(delivery.id, {
        status: newStatus as any,
      });
      if (result.success) {
        toast.success(`Status delivery berhasil diubah menjadi ${newStatus}`);
        fetchDetails();
        if (onUpdate) onUpdate();
      } else {
        toast.error(result.error || "Gagal mengubah status");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-blue-600 border-blue-200 bg-blue-100 font-bold text-[10px] uppercase"
          >
            Open
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-green-600 text-white font-bold text-[10px] uppercase">
            Approved
          </Badge>
        );
      case "completed":
      case "done":
      case "closed":
        return (
          <Badge className="bg-emerald-600 text-white font-bold text-[10px] uppercase">
            Completed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="font-bold text-[10px] uppercase">
            {status}
          </Badge>
        );
    }
  };

  const TRACKING_STEPS = [
    { id: "created", label: "Delivery Dibuat" },
    { id: "packing", label: "Packing" },
    { id: "ready_pickup", label: "Siap Diambil" },
    { id: "in_transit", label: "Dalam Pengiriman" },
    { id: "delivered", label: "Barang Diterima" },
    { id: "completed", label: "Selesai Final" },
  ];
  const TRACKING_ORDER = TRACKING_STEPS.map((s) => s.id);

  const isTrackingStepCompleted = (
    current: string | undefined,
    stepId: string,
  ) => {
    const ci = TRACKING_ORDER.indexOf(current || "created");
    const si = TRACKING_ORDER.indexOf(stepId);
    return ci > si;
  };

  const handleAdvanceTracking = async () => {
    if (!delivery) return;
    const ci = TRACKING_ORDER.indexOf(delivery.tracking_status || "created");
    const deliveredIndex = TRACKING_ORDER.indexOf("delivered");
    if (ci < 0 || ci >= deliveredIndex) return;
    const nextStatus = TRACKING_ORDER[ci + 1];
    setUpdating(true);
    const result = await updateDeliveryTracking(delivery.id, nextStatus);
    if (result.success) {
      toast.success("Status pengiriman diperbarui");
      fetchDetails();
      if (onUpdate) onUpdate();
    } else {
      toast.error(result.error || "Gagal memperbarui status");
    }
    setUpdating(false);
  };

  const handleModeratorTrackingSave = async () => {
    if (!delivery) return;
    setUpdating(true);
    const result = await updateDeliveryTrackingModerator(
      delivery.id,
      moderatorTrackingStatus,
      moderatorTrackingNote,
    );
    if (result.success) {
      toast.success("Tracking status dan catatan berhasil diperbarui");
      fetchDetails();
      if (onUpdate) onUpdate();
    } else {
      toast.error(result.error || "Gagal memperbarui tracking moderator");
    }
    setUpdating(false);
  };

  const handleFinalizeWithSignature = async (signature: {
    id: string;
    image_url: string;
    label: string;
  }) => {
    if (!delivery) return;
    setFinalizing(true);
    const result = await finalizeDelivery(delivery.id, signature.id);
    if (result.success) {
      toast.success(
        "Delivery diselesaikan. Stok telah ditambahkan ke gudang penerima.",
      );
      setReceiverSignOpen(false);
      fetchDetails();
      if (onUpdate) onUpdate();
    } else {
      toast.error(result.error || "Gagal menyelesaikan delivery");
    }
    setFinalizing(false);
  };

  const canFinalize =
    Boolean(delivery) &&
    !delivery?.signature_receiver_id &&
    delivery?.tracking_status === "delivered" &&
    currentUserCabangId !== null &&
    currentUserCabangId === delivery?.ke_cabang_id;

  const canReceiverSign =
    Boolean(delivery) &&
    !delivery?.signature_receiver_id &&
    Boolean(currentUserId) &&
    delivery?.uid_receiver === currentUserId &&
    ["done", "closed"].includes(delivery?.status);

  const isModeratorOrAdmin = currentUserRoleNames.some(
    (role) => role === "moderator" || role === "admin",
  );

  // Delivery yang belum diterima (barang masih in-transit / belum sampai) bisa
  // dibatalkan. Qty dikembalikan ke stok sumber & saldo planning supply di-void.
  const canCancelDelivery =
    Boolean(delivery) &&
    isModeratorOrAdmin &&
    delivery?.status !== "cancelled" &&
    delivery?.status !== "completed" &&
    delivery?.tracking_status !== "completed";

  const handleCancelDelivery = async () => {
    if (!delivery) return;
    if (!cancelReason.trim()) {
      toast.error("Alasan pembatalan wajib diisi.");
      return;
    }
    setCancelling(true);
    const result = await cancelDelivery(delivery.id, cancelReason.trim());
    setCancelling(false);
    if (result?.success) {
      toast.success("Delivery dibatalkan. Qty dikembalikan ke cabang sumber.");
      setCancelReason("");
      fetchDetails();
      onUpdate?.();
    } else {
      toast.error(result?.error || "Gagal membatalkan delivery");
    }
  };

  const currentTrackingIndex = TRACKING_ORDER.indexOf(
    delivery?.tracking_status || "created",
  );
  const deliveredIndex = TRACKING_ORDER.indexOf("delivered");
  const canAdvanceTracking =
    currentTrackingIndex >= 0 && currentTrackingIndex < deliveredIndex;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-slate-200 overflow-hidden text-slate-900 shadow-2xl">
        {loading && !delivery ? (
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Memuat Data Delivery...
              </span>
            </div>
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-slate-50 border-b border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                  <FileBox className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Delivery Overview
                  </span>
                </div>
                {delivery && getStatusBadge(delivery.status)}
              </div>
              <div>
                <SheetTitle className="text-xl font-bold text-slate-900 tracking-tight uppercase leading-none">
                  {delivery?.dlv_kode}
                </SheetTitle>
                <div className="flex flex-col gap-1.5 mt-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <User className="h-3.5 w-3.5 text-slate-400" />{" "}
                    {delivery?.pic?.nama || delivery?.pic || "—"}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-blue-600 uppercase tracking-tight">
                    <Building2 className="h-3.5 w-3.5 text-blue-500/50" />{" "}
                    {delivery?.cabang_dari?.nama_cabang} →{" "}
                    {delivery?.cabang_ke?.nama_cabang}
                  </div>
                  {delivery?.no_resi && (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-600 uppercase tracking-tight mt-1">
                      <FileText className="h-3.5 w-3.5 text-slate-400" /> Resi:{" "}
                      {delivery.no_resi}
                    </div>
                  )}
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-white transition-all">
              {/* Main Info */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-blue-600 rounded-full" />
                  <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                    Informasi Pengiriman
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">
                      Via Pengiriman
                    </p>
                    <p className="font-bold text-slate-900">
                      {delivery?.ekspedisi || "—"}
                    </p>
                    {delivery?.sender_name && (
                      <p className="text-[9px] text-slate-500 font-medium mt-0.5">
                        {delivery.sender_name}
                      </p>
                    )}
                    {delivery?.eksternal_id && (
                      <p className="text-[9px] text-slate-500 font-medium mt-0.5 font-mono">
                        ID: {delivery.eksternal_id}
                      </p>
                    )}
                    {delivery?.no_resi && (
                      <p className="text-[9px] text-slate-500 font-medium mt-0.5 font-mono">
                        Resi: {delivery.no_resi}
                      </p>
                    )}
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">
                      Jumlah Koli
                    </p>
                    <p className="font-bold text-slate-900">
                      {delivery?.jumlah_koli}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">
                      Tanggal
                    </p>
                    <p className="font-bold text-slate-900">
                      {new Date(delivery?.created_at).toLocaleDateString(
                        "id-ID",
                        { day: "numeric", month: "short", year: "numeric" },
                      )}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">
                      Total Item
                    </p>
                    <p className="font-bold text-slate-900">{items.length}</p>
                  </div>
                </div>
              </div>

              {/* Tracking Timeline */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-orange-500 rounded-full" />
                  <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                    Status Pengiriman
                  </h3>
                </div>
                <div className="p-4 bg-orange-50/50 border border-orange-100 rounded-xl space-y-3">
                  <div className="space-y-2.5">
                    {TRACKING_STEPS.map((step, idx) => {
                      const completed = isTrackingStepCompleted(
                        delivery?.tracking_status,
                        step.id,
                      );
                      const current = delivery?.tracking_status === step.id;
                      return (
                        <div key={step.id} className="flex items-center gap-3">
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
                            {step.label}
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
                  {canAdvanceTracking && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 text-xs font-bold border-orange-200 text-orange-700 hover:bg-orange-50"
                      disabled={updating}
                      onClick={handleAdvanceTracking}
                    >
                      {updating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Lanjutkan ke Tahap Berikutnya
                    </Button>
                  )}

                  {delivery?.tracking_note && (
                    <div className="rounded-lg border border-orange-200 bg-white p-3">
                      <p className="text-[9px] font-bold text-orange-700 uppercase mb-1">
                        Catatan Tracking
                      </p>
                      <p className="text-[11px] font-medium text-slate-700 whitespace-pre-wrap">
                        {delivery.tracking_note}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Moderator Tracking Override */}
              {isModeratorOrAdmin && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 bg-indigo-500 rounded-full" />
                    <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                      Tracking Moderator/Admin
                    </h3>
                  </div>
                  <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-3">
                    <Select
                      value={moderatorTrackingStatus}
                      onValueChange={setModeratorTrackingStatus}
                      disabled={updating}
                    >
                      <SelectTrigger className="h-10 bg-white border-indigo-200 font-bold text-xs uppercase text-slate-700 rounded-lg">
                        <SelectValue placeholder="Pilih status tracking" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          value="created"
                          className="text-xs font-bold uppercase"
                        >
                          Delivery Dibuat
                        </SelectItem>
                        <SelectItem
                          value="packing"
                          className="text-xs font-bold uppercase"
                        >
                          Packing
                        </SelectItem>
                        <SelectItem
                          value="ready_pickup"
                          className="text-xs font-bold uppercase"
                        >
                          Siap Diambil
                        </SelectItem>
                        <SelectItem
                          value="in_transit"
                          className="text-xs font-bold uppercase"
                        >
                          Dalam Pengiriman
                        </SelectItem>
                        <SelectItem
                          value="delivered"
                          className="text-xs font-bold uppercase"
                        >
                          Barang Diterima
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <Textarea
                      value={moderatorTrackingNote}
                      onChange={(event) =>
                        setModeratorTrackingNote(event.target.value)
                      }
                      placeholder="Catatan tracking custom (opsional)"
                      className="min-h-20 bg-white border-indigo-200 text-xs"
                      disabled={updating}
                    />

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 text-xs font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                      onClick={handleModeratorTrackingSave}
                      disabled={updating}
                    >
                      {updating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Simpan Tracking + Catatan
                    </Button>
                  </div>

                  {canCancelDelivery && (
                    <div className="p-4 bg-red-50/50 border border-red-100 rounded-xl space-y-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                        <h4 className="text-[11px] font-bold text-red-700 uppercase tracking-tight">
                          Batalkan Delivery
                        </h4>
                      </div>
                      <p className="text-[10px] font-medium text-red-600/80">
                        Qty dikembalikan ke stok cabang sumber & saldo planning
                        supply dibatalkan. Hanya untuk delivery yang belum
                        diterima.
                      </p>
                      <Textarea
                        value={cancelReason}
                        onChange={(event) => setCancelReason(event.target.value)}
                        placeholder="Alasan pembatalan (wajib)"
                        className="min-h-16 bg-white border-red-200 text-xs"
                        disabled={cancelling}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 text-xs font-bold border-red-200 text-red-700 hover:bg-red-50"
                        onClick={handleCancelDelivery}
                        disabled={cancelling}
                      >
                        {cancelling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        )}
                        Batalkan & Kembalikan Stok
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Status Management */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-slate-900 rounded-full" />
                  <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                    Status Dokumen
                  </h3>
                </div>
                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-3 shadow-inner">
                  <Select
                    value={normalizeDocumentStatus(delivery?.status)}
                    onValueChange={handleStatusChange}
                    disabled={updating}
                  >
                    <SelectTrigger className="h-10 bg-white border-blue-200 font-bold text-xs uppercase text-slate-700 rounded-lg">
                      {updating ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-3 w-3 animate-spin" /> Sedang
                          Mengupdate...
                        </div>
                      ) : (
                        <SelectValue placeholder="Pilih Status..." />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="open"
                        className="text-xs font-bold uppercase text-blue-600"
                      >
                        Open
                      </SelectItem>
                      <SelectItem
                        value="approved"
                        className="text-xs font-bold uppercase text-green-600"
                      >
                        Approved
                      </SelectItem>
                      <SelectItem
                        value="completed"
                        className="text-xs font-bold uppercase text-slate-900"
                      >
                        Completed
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Signatures Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-purple-600 rounded-full" />
                  <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                    Tanda Tangan
                  </h3>
                </div>

                {/* Sender Signature */}
                <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-4 space-y-3">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-2">
                      Pengirim
                    </p>
                    <p className="text-xs font-bold text-slate-700">
                      {delivery?.sender?.nama || "N/A"}
                    </p>
                    {delivery?.signed_by_sender_at && (
                      <p className="text-[8px] text-slate-500 font-medium mt-1">
                        Ditandatangani:{" "}
                        {new Date(
                          delivery.signed_by_sender_at,
                        ).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                  {delivery?.signature_sender?.image_url && (
                    <img
                      src={delivery.signature_sender.image_url}
                      alt="Sender Signature"
                      className="h-16 object-contain border border-purple-200 rounded-lg p-2 bg-white"
                    />
                  )}
                </div>

                {/* Receiver Signature */}
                <div className="bg-green-50/50 border border-green-100 rounded-xl p-4 space-y-3">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-2">
                      Penerima
                    </p>
                    <p className="text-xs font-bold text-slate-700">
                      {delivery?.receiver?.nama || "Belum ditentukan"}
                    </p>
                    {delivery?.signed_by_receiver_at ? (
                      <p className="text-[8px] text-slate-500 font-medium mt-1">
                        Ditandatangani:{" "}
                        {new Date(
                          delivery.signed_by_receiver_at,
                        ).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    ) : (
                      <p className="text-[8px] text-orange-600 font-bold mt-1">
                        Belum ditandatangani
                      </p>
                    )}
                  </div>
                  {!delivery?.signature_receiver_id && (
                    <div className="space-y-2">
                      {canFinalize ? (
                        <div className="space-y-3">
                          <p className="text-[9px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5">
                            Anda adalah admin gudang penerima. Konfirmasi tanda
                            tangan melalui Signature Manager untuk menyelesaikan
                            delivery dan menambahkan stok.
                          </p>
                          <Button
                            className="w-full h-9 gap-2 text-xs font-bold bg-green-600 hover:bg-green-700 text-white"
                            disabled={finalizing}
                            onClick={() => setReceiverSignOpen(true)}
                          >
                            {finalizing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Tanda Tangani & Selesaikan
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[8px] text-slate-500 font-medium">
                          {delivery?.tracking_status !== "delivered"
                            ? "Selesaikan tracking hingga 'Barang Diterima' untuk finalisasi."
                            : "Hanya admin gudang penerima yang dapat menyelesaikan delivery ini."}
                        </p>
                      )}
                    </div>
                  )}
                  {delivery?.signature_receiver?.image_url && (
                    <img
                      src={delivery.signature_receiver.image_url}
                      alt="Receiver Signature"
                      className="h-16 object-contain border border-green-200 rounded-lg p-2 bg-white"
                    />
                  )}
                </div>
              </div>

              {/* Delivery Items */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-slate-500 rounded-full" />
                  <h3 className="text-[11px] font-bold text-slate-900 uppercase">
                    Item Pengiriman
                  </h3>
                </div>
                <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                  <Table className="table-fixed w-full">
                    <TableHeader className="bg-slate-50/50">
                      <TableRow className="h-10 hover:bg-transparent border-b border-slate-100">
                        <TableHead className="text-[9px] font-bold uppercase text-slate-400 pl-4 w-30">
                          Part Info
                        </TableHead>
                        <TableHead className="text-[9px] font-bold uppercase text-slate-400">
                          Nama Barang
                        </TableHead>
                        <TableHead className="text-[9px] font-bold uppercase text-slate-400 text-center pr-4 w-20">
                          Qty
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow
                          key={item.id}
                          className="hover:bg-blue-50/30 border-b border-slate-50 transition-colors"
                        >
                          <TableCell className="pl-4 py-3 align-top">
                            <div className="flex flex-col">
                              <span className="text-sm font-black font-mono text-slate-900 uppercase tracking-wide leading-none">
                                {item.barang.part_number}
                              </span>
                              <span className="text-[11px] font-bold text-slate-900 mt-1">
                                {item.satuan}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 align-top">
                            <span className="block whitespace-normal text-[10px] font-medium text-slate-400 uppercase leading-tight">
                              {item.barang.part_name}
                            </span>
                          </TableCell>
                          <TableCell className="text-center pr-4 py-3 align-top">
                            <div className="flex flex-col items-center">
                              <span className="text-[10px] font-black text-blue-600">
                                {item.qty_on_delivery}
                              </span>
                              {item.qty_delivered > 0 ? (
                                <span className="text-[8px] text-green-600 font-bold uppercase">
                                  diterima
                                </span>
                              ) : (
                                <span className="text-[8px] text-blue-500 font-bold uppercase">
                                  dalam pengiriman
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex gap-3 shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
              <Button
                variant="outline"
                className="flex-1 h-11 border-slate-200 text-slate-600 font-bold text-xs uppercase rounded-xl hover:bg-white transition-all gap-2"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-3.5 w-3.5" /> Tutup Panel
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 border border-slate-200 text-slate-400 hover:text-blue-600 rounded-xl hover:bg-white transition-all shadow-sm"
                onClick={fetchDetails}
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                />
              </Button>
            </div>
          </>
        )}
      </SheetContent>

      <MRSignatureDialog
        open={receiverSignOpen}
        onOpenChange={setReceiverSignOpen}
        onConfirm={handleFinalizeWithSignature}
      />
    </Sheet>
  );
}
