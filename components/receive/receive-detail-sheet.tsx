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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  PackageCheck,
  User,
  Building2,
  Calendar,
  Package,
  ShoppingCart,
  ClipboardList,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Save,
  RotateCcw,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";
import { approveReceive, rejectReceive } from "@/services/procurement-actions";
import {
  moderatorEditReceive,
  ModeratorApprovalStep,
} from "@/services/moderator-edit-actions";
import { ApprovalFlowEditor } from "@/components/moderator/approval-flow-editor";
import { ModeratorEditLogPanel } from "@/components/moderator/moderator-edit-log-panel";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";

interface ReceiveDetailSheetProps {
  receiveId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReceiveDetailSheet({
  receiveId,
  open,
  onOpenChange,
}: ReceiveDetailSheetProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [receive, setReceive] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "approve" | "reject" | null
  >(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Moderator Edit state — edit bebas header (tanggal/PIC/keterangan), qty
  // item (selama belum completed), dan jalur/status approval, di luar giliran
  // approval normal. Lihat catatan lengkap di moderatorEditReceive.
  const [isModerator, setIsModerator] = useState(false);
  const [modEditMode, setModEditMode] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modTanggal, setModTanggal] = useState("");
  const [modPic, setModPic] = useState("");
  const [modKeterangan, setModKeterangan] = useState("");
  const [modApprovals, setModApprovals] = useState<ModeratorApprovalStep[]>([]);
  const [modItemsList, setModItemsList] = useState<
    { id: number; part_number: string; qty: number }[]
  >([]);
  const [modDeletedItemIds, setModDeletedItemIds] = useState<number[]>([]);
  const [modRejectionReason, setModRejectionReason] = useState("");
  const [modLogRefreshKey, setModLogRefreshKey] = useState(0);

  useEffect(() => {
    if (open && receiveId) {
      fetchCurrentUser();
      fetchDetail(receiveId);
    } else if (!open) {
      setReceive(null);
      setItems([]);
      setPendingAction(null);
      setRejectionReason("");
      setModEditMode(false);
    }
  }, [open, receiveId]);

  const fetchCurrentUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCurrentUser(null);
      setIsModerator(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, nama, email, roles:user_roles(roles(name,label))")
      .eq("id", user.id)
      .single();

    setCurrentUser(profile || { id: user.id });
    setIsModerator(
      ((profile as any)?.roles || []).some(
        (r: any) => r.roles?.name === "moderator",
      ),
    );
  };

  const fetchDetail = async (id: number) => {
    setLoading(true);
    const { data } = await supabase
      .from("receives")
      .select(
        `
          id, ri_kode, ri_tanggal, ri_pic, ri_pic_id, ri_keterangan, ri_status, approvals, rejection_reason, created_at,
          cabang(id, nama_cabang),
          pos(id, po_kode)
        `,
      )
      .eq("id", id)
      .single();

    if (data) setReceive(data);

    const { data: riItems } = await supabase
      .from("receive_items")
      .select("id, part_number, part_name, satuan, qty, mr_id, part_id, po_item_id")
      .eq("ri_id", id)
      .order("id");

    setItems(riItems || []);
    setLoading(false);
  };

  const totalQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);
  const approvals: any[] = receive?.approvals ?? [];
  const nextPendingApproval = approvals.find(
    (a: any) => a.status === "pending",
  );
  const isMyTurn =
    Boolean(currentUser?.id) &&
    Boolean(nextPendingApproval) &&
    nextPendingApproval.userid === currentUser.id;

  const getStatusBadge = (status?: string) => {
    if (status === "completed") {
      return (
        <Badge className="text-[10px] font-bold uppercase bg-green-600 text-white">
          Completed
        </Badge>
      );
    }

    if (status === "rejected") {
      return (
        <Badge
          variant="destructive"
          className="text-[10px] font-bold uppercase"
        >
          Rejected
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="text-[10px] font-bold uppercase">
        Open
      </Badge>
    );
  };

  const openApproveFlow = () => {
    setPendingAction("approve");
    setSignatureDialogOpen(true);
  };

  const openRejectFlow = () => {
    if (!rejectionReason.trim()) {
      toast.error("Alasan penolakan wajib diisi");
      return;
    }
    setPendingAction("reject");
    setSignatureDialogOpen(true);
  };

  const handleConfirmSignature = async (signature: {
    id: string;
    image_url: string;
    label: string;
  }) => {
    if (!receiveId || !pendingAction) return;

    setApprovalSubmitting(true);
    try {
      if (pendingAction === "approve") {
        const result = await approveReceive(receiveId, signature.image_url);
        if (!result?.success) {
          toast.error(('error' in result && result.error) || "Gagal menyetujui receive");
        } else {
          const isAllDone = "isAllDone" in result && result.isAllDone;
          toast.success(
            isAllDone ? "Receive completed" : "Approval receive berhasil",
          );
          fetchDetail(receiveId);
        }
      } else {
        const result = await rejectReceive(
          receiveId,
          rejectionReason.trim(),
          signature.image_url,
        );
        if (!result?.success) {
          toast.error(result?.error || "Gagal menolak receive");
        } else {
          toast.success("Receive ditolak");
          fetchDetail(receiveId);
          setRejectionReason("");
        }
      }
    } finally {
      setApprovalSubmitting(false);
      setPendingAction(null);
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
    setModTanggal(receive?.ri_tanggal ? String(receive.ri_tanggal).slice(0, 10) : "");
    setModPic(receive?.ri_pic || "");
    setModKeterangan(receive?.ri_keterangan || "");
    setModItemsList(items.map((i) => ({ id: i.id, part_number: i.part_number, qty: i.qty })));
    setModDeletedItemIds([]);
    setModApprovals(approvals.map(normalizeApprovalStep));
    setModRejectionReason(receive?.rejection_reason || "");
    setModEditMode(true);
  };

  const modDeleteItem = (id: number) => {
    setModDeletedItemIds((prev) => [...prev, id]);
    setModItemsList((prev) => prev.filter((i) => i.id !== id));
  };

  const modUpdateItemQty = (id: number, qty: number) => {
    setModItemsList((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
  };

  // Downgrade-lock: receive yang sudah completed (stok & qty_received sudah
  // diposting) tidak boleh status approval-nya diturunkan dari 'completed',
  // dan item-nya tidak boleh diedit lagi.
  const modItemsLocked = receive?.ri_status === "completed";
  const modWillBeCompleted =
    modApprovals.length > 0 && modApprovals.every((a) => a.status === "approved");
  const modDowngradeLocked = modItemsLocked;
  const modBlockedDowngrade = modEditMode && modDowngradeLocked && !modWillBeCompleted;
  const modWillReject = modApprovals.some((a) => a.status === "rejected");

  const handleModSaveEdit = async () => {
    if (!receiveId) return;
    if (modApprovals.length === 0) {
      toast.error("Jalur approval tidak boleh kosong.");
      return;
    }
    if (modApprovals.some((a) => !a.userid || !a.nama)) {
      toast.error("Setiap tahap approval harus punya approver yang dipilih.");
      return;
    }
    if (modWillReject && !modRejectionReason.trim()) {
      toast.error("Alasan penolakan wajib diisi karena ada tahap berstatus rejected.");
      return;
    }

    const updatedItems = modItemsList
      .filter((m) => {
        const original = items.find((p) => p.id === m.id);
        return original && original.qty !== m.qty;
      })
      .map((m) => ({ id: m.id, qty: m.qty }));

    setModSaving(true);
    const res = await moderatorEditReceive(Number(receiveId), {
      ri_tanggal: modTanggal || undefined,
      ri_pic: modPic || undefined,
      ri_keterangan: modKeterangan || null,
      updatedItems: updatedItems.length > 0 ? updatedItems : undefined,
      deletedItemIds: modDeletedItemIds.length > 0 ? modDeletedItemIds : undefined,
      approvals: modApprovals,
      rejection_reason: modWillReject ? modRejectionReason.trim() : undefined,
    });
    if (res.error) {
      toast.error(res.error);
      setModSaving(false);
      return;
    }
    toast.success("Moderator Edit berhasil disimpan.");
    setModEditMode(false);
    setModLogRefreshKey((k) => k + 1);
    await fetchDetail(receiveId);
    setModSaving(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-slate-200 overflow-hidden shadow-2xl">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
              <PackageCheck className="h-4 w-4 text-primary" />
              Detail Penerimaan Barang
            </SheetTitle>
            {isModerator && !modEditMode && receive && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[10px] font-bold border-amber-300 text-amber-600 hover:bg-amber-50 shrink-0"
                onClick={enterModEditMode}
              >
                <ShieldAlert className="h-3 w-3" /> Moderator Edit
              </Button>
            )}
            {modEditMode && (
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-[10px] font-bold text-muted-foreground"
                  onClick={() => setModEditMode(false)}
                  disabled={modSaving}
                >
                  <RotateCcw className="h-3 w-3" /> Batal
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={handleModSaveEdit}
                  disabled={modSaving || modBlockedDowngrade}
                  title={
                    modBlockedDowngrade
                      ? "Tidak bisa disimpan: status approval akan turun dari 'completed' padahal stok sudah diposting."
                      : undefined
                  }
                >
                  {modSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  Simpan
                </Button>
              </div>
            )}
          </div>
          <SheetDescription className="text-[10px] uppercase font-bold">
            Informasi lengkap dokumen Receive Item
          </SheetDescription>
        </SheetHeader>

        {modEditMode && (
          <div className="px-6 pt-4 -mb-2">
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Mode Moderator Edit aktif — header (tanggal/PIC/keterangan)
                {modItemsLocked ? "" : ", qty item,"} dan jalur/status approval
                bisa diubah bebas, di luar giliran approval normal.
                {modItemsLocked
                  ? " Receive ini sudah completed sehingga item & downgrade status tidak bisa diubah."
                  : ""}{" "}
                Perubahan tercatat di Riwayat Moderator Edit.
              </p>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !receive ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <PackageCheck className="h-8 w-8 opacity-30" />
              <p className="text-xs font-medium">Data tidak ditemukan</p>
            </div>
          ) : (
            <div className="space-y-6 p-6">
              {/* Header Info */}
              <div className="grid grid-cols-2 gap-4">
                {/* Kode RI */}
                <div className="col-span-2 space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground">
                    Kode RI
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black text-lg text-foreground font-mono uppercase tracking-wide">
                      {receive.ri_kode}
                    </p>
                    {getStatusBadge(receive.ri_status)}
                  </div>
                </div>

                {/* Tanggal */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Tanggal
                  </p>
                  {modEditMode ? (
                    <Input
                      type="date"
                      value={modTanggal}
                      onChange={(e) => setModTanggal(e.target.value)}
                      className="h-8 text-[11px] font-bold"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-foreground">
                      {formatDate(receive.ri_tanggal)}
                    </p>
                  )}
                </div>

                {/* PIC */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" /> PIC / Penerima
                  </p>
                  {modEditMode ? (
                    <Input
                      value={modPic}
                      onChange={(e) => setModPic(e.target.value)}
                      className="h-8 text-[11px] font-bold"
                    />
                  ) : (
                    <p className="text-sm font-semibold text-foreground">
                      {receive.ri_pic || "-"}
                    </p>
                  )}
                </div>

                {/* Lokasi */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> Lokasi / Cabang
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {receive.cabang?.nama_cabang || "-"}
                  </p>
                </div>

                {/* PO Referensi */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                    <ShoppingCart className="h-3 w-3" /> No. Purchase Order
                  </p>
                  <p className="text-sm font-bold text-foreground">
                    {receive.pos?.po_kode || "-"}
                  </p>
                </div>

                {/* Keterangan */}
                {(receive.ri_keterangan || modEditMode) && (
                  <div className="col-span-2 space-y-1.5">
                    <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                      <ClipboardList className="h-3 w-3" /> Keterangan
                    </p>
                    {modEditMode ? (
                      <Textarea
                        value={modKeterangan}
                        onChange={(e) => setModKeterangan(e.target.value)}
                        className="min-h-16 resize-none text-xs"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                        {receive.ri_keterangan}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* Approval */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Alur Approval Receive
                  </p>
                </div>

                {modEditMode ? (
                  <div className="space-y-3">
                    {modDowngradeLocked && (
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2.5 text-[11px] font-semibold leading-relaxed",
                          modBlockedDowngrade
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {modBlockedDowngrade ? (
                          <>
                            Tidak bisa disimpan: receive ini sudah completed dan
                            stoknya sudah diposting, tapi jalur approval yang
                            Anda atur sekarang membuat status turun dari{" "}
                            <strong>completed</strong>. Kembalikan semua tahap
                            ke approved.
                          </>
                        ) : (
                          <>
                            Receive ini sudah completed. Status approval tidak
                            bisa diturunkan dari <strong>completed</strong>{" "}
                            karena stok sudah diposting.
                          </>
                        )}
                      </div>
                    )}
                    <ApprovalFlowEditor steps={modApprovals} onChange={setModApprovals} />
                    {modWillReject && (
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                          Alasan Penolakan
                        </Label>
                        <Textarea
                          value={modRejectionReason}
                          onChange={(e) => setModRejectionReason(e.target.value)}
                          placeholder="Wajib diisi karena ada tahap berstatus rejected..."
                          className="min-h-16 text-xs"
                        />
                      </div>
                    )}
                  </div>
                ) : approvals.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-[10px] font-medium text-muted-foreground">
                    Approval belum terdefinisi pada dokumen ini.
                  </div>
                ) : (
                  <div className="rounded-lg border border-border overflow-hidden">
                    {approvals.map((step: any, idx: number) => (
                      <div
                        key={`${step.userid}-${idx}`}
                        className="flex items-start gap-3 p-3 border-b last:border-b-0"
                      >
                        <div className="pt-0.5">
                          {step.status === "approved" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : step.status === "rejected" ? (
                            <XCircle className="h-4 w-4 text-red-600" />
                          ) : (
                            <Clock className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold uppercase text-foreground truncate">
                            {step.nama || "Unknown"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {step.email || "-"}
                          </p>
                          {step.notes && (
                            <p className="text-[10px] text-muted-foreground mt-1 italic">
                              {step.notes}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={
                            step.status === "approved"
                              ? "default"
                              : step.status === "rejected"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[9px] font-bold uppercase"
                        >
                          {step.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}

                {!modEditMode && receive?.rejection_reason && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">
                    <span className="font-bold uppercase">Alasan Reject:</span>{" "}
                    {receive.rejection_reason}
                  </div>
                )}

                {!modEditMode && isMyTurn && receive?.ri_status === "open" && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Aksi Approval Anda
                    </p>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 h-8 text-[10px] font-bold uppercase"
                        onClick={openApproveFlow}
                        disabled={approvalSubmitting}
                      >
                        Setujui
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1 h-8 text-[10px] font-bold uppercase"
                        onClick={openRejectFlow}
                        disabled={approvalSubmitting}
                      >
                        Tolak
                      </Button>
                    </div>
                    <Textarea
                      value={rejectionReason}
                      onChange={(event) =>
                        setRejectionReason(event.target.value)
                      }
                      placeholder="Alasan penolakan (wajib saat tolak)"
                      className="min-h-16 text-xs"
                    />
                  </div>
                )}
              </div>

              <Separator />

              {/* Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    Daftar Barang Diterima
                  </p>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="secondary"
                      className="text-[9px] font-bold gap-1"
                    >
                      <Package className="h-2.5 w-2.5" />
                      {items.length} jenis
                    </Badge>
                    <Badge className="text-[9px] font-bold gap-1 bg-primary/10 text-primary border-primary/20">
                      Total: {totalQty} pcs
                    </Badge>
                  </div>
                </div>

                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="h-9 hover:bg-transparent">
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground pl-4 w-32">
                          Part No.
                        </TableHead>
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground">
                          Nama Barang
                        </TableHead>
                        <TableHead className="text-[9px] font-black uppercase text-muted-foreground text-right pr-4 w-24">
                          Qty
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="h-16 text-center text-xs text-muted-foreground font-medium"
                          >
                            Tidak ada item
                          </TableCell>
                        </TableRow>
                      ) : (
                        items.map((item) => (
                          <TableRow
                            key={item.id}
                            className="border-b border-border/50 h-11 hover:bg-muted/20"
                          >
                            <TableCell className="pl-4">
                              <span className="text-sm font-black font-mono uppercase tracking-wide text-foreground">
                                {item.part_number}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-[10px] font-medium text-muted-foreground uppercase leading-snug">
                                {item.part_name}
                              </span>
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              {modEditMode && !modItemsLocked ? (
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
                                <span className="text-xs font-bold text-foreground">
                                  {item.qty}{" "}
                                  <span className="text-muted-foreground font-medium text-[10px]">
                                    {item.satuan}
                                  </span>
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <ModeratorEditLogPanel
                docType="receive"
                docId={Number(receiveId)}
                refreshKey={modLogRefreshKey}
              />

              {/* Footer meta */}
              <div className="flex items-center justify-end">
                <p className="text-[9px] font-medium text-muted-foreground/60 uppercase">
                  Dibuat:{" "}
                  {formatDateTime(receive.created_at)}
                </p>
              </div>
            </div>
          )}
        </div>

        <MRSignatureDialog
          open={signatureDialogOpen}
          onOpenChange={setSignatureDialogOpen}
          onConfirm={handleConfirmSignature}
        />
      </SheetContent>
    </Sheet>
  );
}
