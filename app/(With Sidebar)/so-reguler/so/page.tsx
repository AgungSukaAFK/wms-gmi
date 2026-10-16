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
import { MultiSelect } from "@/components/ui/multi-select";
import { useDebounce } from "use-debounce";
import { useRouter } from "next/navigation";
import {
  ReceiptText,
  Search,
  Plus,
  Calendar as CalendarIcon,
  ChevronRight,
  Clock,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { SO_STATUS_LABEL, canCreateSO } from "@/lib/so-reguler";
import { SoStatusBadge } from "@/components/so-reguler/so-status-badge";
import { CustomerInfoPopover } from "@/components/customers/customer-info-popover";

const SORT_COLUMNS: Record<string, string> = {
  so_kode: "so_kode",
  so_tanggal: "so_tanggal",
  so_due_date: "so_due_date",
  so_status: "so_status",
};

export default function SoRegulerPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [canCreate, setCanCreate] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [sort, setSort] = useState("created_at_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      setCanCreate(canCreateSO((data || []).map((r: any) => r.roles?.name)));
    });
  }, []);

  const fetchData = async () => {
    setLoading(true);
    let query = supabase
      .from("so_reguler")
      .select(
        "*, customer:customers!customer_id(customer_name), so_reguler_items(count)",
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `so_kode.ilike.%${debouncedSearch}%,so_pic.ilike.%${debouncedSearch}%`,
      );
    }
    if (statusFilters.length > 0) query = query.in("so_status", statusFilters);

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
  }, [debouncedSearch, statusFilters, sort, page, limit]);

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
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                SO Reguler
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Sales Order ke customer — dipenuhi lewat PO dan/atau DO Reguler
              </p>
            </div>
          </div>
          {canCreate && (
            <Button
              onClick={() => router.push("/so-reguler/so/create")}
              className="shrink-0 gap-2 font-bold text-xs h-9 uppercase"
            >
              <Plus className="h-4 w-4" /> Buat SO Reguler
            </Button>
          )}
        </div>
      </Content>

      <Content>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari Kode SO atau PIC..."
              className="pl-9 h-9 bg-muted/40 text-xs font-medium"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <MultiSelect
            className="w-full sm:w-44"
            placeholder="Semua Status"
            selected={statusFilters}
            onChange={(v) => {
              setStatusFilters(v);
              setPage(1);
            }}
            options={Object.entries(SO_STATUS_LABEL).map(([value, label]) => ({
              label,
              value,
            }))}
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent h-12">
                <SortableTableHead
                  sortKey="so_kode"
                  currentSort={sort}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground"
                >
                  Kode SO
                </SortableTableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Customer
                </TableHead>
                <SortableTableHead
                  sortKey="so_tanggal"
                  currentSort={sort}
                  onSort={handleSortChange}
                  defaultDir="desc"
                  className="text-[10px] font-black uppercase text-muted-foreground text-center"
                >
                  Tanggal
                </SortableTableHead>
                <SortableTableHead
                  sortKey="so_due_date"
                  currentSort={sort}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground text-center"
                >
                  Deadline
                </SortableTableHead>
                <SortableTableHead
                  sortKey="so_status"
                  currentSort={sort}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground text-center"
                >
                  Status
                </SortableTableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(5)
                  .fill(0)
                  .map((_, i) => (
                    <TableRow key={i}>
                      <TableCell
                        colSpan={6}
                        className="h-16 animate-pulse bg-muted/20"
                      />
                    </TableRow>
                  ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada SO Reguler
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="group hover:bg-muted/30 cursor-pointer h-16"
                    onClick={() => router.push(`/so-reguler/so/${r.id}`)}
                  >
                    <TableCell className="font-bold text-foreground uppercase text-sm">
                      {r.so_kode}
                      <span className="block text-[10px] font-medium text-muted-foreground normal-case">
                        {r.so_reguler_items?.[0]?.count ?? 0} item ·{" "}
                        {r.so_pic || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <CustomerInfoPopover
                        customerId={r.customer_id}
                        customerName={r.customer?.customer_name}
                        className="text-xs font-bold uppercase text-success"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        {r.so_tanggal ? formatDate(r.so_tanggal) : "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-destructive uppercase">
                        <Clock className="h-3.5 w-3.5 text-destructive/40" />
                        {r.so_due_date ? formatDate(r.so_due_date) : "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <SoStatusBadge status={r.so_status} />
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
            itemLabel="SO Reguler"
          />
        </div>
      </Content>
    </>
  );
}
