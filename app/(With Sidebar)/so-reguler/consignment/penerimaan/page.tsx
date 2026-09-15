"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  Loader2,
  PackageCheck,
  Trash2,
  Eye,
  MessageSquareWarning,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import { useDebounce } from "use-debounce";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  getConsignmentPenerimaanList,
  deleteConsignmentPenerimaan,
  resolveComplaintItem,
} from "@/services/consignment-penerimaan-actions";

export default function ConsignmentPenerimaanPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);

  const [detail, setDetail] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentPenerimaanList();
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("roles(name)")
          .eq("user_id", user.id);
        const roleNames = (roleRows || [])
          .map((r: any) => r.roles?.name)
          .filter(Boolean);
        setIsModeratorOrAdmin(
          roleNames.some((r: string) => r === "moderator" || r === "admin"),
        );
      }
    };
    init();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = rows.filter((r) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      r.penerimaan_kode?.toLowerCase().includes(q) ||
      r.ik?.ik_kode?.toLowerCase().includes(q) ||
      r.customer?.customer_name?.toLowerCase().includes(q)
    );
  });

  const hasOpenComplaint = (r: any) =>
    (r.consignment_penerimaan_items || []).some(
      (i: any) => i.status === "komplain" && i.resolution_status === "open",
    );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await deleteConsignmentPenerimaan(deleteTarget.id);
    setDeleting(false);
    if (res.success) {
      toast.success("Penerimaan berhasil dihapus, stok sudah dikembalikan.");
      setDeleteTarget(null);
      load();
    } else {
      toast.error(res.error || "Gagal menghapus Penerimaan.");
    }
  };

  const handleResolve = async () => {
    if (!resolveTarget) return;
    setResolving(true);
    const res = await resolveComplaintItem(resolveTarget.id, resolveNote);
    setResolving(false);
    if (res.success) {
      toast.success("Komplain ditandai selesai.");
      setResolveTarget(null);
      setResolveNote("");
      load();
      setDetail((prev: any) =>
        prev
          ? {
              ...prev,
              consignment_penerimaan_items: prev.consignment_penerimaan_items.map(
                (i: any) =>
                  i.id === resolveTarget.id
                    ? { ...i, resolution_status: "selesai", catatan_resolusi: resolveNote }
                    : i,
              ),
            }
          : prev,
      );
    } else {
      toast.error(res.error || "Gagal menandai selesai.");
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Penerimaan Konsinyasi
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Konfirmasi barang diterima customer & komplain
              </p>
            </div>
          </div>
          <Link href="/so-reguler/consignment/penerimaan/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat Penerimaan
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="relative min-w-0 flex-1 xl:max-w-100">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari No. Penerimaan, No. IK, atau Customer..."
            className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">No. Penerimaan</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tgl Terima</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">No. IK</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Customer</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Nama Penerima</TableHead>
                <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Item</TableHead>
                <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="w-24 text-[10px] font-black uppercase text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-xs text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada Penerimaan
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-bold text-xs">{r.penerimaan_kode}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.tanggal_terima ? formatDate(r.tanggal_terima) : "-"}
                    </TableCell>
                    <TableCell className="text-xs">{r.ik?.ik_kode || "-"}</TableCell>
                    <TableCell className="text-xs">{r.customer?.customer_name || "-"}</TableCell>
                    <TableCell className="text-xs">{r.nama_penerima}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-bold text-[10px]">
                        {(r.consignment_penerimaan_items || []).length}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {hasOpenComplaint(r) ? (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <MessageSquareWarning className="h-3 w-3" /> Komplain
                        </Badge>
                      ) : (
                        <Badge className="text-[10px]">Sesuai</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setDetail(r)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {isModeratorOrAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.penerimaan_kode}</DialogTitle>
            <DialogDescription>
              IK {detail?.ik?.ik_kode} · {detail?.customer?.customer_name} · Diterima oleh {detail?.nama_penerima}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Kirim</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Terima</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                  <TableHead className="w-36 text-[10px] font-black uppercase text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.consignment_penerimaan_items || []).map((item: any) => (
                  <TableRow key={item.id} className="h-14">
                    <TableCell>
                      <code className="block text-xs font-bold">{item.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{item.part_name}</span>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">
                      {item.qty_kirim} {item.satuan}
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">
                      {item.qty_terima} {item.satuan}
                    </TableCell>
                    <TableCell>
                      {item.status === "komplain" ? (
                        <div className="space-y-1">
                          <Badge
                            variant={item.resolution_status === "selesai" ? "secondary" : "destructive"}
                            className="text-[10px]"
                          >
                            Komplain · {item.resolution_status === "selesai" ? "Selesai" : "Open"}
                          </Badge>
                          <p className="text-[10px] text-muted-foreground">{item.catatan_komplain}</p>
                          {item.catatan_resolusi && (
                            <p className="text-[10px] text-muted-foreground italic">
                              Resolusi: {item.catatan_resolusi}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Badge className="text-[10px]">Sesuai</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.status === "komplain" && item.resolution_status === "open" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px]"
                          onClick={() => {
                            setResolveTarget(item);
                            setResolveNote("");
                          }}
                        >
                          Tandai Selesai
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {detail?.catatan && (
            <p className="text-xs text-muted-foreground">Catatan: {detail.catatan}</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Komplain — {resolveTarget?.part_number}</DialogTitle>
            <DialogDescription>{resolveTarget?.catatan_komplain}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Catatan Resolusi (opsional)</Label>
            <Textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Bagaimana komplain ini ditindaklanjuti..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveTarget(null)} disabled={resolving}>
              Batal
            </Button>
            <Button onClick={handleResolve} disabled={resolving}>
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tandai Selesai"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Penerimaan {deleteTarget?.penerimaan_kode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stok akan dikembalikan ke gudang tujuan IK dan dikurangi dari
              stok customer (membalikkan pergerakan stok Penerimaan ini).
              Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
