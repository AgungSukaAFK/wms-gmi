"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
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
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Factory,
  Plus,
  Beaker,
  Package,
  Building2,
  Calendar,
  Eye,
} from "lucide-react";
import { getWorkingOrderList } from "@/services/working-order-actions";
import { canManageWoFormula } from "@/lib/wo-formula-permissions";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "Pending Approval": "secondary",
  "On Process": "default",
  Closed: "outline",
  Rejected: "destructive",
};

// Harus sama dengan kolom yang dicari di `filtered`.
const WO_SEARCH_FIELDS = ["Kode WO", "Kode MR", "Departemen"];

const WO_STATUS_OPTIONS = Object.keys(STATUS_VARIANT).map((value) => ({
  label: value,
  value,
}));

const WO_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getWoSortValue.
const WO_COLUMNS = [
  { id: "wo_kode", label: "Kode WO", sortDirection: "asc", className: `pl-5 ${WO_HEAD_CLASS}` },
  { id: "mr", label: "MR Asal", sortDirection: "asc", className: WO_HEAD_CLASS },
  { id: "gudang", label: "Gudang WO", sortDirection: "asc", className: WO_HEAD_CLASS },
  { id: "departemen", label: "Departemen", sortDirection: "asc", className: WO_HEAD_CLASS },
  { id: "wo_tanggal", label: "Tanggal", sortDirection: "desc", className: WO_HEAD_CLASS },
  { id: "items", label: "Items", className: `text-center ${WO_HEAD_CLASS}` },
  { id: "wo_status", label: "Status", sortDirection: "asc", className: `text-center ${WO_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type WoColumnId = (typeof WO_COLUMNS)[number]["id"];

const getWoSortValue = (wo: any, key: string) => {
  if (key === "mr") return wo.mrs?.mr_kode;
  if (key === "gudang") return wo.cabang?.nama_cabang;
  return wo[key];
};

export default function WorkingOrderListPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [wos, setWos] = useState<any[]>([]);
  const [canFormula, setCanFormula] = useState(false);
  const columnOrder = useColumnOrder("wms:table-column-order:working-order", WO_COLUMNS);
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
    void init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      const roleNames = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
      setCanFormula(canManageWoFormula(roleNames));
    }
    const { data } = await getWorkingOrderList();
    setWos(data || []);
    setLoading(false);
  }

  const filtered = wos.filter((wo) => {
    const q = debouncedSearch.toLowerCase();
    const matchSearch =
      !q ||
      wo.wo_kode?.toLowerCase().includes(q) ||
      wo.mrs?.mr_kode?.toLowerCase().includes(q) ||
      wo.departemen?.toLowerCase().includes(q);
    const matchStatus =
      statusFilters.length === 0 || statusFilters.includes(wo.wo_status);
    const tanggal = (wo.wo_tanggal || "").slice(0, 10);
    const matchTanggal =
      (!dateFrom || tanggal >= dateFrom) && (!dateTo || tanggal <= dateTo);
    return matchSearch && matchStatus && matchTanggal;
  });

  const sorted = sortRows(filtered, sortOrder, getWoSortValue);
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
      value: optionLabels(WO_STATUS_OPTIONS, statusFilters),
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
  const renderCell = (wo: any, id: WoColumnId) => {
    switch (id) {
      case "wo_kode":
        return (
          <TableCell className="pl-5">
            <span className="font-black text-xs text-foreground font-mono uppercase tracking-wide">
              {wo.wo_kode}
            </span>
          </TableCell>
        );
      case "mr":
        return (
          <TableCell className="text-xs font-bold text-foreground">
            {wo.mrs?.mr_kode ?? "-"}
          </TableCell>
        );
      case "gudang":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Building2 className="h-3 w-3 shrink-0" />
              {wo.cabang?.nama_cabang ?? "-"}
            </div>
          </TableCell>
        );
      case "departemen":
        return (
          <TableCell>
            <Badge variant="outline" className="text-[10px] font-bold uppercase">
              {wo.departemen}
            </Badge>
          </TableCell>
        );
      case "wo_tanggal":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Calendar className="h-3 w-3 shrink-0" />
              {formatDate(wo.wo_tanggal)}
            </div>
          </TableCell>
        );
      case "items":
        return (
          <TableCell className="text-center">
            <Badge variant="secondary" className="text-[10px] font-bold gap-1">
              <Package className="h-3 w-3" />
              {wo.working_order_items?.length ?? 0}
            </Badge>
          </TableCell>
        );
      case "wo_status":
        return (
          <TableCell className="text-center">
            <Badge
              variant={STATUS_VARIANT[wo.wo_status] || "secondary"}
              className="text-[10px] font-bold uppercase"
            >
              {wo.wo_status}
            </Badge>
          </TableCell>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Working Order
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Assembly/Produksi Internal dari MR
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canFormula && (
              <Link href="/working-order/formula">
                <Button variant="outline" className="gap-2 font-bold text-xs uppercase h-9">
                  <Beaker className="h-4 w-4" /> Kelola Formula
                </Button>
              </Link>
            )}
            <Link href="/working-order/create">
              <Button className="gap-2 font-bold text-xs uppercase h-9">
                <Plus className="h-4 w-4" /> Buat WO
              </Button>
            </Link>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari kode WO, MR, atau departemen..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={WO_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={WO_STATUS_OPTIONS}
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal WO">
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
          className="min-w-[1000px]"
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
                  <TableCell colSpan={8}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Belum ada Working Order"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((wo) => (
                <TableRow
                  key={wo.id}
                  className="cursor-pointer hover:bg-muted/40 border-b border-border/50 h-14 transition-colors"
                  onClick={() => router.push(`/working-order/${wo.id}`)}
                >
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(wo, id)}</React.Fragment>
                  ))}
                  <TableCell
                    className="text-right pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => router.push(`/working-order/${wo.id}`)}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Lihat Detail
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
          itemLabel="WO"
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
