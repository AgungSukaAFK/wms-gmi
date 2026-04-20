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
  Package,
  MapPin,
  History,
  Pencil,
  ArrowUpRight,
  ArrowDownLeft,
  Settings2,
  Calendar,
  User,
  ExternalLink,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { updateStock } from "@/services/stock-actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface StockDetailSheetProps {
  partId: string | number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

export function StockDetailSheet({
  partId,
  open,
  onOpenChange,
  onUpdate,
}: StockDetailSheetProps) {
  const supabase = createClient();
  const [part, setPart] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && partId) {
      fetchDetails();
    }
  }, [open, partId]);

  const fetchDetails = async () => {
    setLoading(true);
    const normalizedPartId =
      typeof partId === "string" ? Number(partId) : partId;

    if (!normalizedPartId) {
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch Part Info
      const { data: partData } = await supabase
        .from("barang")
        .select("*")
        .eq("id", normalizedPartId)
        .single();
      setPart(partData);

      // 2. Fetch Locations (v_stock_with_status)
      const { data: locData } = await supabase
        .from("v_stock_with_status")
        .select("*")
        .eq("part_id", normalizedPartId);
      setLocations(locData || []);

      // 3. Fetch History
      const { data: histData, error: historyError } = await supabase
        .from("stock_movements")
        .select(
          "id, part_id, cabang_id, qty_change, type, reference_id, notes, created_by, created_at, cabang(nama_cabang)",
        )
        .eq("part_id", normalizedPartId)
        .order("created_at", { ascending: false });

      if (historyError) {
        console.error("Fetch stock_movements error:", historyError);
      }

      const movements = histData || [];
      const actorIds = Array.from(
        new Set(
          movements
            .map((item: any) => item.created_by)
            .filter((id: string | null) => !!id),
        ),
      );

      let actorNameMap = new Map<string, string>();
      if (actorIds.length > 0) {
        const { data: profilesData, error: profileError } = await supabase
          .from("profiles")
          .select("id, nama")
          .in("id", actorIds);

        if (profileError) {
          console.error(
            "Fetch stock movement actor names error:",
            profileError,
          );
        } else {
          actorNameMap = new Map(
            (profilesData || []).map((profile: any) => [
              profile.id,
              profile.nama,
            ]),
          );
        }
      }

      setHistory(
        movements.map((item: any) => ({
          ...item,
          actor_name: item.created_by
            ? actorNameMap.get(item.created_by) || "Unknown User"
            : "System",
        })),
      );
    } catch (err) {
      console.error("Fetch Stock Details Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingStock) return;
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = {
      qty: parseInt(formData.get("qty") as string),
      min_qty: parseInt(formData.get("min_qty") as string),
      max_qty: parseInt(formData.get("max_qty") as string),
    };

    const result = await updateStock(editingStock.id, data);
    setSubmitting(false);

    if (result.success) {
      toast.success("Inventory updated");
      setIsEditOpen(false);
      fetchDetails();
      if (onUpdate) onUpdate();
    } else {
      toast.error(result.error);
    }
  };

  const getMovementIcon = (type: string) => {
    switch (type) {
      case "PR":
        return <ArrowUpRight className="h-3 w-3 text-blue-500" />;
      case "SS":
        return <TrendingUp className="h-3 w-3 text-green-500" />;
      case "ADJUSTMENT":
        return <Settings2 className="h-3 w-3 text-amber-500" />;
      default:
        return <Minus className="h-3 w-3 text-slate-300" />;
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-slate-200 shadow-2xl overflow-hidden">
          {loading && !part ? (
            <div className="flex-1 flex items-center justify-center bg-white">
              <Loader2 className="h-8 w-8 animate-spin text-slate-200" />
            </div>
          ) : (
            <>
              <SheetHeader className="p-6 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2 text-primary mb-1">
                  <Package className="h-4 w-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Inventory Status
                  </span>
                </div>
                <SheetTitle className="text-xl font-bold text-slate-900 leading-tight">
                  {part?.part_number}
                </SheetTitle>
                <div className="flex items-center gap-2 mt-2">
                  <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 font-mono text-xs">
                    {part?.id}
                  </code>
                  <p className="text-xs font-medium text-slate-500 line-clamp-1">
                    {part?.part_name}
                  </p>
                </div>
              </SheetHeader>

              <Tabs
                defaultValue="locations"
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="px-6 border-b border-slate-100">
                  <TabsList className="bg-transparent h-10 w-full justify-start gap-4 border-none p-0">
                    <TabsTrigger
                      value="locations"
                      className="h-10 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-0 text-xs font-bold text-slate-500 data-[state=active]:text-slate-900"
                    >
                      Lokasi
                    </TabsTrigger>
                    <TabsTrigger
                      value="history"
                      className="h-10 border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-0 text-xs font-bold text-slate-500 data-[state=active]:text-slate-900"
                    >
                      Riwayat
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto p-5 bg-white">
                  <TabsContent value="locations" className="m-0 space-y-3">
                    {locations.map((loc) => (
                      <div
                        key={loc.id}
                        className="bg-white border border-slate-200 p-3 rounded-xl flex items-center justify-between hover:border-primary/30 transition-all"
                      >
                        <div className="space-y-1">
                          <h4 className="text-sm font-bold text-slate-700">
                            {loc.nama_cabang}
                          </h4>
                          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
                            <span>Min: {loc.min_qty}</span>
                            <span>Max: {loc.max_qty}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="text-lg font-black text-slate-900 leading-none">
                              {loc.qty}
                            </p>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "mt-1 text-[8px] h-3.5 px-1 font-black uppercase tracking-widest border-none",
                                loc.status === "low"
                                  ? "bg-red-50 text-red-600"
                                  : loc.status === "overstock"
                                    ? "bg-amber-50 text-amber-600"
                                    : "bg-green-50 text-green-600",
                              )}
                            >
                              {loc.status}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-slate-100 rounded-lg text-slate-400"
                            onClick={() => {
                              setEditingStock(loc);
                              setIsEditOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="history" className="m-0 space-y-4">
                    {history.length === 0 ? (
                      <div className="py-12 text-center text-slate-400 text-xs italic">
                        Belum ada riwayat mutasi.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {history.map((item) => (
                          <div
                            key={item.id}
                            className="border-l-2 border-slate-100 pl-4 py-1 space-y-1 relative"
                          >
                            <div
                              className={cn(
                                "absolute -left-1.25 top-2 w-2 h-2 rounded-full",
                                item.qty_change > 0
                                  ? "bg-green-500"
                                  : "bg-red-500",
                              )}
                            />
                            <div className="flex items-center justify-between">
                              <span
                                className={cn(
                                  "text-xs font-bold",
                                  item.qty_change > 0
                                    ? "text-green-600"
                                    : "text-red-500",
                                )}
                              >
                                {item.qty_change > 0 ? "+" : ""}
                                {item.qty_change} {part?.part_satuan}
                              </span>
                              <span className="text-[10px] text-slate-400 uppercase font-bold">
                                {item.type}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-tight">
                              {item.notes}
                            </p>
                            <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1 gap-2">
                              <span className="truncate">
                                {item.cabang?.nama_cabang}
                              </span>
                              <span className="shrink-0">
                                {new Date(item.created_at).toLocaleString(
                                  "id-ID",
                                )}
                              </span>
                            </div>
                            <div className="text-[9px] text-slate-400 mt-1">
                              <span className="font-semibold">By:</span>{" "}
                              {item.actor_name}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </div>
              </Tabs>

              <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-bold"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-100 p-6 rounded-2xl">
          <form onSubmit={handleUpdate}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold">
                Update Inventory
              </DialogTitle>
              <DialogDescription className="text-xs">
                {part?.part_number} - {editingStock?.nama_cabang}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col items-center">
                <Label className="text-[10px] font-black uppercase text-slate-400 mb-2">
                  Quantity Fisik
                </Label>
                <Input
                  name="qty"
                  type="number"
                  min="0"
                  defaultValue={editingStock?.qty}
                  className="h-12 text-3xl font-black text-center border-none bg-transparent focus-visible:ring-0"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">
                    Safety Stock
                  </Label>
                  <Input
                    name="min_qty"
                    type="number"
                    min="0"
                    defaultValue={editingStock?.min_qty}
                    className="h-9 font-bold border-slate-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">
                    Maks Kap.
                  </Label>
                  <Input
                    name="max_qty"
                    type="number"
                    min="0"
                    defaultValue={editingStock?.max_qty}
                    className="h-9 font-bold border-slate-200"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1 h-10 font-bold text-slate-400"
                  onClick={() => setIsEditOpen(false)}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-10 bg-primary font-bold"
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin font-bold" />
                  ) : (
                    "Simpan"
                  )}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Subordinate Icons
function RefreshCw(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
