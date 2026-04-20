"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { FileWarning, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { deleteSpb, getSpbList } from "@/services/spb-actions";

type SpbRow = {
  id: number;
  spb_no: string;
  spb_no_wo?: string | null;
  spb_tanggal: string;
  spb_kode_unit?: string | null;
  spb_tipe_unit?: string | null;
  spb_brand?: string | null;
  spb_hm?: number | null;
  spb_gudang?: string | null;
  spb_pic_gmi?: string | null;
  spb_pic_ppa?: string | null;
  spb_status: string;
};

export default function SpbPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SpbRow[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    const res = await getSpbList({
      search: debouncedSearch || undefined,
      status,
      page,
      limit,
    });

    if (res.error) {
      toast.error(res.error);
      setRows([]);
      setTotal(0);
    } else {
      setRows((res.data || []) as SpbRow[]);
      setTotal(res.count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [debouncedSearch, status, page, limit]);

  const onDelete = async (id: number) => {
    const ok = window.confirm("Hapus SPB ini? Stok akan dikembalikan.");
    if (!ok) return;

    const res = await deleteSpb(id);
    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("SPB berhasil dihapus.");
    fetchData();
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <FileWarning className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                SURAT PENGELUARAN BARANG (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Stock out sesuai alur WMS lama
              </p>
            </div>
          </div>
          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            asChild
          >
            <Link href="/spb/create">
              <Plus className="h-4 w-4" /> BUAT SPB
            </Link>
          </Button>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari No SPB, No WO, PIC"
              className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
            />
          </div>

          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full border-input bg-background text-xs font-semibold text-foreground sm:w-45">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="DONE QUOT">DONE QUOT</SelectItem>
                <SelectItem value="PO_ATTACH">PO_ATTACH</SelectItem>
                <SelectItem value="DO_ATTACH">DO_ATTACH</SelectItem>
                <SelectItem value="DONE_QUOTE">DONE_QUOTE</SelectItem>
                <SelectItem value="Partial">Partial</SelectItem>
                <SelectItem value="Returned">Returned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No SPB</TableHead>
                <TableHead>No WO</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Kode Unit</TableHead>
                <TableHead>Tipe Unit</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>HM</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead>PIC GMI</TableHead>
                <TableHead>PIC PPA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="text-center text-muted-foreground"
                  >
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="text-center text-muted-foreground"
                  >
                    Belum ada data SPB.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.spb_no}</TableCell>
                    <TableCell>{row.spb_no_wo || "-"}</TableCell>
                    <TableCell>
                      {new Date(row.spb_tanggal).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell>{row.spb_kode_unit || "-"}</TableCell>
                    <TableCell>{row.spb_tipe_unit || "-"}</TableCell>
                    <TableCell>{row.spb_brand || "-"}</TableCell>
                    <TableCell>{row.spb_hm ?? "-"}</TableCell>
                    <TableCell>{row.spb_gudang || "-"}</TableCell>
                    <TableCell>{row.spb_pic_gmi || "-"}</TableCell>
                    <TableCell>{row.spb_pic_ppa || "-"}</TableCell>
                    <TableCell>{row.spb_status}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(row.id)}
                        title="Hapus SPB"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DataTablePagination
          totalCount={total}
          pageSize={limit}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          itemLabel="SPB"
        />
      </Content>
    </>
  );
}
