"use client";

import React, { useEffect, useState, use } from "react";
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
  CheckCircle2,
  Clock,
  RefreshCw,
  MapPin,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  XCircle,
  Printer,
  ShieldAlert,
  Trash2,
  Save,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  moderatorEditPR,
  ModeratorApprovalStep,
} from "@/services/moderator-edit-actions";
import { ApprovalFlowEditor } from "@/components/moderator/approval-flow-editor";
import { ModeratorEditLogPanel } from "@/components/moderator/moderator-edit-log-panel";
import { toast } from "sonner";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { normalizeDocumentStatus } from "@/lib/document-status";
import Link from "next/link";
import { Content } from "@/components/content";

export default function PRDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: prId } = use(params);
  const supabase = createClient();

  const [pr, setPr] = useState<any>(null);
  const [prItems, setPrItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [updatingItem, setUpdatingItem] = useState<number | null>(null);
  const [updatingAccurate, setUpdatingAccurate] = useState(false);

  // Linked MR & Fulfillment Tracking
  const [linkedMrs, setLinkedMrs] = useState<any[]>([]);
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
  const [itemDecisions, setItemDecisions] = useState<
    Record<number, "approved" | "rejected">
  >({});

  // Moderator Edit state
  const [isModerator, setIsModerator] = useState(false);
  const [cabangs, setCabangs] = useState<any[]>([]);
  const [modEditMode, setModEditMode] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modCabangId, setModCabangId] = useState("");
  const [modTanggal, setModTanggal] = useState("");
  const [modApprovals, setModApprovals] = useState<ModeratorApprovalStep[]>(
    [],
  );
  const [modItemsList, setModItemsList] = useState<
    { id: number; part_number: string; qty: number }[]
  >([]);
  const [modDeletedItemIds, setModDeletedItemIds] = useState<number[]>([]);
  const [modLogRefreshKey, setModLogRefreshKey] = useState(0);

  useEffect(() => {
    if (prId) {
      fetchDetails();
      fetchCurrentUser();
      fetchCabangs();
    }
  }, [prId]);

  const fetchCurrentUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setCurrentUser(user);
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      setIsModerator(
        (roleRows || []).some((r: any) => r.roles?.name === "moderator"),
      );
    }
  };

  const fetchCabangs = async () => {
    const { data } = await supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang");
    setCabangs(data || []);
  };

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const { data: prData } = await supabase
        .from("prs")
        .select("*, cabang(nama_cabang), profiles(nama)")
        .eq("id", prId)
        .single();
      setPr(prData);

      const { data: pItems } = await supabase
        .from("pr_items")
        .select("*")
        .eq("pr_id", prId)
        .order("created_at");
      setPrItems(pItems || []);

      if (pItems && pItems.length > 0) {
        const mrIds = Array.from(
          new Set(pItems.map((i: any) => i.mr_id).filter(Boolean)),
        );

        const { data: mrData } = await supabase
          .from("mrs")
          .select("*, cabang(nama_cabang)")
          .in("id", mrIds);
        setLinkedMrs(mrData || []);

        const { data: mItems } = await supabase
          .from("mr_items")
          .select("*")
          .in("mr_id", mrIds)
          .gt("qty_sharestock_total", 0);
        setSsItems(mItems || []);

        const { data: allocs } = await supabase
          .from("mr_sharestock_allocations")
          .select("*, cabang(nama_cabang)")
          .in(
            "mr_item_id",
            (mItems || []).map((item: any) => item.id),
          );
        setSsAllocations(allocs || []);

        // Filter lewat delivery_items.mr_item_id (bukan deliveries.mr_id,
        // yang cuma nyimpan MR pertama sebagai referensi utama) — satu
        // delivery bisa berisi item dari beberapa MR sekaligus.
        const { data: dItems } = await supabase
          .from("delivery_items")
          .select("*, deliveries!inner(dlv_kode, status)")
          .in(
            "mr_item_id",
            (mItems || []).map((item: any) => item.id),
          );
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

  const approvals: any[] = pr?.approvals ?? [];
  const nextPendingApproval = approvals.find(
    (a: any) => a.status === "pending",
  );
  const isMyTurn =
    currentUser &&
    nextPendingApproval &&
    nextPendingApproval.userid === currentUser.id;

  const modPreviouslyApprovedLike =
    !!pr && ["approved", "done", "closed"].includes(pr.pr_status);
  const modWillBeApproved =
    modApprovals.length > 0 &&
    modApprovals.every((a) => a.status === "approved");
  const modDowngradeLocked =
    modPreviouslyApprovedLike &&
    !!pr?.pr_convert_status &&
    pr.pr_convert_status !== "pending";
  const modBlockedDowngrade =
    modEditMode && modDowngradeLocked && !modWillBeApproved;

  const handleOpenApproveDialog = () => {
    const defaults: Record<number, "approved" | "rejected"> = {};
    for (const item of prItems) {
      defaults[item.id] = "approved";
    }
    setItemDecisions(defaults);
    setApproveDialogOpen(true);
  };

  const handleApprovePR = async () => {
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
    const result = await approvePR(Number(prId), decisions, signature.image_url);
    if (result?.success) {
      toast.success("PR berhasil disetujui");
      fetchDetails();
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
        newValue ? "Ditandai sudah input ke Accurate" : "Tanda Accurate dihapus",
      );
    } else {
      toast.error(result.error || "Gagal mengubah status Accurate");
    }
    setUpdatingAccurate(false);
  };

  const normalizeApprovalStep = (a: any): ModeratorApprovalStep => ({
    userid: a.userid || a.user_id || "",
    nama: a.nama || "",
    email: a.email || "",
    approval_role:
      a.approval_role === "mengetahui" || a.level === "mengetahui"
        ? "mengetahui"
        : "menyetujui",
    status: a.status || "pending",
    processed_at: a.processed_at ?? null,
    signature_url: a.signature_url ?? null,
    notes: a.notes ?? null,
    snapshot: a.snapshot ?? null,
  });

  const enterModEditMode = () => {
    setModCabangId(pr?.cabang_id ? String(pr.cabang_id) : "");
    setModTanggal(pr?.pr_tanggal ? String(pr.pr_tanggal).slice(0, 10) : "");
    setModItemsList(
      prItems.map((i) => ({
        id: i.id,
        part_number: i.part_number,
        qty: i.qty,
      })),
    );
    setModDeletedItemIds([]);
    setModApprovals((pr?.approvals || []).map(normalizeApprovalStep));
    setModEditMode(true);
  };

  const modDeleteItem = (id: number) => {
    setModDeletedItemIds((prev) => [...prev, id]);
    setModItemsList((prev) => prev.filter((i) => i.id !== id));
  };

  const modUpdateItemQty = (id: number, qty: number) => {
    setModItemsList((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty } : i)),
    );
  };

  const handleModSaveEdit = async () => {
    if (modApprovals.length === 0) {
      toast.error("Jalur approval tidak boleh kosong.");
      return;
    }
    if (modApprovals.some((a) => !a.userid || !a.nama)) {
      toast.error("Setiap tahap approval harus punya approver yang dipilih.");
      return;
    }
    if (
      modApprovals.some((a) => a.status === "rejected") &&
      !modApprovals.find((a) => a.status === "rejected")?.notes?.trim()
    ) {
      toast.error(
        "Catatan/alasan penolakan wajib diisi pada tahap yang di-reject.",
      );
      return;
    }

    const updatedItems = modItemsList
      .filter((m) => {
        const original = prItems.find((p) => p.id === m.id);
        return original && original.qty !== m.qty;
      })
      .map((m) => ({ id: m.id, qty: m.qty }));

    setModSaving(true);
    const res = await moderatorEditPR(Number(prId), {
      cabang_id: modCabangId ? Number(modCabangId) : undefined,
      pr_tanggal: modTanggal || undefined,
      updatedItems: updatedItems.length > 0 ? updatedItems : undefined,
      deletedItemIds:
        modDeletedItemIds.length > 0 ? modDeletedItemIds : undefined,
      approvals: modApprovals,
    });
    if (res.error) {
      toast.error(res.error);
      setModSaving(false);
      return;
    }
    toast.success("Moderator Edit berhasil disimpan.");
    setModEditMode(false);
    setModLogRefreshKey((k) => k + 1);
    fetchDetails();
    setModSaving(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-bold text-[10px] uppercase"
          >
            Open
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success text-success-foreground font-bold text-[10px] uppercase">
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
      case "closed":
        return (
          <Badge className="bg-foreground text-background font-bold text-[10px] uppercase">
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

  const getItemStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "text-primary";
      case "approved":
        return "text-success";
      case "rejected":
        return "text-destructive";
      case "done":
        return "text-foreground";
      case "closed":
        return "text-muted-foreground";
      default:
        return "text-foreground";
    }
  };

  const handlePrint = () => {
    if (!prId) {
      toast.error("ID PR tidak ditemukan");
      return;
    }
    window.open(`/pr/${prId}/print`, "_blank");
  };

  if (loading && !pr) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-bold uppercase tracking-widest animate-pulse">
            Memuat Dokumen PR...
          </p>
        </div>
      </div>
    );
  }

  if (!loading && !pr) {
    return (
      <Content>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-bold text-foreground uppercase">
              Purchase Request tidak ditemukan
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Dokumen dengan ID ini tidak ada atau sudah dihapus.
            </p>
          </div>
          <Link href="/pr">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Kembali ke Daftar PR
            </Button>
          </Link>
        </div>
      </Content>
    );
  }

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/pr">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                  {pr?.pr_kode}
                </h1>
                {getStatusBadge(pr?.pr_status)}
                {pr?.pr_convert_status && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-bold uppercase",
                      pr.pr_convert_status === "complete" &&
                        "bg-success/10 text-success border-success/30",
                      pr.pr_convert_status === "partial" &&
                        "bg-warning/10 text-warning border-warning/30",
                      pr.pr_convert_status === "pending" &&
                        "bg-muted text-muted-foreground border-border",
                    )}
                  >
                    PO: {pr.pr_convert_status}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1">
                <span className="text-[10px] text-muted-foreground font-bold uppercase flex items-center gap-1.5">
                  <User className="h-3 w-3" /> {pr?.profiles?.nama}
                </span>
                {modEditMode ? (
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Select value={modCabangId} onValueChange={setModCabangId}>
                      <SelectTrigger className="h-7 w-44 text-[10px] font-bold">
                        <SelectValue placeholder="Pilih cabang..." />
                      </SelectTrigger>
                      <SelectContent>
                        {cabangs.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.nama_cabang}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground font-bold uppercase flex items-center gap-1.5">
                    <Building2 className="h-3 w-3" /> {pr?.cabang?.nama_cabang}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isModerator && !modEditMode && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 font-semibold border-warning/40 text-warning hover:bg-warning/10"
                onClick={enterModEditMode}
              >
                <ShieldAlert className="h-4 w-4" /> Moderator Edit
              </Button>
            )}
            {modEditMode && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-2 font-semibold text-muted-foreground"
                  onClick={() => setModEditMode(false)}
                  disabled={modSaving}
                >
                  <RotateCcw className="h-4 w-4" /> Batal
                </Button>
                <Button
                  size="sm"
                  className="gap-2 font-semibold bg-warning text-warning-foreground hover:bg-warning/90"
                  onClick={handleModSaveEdit}
                  disabled={modSaving || modBlockedDowngrade}
                  title={
                    modBlockedDowngrade
                      ? "Tidak bisa disimpan: status approval akan turun dari 'approved' padahal PR sudah dikonversi ke PO."
                      : undefined
                  }
                >
                  {modSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Simpan Moderator Edit
                </Button>
              </>
            )}
            <Button
              onClick={handlePrint}
              variant="outline"
              size="sm"
              className="gap-2 font-semibold"
            >
              <Printer className="h-4 w-4" /> Cetak PR
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

      {modEditMode && (
        <Content>
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-warning">
              Mode Moderator Edit aktif — semua field (termasuk jalur & status
              approval) bisa diubah bebas, di luar giliran approval normal.
              Tambah item baru tidak didukung di mode ini. Perubahan tercatat
              di Riwayat Moderator Edit.
            </p>
          </div>
        </Content>
      )}

      <Content title="Referensi Material Request">
        <div className="space-y-3">
          {linkedMrs.length === 0 ? (
            <div className="bg-muted/40 border border-border rounded-xl p-4 text-xs text-muted-foreground italic">
              Tidak ada MR terkait.
            </div>
          ) : (
            linkedMrs.map((mr) => (
              <Link
                key={mr.id}
                href={`/mr/${mr.id}`}
                className="bg-muted/40 border border-border rounded-xl p-4 flex items-center justify-between group hover:bg-background hover:border-primary/30 transition-all cursor-pointer shadow-sm"
              >
                <div>
                  <p className="text-xs font-bold text-foreground uppercase leading-none">
                    {mr.mr_kode}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase mt-1.5 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" />
                    {formatDate(mr.mr_tanggal)}
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </Link>
            ))
          )}
        </div>
      </Content>

      {(approvals.length > 0 || modEditMode) && (
        <Content title="Alur Approval">
          <div className="space-y-3">
            {modEditMode ? (
              <div className="space-y-3">
                {modDowngradeLocked && (
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-[11px] font-semibold leading-relaxed",
                      modBlockedDowngrade
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-warning/40 bg-warning/10 text-warning",
                    )}
                  >
                    {modBlockedDowngrade ? (
                      <>
                        Tidak bisa disimpan: PR ini sudah dikonversi ke PO,
                        tapi jalur approval yang Anda atur sekarang membuat
                        status turun dari <strong>approved</strong>.
                        Kembalikan semua tahap ke approved, atau bereskan dulu
                        PO-nya sebelum menurunkan status.
                      </>
                    ) : (
                      <>
                        PR ini sudah dikonversi ke PO. Status approval tidak
                        bisa diturunkan dari <strong>approved</strong> selama
                        PO tersebut belum dibereskan.
                      </>
                    )}
                  </div>
                )}
                <ApprovalFlowEditor
                  steps={modApprovals}
                  onChange={setModApprovals}
                />
              </div>
            ) : (
              <div className="border border-border rounded-xl overflow-hidden shadow-sm divide-y divide-border">
                {approvals.map((step: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 px-4 py-3 bg-background"
                  >
                    <div className="shrink-0">
                      {step.status === "approved" ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : step.status === "rejected" ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-foreground uppercase leading-none truncate">
                        {step.nama}
                      </p>
                      {step.status !== "pending" && step.processed_at && (
                        <p className="text-[9px] text-muted-foreground font-medium mt-0.5">
                          {formatDateTime(step.processed_at)}
                        </p>
                      )}
                      {step.notes && (
                        <p className="text-[9px] text-muted-foreground italic mt-0.5 truncate">
                          &ldquo;{step.notes}&rdquo;
                        </p>
                      )}
                    </div>
                    <div>
                      {step.status === "approved" ? (
                        <Badge className="bg-success/10 text-success border-none text-[8px] font-bold uppercase h-4 px-1.5">
                          Setuju
                        </Badge>
                      ) : step.status === "rejected" ? (
                        <Badge className="bg-destructive/10 text-destructive border-none text-[8px] font-bold uppercase h-4 px-1.5">
                          Tolak
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground text-[8px] font-bold uppercase h-4 px-1.5"
                        >
                          Menunggu
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isMyTurn && !modEditMode && (
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  className="flex-1 bg-success hover:bg-success/90 text-success-foreground text-xs font-bold uppercase h-9 gap-2"
                  onClick={handleOpenApproveDialog}
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> Setujui PR
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10 text-xs font-bold uppercase h-9 gap-2"
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
        </Content>
      )}

      {!modEditMode && (
        <Content title="Status Dokumen PR">
          <div className="p-4 bg-muted/40 border border-border rounded-xl space-y-3">
            <Select
              value={normalizeDocumentStatus(pr?.pr_status)}
              onValueChange={handleStatusChange}
              disabled={updating}
            >
              <SelectTrigger className="h-10 bg-background border-border font-bold text-xs uppercase text-foreground rounded-lg">
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
                <SelectItem value="open" className="text-xs font-bold uppercase text-primary">
                  Open
                </SelectItem>
                <SelectItem value="approved" className="text-xs font-bold uppercase text-success">
                  Approved
                </SelectItem>
                <SelectItem value="rejected" className="text-xs font-bold uppercase text-destructive">
                  Rejected
                </SelectItem>
                <SelectItem value="completed" className="text-xs font-bold uppercase text-foreground">
                  Completed
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Content>
      )}

      <Content title="Item Pembelian (Edit Status Per Item)">
        <div className="border border-border rounded-xl overflow-hidden shadow-sm">
          <Table className="table-fixed w-full">
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent border-b border-border">
                <TableHead className="text-[9px] font-bold uppercase text-muted-foreground pl-4 w-30">
                  Part Info
                </TableHead>
                <TableHead className="text-[9px] font-bold uppercase text-muted-foreground">
                  Nama Barang
                </TableHead>
                <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right pr-4 w-27.5">
                  Status Item
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prItems.map((item) => (
                <TableRow
                  key={item.id}
                  className="hover:bg-muted/30 border-b border-border/50 transition-colors align-top"
                >
                  <TableCell className="pl-4 py-3 align-top">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-black font-mono text-foreground uppercase tracking-wide leading-none">
                        {item.part_number}
                      </span>
                      {modEditMode ? (
                        modDeletedItemIds.includes(item.id) ? (
                          <span className="text-[10px] font-bold text-destructive italic">
                            Akan dihapus
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={1}
                              value={
                                modItemsList.find((m) => m.id === item.id)
                                  ?.qty ?? item.qty
                              }
                              onChange={(e) =>
                                modUpdateItemQty(
                                  item.id,
                                  Math.max(1, Number(e.target.value)),
                                )
                              }
                              className="h-7 w-16 text-[11px] font-bold px-1.5"
                            />
                            <span className="text-[10px] font-bold text-muted-foreground">
                              {item.satuan}
                            </span>
                            <button
                              onClick={() => modDeleteItem(item.id)}
                              className="text-muted-foreground/40 hover:text-destructive transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      ) : (
                        <span className="text-[11px] font-bold text-foreground mt-1">
                          {item.qty} {item.satuan}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3 align-top">
                    <span className="block whitespace-normal wrap-break-word text-[10px] font-medium text-muted-foreground uppercase leading-tight">
                      {item.part_name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right pr-4 py-3 align-top">
                    <Select
                      value={item.status || "open"}
                      onValueChange={(val) => requestItemStatusChange(item, val)}
                      disabled={updatingItem === item.id}
                    >
                      <SelectTrigger
                        className={cn(
                          "h-7 w-24 ml-auto bg-background border-border font-bold text-[8px] uppercase rounded-md px-2",
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
                        <SelectItem value="open" className="text-[10px] font-bold uppercase text-primary">
                          Open
                        </SelectItem>
                        <SelectItem value="approved" className="text-[10px] font-bold uppercase text-success">
                          Approved
                        </SelectItem>
                        <SelectItem value="rejected" className="text-[10px] font-bold uppercase text-destructive">
                          Rejected
                        </SelectItem>
                        <SelectItem value="done" className="text-[10px] font-bold uppercase text-foreground">
                          Done
                        </SelectItem>
                        <SelectItem value="closed" className="text-[10px] font-bold uppercase text-muted-foreground">
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
      </Content>

      <Content>
        <ModeratorEditLogPanel
          docType="pr"
          docId={Number(prId)}
          refreshKey={modLogRefreshKey}
        />
      </Content>

      {ssItems.length > 0 && (
        <Content title="Share Stock Fulfillment">
          <div className="space-y-4">
            {ssItems.map((item) => {
              const isProcessed = isSsProcessed(item.part_id);
              const itemAllocs = ssAllocations.filter(
                (a) => a.mr_item_id === item.id,
              );

              return (
                <div
                  key={item.id}
                  className="bg-muted/40 border border-border rounded-xl p-4 space-y-3 shadow-sm hover:border-success/30 transition-all group"
                >
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <p className="text-sm font-black font-mono text-foreground leading-none group-hover:text-success transition-colors uppercase tracking-wide">
                        {item.part_number}
                      </p>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase line-clamp-1 leading-snug">
                        {item.part_name}
                      </p>
                    </div>
                    {isProcessed ? (
                      <Badge className="bg-success text-success-foreground font-black text-[8px] uppercase border-none px-1 h-3.5">
                        Processed
                      </Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground font-black text-[8px] uppercase border-none px-1 h-3.5">
                        Not Processed
                      </Badge>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border/50 space-y-2">
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                      <MapPin className="h-2.5 w-2.5" /> Sumber Alokasi (
                      {item.qty_sharestock_total} {item.satuan})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {itemAllocs.map((alloc, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 bg-background border border-border px-2 py-1 rounded-md shadow-sm"
                        >
                          <span className="text-[9px] font-bold text-foreground uppercase">
                            {alloc.cabang?.nama_cabang}
                          </span>
                          <span className="h-3 w-px bg-border" />
                          <span className="text-[9px] font-black text-success">
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
        </Content>
      )}

      <Content>
        <button
          onClick={handleToggleAccurate}
          disabled={updatingAccurate}
          className={cn(
            "w-full flex items-center gap-3 p-3 rounded-xl border transition-all",
            pr?.accurate
              ? "bg-warning/10 border-warning/30 hover:bg-warning/20"
              : "bg-muted/40 border-border hover:bg-background",
          )}
        >
          <div
            className={cn(
              "h-4 w-4 rounded border-2 flex items-center justify-center shrink-0",
              pr?.accurate ? "bg-warning border-warning" : "border-border",
            )}
          >
            {pr?.accurate && (
              <svg
                className="h-2.5 w-2.5 text-warning-foreground"
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
              className={cn(
                "text-[10px] font-bold uppercase tracking-tight leading-none",
                pr?.accurate ? "text-warning" : "text-muted-foreground",
              )}
            >
              {pr?.accurate ? "Sudah Input ke Accurate" : "Belum Input ke Accurate"}
            </p>
            <p className="text-[9px] text-muted-foreground font-medium mt-0.5">
              Klik untuk {pr?.accurate ? "hapus tanda" : "tandai sudah input"}
            </p>
          </div>
          {updatingAccurate && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
          )}
        </button>
      </Content>

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

          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 text-[9px] font-bold uppercase text-muted-foreground">
                    Item
                  </th>
                  <th className="text-right px-3 py-2 text-[9px] font-bold uppercase text-muted-foreground w-32">
                    Keputusan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {prItems.map((item) => (
                  <tr key={item.id} className="bg-background">
                    <td className="px-3 py-2.5">
                      <p className="font-black text-foreground uppercase text-sm font-mono leading-tight tracking-wide">
                        {item.part_number}
                      </p>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mt-0.5 leading-tight">
                        {item.part_name}
                      </p>
                      <p className="text-[9px] text-muted-foreground font-mono mt-0.5">
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
                          className={cn(
                            "h-7 w-28 ml-auto font-bold text-[9px] uppercase",
                            (itemDecisions[item.id] ?? "approved") === "approved"
                              ? "text-success border-success/30"
                              : "text-destructive border-destructive/30",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="approved" className="text-[10px] font-bold uppercase text-success">
                            Disetujui
                          </SelectItem>
                          <SelectItem value="rejected" className="text-[10px] font-bold uppercase text-destructive">
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
              className="bg-success hover:bg-success/90 text-success-foreground font-bold uppercase gap-2"
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
            <DialogTitle className="text-base font-bold uppercase tracking-tight text-destructive">
              Tolak Purchase Request
            </DialogTitle>
            <DialogDescription className="text-xs">
              Berikan alasan penolakan. PR akan berstatus Rejected.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">
              Alasan Penolakan
            </Label>
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
    </>
  );
}
