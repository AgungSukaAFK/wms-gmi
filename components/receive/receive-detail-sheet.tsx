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
  PackageCheck,
  User,
  Building2,
  Calendar,
  Package,
  ShoppingCart,
  ClipboardList,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

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

  useEffect(() => {
    if (open && receiveId) {
      fetchDetail(receiveId);
    } else if (!open) {
      setReceive(null);
      setItems([]);
    }
  }, [open, receiveId]);

  const fetchDetail = async (id: number) => {
    setLoading(true);
    const { data } = await supabase
      .from("receives")
      .select(
        `
          id, ri_kode, ri_tanggal, ri_pic, ri_keterangan, created_at,
          cabang(id, nama_cabang),
          pos(id, po_kode)
        `,
      )
      .eq("id", id)
      .single();

    if (data) setReceive(data);

    const { data: riItems } = await supabase
      .from("receive_items")
      .select("id, part_number, part_name, satuan, qty, mr_id, part_id")
      .eq("ri_id", id)
      .order("id");

    setItems(riItems || []);
    setLoading(false);
  };

  const totalQty = items.reduce((sum, i) => sum + (i.qty || 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 border-l border-slate-200 overflow-hidden shadow-2xl">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
            <PackageCheck className="h-4 w-4 text-primary" />
            Detail Penerimaan Barang
          </SheetTitle>
          <SheetDescription className="text-[10px] uppercase font-bold">
            Informasi lengkap dokumen Receive Item
          </SheetDescription>
        </SheetHeader>

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
                  <p className="font-black text-lg text-foreground font-mono uppercase tracking-wide">
                    {receive.ri_kode}
                  </p>
                </div>

                {/* Tanggal */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Tanggal
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {new Date(receive.ri_tanggal).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>

                {/* PIC */}
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" /> PIC / Penerima
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {receive.ri_pic || "-"}
                  </p>
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
                {receive.ri_keterangan && (
                  <div className="col-span-2 space-y-1.5">
                    <p className="text-[9px] font-black uppercase text-muted-foreground flex items-center gap-1">
                      <ClipboardList className="h-3 w-3" /> Keterangan
                    </p>
                    <p className="text-sm text-muted-foreground font-medium leading-relaxed">
                      {receive.ri_keterangan}
                    </p>
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
                              <span className="text-[11px] font-black font-mono uppercase tracking-wide text-foreground">
                                {item.part_number}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-[10px] font-medium text-muted-foreground uppercase leading-snug">
                                {item.part_name}
                              </span>
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              <span className="text-xs font-bold text-foreground">
                                {item.qty}{" "}
                                <span className="text-muted-foreground font-medium text-[10px]">
                                  {item.satuan}
                                </span>
                              </span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Footer meta */}
              <div className="flex items-center justify-end">
                <p className="text-[9px] font-medium text-muted-foreground/60 uppercase">
                  Dibuat:{" "}
                  {new Date(receive.created_at).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
