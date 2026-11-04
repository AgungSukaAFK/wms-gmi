"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { canCreateMR } from "@/lib/mr-permissions";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Plus,
  CalendarRange,
  Snowflake,
  Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  FilterRange,
  FilterRangeFields,
  filterOptionLabel,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";
import { ListSearchInput } from "@/components/list-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { sortRows } from "@/lib/client-sort";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { getScheduledMaterialRequests } from "@/services/scheduled-mr-actions";
import { StatusBadge } from "@/components/status-badge";

// Harus sama dengan kolom yang dicari di `filtered`.
const SCHEDULED_SEARCH_FIELDS = ["Kode MR", "Requester"];

const SCHEDULED_STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Completed", value: "completed" },
  { label: "Rejected", value: "rejected" },
];

const SCHEDULED_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getScheduledSortValue.
const SCHEDULED_COLUMNS = [
  { id: "mr_kode", label: "Kode MR", sortDirection: "asc", className: SCHEDULED_HEAD_CLASS },
  { id: "mr_pic", label: "Requester", sortDirection: "asc", className: SCHEDULED_HEAD_CLASS },
  { id: "cabang", label: "Cabang", sortDirection: "asc", className: SCHEDULED_HEAD_CLASS },
  { id: "mr_tanggal", label: "Tgl Input", sortDirection: "desc", className: SCHEDULED_HEAD_CLASS },
  { id: "due", label: "Rentang Due Date Item", className: SCHEDULED_HEAD_CLASS },
  { id: "item", label: "Item", className: `text-center ${SCHEDULED_HEAD_CLASS}` },
  { id: "frozen", label: "Frozen", className: `text-center ${SCHEDULED_HEAD_CLASS}` },
  { id: "mr_status", label: "Status", sortDirection: "asc", className: SCHEDULED_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type ScheduledColumnId = (typeof SCHEDULED_COLUMNS)[number]["id"];

const getScheduledSortValue = (mr: any, key: string) =>
  key === "cabang" ? mr.cabang?.nama_cabang : mr[key];

export default function ScheduledMRPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [mrs, setMrs] = useState<any[]>([]);
  const [canCreate, setCanCreate] = useState(false);

  const columnOrder = useColumnOrder("wms:table-column-order:scheduled-mr", SCHEDULED_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
  const dateFrom = urlState.get("dari");
  const setDateFrom = (v: string) =>
    urlState.set({ dari: v }, { resetPage: true });
  const dateTo = urlState.get("sampai");
  const setDateTo = (v: string) =>
    urlState.set({ sampai: v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

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
        setCanCreate(canCreateMR(roleNames));
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await getScheduledMaterialRequests();
      setMrs(res.data || []);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = mrs.filter((mr) => {
    const q = debouncedSearch.toLowerCase();
    const matchSearch =
      !q ||
      mr.mr_kode?.toLowerCase().includes(q) ||
      mr.mr_pic?.toLowerCase().includes(q);
    const matchStatus =
      statusFilters.length === 0 || statusFilters.includes(mr.mr_status);
    const tanggal = (mr.mr_tanggal || "").slice(0, 10);
    const matchTanggal =
      (!dateFrom || tanggal >= dateFrom) && (!dateTo || tanggal <= dateTo);
    return matchSearch && matchStatus && matchTanggal;
  });

  const sorted = sortRows(filtered, sortOrder, getScheduledSortValue);
  const totalCount = sorted.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(totalCount / limit)));
  const pageRows = sorted.slice((safePage - 1) * limit, safePage * limit);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const resetFilters = () => {
    resetSearchQuery();
    urlState.reset();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");
  const activeFilters: ActiveFilter[] = [];
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(SCHEDULED_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (mr: any, id: ScheduledColumnId) => {
    const dueDates = (mr.mr_items || [])
      .map((i: any) => i.item_due_date)
      .filter(Boolean)
      .sort();
    const frozenCount = (mr.mr_items || []).filter(
      (i: any) => i.is_item_frozen,
    ).length;

    switch (id) {
      case "mr_kode":
        return (
          <TableCell className="font-bold text-xs">
            {mr.mr_kode}
          </TableCell>
        );
      case "mr_pic":
        return (
          <TableCell className="text-xs">{mr.mr_pic}</TableCell>
        );
      case "cabang":
        return (
          <TableCell className="text-xs">
            {mr.cabang?.nama_cabang || "-"}
          </TableCell>
        );
      case "mr_tanggal":
        return (
          <TableCell className="text-xs whitespace-nowrap">
            {mr.mr_tanggal ? formatDate(mr.mr_tanggal) : "-"}
          </TableCell>
        );
      case "due":
        return (
          <TableCell className="text-xs whitespace-nowrap">
            {dueDates.length > 0
              ? `${formatDate(dueDates[0])} — ${formatDate(dueDates[dueDates.length - 1])}`
              : "-"}
          </TableCell>
        );
      case "item":
        return (
          <TableCell className="text-center text-xs font-semibold">
            {(mr.mr_items || []).length}
          </TableCell>
        );
      case "frozen":
        return (
          <TableCell className="text-center">
            {frozenCount > 0 ? (
              <Badge className="gap-1 bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[10px] dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800">
                <Snowflake className="h-3 w-3" /> {frozenCount}
              </Badge>
            ) : (
              <span className="text-muted-foreground/40 text-xs">-</span>
            )}
          </TableCell>
        );
      case "mr_status":
        return (
          <TableCell><StatusBadge status={mr.mr_status} /></TableCell>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Scheduled MR
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Perencanaan kebutuhan s/d 3 bulan, per item
              </p>
            </div>
          </div>
          {canCreate && (
            <Link href="/mr/scheduled/create">
              <Button className="h-9 gap-2 text-xs font-bold uppercase">
                <Plus className="h-4 w-4" /> Buat Scheduled MR
              </Button>
            </Link>
          )}
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari Kode MR atau Requester..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={SCHEDULED_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={SCHEDULED_STATUS_OPTIONS}
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tgl Input">
                <FilterRange
                  from={
                    <DatePickerString
                      value={dateFrom}
                      onChange={setDateFrom}
                      placeholder="Dari"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                  to={
                    <DatePickerString
                      value={dateTo}
                      onChange={setDateTo}
                      placeholder="Sampai"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                />
              </FilterField>
            </FilterRangeFields>
          </FilterPanel>
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[1200px]"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
              className="hover:bg-transparent h-10"
            >
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sortOrder, onSort: handleSortChange }}
                />
              ))}
              <TableHead className="w-20 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">
                Aksi
              </TableHead>
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Belum ada Scheduled MR"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((mr) => (
                <TableRow key={mr.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(mr, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem asChild>
                        <Link href={`/mr/scheduled/${mr.id}`}>
                          <Eye className="mr-2 h-4 w-4" /> Lihat Detail
                        </Link>
                      </DropdownMenuItem>
                    </RowActionsMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={safePage}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Scheduled MR"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>
    </>
  );
}
