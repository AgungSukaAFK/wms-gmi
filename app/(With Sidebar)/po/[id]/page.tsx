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
  XCircle,
  ThumbsUp,
  ThumbsDown,
  Printer,
  CreditCard,
  AlertCircle,
  Truck,
  ShieldAlert,
  Trash2,
  Save,
  RotateCcw,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { approvePO, rejectPO } from "@/services/procurement-actions";
import {
  moderatorEditPO,
  ModeratorApprovalStep,
} from "@/services/moderator-edit-actions";
import { ApprovalFlowEditor } from "@/components/moderator/approval-flow-editor";
import { ModeratorEditLogPanel } from "@/components/moderator/moderator-edit-log-panel";
import { cn, formatDate } from "@/lib/utils";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { canViewPOPrice, maskedPriceText } from "@/lib/po-price-access";
import Link from "next/link";
import { Content } from "@/components/content";

export default function PODetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: poId } = use(params);
  const supabase = createClient();

  const [po, setPo] = useState<any>(null);
  const [poItems, setPoItems] = useState<any[]>([]);
  const [linkedPrs, setLinkedPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [canViewPrice, setCanViewPrice] = useState(false);

  // Approval states
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Moderator Edit state
  const [isModerator, setIsModerator] = useState(false);
  const [modEditMode, setModEditMode] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modTanggal, setModTanggal] = useState("");
  const [modEstimasi, setModEstimasi] = useState("");
  const [modPaymentTerm, setModPaymentTerm] = useState("");
  const [modKeterangan, setModKeterangan] = useState("");
  const [modApprovals, setModApprovals] = useState<ModeratorApprovalStep[]>(
    [],
  );
  const [modItemsList, setModItemsList] = useState<
    { id: number; part_number: string; qty: number }[]
  >([]);
  const [modDeletedItemIds, setModDeletedItemIds] = useState<number[]>([]);
  const [modLogRefreshKey, setModLogRefreshKey] = useState(0);

  useEffect(() => {
    if (poId) {
      fetchDetails();
      fetchCurrentUser();
    }
  }, [poId]);

  const fetchCurrentUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setCurrentUser(user);
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, roles:user_roles(roles(name,label))")
        .eq("id", user.id)
        .single();
      setCanViewPrice(canViewPOPrice(profile));
      setIsModerator(
        ((profile as any)?.roles || []).some(
          (r: any) => r.roles?.name === "moderator",
        ),
      );
    }
  };

  const fetchDetails = async () => {
    setLoading(true);
    try {
      const { data: poData } = await supabase
        .from("pos")
        .select(
          `
          id, po_kode, po_tanggal, po_estimasi, po_status, po_receive_status,
          po_pic, po_detail_status, po_payment_term, po_keterangan, approvals, created_at,
          prs(
            id, pr_kode, cabang_id,
            cabang(nama_cabang),
            profiles(nama)
          )
        `,
        )
        .eq("id", poId)
        .single();

      if (poData) setPo(poData);

      const { data: items } = await supabase
        .from("po_items")
        .select(
          "id, part_id, part_number, part_name, satuan, qty, harga, vendor_id, qty_received, mr_id, pr_item_id, vendors(vendor_name)",
        )
        .eq("po_id", poId)
        .order("vendor_id", { nullsFirst: false });

      setPoItems(items || []);

      const prItemIds = Array.from(
        new Set((items || []).map((i: any) => i.pr_item_id).filter(Boolean)),
      );
      if (prItemIds.length > 0) {
        const { data: prItemRows } = await supabase
          .from("pr_items")
          .select("pr_id")
          .in("id", prItemIds);
        const prIds = Array.from(
          new Set((prItemRows || []).map((r: any) => r.pr_id).filter(Boolean)),
        );
        if (prIds.length > 0) {
          const { data: prsData } = await supabase
            .from("prs")
            .select("id, pr_kode, pr_convert_status, cabang(nama_cabang)")
            .in("id", prIds);
          setLinkedPrs(prsData || []);
        } else {
          setLinkedPrs([]);
        }
      } else {
        setLinkedPrs([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const nextApproval = po?.approvals?.find((a: any) => a.status === "pending");
  const isMyTurn =
    currentUser && nextApproval && nextApproval.userid === currentUser.id;

  const handleApprove = async () => {
    if (!poId) return;
    setSignatureDialogOpen(true);
  };

  const handleApproveConfirm = async (signature: {
    id: string;
    image_url: string;
    label: string;
  }) => {
    if (!poId) return;
    setSubmitting(true);
    try {
      const result = await approvePO(Number(poId), signature.image_url);
      if (result.success) {
        toast.success(
          result.isAllDone
            ? "PO telah disetujui sepenuhnya"
            : "Langkah approval berhasil",
        );
        await fetchDetails();
      } else {
        toast.error(result.error || "Gagal menyetujui");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("Alasan penolakan wajib diisi");
      return;
    }
    if (!poId) return;
    setSubmitting(true);
    try {
      const result = await rejectPO(Number(poId), rejectionReason);
      if (result.success) {
        toast.success("PO berhasil ditolak");
        setIsRejectDialogOpen(false);
        setRejectionReason("");
        await fetchDetails();
      } else {
        toast.error(result.error || "Gagal menolak");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
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
    setModTanggal(po?.po_tanggal ? String(po.po_tanggal).slice(0, 10) : "");
    setModEstimasi(po?.po_estimasi ? String(po.po_estimasi).slice(0, 10) : "");
    setModPaymentTerm(po?.po_payment_term || "");
    setModKeterangan(po?.po_keterangan || "");
    setModItemsList(
      poItems.map((i) => ({
        id: i.id,
        part_number: i.part_number,
        qty: i.qty,
      })),
    );
    setModDeletedItemIds([]);
    setModApprovals((po?.approvals || []).map(normalizeApprovalStep));
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

  const modPreviouslyApprovedLike =
    !!po && ["approved", "completed", "closed"].includes(po.po_status);
  const modWillBeApproved =
    modApprovals.length > 0 &&
    modApprovals.every((a) => a.status === "approved");
  const modDowngradeLocked =
    modPreviouslyApprovedLike &&
    !!po?.po_receive_status &&
    po.po_receive_status !== "pending";
  const modBlockedDowngrade =
    modEditMode && modDowngradeLocked && !modWillBeApproved;

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
        const original = poItems.find((p) => p.id === m.id);
        return original && original.qty !== m.qty;
      })
      .map((m) => ({ id: m.id, qty: m.qty }));

    setModSaving(true);
    const res = await moderatorEditPO(Number(poId), {
      po_tanggal: modTanggal || undefined,
      po_estimasi: modEstimasi || null,
      po_payment_term: modPaymentTerm || null,
      po_keterangan: modKeterangan || null,
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
    await fetchDetails();
    setModSaving(false);
  };

  const itemsByVendor = React.useMemo(() => {
    const map: Record<string, { vendor: any; items: any[] }> = {};
    for (const item of poItems) {
      const key = item.vendor_id?.toString() ?? "null";
      if (!map[key]) {
        map[key] = { vendor: item.vendors, items: [] };
      }
      map[key].items.push(item);
    }
    return Object.entries(map);
  }, [poItems]);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(n);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-bold text-[10px] uppercase"
          >
            Pending Approval
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
      case "closed":
        return (
          <Badge className="bg-success/10 text-success border-none font-bold text-[10px] uppercase">
            Completed
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

  const getReceiveBadge = (status: string) => {
    switch (status) {
      case "complete":
        return (
          <Badge className="bg-success/10 text-success border-none font-bold text-[10px] uppercase">
            Selesai
          </Badge>
        );
      case "partial":
        return (
          <Badge
            variant="outline"
            className="text-warning border-warning/30 bg-warning/10 font-bold text-[10px] uppercase"
          >
            Partial
          </Badge>
        );
      default:
        return (
          <Badge
            variant="secondary"
            className="font-bold text-[10px] uppercase text-muted-foreground"
          >
            Menunggu
          </Badge>
        );
    }
  };

  if (loading && !po) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-bold uppercase tracking-widest animate-pulse">
            Memuat Dokumen PO...
          </p>
        </div>
      </div>
    );
  }

  if (!loading && !po) {
    return (
      <Content>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-bold text-foreground uppercase">
              Purchase Order tidak ditemukan
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Dokumen dengan ID ini tidak ada atau sudah dihapus.
            </p>
          </div>
          <Link href="/po">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Kembali ke Daftar PO
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
            <Link href="/po">
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
                  {po?.po_kode}
                </h1>
                {getStatusBadge(po?.po_status)}
                {getReceiveBadge(po?.po_receive_status)}
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1 flex items-center gap-1.5">
                <User className="h-3 w-3" /> {po?.po_pic || "-"}
                <span className="mx-1">·</span>
                <Building2 className="h-3 w-3" />{" "}
                {po?.prs?.cabang?.nama_cabang || "-"}
              </p>
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
                      ? "Tidak bisa disimpan: status approval akan turun dari 'approved' padahal PO sudah mulai diterima."
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
            {["approved", "completed"].includes(po?.po_status) && (
              <Button
                onClick={() => window.open(`/po/${poId}/print`, "_blank")}
                variant="outline"
                size="sm"
                className="gap-2 font-semibold"
              >
                <Printer className="h-4 w-4" /> Cetak PO
              </Button>
            )}
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
              Mode Moderator Edit aktif — header (non-harga), qty item, dan
              jalur/status approval bisa diubah bebas, di luar giliran
              approval normal. Harga & vendor tidak bisa diedit di mode ini.
              Tambah item baru tidak didukung. Perubahan tercatat di Riwayat
              Moderator Edit.
            </p>
          </div>
        </Content>
      )}

      <Content title="Informasi PO">
        {modEditMode ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[9px] font-bold uppercase text-muted-foreground">
                Tanggal PO
              </Label>
              <Input
                type="date"
                value={modTanggal}
                onChange={(e) => setModTanggal(e.target.value)}
                className="h-9 text-[11px] font-bold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[9px] font-bold uppercase text-muted-foreground">
                Estimasi Terima
              </Label>
              <Input
                type="date"
                value={modEstimasi}
                onChange={(e) => setModEstimasi(e.target.value)}
                className="h-9 text-[11px] font-bold"
              />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-[9px] font-bold uppercase text-muted-foreground">
                Syarat Pembayaran
              </Label>
              <Input
                value={modPaymentTerm}
                onChange={(e) => setModPaymentTerm(e.target.value)}
                placeholder="mis. Net 30"
                className="h-9 text-[11px] font-bold"
              />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-[9px] font-bold uppercase text-muted-foreground">
                Keterangan
              </Label>
              <Textarea
                value={modKeterangan}
                onChange={(e) => setModKeterangan(e.target.value)}
                className="min-h-16 resize-none text-[11px]"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                Tanggal PO
              </p>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                {formatDate(po?.po_tanggal)}
              </div>
            </div>
            <div className="bg-muted/40 border border-border rounded-lg p-3">
              <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                Estimasi Terima
              </p>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                <Truck className="h-3 w-3 text-muted-foreground" />
                {formatDate(po?.po_estimasi)}
              </div>
            </div>
            {po?.po_payment_term && (
              <div className="sm:col-span-2 bg-muted/40 border border-border rounded-lg p-3">
                <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                  Syarat Pembayaran
                </p>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                  <CreditCard className="h-3 w-3 text-muted-foreground" />
                  {po.po_payment_term}
                </div>
              </div>
            )}
            {po?.po_keterangan && (
              <div className="sm:col-span-2 bg-muted/40 border border-border rounded-lg p-3">
                <p className="text-[9px] font-bold uppercase text-muted-foreground mb-1">
                  Keterangan
                </p>
                <p className="text-[11px] text-foreground whitespace-pre-wrap">
                  {po.po_keterangan}
                </p>
              </div>
            )}
          </div>
        )}
      </Content>

      <Content title="Referensi Purchase Request">
        <div className="flex flex-wrap items-center gap-2">
          {linkedPrs.length > 0 ? (
            linkedPrs.map((pr) => (
              <Link key={pr.id} href={`/pr/${pr.id}`}>
                <Badge
                  variant="outline"
                  className="text-[10px] font-bold uppercase font-mono hover:bg-muted transition-colors cursor-pointer"
                >
                  {pr.pr_kode}
                </Badge>
              </Link>
            ))
          ) : (
            <span className="text-xs text-muted-foreground italic">
              {po?.prs?.pr_kode || "-"}
            </span>
          )}
        </div>
      </Content>

      {((po?.approvals && po.approvals.length > 0) || modEditMode) && (
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
                        Tidak bisa disimpan: PO ini sudah mulai diterima
                        (partial/complete), tapi jalur approval yang Anda atur
                        sekarang membuat status turun dari{" "}
                        <strong>approved</strong>. Kembalikan semua tahap ke
                        approved, atau bereskan dulu penerimaannya sebelum
                        menurunkan status.
                      </>
                    ) : (
                      <>
                        PO ini sudah mulai diterima (partial/complete). Status
                        approval tidak bisa diturunkan dari{" "}
                        <strong>approved</strong> selama penerimaan tersebut
                        belum dibereskan.
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
              <div className="space-y-2">
                {(po.approvals as any[]).map((step: any, i: number) => (
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
                        {step.nama}
                      </p>
                      <p className="text-[9px] text-muted-foreground font-medium uppercase">
                        {step.type}
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
                          {step.processed_at
                            ? formatDate(step.processed_at)
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isMyTurn && po?.po_status === "open" && !modEditMode && (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl space-y-3">
                <div className="flex items-start gap-2 text-[10px] text-primary font-bold uppercase">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  Giliran Anda untuk menyetujui PO ini
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 gap-2 font-bold text-xs uppercase"
                    onClick={handleApprove}
                    disabled={submitting}
                  >
                    {submitting ? (
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
                    onClick={() => setIsRejectDialogOpen(true)}
                    disabled={submitting}
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

      <Content title="Daftar Item (per Vendor)">
        <div className="space-y-4">
          {itemsByVendor.map(([vendorKey, group]) => {
            const total = group.items.reduce(
              (sum, it) => sum + it.qty * it.harga,
              0,
            );
            return (
              <div
                key={vendorKey}
                className="border border-border rounded-xl overflow-hidden shadow-sm"
              >
                <div className="flex items-center justify-between bg-muted/60 px-4 py-2.5 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-bold text-foreground uppercase wrap-break-word">
                      {group.vendor?.vendor_name ?? "Vendor Belum Ditentukan"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-foreground">
                      {maskedPriceText(canViewPrice, formatCurrency(total))}
                    </span>
                    {["approved", "completed"].includes(po?.po_status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[9px] font-bold uppercase gap-1 text-primary"
                        onClick={() =>
                          window.open(
                            `/po/${poId}/print?vendor_id=${vendorKey}`,
                            "_blank",
                          )
                        }
                      >
                        <Printer className="h-3 w-3" /> Cetak
                      </Button>
                    )}
                  </div>
                </div>
                <Table className="table-fixed w-full">
                  <TableHeader className="bg-muted/20">
                    <TableRow className="h-8 hover:bg-transparent border-b border-border/50">
                      <TableHead className="text-[9px] font-bold uppercase text-muted-foreground pl-4 w-28">
                        Part No.
                      </TableHead>
                      <TableHead className="text-[9px] font-bold uppercase text-muted-foreground">
                        Nama Barang
                      </TableHead>
                      <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right w-20">
                        Qty
                      </TableHead>
                      <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right pr-4 w-24">
                        Diterima
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((item: any) => {
                      const isComplete = item.qty_received >= item.qty;
                      return (
                        <TableRow
                          key={item.id}
                          className="border-b border-border/30 hover:bg-muted/20"
                        >
                          <TableCell className="pl-4 py-2.5">
                            <span
                              className="inline-block max-w-full rounded bg-muted px-1.5 py-0.5 text-sm font-mono font-black text-foreground break-all tracking-wide"
                              title={item.part_number}
                            >
                              {item.part_number}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5 min-w-0">
                            <p
                              className="text-[10px] font-medium text-muted-foreground leading-tight truncate"
                              title={item.part_name}
                            >
                              {item.part_name}
                            </p>
                            <p className="text-[9px] text-muted-foreground font-medium">
                              {maskedPriceText(
                                canViewPrice,
                                `${formatCurrency(item.harga)} / ${item.satuan}`,
                              )}
                            </p>
                          </TableCell>
                          <TableCell className="text-right py-2.5">
                            {modEditMode ? (
                              modDeletedItemIds.includes(item.id) ? (
                                <span className="text-[9px] font-bold text-destructive italic">
                                  Dihapus
                                </span>
                              ) : (
                                <div className="flex items-center justify-end gap-1">
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
                                    className="h-7 w-16 text-[11px] font-bold px-1.5 text-right"
                                  />
                                  <button
                                    onClick={() => modDeleteItem(item.id)}
                                    className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )
                            ) : (
                              <>
                                <span className="text-[11px] font-bold text-foreground">
                                  {item.qty}
                                </span>
                                <span className="text-[9px] text-muted-foreground ml-1">
                                  {item.satuan}
                                </span>
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-4 py-2.5">
                            <span
                              className={cn(
                                "text-[11px] font-bold",
                                isComplete
                                  ? "text-success"
                                  : item.qty_received > 0
                                    ? "text-warning"
                                    : "text-muted-foreground",
                              )}
                            >
                              {item.qty_received}
                            </span>
                            <span className="text-[9px] text-muted-foreground ml-0.5">
                              / {item.qty}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            );
          })}
        </div>
      </Content>

      <Content>
        <ModeratorEditLogPanel
          docType="po"
          docId={Number(poId)}
          refreshKey={modLogRefreshKey}
        />
      </Content>

      {/* Reject Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Purchase Order</DialogTitle>
            <DialogDescription>
              Berikan alasan penolakan PO <strong>{po?.po_kode}</strong>
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
                setIsRejectDialogOpen(false);
                setRejectionReason("");
              }}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={submitting || !rejectionReason.trim()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Konfirmasi Tolak"
              )}
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
