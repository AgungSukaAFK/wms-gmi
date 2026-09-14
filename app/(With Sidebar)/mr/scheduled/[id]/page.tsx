"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  Loader2,
  CalendarRange,
  Clock,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  Snowflake,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/lib/utils";
import { approveMR, rejectMR } from "@/services/procurement-actions";
import { evaluateMrItemFreezeForMr } from "@/services/freeze-actions";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { MrItemFreezePanel } from "@/components/mr/mr-item-freeze-panel";
import Link from "next/link";

const PRIORITY_COLOR: Record<string, string> = {
  P1: "text-destructive border-destructive/30 bg-destructive/10",
  P2: "text-warning border-warning/30 bg-warning/10",
  P3: "text-primary border-primary/30 bg-primary/10",
  P4: "text-muted-foreground border-border bg-muted",
};

export default function ScheduledMRDetailPage() {
  const { id: mrId } = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [mr, setMr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchDetails = async () => {
    setLoading(true);
    await evaluateMrItemFreezeForMr(Number(mrId)).catch(() => {});

    const { data: mrData } = await supabase
      .from("mrs")
      .select("*, cabang(nama_cabang)")
      .eq("id", mrId)
      .single();
    setMr(mrData);

    const { data: itemsData } = await supabase
      .from("mr_items")
      .select("*, item_site_cabang:cabang!mr_items_item_site_cabang_id_fkey(nama_cabang)")
      .eq("mr_id", mrId)
      .order("item_due_date");
    setItems(itemsData || []);

    setLoading(false);
  };

  useEffect(() => {
    if (mrId) fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrId]);

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextApprover =
    mr?.mr_status === "open"
      ? mr?.approvals?.find((a: any) => a.status === "pending")
      : null;
  const isPendingApprover =
    currentUser &&
    nextApprover &&
    (nextApprover.user_id === currentUser.id ||
      nextApprover.userid === currentUser.id);

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("Alasan penolakan harus diisi");
      return;
    }
    setSubmitting(true);
    const result = await rejectMR(Number(mrId), rejectionReason);
    setSubmitting(false);
    if (result.success) {
      toast.success("Scheduled MR berhasil ditolak");
      setIsRejectDialogOpen(false);
      fetchDetails();
    } else {
      toast.error(result.error || "Gagal menolak MR");
    }
  };

  const handleApproveConfirm = async (signature: any) => {
    setSubmitting(true);
    // Scheduled MR: alokasi PR/Share-Stock sudah diputuskan requester saat
    // create, jadi tidak ada allocations yang perlu dikirim di sini.
    const result = await approveMR(Number(mrId), signature.image_url, undefined);
    setSubmitting(false);
    if (result.success) {
      toast.success("Scheduled MR berhasil disetujui");
      setIsSignatureDialogOpen(false);
      fetchDetails();
    } else {
      toast.error(result.error || "Gagal menyetujui MR");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-100 font-bold text-[10px] uppercase">
            Open
          </Badge>
        );
      case "approved":
        return <Badge className="bg-green-600 text-white font-bold text-[10px] uppercase">Approved</Badge>;
      case "rejected":
        return <Badge className="bg-destructive text-destructive-foreground font-bold text-[10px] uppercase">Rejected</Badge>;
      case "completed":
      case "done":
      case "closed":
        return <Badge className="bg-emerald-600 text-white font-bold text-[10px] uppercase">Completed</Badge>;
      default:
        return <Badge variant="outline" className="font-bold text-[10px] uppercase">{status}</Badge>;
    }
  };

  if (loading || !mr) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const frozenItems = items.filter((i) => i.is_item_frozen);

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => router.back()}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                  {mr.mr_kode}
                </h1>
                {getStatusBadge(mr.mr_status)}
                {Array.from(
                  new Set(
                    items.map((i: any) => i.item_priority).filter(Boolean),
                  ),
                ).map((p: any) => (
                  <Badge
                    key={p}
                    variant="outline"
                    className={`font-bold text-[10px] uppercase ${PRIORITY_COLOR[p] || ""}`}
                  >
                    {p}
                  </Badge>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Scheduled Material Request
              </p>
            </div>
          </div>
          <Link href={`/mr/scheduled/print/${mrId}`} target="_blank">
            <Button variant="outline" size="sm" className="h-9 gap-2 text-xs font-bold">
              <Printer className="h-3.5 w-3.5" /> Cetak
            </Button>
          </Link>
        </div>
      </Content>

      <div className="col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 space-y-4">
          <Content title="Informasi Utama">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Requester</p>
                <p className="font-semibold">{mr.mr_pic}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Cabang</p>
                <p className="font-semibold">{mr.cabang?.nama_cabang || "-"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Tgl Input</p>
                <p className="font-semibold">{mr.mr_tanggal ? formatDate(mr.mr_tanggal) : "-"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Rentang Due Date</p>
                <p className="font-semibold">
                  {items.length > 0
                    ? `${formatDate(items[0].item_due_date)} — ${formatDate(items[items.length - 1].item_due_date)}`
                    : "-"}
                </p>
              </div>
            </div>
          </Content>

          {frozenItems.length > 0 && (
            <Content title={`Item Di-Freeze (${frozenItems.length})`}>
              <div className="space-y-3">
                {frozenItems.map((item) => (
                  <div key={item.id} className="space-y-1.5">
                    <p className="text-xs font-bold">
                      {item.part_number} — {item.part_name}
                    </p>
                    <MrItemFreezePanel
                      mrItemId={item.id}
                      currentUserId={currentUser?.id}
                      onChanged={fetchDetails}
                    />
                  </div>
                ))}
              </div>
            </Content>
          )}

          <Content title={`Daftar Item (${items.length})`}>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="h-10 hover:bg-transparent">
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                    <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Due Date</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Priority</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Site</TableHead>
                    <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Alokasi</TableHead>
                    <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} className="h-14">
                      <TableCell>
                        <code className="block text-sm font-bold">{item.part_number}</code>
                        <span className="block text-[10px] text-muted-foreground truncate max-w-40">
                          {item.part_name}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-xs font-bold">
                        {item.qty_request} {item.satuan}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {item.item_due_date ? formatDate(item.item_due_date) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-bold ${PRIORITY_COLOR[item.item_priority] || ""}`}>
                          {item.item_priority || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.item_site_cabang?.nama_cabang || "-"}
                      </TableCell>
                      <TableCell className="text-[11px] font-medium">
                        PR {item.qty_pr} / SS {item.qty_sharestock_total}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.is_item_frozen ? (
                          <Badge className="gap-1 bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[9px]">
                            <Snowflake className="h-3 w-3" /> Frozen
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Content>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <Content title="Tindakan">
            <div className="space-y-4">
              {isPendingApprover ? (
                <div className="flex flex-col gap-3">
                  <Button
                    className="w-full h-12 gap-2 bg-success hover:bg-success/90 text-success-foreground font-black uppercase text-xs tracking-widest shadow-lg"
                    onClick={() => setIsSignatureDialogOpen(true)}
                    disabled={submitting}
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
                    Setujui & Tandatangan
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-12 gap-2 border-border text-foreground hover:bg-destructive/5 hover:text-destructive hover:border-destructive/30 font-bold uppercase text-xs transition-all"
                    onClick={() => setIsRejectDialogOpen(true)}
                    disabled={submitting}
                  >
                    <ThumbsDown className="h-4 w-4" /> Tolak Request
                  </Button>
                </div>
              ) : mr.mr_status === "rejected" ? (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-xs font-black uppercase tracking-tight">Request Ditolak</span>
                  </div>
                  <p className="text-xs text-muted-foreground italic font-medium leading-relaxed">
                    &quot;{mr.rejection_reason}&quot;
                  </p>
                </div>
              ) : (
                <div className="text-center py-6 bg-muted/30 rounded-xl border border-dashed border-border space-y-3">
                  <div className="h-10 w-10 rounded-full bg-background flex items-center justify-center mx-auto shadow-sm">
                    <Clock className="h-5 w-5 text-muted-foreground/40" />
                  </div>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-tight">
                    {mr.mr_status === "approved" ? "SELURUH PROSES SELESAI" : "MENUNGGU PROSES APPROVAL"}
                  </p>
                </div>
              )}
            </div>
          </Content>

          <Content title="Jalur Approval">
            <div className="space-y-2.5">
              {mr.approvals
                ?.slice()
                .sort((a: any, b: any) => a.step_order - b.step_order)
                .map((approval: any, idx: number) => {
                  const isApproved = approval.status === "approved";
                  const isPending = approval.status === "pending";
                  return (
                    <div key={idx} className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h5 className="text-[12px] font-black text-foreground uppercase tracking-tight leading-snug">
                          {idx + 1}. {approval.nama}
                        </h5>
                        {isApproved ? (
                          <Badge className="h-3.5 px-1.5 bg-success/10 text-success border-none text-[7px] font-black uppercase shrink-0">
                            Approved
                          </Badge>
                        ) : isPending ? (
                          <Badge variant="outline" className="h-3.5 px-1.5 text-primary border-primary/20 bg-primary/5 text-[7px] font-black uppercase shrink-0">
                            Current Step
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="h-3.5 px-1.5 text-muted-foreground border-border bg-muted/30 text-[7px] font-black uppercase shrink-0">
                            Pending
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-[9px] text-muted-foreground font-bold uppercase tracking-widest">
                        {approval.role || "Personnel"}
                      </p>
                      {isApproved ? (
                        <div className="flex items-center gap-1.5 mt-1.5 text-muted-foreground">
                          <Clock className="h-2.5 w-2.5 shrink-0" />
                          <span className="text-[9px] font-black uppercase tracking-tighter">
                            {formatDateTime(approval.processed_at)}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[9px] font-bold text-muted-foreground italic uppercase">
                          Menunggu giliran approval
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          </Content>
        </div>
      </div>

      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive uppercase font-black">
              <ThumbsDown className="h-5 w-5" /> Alasan Penolakan
            </DialogTitle>
            <DialogDescription>
              Berikan alasan penolakan yang jelas agar pemohon dapat melakukan perbaikan.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label className="text-[10px] font-black uppercase text-muted-foreground">Keterangan Penolakan</Label>
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Tulis alasan di sini..."
              className="h-32 resize-none text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsRejectDialogOpen(false)} disabled={submitting}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Konfirmasi Tolak"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MRSignatureDialog
        open={isSignatureDialogOpen}
        onOpenChange={setIsSignatureDialogOpen}
        onConfirm={handleApproveConfirm}
      />
    </>
  );
}
