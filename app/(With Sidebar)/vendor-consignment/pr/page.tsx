"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { Plus, Search, Loader2, FileSpreadsheet, Eye, PackageCheck, Printer } from "lucide-react";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { getConsignmentPrList } from "@/services/vendor-consignment-actions";

const STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  approved: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  completed: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  rejected: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
};

function ProgressCell({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1 min-w-24">
      <span className="text-xs font-bold">
        {done} / {total}
      </span>
      <div className="h-1.5 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ConsignmentPrPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => {
    getConsignmentPrList().then((res) => {
      setRows(res.data || []);
      setLoading(false);
    });
  }, []);

  const filtered = rows.filter((pr) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      pr.pr_kode?.toLowerCase().includes(q) ||
      pr.vendors?.vendor_name?.toLowerCase().includes(q) ||
      (pr.pr_items || []).some((i: any) => i.part_number?.toLowerCase().includes(q))
    );
  });

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">PR Konsinyasi</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Daftar barang titipan yang di-share ke supplier · progres GR & PO Rekonsil (FIFO)
              </p>
            </div>
          </div>
          <Link href="/vendor-consignment/pr/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat PR Konsinyasi
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
            placeholder="Cari kode PR, vendor, atau part number..."
            className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Kode PR</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Tanggal</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Vendor</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Gudang</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Diterima (GR)</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Ter-PO</TableHead>
                <TableHead className="w-32" />
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
                    Belum ada PR Konsinyasi
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((pr) => {
                  const canGr =
                    ["approved", "completed"].includes(pr.pr_status) &&
                    (pr.pr_items || []).some((i: any) => i.sisa_gr > 0);
                  return (
                    <TableRow key={pr.id}>
                      <TableCell className="font-bold text-xs">
                        <Link href={`/pr/${pr.id}`} className="hover:underline">
                          {pr.pr_kode}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(pr.pr_tanggal)}</TableCell>
                      <TableCell className="text-xs">{pr.vendors?.vendor_name || "-"}</TableCell>
                      <TableCell className="text-xs">{pr.cabang?.nama_cabang || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-bold uppercase ${STATUS_TONE[pr.pr_status] || ""}`}>
                          {pr.pr_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ProgressCell done={pr.total_gr} total={pr.total_qty} />
                      </TableCell>
                      <TableCell>
                        <ProgressCell done={pr.total_po} total={pr.total_qty} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Detail item" onClick={() => setDetail(pr)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Link href={`/pr/${pr.id}/print`} title="Cetak untuk supplier">
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                          {canGr && (
                            <Link href={`/vendor-consignment/gr/create?pr=${pr.id}`} title="Terima barang (GR)">
                              <Button variant="outline" size="sm" className="h-7 gap-1 text-[10px] font-bold">
                                <PackageCheck className="h-3 w-3" /> GR
                              </Button>
                            </Link>
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

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.pr_kode}</DialogTitle>
            <DialogDescription>
              {detail?.vendors?.vendor_name} · {detail?.cabang?.nama_cabang}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty PR</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Diterima</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Ter-PO</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.pr_items || []).map((i: any) => (
                  <TableRow key={i.id} className="h-11">
                    <TableCell>
                      <code className="block text-xs font-bold">{i.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{i.part_name}</span>
                      {i.rejected && (
                        <Badge variant="destructive" className="mt-1 text-[9px]">Ditolak</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold">
                      {i.qty} {i.satuan}
                    </TableCell>
                    <TableCell className="text-right text-xs">{i.qty_gr}</TableCell>
                    <TableCell className="text-right text-xs">{i.qty_po}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
