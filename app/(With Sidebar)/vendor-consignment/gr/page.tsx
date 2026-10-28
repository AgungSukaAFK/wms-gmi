"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { Plus, Search, Loader2, PackageCheck, Eye, Trash2, Printer, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDate } from "@/lib/utils";
import { VendorPicker, type VendorOption } from "@/components/vendor-consignment/vendor-picker";
import {
  deleteConsignmentGr,
  getConsignmentGrList,
  resolveConsignmentGrComplaint,
} from "@/services/vendor-consignment-actions";

export default function ConsignmentGrPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [isModeratorOrAdmin, setIsModeratorOrAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);
  const [onlyOpenComplaint, setOnlyOpenComplaint] = useState(false);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);

  const [bastOpen, setBastOpen] = useState(false);
  const [bastVendor, setBastVendor] = useState<VendorOption | null>(null);
  const [bastBulan, setBastBulan] = useState(new Date().toISOString().slice(0, 7));

  const load = async () => {
    setLoading(true);
    const res = await getConsignmentGrList();
    if (res.error) toast.error(res.error);
    setRows(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleRows } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
      const roleNames = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
      setIsModeratorOrAdmin(roleNames.some((r: string) => r === "moderator" || r === "admin"));
    };
    init();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasOpenComplaint = (gr: any) =>
    (gr.vendor_consignment_gr_items || []).some((i: any) => i.resolution_status === "open");

  const filtered = rows.filter((gr) => {
    if (onlyOpenComplaint && !hasOpenComplaint(gr)) return false;
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      gr.gr_kode?.toLowerCase().includes(q) ||
      gr.no_surat_jalan?.toLowerCase().includes(q) ||
      gr.prs?.pr_kode?.toLowerCase().includes(q) ||
      gr.vendors?.vendor_name?.toLowerCase().includes(q)
    );
  });

  const detail = rows.find((r) => r.id === detailId) || null;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await deleteConsignmentGr(deleteTarget.id);
    setDeleting(false);
    if (res.error) return toast.error(res.error);
    toast.success("GR dihapus, stok konsinyasinya sudah dikurangi kembali.");
    setDeleteTarget(null);
    load();
  };

  const handleResolve = async () => {
    if (!resolveTarget) return;
    setResolving(true);
    const res = await resolveConsignmentGrComplaint(resolveTarget.id, resolveNote);
    setResolving(false);
    if (res.error) return toast.error(res.error);
    toast.success("Komplain ditandai selesai.");
    setResolveTarget(null);
    setResolveNote("");
    load();
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
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">GR Konsinyasi</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Penerimaan barang titipan supplier di WH HO / Branch
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-9 gap-2 text-xs font-bold uppercase" onClick={() => setBastOpen(true)}>
              <Printer className="h-4 w-4" /> BAST Bulanan
            </Button>
            <Link href="/vendor-consignment/gr/create">
              <Button className="h-9 gap-2 text-xs font-bold uppercase">
                <Plus className="h-4 w-4" /> Terima Barang
              </Button>
            </Link>
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative min-w-0 flex-1 xl:max-w-100">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kode GR, PR, surat jalan, vendor..."
              className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
            />
          </div>
          <Button
            variant={onlyOpenComplaint ? "default" : "outline"}
            size="sm"
            className="h-9 text-xs"
            onClick={() => setOnlyOpenComplaint((v) => !v)}
          >
            Komplain belum selesai
          </Button>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Kode GR</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tanggal</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">PR</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Vendor</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Gudang</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Surat Jalan</TableHead>
                <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">Sesuai / Kirim</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada GR Konsinyasi
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((gr) => {
                  const items = gr.vendor_consignment_gr_items || [];
                  const terima = items.reduce((a: number, i: any) => a + i.qty_terima, 0);
                  const kirim = items.reduce((a: number, i: any) => a + i.qty_kirim, 0);
                  return (
                    <TableRow key={gr.id}>
                      <TableCell className="font-bold text-xs">
                        {gr.gr_kode}
                        {hasOpenComplaint(gr) && (
                          <Badge variant="destructive" className="ml-1.5 text-[9px] font-bold">
                            Komplain
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(gr.gr_tanggal)}</TableCell>
                      <TableCell className="text-xs">
                        <Link href={`/pr/${gr.pr_id}`} className="hover:underline">
                          {gr.prs?.pr_kode || "-"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">{gr.vendors?.vendor_name || "-"}</TableCell>
                      <TableCell className="text-xs">{gr.cabang?.nama_cabang || "-"}</TableCell>
                      <TableCell className="text-xs">{gr.no_surat_jalan}</TableCell>
                      <TableCell className="text-center text-xs font-bold">
                        {terima} / {kirim}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailId(gr.id)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {isModeratorOrAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(gr)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.gr_kode}</DialogTitle>
            <DialogDescription>
              PR {detail?.prs?.pr_kode} · {detail?.vendors?.vendor_name} · {detail?.cabang?.nama_cabang} · SJ{" "}
              {detail?.no_surat_jalan}
              {detail?.catatan ? ` · ${detail.catatan}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Kirim</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Sesuai</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Komplain</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.vendor_consignment_gr_items || []).map((i: any) => (
                  <TableRow key={i.id} className="h-12">
                    <TableCell>
                      <code className="block text-xs font-bold">{i.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{i.part_name}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {i.qty_kirim} {i.satuan}
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold">{i.qty_terima}</TableCell>
                    <TableCell className="text-xs max-w-64">
                      {i.status === "komplain" ? (
                        <div className="space-y-1">
                          <p>{i.catatan_komplain}</p>
                          {i.resolution_status === "selesai" && (
                            <p className="text-[10px] text-green-700">Selesai: {i.catatan_resolusi}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {i.resolution_status === "open" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-[10px]"
                          onClick={() => setResolveTarget(i)}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Tandai Selesai
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Selesaikan komplain {resolveTarget?.part_number}</DialogTitle>
            <DialogDescription>{resolveTarget?.catatan_komplain}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Catatan penyelesaian</Label>
            <Input
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="mis. sudah diretur, diganti lewat GR-xxxx"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResolveTarget(null)}>
              Batal
            </Button>
            <Button onClick={handleResolve} disabled={resolving}>
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bastOpen} onOpenChange={setBastOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>BAST Serah Terima Bulanan</DialogTitle>
            <DialogDescription>
              Rekap barang konsinyasi yang diterima dalam satu bulan, ditandatangani GMI & supplier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Vendor</Label>
              <VendorPicker value={bastVendor} onChange={setBastVendor} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bulan</Label>
              <Input type="month" value={bastBulan} onChange={(e) => setBastBulan(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!bastVendor || !bastBulan}
              onClick={() =>
                window.open(`/vendor-consignment/gr/bast?vendor=${bastVendor!.id}&bulan=${bastBulan}`, "_blank")
              }
            >
              <Printer className="h-4 w-4" /> Cetak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus GR {deleteTarget?.gr_kode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stok konsinyasi yang masuk lewat GR ini akan dikurangi kembali. Ditolak kalau barangnya
              sudah ditransfer/dipakai. Tindakan ini tidak bisa dibatalkan.
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
