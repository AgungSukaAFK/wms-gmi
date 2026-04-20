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
  Truck,
  ShoppingCart,
  MapPin,
  ExternalLink,
  ChevronDown,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  XCircle,
  Printer,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  updatePRStatus,
  updatePRItemStatus,
  updatePRAccurate,
  approvePR,
  rejectPR,
} from "@/services/procurement-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { MyAlertDialog } from "@/components/dialog-confirm";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";

interface PRDetailSheetProps {
  prId: string | number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

export function PRDetailSheet({
  prId,
  open,
  onOpenChange,
  onUpdate,
}: PRDetailSheetProps) {
  const supabase = createClient();
  const [pr, setPr] = useState<any>(null);
  const [prItems, setPrItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updatingItem, setUpdatingItem] = useState<number | null>(null);
  const [updatingAccurate, setUpdatingAccurate] = useState(false);

  // Linked MR & Fulfillment Tracking
  const [linkedMr, setLinkedMr] = useState<any>(null);
  const [ssItems, setSsItems] = useState<any[]>([]);
  const [ssAllocations, setSsAllocations] = useState<any[]>([]);
  const [deliveryRecords, setDeliveryRecords] = useState<any[]>([]);

  // Approval state
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  // Per-item decisions for approver: itemId -> 'approved' | 'rejected'
  const [itemDecisions, setItemDecisions] = useState<
    Record<number, "approved" | "rejected">
  >({});

  useEffect(() => {
    if (open && prId) {
      fetchDetails();
      fetchCurrentUser();
    }
  }, [open, prId]);

  const fetchCurrentUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) setCurrentUser(user);
  };

  const fetchDetails = async () => {
    setLoading(true);
    try {
      // 1. Fetch PR Header
      const { data: prData } = await supabase
        .from("prs")
        .select("*, cabang(nama_cabang), profiles(nama)")
        .eq("id", prId)
        .single();
      setPr(prData);

      // 2. Fetch PR Items (including status column)
      const { data: pItems } = await supabase
        .from("pr_items")
        .select("*")
        .eq("pr_id", prId)
        .order("created_at");
      setPrItems(pItems || []);

      if (pItems && pItems.length > 0) {
        const mrId = pItems[0].mr_id;

        // 3. Fetch Linked MR Header
        const { data: mrData } = await supabase
          .from("mrs")
          .select("*, cabang(nama_cabang)")
          .eq("id", mrId)
          .single();
        setLinkedMr(mrData);

        // 4. Fetch Share Stock Items from MR
        const { data: mItems } = await supabase
          .from("mr_items")
          .select("*")
          .eq("mr_id", mrId)
          .gt("qty_sharestock_total", 0);
        setSsItems(mItems || []);

        // 5. Fetch SS Allocations
        const { data: allocs } = await supabase
          .from("mr_sharestock_allocations")
          .select("*, cabang(nama_cabang)")
          .in(
            "mr_item_id",
            (mItems || []).map((item: any) => item.id),
          );
        setSsAllocations(allocs || []);

        // 6. Fetch Delivery Items (to check process status for SS)
        const { data: dItems } = await supabase
          .from("delivery_items")
          .select("*, deliveries!inner(dlv_kode, status)")
          .eq("deliveries.mr_id", mrId);
        setDeliveryRecords(dItems || []);
      }
    } catch (err) {
      console.error("Fetch Details Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!prId) return;
    setUpdating(true);
    try {
      const result = await updatePRStatus(Number(prId), newStatus);
      if (result.success) {
        toast.success(`Status PR berhasil diubah menjadi ${newStatus}`);
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

  const handleItemStatusChange = async (itemId: number, newStatus: string) => {
    setUpdatingItem(itemId);
    try {
      const result = await updatePRItemStatus(itemId, newStatus);
      if (result.success) {
        toast.success("Status item berhasil diperbarui");
        setPrItems((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, status: newStatus } : item,
          ),
        );
      } else {
        toast.error(result.error || "Gagal memperbarui status item");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUpdatingItem(null);
    }
  };

  const requestItemStatusChange = (item: any, newStatus: string) => {
    if ((item.status || "open") === newStatus) return;
    handleItemStatusChange(item.id, newStatus);
  };

  const isSsProcessed = (partId: number) => {
    return deliveryRecords.some((dlv) => dlv.part_id === partId);
  };

  // Compute approval state
  const approvals: any[] = pr?.approvals ?? [];
  const nextPendingApproval = approvals.find(
    (a: any) => a.status === "pending",
  );
  const isMyTurn =
    currentUser &&
    nextPendingApproval &&
    nextPendingApproval.userid === currentUser.id;

  const handleOpenApproveDialog = () => {
    // Default all items to approved
    const defaults: Record<number, "approved" | "rejected"> = {};
    for (const item of prItems) {
      defaults[item.id] = "approved";
    }
    setItemDecisions(defaults);
    setApproveDialogOpen(true);
  };

  const handleApprovePR = async () => {
    // After item decisions confirmed, open signature dialog
    setApproveDialogOpen(false);
    setSignatureDialogOpen(true);
  };

  const handleApproveConfirm = async (signature: {
    id: string;
    image_url: string;
    label: string;
  }) => {
    if (!prId) return;
    setApprovalSubmitting(true);
    const decisions = Object.entries(itemDecisions).map(([id, status]) => ({
      itemId: Number(id),
      status: status as "approved" | "rejected",
    }));
    const result = await approvePR(
      Number(prId),
      decisions,
      signature.image_url,
    );
    if (result?.success) {
      toast.success("PR berhasil disetujui");
      fetchDetails();
      if (onUpdate) onUpdate();
    } else {
      toast.error(result?.error || "Gagal menyetujui PR");
    }
    setApprovalSubmitting(false);
  };

  const handleRejectPR = async () => {
    if (!prId || !rejectionReason.trim()) {
      toast.error("Alasan penolakan harus diisi");
      return;
    }
    setApprovalSubmitting(true);
    const result = await rejectPR(Number(prId), rejectionReason.trim());
    if (result?.success) {
      toast.success("PR ditolak");
      setRejectionReason("");
      setRejectDialogOpen(false);
      fetchDetails();
      if (onUpdate) onUpdate();
    } else {
      toast.error(result?.error || "Gagal menolak PR");
    }
    setApprovalSubmitting(false);
  };

  const handleToggleAccurate = async () => {
    if (!pr) return;
    setUpdatingAccurate(true);
    const newValue = !pr.accurate;
    const result = await updatePRAccurate(Number(prId), newValue);
    if (result.success) {
      setPr((prev: any) => ({ ...prev, accurate: newValue }));
      toast.success(
        newValue
          ? "Ditandai sudah input ke Accurate"
          : "Tanda Accurate dihapus",
      );
    } else {
      toast.error(result.error || "Gagal mengubah status Accurate");
    }
    setUpdatingAccurate(false);
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
      case "rejected":
        return (
          <Badge
            variant="destructive"
            className="font-bold text-[10px] uppercase"
          >
            Rejected
          </Badge>
        );
      case "done":
        return (
          <Badge className="bg-slate-900 text-white font-bold text-[10px] uppercase">
            Done
          </Badge>
        );
      case "closed":
        return (
          <Badge
            variant="secondary"
            className="font-bold text-[10px] uppercase text-slate-400"
          >
            Closed
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

  const getItemStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "text-blue-600";
      case "approved":
        return "text-green-600";
      case "rejected":
        return "text-red-600";
      case "done":
        return "text-slate-900";
      case "closed":
        return "text-slate-400";
      default:
        return "text-slate-600";
    }
  };

  const handlePrint = () => {
    if (!prId) {
      toast.error("ID PR tidak ditemukan");
      return;
    }
    window.open(`/pr/${prId}/print`, "_blank");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-slate-200 overflow-hidden text-slate-900 shadow-2xl">
        {/* Always-present title for screen reader accessibility */}
        <SheetTitle className="sr-only">Purchase Request Detail</SheetTitle>
        {loading && !pr ? (
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Memuat Data Dokumen...
              </span>
            </div>
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-slate-50 border-b border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                  <FileText className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Document Overview
                  </span>
                </div>
                {pr && getStatusBadge(pr.pr_status)}
              </div>
              <div>
                <SheetTitle className="text-xl font-bold text-slate-900 tracking-tight uppercase leading-none">
                  {pr?.pr_kode}
                </SheetTitle>
                <div className="flex flex-col gap-1.5 mt-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <User className="h-3.5 w-3.5 text-slate-400" />{" "}
                    {pr?.profiles?.nama}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-blue-600 uppercase tracking-tight">
                    <Building2 className="h-3.5 w-3.5 text-blue-500/50" />{" "}
                    {pr?.cabang?.nama_cabang}
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-white transition-all">
              {/* Linked MR Reference */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-red-500 rounded-full" />
                  <h3 className="text-[11px] font-bold text-slate-900 uppercase">
                    Referensi Material Request
                  </h3>
                </div>
                <div
                  className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-center justify-between group hover:bg-white hover:border-red-200 transition-all cursor-pointer shadow-sm"
                  onClick={() =>
                    linkedMr && window.open(`/mr/${linkedMr.id}`, "_blank")
                  }
                >
                  <div>
                    <p className="text-xs font-bold text-slate-800 uppercase leading-none">
                      {linkedMr?.mr_kode || "Loading..."}
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium uppercase mt-1.5 flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />
                      {linkedMr?.mr_tanggal
                        ? new Date(linkedMr.mr_tanggal).toLocaleDateString(
                            "id-ID",
                            { day: "numeric", month: "short", year: "numeric" },
                          )
                        : "-"}
                    </p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-slate-300 group-hover:text-red-500 transition-colors" />
                </div>
              </div>

              {/* Approval Flow */}
              {approvals.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 bg-violet-500 rounded-full" />
                    <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                      Alur Approval
                    </h3>
                  </div>
                  <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm divide-y divide-slate-50">
                    {approvals.map((step: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 px-4 py-3 bg-white"
                      >
                        <div className="shrink-0">
                          {step.status === "approved" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : step.status === "rejected" ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <Clock className="h-4 w-4 text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-slate-800 uppercase leading-none truncate">
                            {step.nama}
                          </p>
                          {step.status !== "pending" && step.processed_at && (
                            <p className="text-[9px] text-slate-400 font-medium mt-0.5">
                              {new Date(step.processed_at).toLocaleDateString(
                                "id-ID",
                                {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </p>
                          )}
                          {step.notes && (
                            <p className="text-[9px] text-slate-500 italic mt-0.5 truncate">
                              &ldquo;{step.notes}&rdquo;
                            </p>
                          )}
                        </div>
                        <div>
                          {step.status === "approved" ? (
                            <Badge className="bg-green-100 text-green-700 border-none text-[8px] font-bold uppercase h-4 px-1.5">
                              Setuju
                            </Badge>
                          ) : step.status === "rejected" ? (
                            <Badge className="bg-red-100 text-red-700 border-none text-[8px] font-bold uppercase h-4 px-1.5">
                              Tolak
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-slate-400 text-[8px] font-bold uppercase h-4 px-1.5"
                            >
                              Menunggu
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons — only shown when it's the current user's turn */}
                  {isMyTurn && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs font-bold uppercase h-9 gap-2"
                        onClick={handleOpenApproveDialog}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" /> Setujui PR
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold uppercase h-9 gap-2"
                        onClick={() => {
                          setRejectionReason("");
                          setRejectDialogOpen(true);
                        }}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" /> Tolak PR
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Status Management */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-blue-600 rounded-full" />
                  <h3 className="text-[11px] font-bold text-slate-900 uppercase tracking-tight">
                    Status Dokumen PR
                  </h3>
                </div>
                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-3 shadow-inner">
                  <Select
                    value={pr?.pr_status}
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
                        value="rejected"
                        className="text-xs font-bold uppercase text-red-600"
                      >
                        Rejected
                      </SelectItem>
                      <SelectItem
                        value="done"
                        className="text-xs font-bold uppercase text-slate-900"
                      >
                        Done
                      </SelectItem>
                      <SelectItem
                        value="closed"
                        className="text-xs font-bold uppercase text-slate-400"
                      >
                        Closed
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Item Pembelian (PR Items) - Per Item Status Editable */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 bg-slate-900 rounded-full" />
                    <h3 className="text-[11px] font-bold text-slate-900 uppercase">
                      Item Pembelian (Edit Status Per Item)
                    </h3>
                  </div>
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
                        <TableHead className="text-[9px] font-bold uppercase text-slate-400 text-right pr-4 w-27.5">
                          Status Item
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prItems.map((item) => (
                        <TableRow
                          key={item.id}
                          className="hover:bg-blue-50/30 border-b border-slate-50 transition-colors align-top"
                        >
                          <TableCell className="pl-4 py-3 align-top">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-tighter leading-none">
                                {item.part_number}
                              </span>
                              <span className="text-[11px] font-bold text-slate-900 mt-1">
                                {item.qty} {item.satuan}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 align-top">
                            <span className="block whitespace-normal wrap-break-word text-[11px] font-bold text-slate-800 uppercase leading-tight">
                              {item.part_name}
                            </span>
                          </TableCell>
                          <TableCell className="text-right pr-4 py-3 align-top">
                            <Select
                              value={item.status || "open"}
                              onValueChange={(val) =>
                                requestItemStatusChange(item, val)
                              }
                              disabled={updatingItem === item.id}
                            >
                              <SelectTrigger
                                className={cn(
                                  "h-7 w-24 ml-auto bg-white border-slate-200 font-bold text-[8px] uppercase rounded-md px-2",
                                  getItemStatusColor(item.status || "open"),
                                )}
                              >
                                {updatingItem === item.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                                ) : (
                                  <SelectValue />
                                )}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  value="open"
                                  className="text-[10px] font-bold uppercase text-blue-600"
                                >
                                  Open
                                </SelectItem>
                                <SelectItem
                                  value="approved"
                                  className="text-[10px] font-bold uppercase text-green-600"
                                >
                                  Approved
                                </SelectItem>
                                <SelectItem
                                  value="rejected"
                                  className="text-[10px] font-bold uppercase text-red-600"
                                >
                                  Rejected
                                </SelectItem>
                                <SelectItem
                                  value="done"
                                  className="text-[10px] font-bold uppercase text-slate-900"
                                >
                                  Done
                                </SelectItem>
                                <SelectItem
                                  value="closed"
                                  className="text-[10px] font-bold uppercase text-slate-400"
                                >
                                  Closed
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Share Stock Fulfillment */}
              {ssItems.length > 0 && (
                <div className="space-y-3 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-1 bg-green-500 rounded-full" />
                      <h3 className="text-[11px] font-bold text-slate-900 uppercase">
                        Share Stock Fulfillment
                      </h3>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {ssItems.map((item) => {
                      const isProcessed = isSsProcessed(item.part_id);
                      const itemAllocs = ssAllocations.filter(
                        (a) => a.mr_item_id === item.id,
                      );

                      return (
                        <div
                          key={item.id}
                          className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3 shadow-sm hover:border-green-200 transition-all group"
                        >
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <p className="text-[10px] font-mono font-bold text-slate-400 leading-none group-hover:text-green-600 transition-colors uppercase tracking-tight">
                                {item.part_number}
                              </p>
                              <p className="text-[11px] font-bold text-slate-800 uppercase line-clamp-1 leading-snug">
                                {item.part_name}
                              </p>
                            </div>
                            {isProcessed ? (
                              <Badge className="bg-green-600 text-white font-black text-[8px] uppercase ring-2 ring-green-100 border-none px-1 h-3.5">
                                Processed
                              </Badge>
                            ) : (
                              <Badge className="bg-slate-200 text-slate-500 font-black text-[8px] uppercase border-none px-1 h-3.5">
                                Not Processed
                              </Badge>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-200/50 space-y-2">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                              <MapPin className="h-2.5 w-2.5" /> Sumber Alokasi
                              ({item.qty_sharestock_total} {item.satuan})
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {itemAllocs.map((alloc, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-1 rounded-md shadow-sm"
                                >
                                  <span className="text-[9px] font-bold text-slate-700 uppercase">
                                    {alloc.cabang?.nama_cabang}
                                  </span>
                                  <span className="h-3 w-px bg-slate-200" />
                                  <span className="text-[9px] font-black text-green-600">
                                    {alloc.qty}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50/50 space-y-3 shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
              <button
                onClick={handleToggleAccurate}
                disabled={updatingAccurate}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                  pr?.accurate
                    ? "bg-amber-50 border-amber-200 hover:bg-amber-100"
                    : "bg-slate-50 border-slate-200 hover:bg-white"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
                    pr?.accurate
                      ? "bg-amber-500 border-amber-500"
                      : "border-slate-300"
                  }`}
                >
                  {pr?.accurate && (
                    <svg
                      className="h-2.5 w-2.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <p
                    className={`text-[10px] font-bold uppercase tracking-tight leading-none ${
                      pr?.accurate ? "text-amber-700" : "text-slate-500"
                    }`}
                  >
                    {pr?.accurate
                      ? "Sudah Input ke Accurate"
                      : "Belum Input ke Accurate"}
                  </p>
                  <p className="text-[9px] text-slate-400 font-medium mt-0.5">
                    Klik untuk{" "}
                    {pr?.accurate ? "hapus tanda" : "tandai sudah input"}
                  </p>
                </div>
                {updatingAccurate && (
                  <Loader2 className="h-3 w-3 animate-spin text-slate-400 shrink-0" />
                )}
              </button>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-11 border-slate-200 text-slate-600 font-bold text-xs uppercase rounded-xl hover:bg-white transition-all gap-2"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="h-3.5 w-3.5" /> Tutup Panel
                </Button>
                <Button
                  variant="outline"
                  className="h-11 px-4 border-slate-200 text-slate-600 font-bold text-xs uppercase rounded-xl hover:bg-white transition-all gap-2"
                  onClick={handlePrint}
                >
                  <Printer className="h-3.5 w-3.5" /> Cetak PR
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
            </div>
          </>
        )}
      </SheetContent>

      {/* Approve PR Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold uppercase tracking-tight">
              Setujui Purchase Request
            </DialogTitle>
            <DialogDescription className="text-xs">
              Tentukan keputusan per-item. Semua item di-approve secara default.
            </DialogDescription>
          </DialogHeader>

          <div className="border border-slate-100 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-3 py-2 text-[9px] font-bold uppercase text-slate-400">
                    Item
                  </th>
                  <th className="text-right px-3 py-2 text-[9px] font-bold uppercase text-slate-400 w-32">
                    Keputusan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {prItems.map((item) => (
                  <tr key={item.id} className="bg-white">
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-slate-800 uppercase text-[10px] leading-tight">
                        {item.part_name}
                      </p>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">
                        {item.qty} {item.satuan}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Select
                        value={itemDecisions[item.id] ?? "approved"}
                        onValueChange={(val) =>
                          setItemDecisions((prev) => ({
                            ...prev,
                            [item.id]: val as "approved" | "rejected",
                          }))
                        }
                      >
                        <SelectTrigger
                          className={`h-7 w-28 ml-auto font-bold text-[9px] uppercase ${
                            (itemDecisions[item.id] ?? "approved") ===
                            "approved"
                              ? "text-green-600 border-green-200"
                              : "text-red-600 border-red-200"
                          }`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value="approved"
                            className="text-[10px] font-bold uppercase text-green-600"
                          >
                            Disetujui
                          </SelectItem>
                          <SelectItem
                            value="rejected"
                            className="text-[10px] font-bold uppercase text-red-600"
                          >
                            Ditolak
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setApproveDialogOpen(false)}
              disabled={approvalSubmitting}
            >
              Batal
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white font-bold uppercase gap-2"
              onClick={handleApprovePR}
              disabled={approvalSubmitting}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              Lanjut & Tanda Tangan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject PR Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold uppercase tracking-tight text-red-600">
              Tolak Purchase Request
            </DialogTitle>
            <DialogDescription className="text-xs">
              Berikan alasan penolakan. PR akan berstatus Rejected.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase text-slate-500">
              Alasan Penolakan
            </label>
            <Textarea
              placeholder="Tuliskan alasan penolakan..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
              className="text-xs resize-none"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectDialogOpen(false)}
              disabled={approvalSubmitting}
            >
              Batal
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="font-bold uppercase gap-2"
              onClick={handleRejectPR}
              disabled={approvalSubmitting || !rejectionReason.trim()}
            >
              {approvalSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ThumbsDown className="h-3.5 w-3.5" />
              )}
              Tolak PR
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MRSignatureDialog
        open={signatureDialogOpen}
        onOpenChange={setSignatureDialogOpen}
        onConfirm={handleApproveConfirm}
      />
    </Sheet>
  );
}
