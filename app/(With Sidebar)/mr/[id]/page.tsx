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
  Package,
  Clock,
  MapPin,
  MessageSquare,
  Printer,
  ThumbsUp,
  ThumbsDown,
  PlusCircle,
  Trash2,
  AlertTriangle,
  ArrowLeft,
  CircleUser,
  Building,
  Calendar,
  Tag,
  Layers,
  Building2,
  Info,
  Truck,
  ShoppingCart,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { approveMR, rejectMR } from "@/services/procurement-actions";
import { MRSignatureDialog } from "@/components/mr/mr-signature-dialog";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Content } from "@/components/content";

export default function MRDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: mrId } = use(params);
  const supabase = createClient();
  const router = useRouter();

  const [mr, setMr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [cabangs, setCabangs] = useState<any[]>([]);

  // Fulfillment Data
  const [prRecords, setPrRecords] = useState<any[]>([]);
  const [deliveryRecords, setDeliveryRecords] = useState<any[]>([]);

  // Approval states
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fulfillment states (allocation)
  const [allocations, setAllocations] = useState<any[]>([]);

  useEffect(() => {
    if (mrId) {
      fetchDetails();
      fetchUser();
      fetchCabangs();
    }
  }, [mrId]);

  const fetchUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUser(user);
  };

  const fetchCabangs = async () => {
    const { data } = await supabase
      .from("cabang")
      .select("id, nama_cabang")
      .order("nama_cabang");
    setCabangs(data || []);
  };

  const fetchDetails = async () => {
    setLoading(true);
    // Fetch MR primary data
    const { data: mrData } = await supabase
      .from("mrs")
      .select("*, cabang(nama_cabang)")
      .eq("id", mrId)
      .single();

    setMr(mrData);

    // Fetch MR Items
    const { data: itemsData } = await supabase
      .from("mr_items")
      .select("*")
      .eq("mr_id", mrId)
      .order("created_at");

    setItems(itemsData || []);

    const { data: prsData } = await supabase
      .from("pr_items")
      .select("*, prs(pr_kode, pr_status)")
      .eq("mr_id", mrId);
    setPrRecords(prsData || []);

    // Fetch related deliveries for Share Stock progress
    const { data: deliveriesData } = await supabase
      .from("delivery_items")
      .select("*, deliveries!inner(dlv_kode, status, mr_id)")
      .eq("deliveries.mr_id", mrId);
    setDeliveryRecords(deliveriesData || []);

    if (itemsData) {
      const initialAllocations = itemsData.map((item: any) => ({
        mr_item_id: item.id,
        part_name: item.part_name,
        qty_request: item.qty_request,
        qty_sharestock_total: item.qty_sharestock_total || 0,
        qty_pr: item.qty_pr || item.qty_request,
        sharestocks: [],
      }));
      setAllocations(initialAllocations);
    }

    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-bold uppercase"
          >
            Open
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success/10 text-success border-none font-bold uppercase">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="font-bold uppercase">
            Rejected
          </Badge>
        );
      case "done":
        return <Badge className="font-bold uppercase">Done</Badge>;
      case "closed":
        return (
          <Badge variant="secondary" className="font-bold uppercase">
            Closed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="font-bold uppercase">
            {status}
          </Badge>
        );
    }
  };

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "P1":
        return (
          <Badge
            variant="destructive"
            className="font-bold px-2 py-0.5 text-[10px]"
          >
            P1 - EMERGENCY
          </Badge>
        );
      case "P2":
        return (
          <Badge className="bg-warning text-warning-foreground font-bold px-2 py-0.5 text-[10px]">
            P2 - HIGH
          </Badge>
        );
      case "P3":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-bold px-2 py-0.5 text-[10px]"
          >
            P3 - NORMAL
          </Badge>
        );
      case "P4":
        return (
          <Badge
            variant="secondary"
            className="text-muted-foreground font-bold px-2 py-0.5 text-[10px]"
          >
            P4 - LOW
          </Badge>
        );
      default:
        return null;
    }
  };

  const nextApprover =
    mr?.mr_status === "open"
      ? mr?.approvals?.find((a: any) => a.status === "pending")
      : null;
  const isPendingApprover =
    currentUser && nextApprover && nextApprover.user_id === currentUser.id;
  const isLastApprover =
    mr?.approvals &&
    nextApprover &&
    mr.approvals.findIndex((a: any) => a.status === "pending") ===
      mr.approvals.length - 1;

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error("Alasan penolakan harus diisi");
      return;
    }
    setSubmitting(true);
    try {
      const result = await rejectMR(Number(mrId), rejectionReason);
      if (result.success) {
        toast.success("Material Request berhasil ditolak");
        setIsRejectDialogOpen(false);
        fetchDetails();
      } else {
        toast.error(result.error || "Gagal menolak MR");
      }
    } catch (err) {
      toast.error("Terjadi kesalahan sistem");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveConfirm = async (signature: any) => {
    setSubmitting(true);
    try {
      const result = await approveMR(
        Number(mrId),
        signature.image_url,
        isLastApprover ? allocations : undefined,
      );
      if (result.success) {
        toast.success("Material Request berhasil disetujui");
        setIsSignatureDialogOpen(false);
        fetchDetails();
      } else {
        toast.error(result.error || "Gagal menyetujui MR");
      }
    } catch (err) {
      toast.error("Terjadi kesalahan sistem");
    } finally {
      setSubmitting(false);
    }
  };

  const updateAllocation = (itemId: number, sharestocks: any[]) => {
    const totalShare = sharestocks.reduce(
      (sum, s) => sum + Number(s.qty || 0),
      0,
    );
    setAllocations((prev) =>
      prev.map((a) => {
        if (a.mr_item_id === itemId) {
          return {
            ...a,
            sharestocks,
            qty_sharestock_total: totalShare,
            qty_pr: Math.max(0, a.qty_request - totalShare),
          };
        }
        return a;
      }),
    );
  };

  const addShareStockLine = (itemId: number) => {
    const alloc = allocations.find((a) => a.mr_item_id === itemId);
    if (!alloc) return;
    updateAllocation(itemId, [
      ...alloc.sharestocks,
      { source_cabang_id: "", qty: 0 },
    ]);
  };

  const removeShareStockLine = (itemId: number, index: number) => {
    const alloc = allocations.find((a) => a.mr_item_id === itemId);
    if (!alloc) return;
    const newSS = [...alloc.sharestocks];
    newSS.splice(index, 1);
    updateAllocation(itemId, newSS);
  };

  const updateShareStockLine = (
    itemId: number,
    index: number,
    field: string,
    value: any,
  ) => {
    const alloc = allocations.find((a) => a.mr_item_id === itemId);
    if (!alloc) return;
    const newSS = [...alloc.sharestocks];
    newSS[index] = { ...newSS[index], [field]: value };
    updateAllocation(itemId, newSS);
  };

  if (loading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground font-bold uppercase tracking-widest animate-pulse">
            Memuat Transaksi...
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/mr">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground tracking-tight">
                  {mr?.mr_kode}
                </h1>
                {getStatusBadge(mr?.mr_status)}
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Dibuat pada{" "}
                {new Date(mr?.created_at).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
          <Button
            onClick={() => window.open(`/mr/print/${mrId}`, "_blank")}
            variant="outline"
            size="sm"
            className="gap-2 font-semibold shrink-0"
          >
            <Printer className="h-4 w-4" /> Cetak MR
          </Button>
        </div>
      </Content>

      <div className="col-span-12 grid grid-cols-12 gap-4 md:gap-6 items-start">
        <div className="col-span-12 lg:col-span-8 space-y-4 md:space-y-6">
          <Content title="Informasi Utama">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Pemohon / PIC
                </Label>
                <div className="flex items-center gap-2">
                  <CircleUser className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {mr?.mr_pic}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Cabang / Lokasi
                </Label>
                <div className="flex items-center gap-2">
                  <Building className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {mr?.cabang?.nama_cabang}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Tanggal Request
                </Label>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {new Date(
                      mr?.mr_tanggal || mr?.created_at,
                    ).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Tingkat Prioritas
                </Label>
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-muted-foreground" />
                  <div className="flex h-10 w-full items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground">
                    {getPriorityBadge(mr?.mr_priority)}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 space-y-1.5 mt-2">
                <Label className="text-[11px] font-bold uppercase text-muted-foreground">
                  Keterangan / Remarks
                </Label>
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground mt-2.5" />
                  <div className="w-full rounded-md border border-border bg-muted/40 px-3 py-2 text-sm min-h-20 whitespace-pre-wrap font-medium text-foreground leading-relaxed">
                    {mr?.mr_remarks || "-"}
                  </div>
                </div>
              </div>
            </div>
          </Content>

          <Content title="Daftar Kebutuhan Material">
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="h-12">
                    <TableHead className="w-12 text-center text-[10px] font-bold uppercase text-muted-foreground">
                      No
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-muted-foreground">
                      Part Number
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-muted-foreground min-w-50">
                      Nama Barang
                    </TableHead>
                    <TableHead className="text-[10px] font-bold uppercase text-muted-foreground text-center">
                      Satuan
                    </TableHead>
                    <TableHead className="text-right text-[10px] font-bold uppercase text-muted-foreground pr-4">
                      Qty Req
                    </TableHead>
                    {/* Fulfillment Columns (Only show when approved) */}
                    {(mr?.mr_status === "approved" ||
                      mr?.mr_status === "done" ||
                      mr?.mr_status === "closed") && (
                      <>
                        <TableHead className="text-[10px] font-bold uppercase text-muted-foreground px-4">
                          Share Stock
                        </TableHead>
                        <TableHead className="text-[10px] font-bold uppercase text-muted-foreground px-4 pr-6">
                          Purchase (PR)
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => {
                    const itemPrs = prRecords.filter(
                      (p) => p.part_id === item.part_id,
                    );
                    const itemDeliveries = deliveryRecords.filter(
                      (d) => d.part_id === item.part_id,
                    );

                    return (
                      <TableRow
                        key={item.id}
                        className="h-16 hover:bg-muted/30 group"
                      >
                        <TableCell className="text-center text-xs font-bold text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] font-bold text-muted-foreground uppercase">
                          {item.part_number}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-bold text-foreground uppercase">
                            {item.part_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className="text-[9px] font-bold text-muted-foreground h-5 uppercase"
                          >
                            {item.satuan}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-black text-foreground pr-4 text-base">
                          {item.qty_request}
                        </TableCell>

                        {/* Fulfillment Status Visualization */}
                        {(mr?.mr_status === "approved" ||
                          mr?.mr_status === "done" ||
                          mr?.mr_status === "closed") && (
                          <>
                            {/* Share Stock Details */}
                            <TableCell className="px-4">
                              {item.qty_sharestock_total > 0 ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-black text-success">
                                      {item.qty_sharestock_total}
                                    </span>
                                    {itemDeliveries.length > 0 ? (
                                      <Badge className="bg-success/10 text-success border-none text-[8px] h-3.5 font-black uppercase">
                                        Processed
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-[8px] h-3.5 text-muted-foreground border-border font-bold uppercase"
                                      >
                                        Pending
                                      </Badge>
                                    )}
                                  </div>
                                  {itemDeliveries.map((d, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground hover:text-primary transition-colors cursor-default"
                                    >
                                      <Truck className="h-2.5 w-2.5" />
                                      {d.deliveries?.dlv_kode} (
                                      {d.qty_on_delivery})
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/40 text-[10px] font-bold uppercase italic">
                                  -
                                </span>
                              )}
                            </TableCell>

                            {/* PR Details */}
                            <TableCell className="px-4 pr-6">
                              {item.qty_pr > 0 ? (
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm font-black text-primary">
                                      {item.qty_pr}
                                    </span>
                                    {itemPrs.length > 0 ? (
                                      <Badge className="bg-primary/10 text-primary border-none text-[8px] h-3.5 font-black uppercase">
                                        Processed
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-[8px] h-3.5 text-muted-foreground border-border font-bold uppercase"
                                      >
                                        Pending
                                      </Badge>
                                    )}
                                  </div>
                                  {itemPrs.map((p, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground hover:text-primary transition-colors cursor-default"
                                    >
                                      <ShoppingCart className="h-2.5 w-2.5" />
                                      {p.prs?.pr_kode} ({p.qty})
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/40 text-[10px] font-bold uppercase italic">
                                  -
                                </span>
                              )}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Content>

          {isPendingApprover && isLastApprover && (
            <Content title="Perencanaan Pemenuhan (Decision Making)">
              <div className="space-y-6">
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-start gap-4 ring-1 ring-primary/10 mb-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Info className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-foreground uppercase tracking-tight">
                      Final Decision Required
                    </h4>
                    <p className="text-xs text-primary leading-relaxed mt-1">
                      Sebagai penyetuju terakhir, Anda perlu menentukan alokasi
                      barang antara Share Stock (dari cabang lain) dan Purchase
                      Request (pengadaan baru).
                    </p>
                  </div>
                </div>

                {allocations.map((alloc) => (
                  <div
                    key={alloc.mr_item_id}
                    className="border border-border rounded-xl overflow-hidden bg-background hover:border-primary/50 transition-all p-5 space-y-4 shadow-sm"
                  >
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                      <div className="min-w-0">
                        <h4 className="text-base font-bold text-foreground uppercase tracking-tight">
                          {alloc.part_name}
                        </h4>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-md border border-border bg-muted/50 px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                            Req Qty: {alloc.qty_request}
                          </span>
                          <span className="rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] font-bold text-primary uppercase tracking-widest">
                            PR Plan: {alloc.qty_pr}
                          </span>
                          <span className="rounded-md border border-success/20 bg-success/5 px-2 py-1 text-[10px] font-bold text-success uppercase tracking-widest">
                            Share Plan: {alloc.qty_sharestock_total}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => addShareStockLine(alloc.mr_item_id)}
                        className="h-9 w-full xl:w-auto gap-2 bg-background text-primary border border-primary/30 hover:bg-primary hover:text-primary-foreground font-bold text-xs shadow-sm transition-all"
                      >
                        <PlusCircle className="h-3.5 w-3.5" /> Tambah Alokasi
                        Stok
                      </Button>
                    </div>

                    {alloc.sharestocks.length > 0 && (
                      <div className="space-y-2.5 mt-2">
                        {alloc.sharestocks.map((ss: any, idx: number) => (
                          <div
                            key={idx}
                            className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_110px_44px] gap-2 items-center bg-muted/40 p-2.5 rounded-lg border border-border"
                          >
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] font-bold uppercase outline-none focus:ring-1 focus:ring-ring"
                              value={ss.source_cabang_id}
                              onChange={(e) =>
                                updateShareStockLine(
                                  alloc.mr_item_id,
                                  idx,
                                  "source_cabang_id",
                                  e.target.value,
                                )
                              }
                            >
                              <option value="">Pilih Sumber...</option>
                              {cabangs.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nama_cabang}
                                </option>
                              ))}
                            </select>
                            <Input
                              type="number"
                              placeholder="Qty"
                              min="0"
                              className="h-9 w-full text-center font-bold text-[11px]"
                              value={ss.qty || ""}
                              onChange={(e) =>
                                updateShareStockLine(
                                  alloc.mr_item_id,
                                  idx,
                                  "qty",
                                  e.target.value,
                                )
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-md"
                              onClick={() =>
                                removeShareStockLine(alloc.mr_item_id, idx)
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Content>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4 md:space-y-6">
          <Content title="Tindakan">
            <div className="space-y-4">
              {isPendingApprover ? (
                <div className="flex flex-col gap-3">
                  <Button
                    className="w-full h-12 gap-2 bg-success hover:bg-success/90 text-success-foreground font-black uppercase text-xs tracking-widest shadow-lg"
                    onClick={() => setIsSignatureDialogOpen(true)}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ThumbsUp className="h-4 w-4" />
                    )}
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
              ) : mr?.mr_status === "rejected" ? (
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-xs font-black uppercase tracking-tight">
                      Request Ditolak
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground italic font-medium leading-relaxed">
                    "{mr?.rejection_reason}"
                  </p>
                </div>
              ) : (
                <div className="text-center py-6 bg-muted/30 rounded-xl border border-dashed border-border space-y-3">
                  <div className="h-10 w-10 rounded-full bg-background flex items-center justify-center mx-auto shadow-sm">
                    <Clock className="h-5 w-5 text-muted-foreground/40" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest leading-tight">
                      {mr?.mr_status === "approved"
                        ? "SELURUH PROSES SELESAI"
                        : "MENUNGGU PROSES APPROVAL"}
                    </p>
                    <p className="text-[9px] text-muted-foreground/50 font-bold uppercase">
                      Transaction Closed for Editing
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Content>

          <Content title="Jalur Approval">
            <div className="space-y-2.5">
              {mr?.approvals
                ?.sort((a: any, b: any) => a.step_order - b.step_order)
                .map((approval: any, idx: number) => {
                  const isApproved = approval.status === "approved";
                  const isPending = approval.status === "pending";

                  return (
                    <div
                      key={idx}
                      className="rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h5 className="text-[12px] font-black text-foreground uppercase tracking-tight leading-snug">
                          {idx + 1}. {approval.nama}
                        </h5>
                        {isApproved ? (
                          <Badge className="h-3.5 px-1.5 bg-success/10 text-success border-none text-[7px] font-black uppercase shrink-0">
                            Approved
                          </Badge>
                        ) : isPending ? (
                          <Badge
                            variant="outline"
                            className="h-3.5 px-1.5 text-primary border-primary/20 bg-primary/5 text-[7px] font-black uppercase shrink-0"
                          >
                            Current Step
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="h-3.5 px-1.5 text-muted-foreground border-border bg-muted/30 text-[7px] font-black uppercase shrink-0"
                          >
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
                            {new Date(approval.processed_at).toLocaleString(
                              "id-ID",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "numeric",
                                month: "short",
                              },
                            )}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[9px] font-bold text-muted-foreground italic uppercase">
                          Menunggu giliran approval
                        </p>
                      )}
                      {approval.signature_url && (
                        <Badge
                          variant="outline"
                          className="mt-1.5 h-3.5 px-1.5 text-[7px] text-success border-success/30 bg-success/10 font-black uppercase"
                        >
                          Signed
                        </Badge>
                      )}
                    </div>
                  );
                })}
            </div>
          </Content>
        </div>
      </div>

      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent className="sm:max-w-106.25 rounded-2xl border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive uppercase font-black text-xl tracking-tight">
              <ThumbsDown className="h-6 w-6" /> Alasan Penolakan
            </DialogTitle>
            <DialogDescription className="font-bold text-muted-foreground text-xs uppercase pt-2">
              Berikan alasan penolakan yang jelas agar pemohon dapat melakukan
              perbaikan.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-4">
            <Label
              htmlFor="reason"
              className="text-[10px] font-black uppercase text-muted-foreground tracking-widest"
            >
              Keterangan Penolakan
            </Label>
            <Textarea
              id="reason"
              placeholder="Tulis alasan di sini..."
              className="h-40 resize-none font-bold text-foreground border-2 border-border focus:border-destructive rounded-xl p-4 shadow-inner"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              className="font-bold uppercase text-xs"
              onClick={() => setIsRejectDialogOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              className="font-black uppercase text-xs shadow-lg rounded-xl h-12 px-6"
              onClick={handleReject}
              disabled={submitting}
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
        open={isSignatureDialogOpen}
        onOpenChange={setIsSignatureDialogOpen}
        onConfirm={handleApproveConfirm}
      />
    </>
  );
}
