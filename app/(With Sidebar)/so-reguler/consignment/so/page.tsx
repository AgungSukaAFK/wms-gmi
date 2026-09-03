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
import { Content } from "@/components/content";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useDebounce } from "use-debounce";
import { useRouter } from "next/navigation";
import {
  Handshake,
  Search,
  Plus,
  ChevronRight,
  Calendar as CalendarIcon,
  MapPin,
} from "lucide-react";
import { ConsignmentSoDetailSheet } from "@/components/consignment/consignment-so-detail-sheet";
import { formatDate } from "@/lib/utils";

const SORT_COLUMNS: Record<string, string> = {
  so_no: "so_no",
  so_tanggal_input: "so_tanggal_input",
  due_date: "due_date",
};

export default function ConsignmentSoPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [sort, setSort] = useState("created_at_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    let query = supabase
      .from("consignment_so")
      .select(
        "*, customer:customers!customer_id(customer_name, customer_no), items:consignment_so_items(id)",
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `so_no.ilike.%${debouncedSearch}%,no_po.ilike.%${debouncedSearch}%,site.ilike.%${debouncedSearch}%`,
      );
    }

    const [sortKeyRaw, sortDirRaw] = sort.split(/_(asc|desc)$/);
    const sortColumn = SORT_COLUMNS[sortKeyRaw];

    const from = (page - 1) * limit;
    const { data, count, error } = await query
      .order(sortColumn || "created_at", {
        ascending: sortColumn ? sortDirRaw === "asc" : false,
      })
      .range(from, from + limit - 1);

    if (!error) {
      setRows(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sort, page, limit]);

  const handleSortChange = (nextSort: string) => {
    setSort(nextSort);
    setPage(1);
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Handshake className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Sales Order Consignment
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Pencatatan SO Consignment
              </p>
            </div>
          </div>
          <Button
            onClick={() => router.push("/so-reguler/consignment/so/create")}
            className="shrink-0 gap-2 font-bold text-xs h-9 uppercase"
          >
            <Plus className="h-4 w-4" /> Buat SO Consignment
          </Button>
        </div>
      </Content>

      <Content>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari No. SO, No. PO, atau Site..."
              className="pl-9 h-9 bg-muted/40 text-xs font-medium"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent h-12">
                <SortableTableHead
                  sortKey="so_no"
                  currentSort={sort}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground"
                >
                  No. SO
                </SortableTableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Customer
                </TableHead>
                <SortableTableHead
                  sortKey="so_tanggal_input"
                  currentSort={sort}
                  onSort={handleSortChange}
                  defaultDir="desc"
                  className="text-[10px] font-black uppercase text-muted-foreground text-center"
                >
                  Tgl Input SO
                </SortableTableHead>
                <SortableTableHead
                  sortKey="due_date"
                  currentSort={sort}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground text-center"
                >
                  Due Date
                </SortableTableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Site
                </TableHead>
                <TableHead className="w-20 text-center text-[10px] font-black uppercase text-muted-foreground">
                  Item
                </TableHead>
                <TableHead className="w-14"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(5)
                  .fill(0)
                  .map((_, i) => (
                    <TableRow key={i}>
                      <TableCell
                        colSpan={7}
                        className="h-16 animate-pulse bg-muted/20"
                      />
                    </TableRow>
                  ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada SO Consignment
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
                      {r.so_no}
                      {r.no_po && (
                        <code className="block text-[10px] font-medium text-muted-foreground normal-case">
                          PO: {r.no_po}
                        </code>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-bold text-foreground uppercase">
                        {r.customer?.customer_name || "-"}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {r.customer?.customer_no}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        {r.so_tanggal_input ? formatDate(r.so_tanggal_input) : "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold text-foreground uppercase">
                      {r.due_date ? formatDate(r.due_date) : "-"}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        {r.site || "-"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-xs font-bold">
                      {r.items?.length ?? 0}
                    </TableCell>
                    <TableCell className="text-center">
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
            itemLabel="SO Consignment"
          />
        </div>
      </Content>

      <ConsignmentSoDetailSheet
        soId={selectedId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={fetchData}
      />
    </>
  );
}
