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
  ClipboardList,
  ArrowRight,
  Trash2,
  Eye,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import { useDebounce } from "use-debounce";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  getConsignmentIkList,
  deleteConsignmentIk,
} from "@/services/consignment-ik-actions";

export default function ConsignmentIkPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [iks, setIks] = useState<any[]>([]);
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);

  const [detailIk, setDetailIk] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentIkList();
    setIks(res.data || []);
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

  const filtered = iks.filter((ik) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      ik.ik_kode?.toLowerCase().includes(q) ||
      ik.no_awb?.toLowerCase().includes(q) ||
      ik.so?.so_no?.toLowerCase().includes(q)
    );
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await deleteConsignmentIk(deleteTarget.id);
    setDeleting(false);
    if (res.success) {
      toast.success("IK berhasil dihapus, stok sudah dikembalikan.");
      setDeleteTarget(null);
      load();
    } else {
      toast.error(res.error || "Gagal menghapus IK.");
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Invoice Konsinyasi
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Pengiriman fisik barang Consignment antar gudang
              </p>
            </div>
          </div>
          <Link href="/so-reguler/consignment/ik/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat Invoice Konsinyasi
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
            placeholder="Cari No. IK, No. AWB, atau No. SO..."
            className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Kode IK</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tgl IK</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">No. SO</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Gudang</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">No. AWB</TableHead>
                <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Item</TableHead>
                <TableHead className="w-24 text-[10px] font-black uppercase text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-xs text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada Invoice Konsinyasi
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((ik) => (
                  <TableRow key={ik.id}>
                    <TableCell className="font-bold text-xs">{ik.ik_kode}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {ik.ik_tanggal ? formatDate(ik.ik_tanggal) : "-"}
                    </TableCell>
                    <TableCell className="text-xs">{ik.so?.so_no || "-"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        {ik.cabang_asal?.nama_cabang || "-"}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        {ik.cabang_tujuan?.nama_cabang || "-"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{ik.no_awb || "-"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-bold text-[10px]">
                        {(ik.consignment_ik_items || []).length}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setDetailIk(ik)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {isModeratorOrAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(ik)}
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

      <Dialog open={!!detailIk} onOpenChange={(o) => !o && setDetailIk(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailIk?.ik_kode}</DialogTitle>
            <DialogDescription>
              {detailIk?.cabang_asal?.nama_cabang} → {detailIk?.cabang_tujuan?.nama_cabang}
              {detailIk?.no_awb ? ` · AWB: ${detailIk.no_awb}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detailIk?.consignment_ik_items || []).map((item: any) => (
                  <TableRow key={item.id} className="h-11">
                    <TableCell>
                      <code className="block text-xs font-bold">{item.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{item.part_name}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold">
                      {item.qty} {item.satuan}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Invoice Konsinyasi {deleteTarget?.ik_kode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stok akan dikembalikan ke gudang asal dan dikurangi dari gudang
              tujuan (membalikkan pergerakan stok IK ini). Tindakan ini tidak
              bisa dibatalkan.
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
