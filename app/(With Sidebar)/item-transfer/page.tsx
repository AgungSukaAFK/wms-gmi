"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { MultiSelect } from "@/components/ui/multi-select";
import { useDebounce } from "use-debounce";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Search,
  MapPin,
  Plus,
  ArrowRight,
  Calendar as CalendarIcon,
  ChevronRight,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { ItemTransferDetailSheet } from "@/components/item-transfer/item-transfer-detail-sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { formatDate } from "@/lib/utils";
import {
  IT_STATUS_LABEL,
  buildItemTransferWorkbook,
  downloadWorkbook,
  type ItExportItem,
} from "@/lib/item-transfer-export";

const IT_SORT_COLUMNS: Record<string, string> = {
  it_kode: "it_kode",
  it_tanggal: "it_tanggal",
  status: "status",
};

export default function ItemTransferPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<string>("newest");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setAvailableCabang(data || []));
  }, []);

  // Dipakai bersama oleh list & export supaya hasil export = filter di layar.
  const buildFilteredQuery = (withCount = false) => {
    let query = supabase
      .from("item_transfers")
      .select(
        "*, dari:cabang!dari_cabang_id(nama_cabang), tujuan:cabang!ke_cabang_id(nama_cabang)",
        withCount ? { count: "exact" } : undefined,
      );

    if (debouncedSearch) {
      query = query.or(
        `it_kode.ilike.%${debouncedSearch}%,pic.ilike.%${debouncedSearch}%`,
      );
    }
    if (statusFilters.length > 0) query = query.in("status", statusFilters);
    if (locationFilters.length > 0)
      query = query.or(
        `dari_cabang_id.in.(${locationFilters.join(",")}),ke_cabang_id.in.(${locationFilters.join(",")})`,
      );
    return query;
  };

  const getSort = () => {
    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = IT_SORT_COLUMNS[sortKeyRaw];
    return {
      field: sortColumn || "created_at",
      ascending: sortColumn ? sortDirRaw === "asc" : false,
    };
  };

  const fetchData = async () => {
    setLoading(true);
    const query = buildFilteredQuery(true);
    const { field, ascending } = getSort();
    const from = (page - 1) * limit;
    const { data, count, error } = await query
      .order(field, { ascending })
      .range(from, from + limit - 1);

    if (!error) {
      setRows(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const pageSize = 1000;
      const { field, ascending } = getSort();
      const transfers: any[] = [];
      for (let pageIndex = 0; ; pageIndex += 1) {
        const from = pageIndex * pageSize;
        const { data, error } = await buildFilteredQuery()
          .order(field, { ascending })
          .order("id", { ascending })
          .range(from, from + pageSize - 1);
        if (error) {
          toast.error(error.message || "Gagal mengambil data untuk export.");
          return;
        }
        transfers.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      if (transfers.length === 0) {
        toast.error("Tidak ada data untuk diekspor.");
        return;
      }

      // Item per IT + referensi MR/RI (kalau IT dibuat dari RI). Di-chunk per
      // 200 IT dan di-paginate karena 1 chunk bisa > 1000 baris item.
      const itIds = transfers.map((t) => t.id);
      const items: ItExportItem[] = [];
      for (let i = 0; i < itIds.length; i += 200) {
        const chunk = itIds.slice(i, i + 200);
        for (let pageIndex = 0; ; pageIndex += 1) {
          const from = pageIndex * pageSize;
          const { data, error } = await supabase
            .from("item_transfer_items")
            .select(
              "it_id, part_number, part_name, satuan, qty, mr_items(mrs(mr_kode)), receive_items(receives(ri_kode))",
            )
            .in("it_id", chunk)
            .order("it_id")
            .order("id")
            .range(from, from + pageSize - 1);
          if (error) {
            toast.error(error.message || "Gagal mengambil item transfer.");
            return;
          }
          for (const row of (data || []) as any[]) {
            const mrItem = Array.isArray(row.mr_items)
              ? row.mr_items[0]
              : row.mr_items;
            const riItem = Array.isArray(row.receive_items)
              ? row.receive_items[0]
              : row.receive_items;
            items.push({
              it_id: row.it_id,
              part_number: row.part_number,
              part_name: row.part_name,
              satuan: row.satuan,
              qty: row.qty,
              mr_kode: mrItem?.mrs?.mr_kode ?? null,
              ri_kode: riItem?.receives?.ri_kode ?? null,
            });
          }
          if (!data || data.length < pageSize) break;
        }
      }

      const uids = Array.from(
        new Set(
          transfers
            .flatMap((t) => [t.uid_requester, t.uid_receiver])
            .filter(Boolean),
        ),
      ) as string[];
      const profilesMap: Record<string, string> = {};
      for (let i = 0; i < uids.length; i += 200) {
        const { data } = await supabase
          .from("profiles")
          .select("id, nama")
          .in("id", uids.slice(i, i + 200));
        (data || []).forEach((p: any) => (profilesMap[p.id] = p.nama));
      }

      const filterParts: string[] = [];
      if (debouncedSearch) filterParts.push(`Cari "${debouncedSearch}"`);
      if (statusFilters.length > 0)
        filterParts.push(
          `Status: ${statusFilters.map((s) => IT_STATUS_LABEL[s] || s).join(", ")}`,
        );
      if (locationFilters.length > 0)
        filterParts.push(
          `Lokasi: ${locationFilters
            .map(
              (id) =>
                availableCabang.find((c) => c.id.toString() === id)
                  ?.nama_cabang || id,
            )
            .join(", ")}`,
        );

      const wb = await buildItemTransferWorkbook({
        transfers,
        items,
        profilesMap,
        filterDescription: filterParts.join("; ") || "Semua data",
      });
      await downloadWorkbook(
        wb,
        `ITEM_TRANSFER_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(
        `Export Excel berhasil (${transfers.length} dokumen, ${items.length} item).`,
      );
    } catch (err: any) {
      toast.error(err?.message || "Gagal membuat file Excel.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [debouncedSearch, statusFilters, locationFilters, sortOrder, page, limit]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge variant="outline" className="text-primary border-primary/30 bg-primary/10 font-bold text-[10px] uppercase">
            Menunggu Approval
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success text-success-foreground font-bold text-[10px] uppercase">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="font-bold text-[10px] uppercase">
            Rejected
          </Badge>
        );
      case "completed":
      case "done":
        return (
          <Badge className="bg-foreground text-background font-bold text-[10px] uppercase">
            Selesai
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="font-bold text-[10px] uppercase">
            {status}
          </Badge>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Item Transfer
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Pemindahan stok antar gudang
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={loading || exporting}
              className="gap-2 font-bold text-xs h-9 uppercase"
            >
              <Download className="h-4 w-4" />
              {exporting ? "MENGEKSPOR..." : "EXPORT EXCEL"}
            </Button>
            <Button
              onClick={() => router.push("/item-transfer/create")}
              className="shrink-0 gap-2 font-bold text-xs h-9 uppercase"
            >
              <Plus className="h-4 w-4" /> Buat Item Transfer
            </Button>
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari Kode IT atau PIC..."
              className="pl-9 h-9 bg-muted/40 text-xs font-medium"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <MultiSelect
            className="w-full sm:w-45"
            placeholder="Semua Lokasi"
            icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
            searchable
            selected={locationFilters}
            onChange={(v) => {
              setLocationFilters(v);
              setPage(1);
            }}
            options={availableCabang.map((c) => ({
              label: c.nama_cabang,
              value: c.id.toString(),
            }))}
          />
          <MultiSelect
            className="w-full sm:w-44"
            placeholder="Semua Status"
            selected={statusFilters}
            onChange={(v) => {
              setStatusFilters(v);
              setPage(1);
            }}
            options={[
              { label: "Menunggu Approval", value: "open" },
              { label: "Approved", value: "approved" },
              { label: "Rejected", value: "rejected" },
              { label: "Selesai", value: "completed" },
            ]}
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent h-12">
                <SortableTableHead
                  sortKey="it_kode"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground"
                >
                  Kode IT
                </SortableTableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Rute Gudang</TableHead>
                <SortableTableHead
                  sortKey="it_tanggal"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  defaultDir="desc"
                  className="justify-center text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Tanggal
                </SortableTableHead>
                <SortableTableHead
                  sortKey="status"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="justify-center text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Status
                </SortableTableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5} className="h-16 animate-pulse bg-muted/20" />
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]">
                    Belum ada Item Transfer
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="group hover:bg-muted/30 cursor-pointer h-16"
                    onClick={() => {
                      setSelectedId(r.id);
                      setDetailOpen(true);
                    }}
                  >
                    <TableCell className="font-bold text-foreground uppercase text-sm">
                      {r.it_kode}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase">
                        {r.dari?.nama_cabang}
                        <ArrowRight className="h-3.5 w-3.5 text-primary" />
                        {r.tujuan?.nama_cabang}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        {r.it_tanggal ? formatDate(r.it_tanggal) : "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {getStatusBadge(r.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary inline" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="pt-4 border-t border-border">
          <DataTablePagination
            totalCount={totalCount}
            pageSize={limit}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={(val) => {
              setLimit(parseInt(val));
              setPage(1);
            }}
            itemLabel="Item Transfer"
          />
        </div>
      </Content>

      <ItemTransferDetailSheet
        itId={selectedId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={fetchData}
      />
    </>
  );
}
