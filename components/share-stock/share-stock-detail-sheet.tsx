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
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateMRItemSSStatus } from "@/services/procurement-actions";
import { bypassShareStockCompletion } from "@/services/inventory-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { MyAlertDialog } from "@/components/dialog-confirm";

interface ShareStockDetailSheetProps {
  mrId: string | number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

export function ShareStockDetailSheet({
  mrId,
  open,
  onOpenChange,
  onUpdate,
}: ShareStockDetailSheetProps) {
  const supabase = createClient();
  const [mr, setMr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingItem, setUpdatingItem] = useState<number | null>(null);
  const [bypassingItem, setBypassingItem] = useState<number | null>(null);

  // PR Context for this MR
  const [prRecords, setPrRecords] = useState<any[]>([]);
  const [prItems, setPrItems] = useState<any[]>([]);
  const [ssAllocations, setSsAllocations] = useState<any[]>([]);

  // Confirmation Dialog State
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    itemId: number;
    currentStatus: string;
    newStatus: string;
    itemName: string;
  } | null>(null);

  useEffect(() => {
    if (open && mrId) {
      fetchDetails();
    }
  }, [open, mrId]);

  const fetchDetails = async () => {
    setLoading(true);
    try {
      // 1. Fetch MR Header
      const { data: mrData } = await supabase
        .from("mrs")
        .select("*, cabang(nama_cabang)")
        .eq("id", mrId)
        .single();
      setMr(mrData);

      // 2. Fetch MR Items (Filter for Share Stock items)
      const { data: mItems } = await supabase
        .from("mr_items")
        .select("*")
        .eq("mr_id", mrId)
        .gt("qty_sharestock_total", 0)
        .order("created_at");
      setItems(mItems || []);

      // 3. Fetch PR Records linked to this MR
      // Since pr_items has mr_id, we find prs through pr_items
      const { data: pItems } = await supabase
        .from("pr_items")
        .select("*, prs(pr_kode, pr_status, pr_tanggal)")
        .eq("mr_id", mrId);
      setPrItems(pItems || []);

      const uniquePrs = Array.from(
        new Set((pItems || []).map((prItem: any) => prItem.prs.pr_kode)),
      ).map((kode) => {
        return (pItems || []).find((prItem: any) => prItem.prs.pr_kode === kode)
          ?.prs;
      });
      setPrRecords(uniquePrs || []);

      // 4. Fetch SS Allocations
      if (mItems && mItems.length > 0) {
        const { data: allocs } = await supabase
          .from("mr_sharestock_allocations")
          .select("*, cabang(nama_cabang)")
          .in(
            "mr_item_id",
            mItems.map((item: any) => item.id),
          );
        setSsAllocations(allocs || []);
      }
    } catch (err) {
      console.error("Fetch SS Details Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const requestSSStatusChange = (
    itemId: number,
    newStatus: string,
    currentStatus: string,
    itemName: string,
  ) => {
    // Only show confirmation for closed status transitions
    if (
      (currentStatus !== "closed" && newStatus === "closed") ||
      (currentStatus === "closed" && newStatus !== "closed")
    ) {
      setConfirmAction({
        itemId,
        currentStatus,
        newStatus,
        itemName,
      });
      setIsConfirmOpen(true);
    } else {
      handleSSStatusChange(itemId, newStatus);
    }
  };

  const handleSSStatusChange = async (itemId: number, newStatus: string) => {
    setUpdatingItem(itemId);
    try {
      const result = await updateMRItemSSStatus(itemId, newStatus);
      if (result.success) {
        toast.success("Status Share Stock diperbarui");
        setItems((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, ss_status: newStatus } : item,
          ),
        );
        if (onUpdate) onUpdate();
      } else {
        toast.error(result.error || "Gagal memperbarui status");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUpdatingItem(null);
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!confirmAction) return;
    setIsConfirmOpen(false);
    await handleSSStatusChange(confirmAction.itemId, confirmAction.newStatus);
    setConfirmAction(null);
  };

  const handleConfirmDialogOpenChange = (open: boolean) => {
    setIsConfirmOpen(open);
    if (!open) {
      // Reset confirmation action when dialog closes
      setConfirmAction(null);
    }
  };

  const handleBypass = async (itemId: number) => {
    setBypassingItem(itemId);
    try {
      const result = await bypassShareStockCompletion(itemId);
      if (result.success) {
        toast.success(
          "Item berhasil diselesaikan (bypass). Stok sudah dipindahkan.",
        );
        setItems((prev) =>
          prev.map((item) =>
            item.id === itemId ? { ...item, ss_status: "closed" } : item,
          ),
        );
        if (onUpdate) onUpdate();
      } else {
        toast.error(result.error || "Gagal bypass share stock");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBypassingItem(null);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-slate-200 overflow-hidden text-slate-900 shadow-2xl">
        {loading && !mr ? (
          <div className="flex-1 flex items-center justify-center bg-white">
            <SheetTitle className="sr-only">Memuat Data Share Stock</SheetTitle>
            <SheetDescription className="sr-only">
              Sedang memuat detail share stock.
            </SheetDescription>
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-green-600" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Memuat Data Share Stock...
              </span>
            </div>
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-slate-50 border-b border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                  <Truck className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Share Stock Management
                  </span>
                </div>
                {mr && getStatusBadge(mr.mr_status)}
              </div>
              <div>
                <SheetTitle className="text-xl font-bold text-slate-900 tracking-tight uppercase leading-none">
                  {mr?.mr_kode}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Detail share stock untuk {mr?.mr_kode}.
                </SheetDescription>
                <div className="flex flex-col gap-1.5 mt-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <User className="h-3.5 w-3.5 text-slate-400" /> {mr?.mr_pic}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-green-600 uppercase tracking-tight">
                    <Building2 className="h-3.5 w-3.5 text-green-500/50" />{" "}
                    {mr?.cabang?.nama_cabang}
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-white transition-all">
              {/* Linked PR Section (Read Only) */}
              {prRecords.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 bg-blue-500 rounded-full" />
                    <h3 className="text-[11px] font-bold text-slate-900 uppercase">
                      Status Pengadaan (PR)
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {prRecords.map((pr) => (
                      <div
                        key={pr.pr_kode}
                        className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-3 shadow-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ShoppingCart className="h-3.5 w-3.5 text-blue-500" />
                            <span className="text-xs font-bold text-slate-800 uppercase leading-none">
                              {pr.pr_kode}
                            </span>
                          </div>
                          {getStatusBadge(pr.pr_status)}
                        </div>

                        {/* PR Items Status */}
                        <div className="pt-2 border-t border-blue-200/30 space-y-1.5">
                          {prItems
                            .filter((pi) => pi.prs.pr_kode === pr.pr_kode)
                            .map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between text-[10px]"
                              >
                                <span className="font-bold text-slate-600 uppercase tracking-tight">
                                  {item.part_name}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-400 font-medium">
                                    Qty: {item.qty}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "h-3.5 px-1 text-[8px] font-black uppercase border-none",
                                      getItemStatusColor(item.status),
                                    )}
                                  >
                                    {item.status || "open"}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Share Stock Items (Editable) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 bg-green-600 rounded-full" />
                    <h3 className="text-[11px] font-bold text-slate-900 uppercase">
                      Alokasi Share Stock (Editable)
                    </h3>
                  </div>
                </div>

                <div className="space-y-4">
                  {items.length === 0 ? (
                    <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-2xl gap-3">
                      <Inbox className="h-8 w-8 text-slate-200" />
                      <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                        Tidak ada alokasi share stock
                      </p>
                    </div>
                  ) : (
                    items.map((item) => {
                      const itemAllocs = ssAllocations.filter(
                        (a) => a.mr_item_id === item.id,
                      );

                      return (
                        <div
                          key={item.id}
                          className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-4 shadow-sm hover:border-green-200 transition-all group"
                        >
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <p className="text-[10px] font-mono font-bold text-slate-400 leading-none group-hover:text-green-600 transition-colors uppercase tracking-tight">
                                {item.part_number}
                              </p>
                              <p className="text-[11px] font-bold text-slate-800 uppercase line-clamp-1 leading-snug">
                                {item.part_name}
                              </p>
                              <p className="text-[12px] font-black text-slate-900 mt-1">
                                {item.qty_sharestock_total}{" "}
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                  {item.satuan}
                                </span>
                              </p>
                            </div>

                            <Select
                              value={item.ss_status || "open"}
                              onValueChange={(val) =>
                                requestSSStatusChange(
                                  item.id,
                                  val,
                                  item.ss_status || "open",
                                  item.part_name,
                                )
                              }
                              disabled={updatingItem === item.id}
                            >
                              <SelectTrigger
                                className={cn(
                                  "h-8 w-28 bg-white border-slate-200 font-bold text-[9px] uppercase rounded-lg px-2 shadow-sm",
                                  getItemStatusColor(item.ss_status || "open"),
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
                                  Processed
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
                          </div>

                          {/* Branch Sources */}
                          <div className="pt-3 border-t border-slate-200/50 space-y-2">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                              <MapPin className="h-3 w-3" /> Gudang Sumber
                              Pasokan
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {itemAllocs.map((alloc, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-sm"
                                >
                                  <span className="text-[9px] font-bold text-slate-700 uppercase">
                                    {alloc.cabang?.nama_cabang}
                                  </span>
                                  <span className="h-3 w-px bg-slate-100" />
                                  <span className="text-[10px] font-black text-blue-600">
                                    {alloc.qty}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Bypass button */}
                          {item.ss_status !== "closed" && (
                            <div className="pt-3 border-t border-slate-200/50">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full gap-2 text-[10px] font-bold border-amber-200 text-amber-700 hover:bg-amber-50"
                                disabled={bypassingItem === item.id}
                                onClick={() => {
                                  setConfirmAction({
                                    itemId: item.id,
                                    currentStatus: item.ss_status || "open",
                                    newStatus: "bypass",
                                    itemName: item.part_name,
                                  });
                                  setIsConfirmOpen(true);
                                }}
                              >
                                {bypassingItem === item.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3 w-3" />
                                )}
                                Selesaikan Langsung (Bypass)
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
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
                className="h-11 w-11 border border-slate-200 text-slate-400 hover:text-green-600 rounded-xl hover:bg-white transition-all shadow-sm"
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

      {/* Status Change Confirmation Dialog */}
      <MyAlertDialog
        open={isConfirmOpen}
        onOpenChange={handleConfirmDialogOpenChange}
        title={
          confirmAction?.newStatus === "bypass"
            ? "Selesaikan Langsung?"
            : "Konfirmasi Perubahan Status"
        }
        description={
          confirmAction
            ? confirmAction.newStatus === "bypass"
              ? `Item "${confirmAction.itemName}" akan diselesaikan secara bypass: stok akan langsung dipindahkan dari semua gudang sumber ke gudang tujuan MR. Lanjutkan?`
              : `Ubah status "${confirmAction.itemName}" dari ${confirmAction.currentStatus.toUpperCase()} ke ${confirmAction.newStatus.toUpperCase()}. Lanjutkan?`
            : ""
        }
        actionText="Lanjutkan"
        cancelText="Batal"
        onAction={async () => {
          if (!confirmAction) return;
          setIsConfirmOpen(false);
          if (confirmAction.newStatus === "bypass") {
            await handleBypass(confirmAction.itemId);
          } else {
            await handleSSStatusChange(
              confirmAction.itemId,
              confirmAction.newStatus,
            );
          }
          setConfirmAction(null);
        }}
      />
    </Sheet>
  );
}
