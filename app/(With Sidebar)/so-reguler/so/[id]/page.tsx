"use client";

import React, { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  ReceiptText,
  Loader2,
  ShoppingCart,
  Truck,
  Building2,
  UsersRound,
  Calendar as CalendarIcon,
  Clock,
  User,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import {
  computeSoItemRemaining,
  fetchSoItemFulfillment,
  type SoItemFulfillment,
} from "@/lib/so-reguler";
import { SoStatusBadge } from "@/components/so-reguler/so-status-badge";
import {
  cancelSoReguler,
  syncSoRegulerStatus,
} from "@/services/so-reguler-actions";

const PRIORITY_COLOR: Record<string, string> = {
  P1: "text-destructive bg-destructive/10 border-destructive/30",
  P2: "text-warning bg-warning/10 border-warning/30",
  P3: "text-primary bg-primary/10 border-primary/30",
  P4: "text-muted-foreground bg-muted border-border",
};

export default function SoRegulerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const soId = Number(id);
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [so, setSo] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [fulfillment, setFulfillment] = useState<
    Map<number, SoItemFulfillment>
  >(new Map());
  const [isModerator, setIsModerator] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    // Segarkan status dulu (mis. setelah PO dihapus lewat cascade moderator).
    await syncSoRegulerStatus(soId);
    const { data } = await supabase
      .from("so_reguler")
      .select(
        "*, cabang:cabang!cabang_id(nama_cabang), customer:customers!customer_id(customer_name, customer_no), so_reguler_items(*)",
      )
      .eq("id", soId)
      .maybeSingle();
    if (!data) {
      setSo(null);
      setLoading(false);
      return;
    }
    const soItems = [...(data.so_reguler_items || [])].sort(
      (a: any, b: any) => a.id - b.id,
    );
    setSo(data);
    setItems(soItems);
    setFulfillment(
      await fetchSoItemFulfillment(
        supabase,
        soItems.map((i: any) => i.id),
      ),
    );
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      setIsModerator(
        (data || []).some((r: any) => r.roles?.name === "moderator"),
      );
    });
  }, [soId]);

  const handleCancel = async () => {
    if (!cancelReason.trim()) return toast.error("Isi alasan pembatalan.");
    setCancelling(true);
    const res = await cancelSoReguler(soId, cancelReason);
    setCancelling(false);
    if (res.error) return toast.error(res.error);
    toast.success("SO Reguler dibatalkan");
    setCancelOpen(false);
    setCancelReason("");
    fetchData();
  };

  if (loading) {
    return (
      <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!so) {
    return (
      <Content>
        <p className="text-sm text-muted-foreground">
          SO Reguler tidak ditemukan.
        </p>
      </Content>
    );
  }

  const rows = items.map((item) => {
    const f = fulfillment.get(item.id);
    return { item, f, ...computeSoItemRemaining(item.qty, f) };
  });
  const isClosed = so.so_status === "cancelled";
  const totalSisaPo = rows.reduce((s, r) => s + r.sisaPo, 0);
  const totalSisaDo = rows.reduce((s, r) => s + r.sisaDo, 0);

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => router.push("/so-reguler/so")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                  {so.so_kode}
                </h1>
                <SoStatusBadge status={so.so_status} />
              </div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                SO Reguler · {so.kategori || "-"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isClosed && totalSisaPo > 0 && (
              <Button
                variant="outline"
                className="gap-2 font-bold text-xs h-9 uppercase"
                onClick={() => router.push(`/po/create?so_id=${so.id}`)}
              >
                <ShoppingCart className="h-4 w-4" /> Buat PO dari SO
              </Button>
            )}
            {!isClosed && totalSisaDo > 0 && (
              <Button
                className="gap-2 font-bold text-xs h-9 uppercase"
                onClick={() =>
                  router.push(`/so-reguler/do/create?so_id=${so.id}`)
                }
              >
                <Truck className="h-4 w-4" /> Buat DO dari SO
              </Button>
            )}
            {isModerator && !isClosed && (
              <Button
                variant="ghost"
                className="gap-2 font-bold text-xs h-9 uppercase text-destructive hover:text-destructive"
                onClick={() => setCancelOpen(true)}
              >
                <Ban className="h-4 w-4" /> Batalkan
              </Button>
            )}
          </div>
        </div>
      </Content>

      <Content>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 text-xs">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
              <UsersRound className="h-3 w-3" /> Customer
            </p>
            <p className="font-bold uppercase text-success">
              {so.customer?.customer_name || "-"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {so.customer?.customer_no}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> Lokasi Site
            </p>
            <p className="font-bold uppercase">{so.cabang?.nama_cabang || "-"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
              <CalendarIcon className="h-3 w-3" /> Tanggal /{" "}
              <Clock className="h-3 w-3 text-destructive/60" /> Deadline
            </p>
            <p className="font-bold">
              {so.so_tanggal ? formatDate(so.so_tanggal) : "-"} /{" "}
              <span className="text-destructive">
                {so.so_due_date ? formatDate(so.so_due_date) : "-"}
              </span>
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> PIC
            </p>
            <p className="font-bold">{so.so_pic || "-"}</p>
          </div>
          {so.remarks && (
            <div className="sm:col-span-2 xl:col-span-4 rounded-md bg-muted/40 border border-border p-3">
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                Keterangan
              </p>
              <p className="whitespace-pre-wrap">{so.remarks}</p>
            </div>
          )}
          {isClosed && (
            <div className="sm:col-span-2 xl:col-span-4 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-destructive">
              <p className="text-[10px] font-bold uppercase mb-1">
                Dibatalkan
                {so.cancelled_at ? ` · ${formatDate(so.cancelled_at)}` : ""}
              </p>
              <p className="whitespace-pre-wrap">{so.cancel_reason || "-"}</p>
            </div>
          )}
        </div>
      </Content>

      <Content title="Daftar Barang & Pemenuhan">
        <p className="text-[10px] text-muted-foreground font-medium mb-3">
          Tiap item bisa dipecah per qty: sebagian langsung DO dari stok,
          sebagian di-PO dulu (diterima di gudang {so.cabang?.nama_cabang}) lalu
          di-DO. &quot;Bisa di-PO&quot; = qty yang belum di-PO dan belum
          dikirim dari stok.
        </p>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="h-10 hover:bg-transparent">
                <TableHead className="w-10 text-center text-[10px] font-black uppercase text-muted-foreground">
                  No
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Barang
                </TableHead>
                <TableHead className="w-20 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Prioritas
                </TableHead>
                <TableHead className="w-20 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Qty SO
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  PO (diterima)
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  DO
                </TableHead>
                <TableHead className="w-24 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Bisa di-PO
                </TableHead>
                <TableHead className="w-24 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Belum Dikirim
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, f, sisaPo, sisaDo }, idx) => (
                <TableRow key={item.id} className="align-top">
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <p className="font-semibold text-xs">{item.part_name}</p>
                    <code className="text-[10px] text-muted-foreground">
                      {item.part_number}
                    </code>
                    {item.remarks && (
                      <p className="text-[10px] text-muted-foreground italic mt-0.5">
                        {item.remarks}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold ${PRIORITY_COLOR[item.item_priority] || ""}`}
                    >
                      {item.item_priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-xs font-bold">
                    {item.qty}{" "}
                    <span className="text-[9px] text-muted-foreground uppercase">
                      {item.satuan}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs font-bold">
                      {f?.qtyPo ?? 0}{" "}
                      <span className="text-[10px] text-muted-foreground font-medium">
                        ({f?.qtyPoReceived ?? 0})
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {f?.pos.map((p) => (
                        <Link key={`${p.id}-${p.qty}`} href={`/po/${p.id}`}>
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono font-bold hover:bg-muted"
                          >
                            {p.po_kode} · {p.qty}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs font-bold">{f?.qtyDo ?? 0}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {f?.dos.map((d) => (
                        <Badge
                          key={`${d.id}-${d.qty}`}
                          variant="outline"
                          className="text-[9px] font-mono font-bold"
                        >
                          {d.do_kode} · {d.qty}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-xs font-bold text-primary">
                    {sisaPo}
                  </TableCell>
                  <TableCell
                    className={`text-center text-xs font-bold ${sisaDo > 0 ? "text-warning" : "text-success"}`}
                  >
                    {sisaDo}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Batalkan SO {so.so_kode}?</DialogTitle>
            <DialogDescription>
              PO dan DO yang sudah dibuat dari SO ini tidak ikut dibatalkan. SO
              tidak bisa dipakai lagi untuk PO/DO baru.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Alasan pembatalan..."
            className="min-h-20 text-xs"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCancelOpen(false)}
              disabled={cancelling}
            >
              Tutup
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Batalkan SO"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
