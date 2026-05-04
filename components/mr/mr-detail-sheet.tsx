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
  Package,
  Clock,
  MapPin,
  MessageSquare,
  Printer,
  X,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { updateMRAccurate } from "@/services/procurement-actions";
import { toast } from "sonner";

interface MRDetailSheetProps {
  mrId: string | number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MRDetailSheet({
  mrId,
  open,
  onOpenChange,
}: MRDetailSheetProps) {
  const supabase = createClient();
  const router = useRouter();
  const [mr, setMr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingAccurate, setUpdatingAccurate] = useState(false);

  useEffect(() => {
    if (open && mrId) {
      fetchDetails();
    }
  }, [open, mrId]);

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
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-semibold text-[10px] uppercase"
          >
            Open
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success text-success-foreground font-semibold text-[10px] uppercase">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge
            variant="destructive"
            className="font-semibold text-[10px] uppercase"
          >
            Rejected
          </Badge>
        );
      case "completed":
      case "done":
      case "closed":
        return (
          <Badge className="bg-foreground text-background font-semibold text-[10px] uppercase">
            Completed
          </Badge>
        );
      default:
        return (
          <Badge
            variant="outline"
            className="font-semibold text-[10px] uppercase"
          >
            {status}
          </Badge>
        );
    }
  };

  const handleToggleAccurate = async () => {
    if (!mr) return;
    setUpdatingAccurate(true);
    const newValue = !mr.accurate;
    const result = await updateMRAccurate(Number(mrId), newValue);
    if (result.success) {
      setMr((prev: any) => ({ ...prev, accurate: newValue }));
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

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "P1":
        return (
          <Badge
            variant="destructive"
            className="text-[10px] font-bold px-2 h-5 shrink-0"
          >
            P1 - EMERGENCY
          </Badge>
        );
      case "P2":
        return (
          <Badge className="bg-warning text-warning-foreground text-[10px] font-bold px-2 h-5 shrink-0">
            P2 - HIGH
          </Badge>
        );
      case "P3":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 text-[10px] font-bold px-2 h-5 shrink-0"
          >
            P3 - NORMAL
          </Badge>
        );
      case "P4":
        return (
          <Badge
            variant="outline"
            className="text-muted-foreground border-border bg-muted/40 text-[10px] font-bold px-2 h-5 shrink-0"
          >
            P4 - LOW
          </Badge>
        );
      default:
        return null;
    }
  };

  const handlePrint = () => {
    if (mrId) {
      window.open(`/mr/print/${mrId}`, "_blank");
    }
  };

  const nextApprover =
    mr?.mr_status === "open"
      ? mr?.approvals?.find((a: any) => a.status === "pending")
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg md:max-w-xl p-0 flex flex-col gap-0 border-l border-border overflow-hidden text-foreground shadow-2xl">
        {loading && !mr ? (
          <>
            <SheetTitle className="sr-only">Detail Material Request</SheetTitle>
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </>
        ) : (
          <>
            <SheetHeader className="p-8 bg-muted/40 border-b border-border space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-tight">
                    Material Request Detail
                  </span>
                </div>
                <div className="flex items-center gap-2 overflow-hidden">
                  {mr && getPriorityBadge(mr.mr_priority)}
                  {mr && getStatusBadge(mr.mr_status)}
                </div>
              </div>
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div className="max-w-full min-w-0">
                  <SheetTitle className="text-2xl font-bold text-foreground tracking-tight wrap-break-word">
                    {mr?.mr_kode}
                  </SheetTitle>
                  <SheetDescription className="text-xs font-medium text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
                    Oleh{" "}
                    <span className="text-foreground font-bold wrap-break-word">
                      {mr?.mr_pic}
                    </span>
                    <span className="mx-0.5 text-muted-foreground shrink-0">
                      •
                    </span>
                    <MapPin className="h-3 w-3 text-destructive shrink-0" />
                    <span className="text-foreground font-bold uppercase wrap-break-word">
                      {mr?.cabang?.nama_cabang}
                    </span>
                  </SheetDescription>
                </div>

                {nextApprover && (
                  <div className="bg-warning/10 border border-warning/30 p-2 rounded-md flex items-center gap-2 px-3 shadow-sm self-start lg:self-auto max-w-full min-w-0">
                    <Clock className="h-3.5 w-3.5 text-warning animate-pulse shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[8px] font-bold text-warning uppercase leading-none">
                        Menunggu:
                      </span>
                      <span className="text-[11px] font-bold text-warning uppercase wrap-break-word">
                        {nextApprover.nama}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-8 space-y-10 pb-20 bg-background">
              {/* Section: Priority & Remarks Info */}
              {mr?.mr_remarks && (
                <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-2 overflow-hidden wrap-break-word">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Keterangan / Remarks
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground leading-relaxed font-medium whitespace-pre-wrap">
                    {mr.mr_remarks}
                  </p>
                </div>
              )}

              {/* Section: Items */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-primary rounded-full shrink-0" />
                  <h3 className="text-[11px] font-bold text-foreground uppercase">
                    Daftar Barang
                  </h3>
                </div>
                <div className="border border-border rounded-lg overflow-hidden shadow-sm bg-background">
                  <Table className="table-fixed w-full">
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent h-9 border-b border-border">
                        <TableHead className="text-[9px] font-bold uppercase text-muted-foreground pl-4">
                          Part Number
                        </TableHead>
                        <TableHead className="text-[9px] font-bold uppercase text-muted-foreground">
                          Nama Barang
                        </TableHead>
                        <TableHead className="text-[9px] font-bold uppercase text-muted-foreground text-right pr-4">
                          Qty
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="h-20 text-center text-muted-foreground text-[11px] italic"
                          >
                            Belum ada barang
                          </TableCell>
                        </TableRow>
                      ) : (
                        items.map((item) => (
                          <TableRow
                            key={item.id}
                            className="hover:bg-muted/40 border-b border-border/40 last:border-0 align-top"
                          >
                            <TableCell className="text-[11px] font-mono font-bold text-muted-foreground uppercase pl-4 py-2 whitespace-normal wrap-break-word">
                              {item.part_number}
                            </TableCell>
                            <TableCell className="text-[11px] font-semibold text-foreground uppercase py-2 whitespace-normal wrap-break-word leading-snug">
                              {item.part_name}
                            </TableCell>
                            <TableCell className="text-[11px] font-bold text-foreground text-right pr-4 py-2 whitespace-nowrap">
                              {item.qty_request}{" "}
                              <span className="text-muted-foreground font-medium ml-0.5">
                                {item.satuan}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Section: Approval Progress */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 bg-primary rounded-full shrink-0" />
                  <h3 className="text-[11px] font-bold text-foreground uppercase">
                    Proses Approval
                  </h3>
                </div>
                <div className="space-y-2.5 min-w-0">
                  {mr?.approvals
                    ?.sort((a: any, b: any) => a.step_order - b.step_order)
                    .map((approval: any, idx: number) => {
                      const isApproved = approval.status === "approved";

                      return (
                        <div
                          key={idx}
                          className={`rounded-lg border border-border bg-muted/20 p-3 min-w-0 ${
                            !isApproved ? "opacity-75" : ""
                          }`}
                        >
                          <div className="flex flex-col gap-1.5 max-w-full min-w-0">
                            <div className="flex items-start justify-between gap-2 text-foreground">
                              <span className="text-xs font-bold flex-1 whitespace-normal wrap-break-word leading-snug">
                                {idx + 1}. {approval.nama}
                              </span>
                              {isApproved ? (
                                <Badge className="h-3.5 px-1.5 text-[8px] bg-success/10 text-success border-none font-bold uppercase shrink-0">
                                  Approved
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="h-3.5 px-1.5 text-[8px] text-muted-foreground border-border bg-muted/40 font-bold uppercase shrink-0"
                                >
                                  Pending
                                </Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-tighter whitespace-normal wrap-break-word">
                              {approval.role || "Checker"}
                            </p>

                            {isApproved ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span className="text-[10px] font-semibold whitespace-normal wrap-break-word">
                                  {new Date(
                                    approval.processed_at,
                                  ).toLocaleString("id-ID", {
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {approval.signature_url && (
                                  <>
                                    <Badge
                                      variant="outline"
                                      className="text-[8px] h-3.5 px-1 text-success border-success/30 bg-success/10 cursor-default shrink-0"
                                    >
                                      Signed
                                    </Badge>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span className="text-[10px] font-medium italic">
                                  Menunggu giliran...
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-border bg-muted/40 space-y-4 shadow-sm mt-auto">
              {/* ACCURATE_HIDDEN: tombol toggle disembunyikan, nilai selalu false */}
              {false && (
                <button
                  onClick={handleToggleAccurate}
                  disabled={updatingAccurate}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    mr?.accurate
                      ? "bg-amber-50 border-amber-200 hover:bg-amber-100"
                      : "bg-muted/30 border-border hover:bg-muted/60"
                  }`}
                >
                  <div
                    className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      mr?.accurate
                        ? "bg-amber-500 border-amber-500"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {mr?.accurate && (
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
                        mr?.accurate
                          ? "text-amber-700"
                          : "text-muted-foreground"
                      }`}
                    >
                      {mr?.accurate
                        ? "Sudah Input ke Accurate"
                        : "Belum Input ke Accurate"}
                    </p>
                    <p className="text-[9px] text-muted-foreground font-medium mt-0.5">
                      Klik untuk{" "}
                      {mr?.accurate ? "hapus tanda" : "tandai sudah input"}
                    </p>
                  </div>
                  {updatingAccurate && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                  )}
                </button>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                <Button
                  variant="outline"
                  className="h-10 border-border text-muted-foreground font-bold text-xs uppercase rounded-lg hover:bg-background hover:text-foreground transition-all flex items-center justify-center gap-2"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="h-3.5 w-3.5" /> Close
                </Button>

                <Button
                  className="h-10 font-bold text-xs uppercase rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
                  onClick={() => {
                    router.push(`/mr/${mrId}`);
                    onOpenChange(false);
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Buka Detail
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
