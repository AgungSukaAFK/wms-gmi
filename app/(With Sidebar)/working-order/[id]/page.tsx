"use client";

import React, { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Factory,
  Building2,
  Calendar,
  User,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  Beaker,
  Printer,
  Pencil,
  Flag,
  History,
} from "lucide-react";
import { toast } from "sonner";
import {
  getWorkingOrderDetail,
  getWoEditLogs,
  approveWorkingOrder,
  rejectWorkingOrder,
  closeWorkingOrder,
  editWorkingOrder,
} from "@/services/working-order-actions";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "Pending Approval": "secondary",
  "On Process": "default",
  Closed: "outline",
  Rejected: "destructive",
};

export default function WorkingOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = usePromise(params);
  const woId = Number(id);
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [wo, setWo] = useState<any>(null);
  const [editLogs, setEditLogs] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [roleNames, setRoleNames] = useState<string[]>([]);

  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<
    { id: number; part_number: string; qty: string; lead_time_days: string; deadline_date: string }[]
  >([]);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    void load();
  }, [woId]);

  async function load() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setCurrentUser(user);
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      setRoleNames((roleRows || []).map((r: any) => r.roles?.name).filter(Boolean));
    }
    const { data, error } = await getWorkingOrderDetail(woId);
    if (error || !data) {
      toast.error(error || "WO tidak ditemukan.");
    } else {
      setWo(data);
    }
    const { data: logs } = await getWoEditLogs(woId);
    setEditLogs(logs || []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!wo) return null;

  const approvals: any[] = wo.approvals || [];
  const nextPending = approvals.find((a: any) => a.status === "pending");
  const isMyTurn = Boolean(currentUser?.id) && Boolean(nextPending) && nextPending.userid === currentUser.id;
  const isModerator = roleNames.includes("moderator");
  const approverIds = approvals.map((a: any) => a.userid).filter(Boolean);
  const isApproverOrModerator = isModerator || approverIds.includes(currentUser?.id);
  const canEdit =
    (wo.wo_status === "Pending Approval" && (isModerator || wo.wo_pic_id === currentUser?.id)) ||
    (wo.wo_status === "On Process" && isApproverOrModerator);
  const canClose = wo.wo_status === "On Process" && isApproverOrModerator;
  const crossCabang = wo.mrs?.cabang_id && wo.cabang?.id && wo.mrs.cabang_id !== wo.cabang.id;

  function openApprove() {
    setPendingAction("approve");
    setSignatureOpen(true);
  }
  function openReject() {
    if (!rejectionReason.trim()) return toast.error("Alasan penolakan wajib diisi.");
    setPendingAction("reject");
    setSignatureOpen(true);
  }

  async function handleSignature(signature: { image_url: string }) {
    if (!pendingAction) return;
    setSubmitting(true);
    try {
      if (pendingAction === "approve") {
        const result = await approveWorkingOrder(woId, signature.image_url);
        if ((result as any).error) toast.error((result as any).error);
        else {
          toast.success((result as any).isAllDone ? "WO full approved — On Process" : "Approval WO berhasil");
          await load();
        }
      } else {
        const result = await rejectWorkingOrder(woId, rejectionReason.trim(), signature.image_url);
        if ((result as any).error) toast.error((result as any).error);
        else {
          toast.success("WO ditolak.");
          setRejectionReason("");
          await load();
        }
      }
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  }

  async function handleClose() {
    if (!confirm("Selesaikan WO ini? Qty produksi akan terdistribusi ke MR.")) return;
    const result = await closeWorkingOrder(woId);
    if ((result as any).error) toast.error((result as any).error);
    else {
      toast.success("WO diselesaikan.");
      await load();
    }
  }

  function openEdit() {
    setEditDraft(
      wo.items.map((i: any) => ({
        id: i.id,
        part_number: i.part_number,
        qty: String(i.qty),
        lead_time_days: i.lead_time_days != null ? String(i.lead_time_days) : "",
        deadline_date: i.deadline_date || "",
      })),
    );
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    setEditSaving(true);
    try {
      const result = await editWorkingOrder(
        woId,
        editDraft.map((d) => ({
          working_order_item_id: d.id,
          qty: Number(d.qty) || 0,
          lead_time_days: d.lead_time_days ? Number(d.lead_time_days) : null,
          deadline_date: d.deadline_date || null,
        })),
      );
      if ((result as any).error) toast.error((result as any).error);
      else {
        toast.success("WO berhasil diperbarui.");
        setEditOpen(false);
        await load();
      }
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/working-order">
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase font-mono">
                {wo.wo_kode}
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                MR {wo.mrs?.mr_kode}
              </p>
            </div>
            <Badge variant={STATUS_VARIANT[wo.wo_status] || "secondary"} className="text-xs font-bold uppercase ml-2">
              {wo.wo_status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/working-order/${woId}/material-release`}>
              <Button variant="outline" className="gap-2 text-xs font-bold uppercase">
                <Beaker className="h-4 w-4" /> Material Release
              </Button>
            </Link>
            {canEdit && (
              <Button variant="outline" className="gap-2 text-xs font-bold uppercase" onClick={openEdit}>
                <Pencil className="h-4 w-4" /> Edit WO
              </Button>
            )}
            {canClose && (
              <Button className="gap-2 text-xs font-bold uppercase" onClick={handleClose}>
                <Flag className="h-4 w-4" /> Selesaikan WO
              </Button>
            )}
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <InfoTile icon={<Building2 className="h-3.5 w-3.5" />} label="Gudang WO" value={wo.cabang?.nama_cabang} />
          <InfoTile icon={<Factory className="h-3.5 w-3.5" />} label="Departemen" value={wo.departemen} />
          <InfoTile icon={<Calendar className="h-3.5 w-3.5" />} label="Tanggal WO" value={formatDate(wo.wo_tanggal)} />
          <InfoTile icon={<User className="h-3.5 w-3.5" />} label="PIC" value={wo.wo_pic?.nama} />
        </div>
        {crossCabang && (
          <div className="mt-4 p-3 bg-amber-500/10 border border-amber-400/30 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300">
            Gudang WO ({wo.cabang?.nama_cabang}) berbeda dengan cabang MR ({wo.mrs?.cabang?.nama_cabang}).
            Hasil produksi WO ini ada di Gudang WO — buat Delivery atau Item Transfer terpisah untuk
            memindahkan stoknya secara fisik ke cabang MR.
          </div>
        )}
      </Content>

      <Content>
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-foreground uppercase">Item &amp; Formula</h3>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table containerClassName="max-h-[50vh] overflow-y-auto">
              <TableHeader className="bg-muted/50 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted">
                <TableRow>
                  <TableHead>Part Number</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-center">Lead Time</TableHead>
                  <TableHead className="text-center">Deadline</TableHead>
                  <TableHead>Formula</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wo.items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs font-bold uppercase">{item.part_number}</TableCell>
                    <TableCell className="text-sm font-semibold">{item.part_name}</TableCell>
                    <TableCell className="text-center font-bold">
                      {item.qty} {item.satuan}
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {item.lead_time_days != null ? `${item.lead_time_days} hari` : "-"}
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {item.deadline_date ? formatDate(item.deadline_date) : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {(item.working_order_item_components || []).map((c: any) => (
                          <div key={c.id} className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                            <Beaker className="h-3 w-3 shrink-0" />
                            {c.component_part_number} — {Number(c.qty_required).toFixed(2)} {c.component_satuan}
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-foreground uppercase">Approval Flow</h3>
            <div className="space-y-2">
              {approvals.map((a: any, idx: number) => (
                <div key={idx} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                  {a.status === "approved" ? (
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  ) : a.status === "rejected" ? (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="text-xs font-bold">{a.nama}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">
                      {a.approval_role} · {a.status}
                      {a.processed_at ? ` · ${formatDateTime(a.processed_at)}` : ""}
                    </p>
                    {a.notes && <p className="text-[10px] text-destructive mt-1">{a.notes}</p>}
                  </div>
                </div>
              ))}
            </div>

            {isMyTurn && wo.wo_status === "Pending Approval" && (
              <div className="space-y-2 pt-2">
                <Textarea
                  placeholder="Alasan penolakan (wajib diisi kalau menolak)..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button className="flex-1 gap-2" onClick={openApprove}>
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </Button>
                  <Button variant="destructive" className="flex-1 gap-2" onClick={openReject}>
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-foreground uppercase flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" /> Riwayat Edit
            </h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {editLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Belum ada riwayat edit.</p>
              ) : (
                editLogs.map((log) => (
                  <div key={log.id} className="p-3 border border-border rounded-lg text-xs">
                    <p className="font-bold">{log.summary}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {log.user_nama} · {formatDateTime(log.created_at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Content>

      <MRSignatureDialog open={signatureOpen} onOpenChange={setSignatureOpen} onConfirm={handleSignature} />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Working Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {editDraft.map((d, idx) => (
              <div key={d.id} className="grid grid-cols-3 gap-2 p-3 border border-border rounded-lg">
                <div className="col-span-3 text-xs font-bold font-mono uppercase">{d.part_number}</div>
                <div className="space-y-1">
                  <Label className="text-[9px] uppercase text-muted-foreground">Qty</Label>
                  <Input
                    type="number"
                    value={d.qty}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, qty: v } : p)));
                    }}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] uppercase text-muted-foreground">Lead Time</Label>
                  <Input
                    type="number"
                    value={d.lead_time_days}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, lead_time_days: v } : p)));
                    }}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[9px] uppercase text-muted-foreground">Deadline</Label>
                  <Input
                    type="date"
                    value={d.deadline_date}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditDraft((prev) => prev.map((p, i) => (i === idx ? { ...p, deadline_date: v } : p)));
                    }}
                    className="h-8"
                  />
                </div>
              </div>
            ))}
          </div>
          {wo.wo_status === "On Process" && (
            <p className="text-[10px] text-amber-600 font-medium">
              WO sedang On Process — perubahan qty akan menyesuaikan stok (selisihnya saja) di Gudang WO.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="p-3.5 bg-muted/40 border border-border rounded-lg">
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-muted-foreground mb-1.5">
        {icon} {label}
      </div>
      <p className="text-sm font-bold text-foreground">{value || "-"}</p>
    </div>
  );
}
