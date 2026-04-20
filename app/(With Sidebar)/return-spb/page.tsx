"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { Plus, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { getReturnSpbList } from "@/services/spb-actions";

export default function ReturnSpbPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const fetchData = async () => {
    setLoading(true);
    const res = await getReturnSpbList({
      search: debouncedSearch || undefined,
      page,
      limit,
    });
    if (res.error) {
      toast.error(res.error);
      setRows([]);
      setTotal(0);
    } else {
      setRows(res.data || []);
      setTotal(res.count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [debouncedSearch, page, limit]);

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <Undo2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                RETURN SPB
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Pengembalian barang dari SPB
              </p>
            </div>
          </div>
          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            asChild
          >
            <Link href="/return-spb/create">
              <Plus className="h-4 w-4" /> BUAT RETURN
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
              placeholder="Cari kode return"
              className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
            />
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode Return</TableHead>
                <TableHead>No SPB</TableHead>
                <TableHead>Tanggal Return</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    Belum ada data return.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.rtn_kode}
                    </TableCell>
                    <TableCell>{row.spb?.spb_no || "-"}</TableCell>
                    <TableCell>
                      {new Date(row.rtn_tanggal).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell>{row.rtn_status}</TableCell>
                    <TableCell>{row.rtn_note || "-"}</TableCell>
                    <TableCell>
                      {new Date(row.created_at).toLocaleDateString("id-ID")}
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
          itemLabel="Return SPB"
        />
      </Content>
    </>
  );
}
