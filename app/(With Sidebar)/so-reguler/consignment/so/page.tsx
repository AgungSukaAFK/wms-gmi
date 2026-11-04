"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ListSearchInput } from "@/components/list-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";
import { useRouter } from "next/navigation";
import {
  Handshake,
  Plus,
  Calendar as CalendarIcon,
  MapPin,
  Eye,
} from "lucide-react";
import { ConsignmentSoDetailSheet } from "@/components/consignment/consignment-so-detail-sheet";
import { formatDate } from "@/lib/utils";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const SORT_COLUMNS: Record<string, string> = {
  so_no: "so_no",
  so_tanggal_input: "so_tanggal_input",
  due_date: "due_date",
};

// Harus sama dengan kolom yang dicari di fetchData.
const CSO_SEARCH_FIELDS = ["No. SO", "No. PO", "Site"];

const ASAL_OPTIONS = [
  { label: "Input Web", value: "web" },
  { label: "Import", value: "import" },
];

const CSO_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di SORT_COLUMNS.
const CSO_COLUMNS = [
  { id: "so_no", label: "No. SO", sortDirection: "asc", className: CSO_HEAD_CLASS },
  { id: "customer", label: "Customer", className: CSO_HEAD_CLASS },
  { id: "so_tanggal_input", label: "Tgl Input SO", sortDirection: "desc", className: `text-center ${CSO_HEAD_CLASS}` },
  { id: "due_date", label: "Due Date", sortDirection: "asc", className: `text-center ${CSO_HEAD_CLASS}` },
  { id: "site", label: "Site", className: CSO_HEAD_CLASS },
  { id: "item", label: "Item", className: `w-20 text-center ${CSO_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type CsoColumnId = (typeof CSO_COLUMNS)[number]["id"];

export default function ConsignmentSoPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:consignment-so", CSO_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const asalFilters = urlState.list("asal");
  const setAsalFilters = (v: string[]) =>
    urlState.set({ asal: v }, { resetPage: true });
  const dateFrom = urlState.get("dari");
  const setDateFrom = (v: string) =>
    urlState.set({ dari: v }, { resetPage: true });
  const dateTo = urlState.get("sampai");
  const setDateTo = (v: string) =>
    urlState.set({ sampai: v }, { resetPage: true });
  const barangFilter = urlState.get("barang");
  const [barangInput, setBarangInput, resetBarangInput] = useUrlSearchInput(
    barangFilter,
    (value) => urlState.set({ barang: value }, { resetPage: true }),
  );
  const sortOrder = urlState.get("sort", "created_at_desc");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "created_at_desc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    // Filter isi item lewat embed alias, supaya jumlah item tidak ikut tersaring.
    const barangEmbed = barangFilter
      ? ", barang_cocok:consignment_so_items!inner(id)"
      : "";
    let query = supabase
      .from("consignment_so")
      .select(
        `*, customer:customers!customer_id(customer_name, customer_no), items:consignment_so_items(id)${barangEmbed}`,
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `so_no.ilike.${orIlikePattern(debouncedSearch)},no_po.ilike.${orIlikePattern(debouncedSearch)},site.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }

    if (asalFilters.length === 1)
      query = query.eq("so_is_import", asalFilters[0] === "import");
    if (dateFrom) query = query.gte("so_tanggal_input", dateFrom);
    if (dateTo) query = query.lte("so_tanggal_input", dateTo);

    if (barangFilter) {
      query = query.or(
        `part_number.ilike.${orIlikePattern(barangFilter)},part_name.ilike.${orIlikePattern(barangFilter)}`,
        { referencedTable: "barang_cocok" },
      );
    }

    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = SORT_COLUMNS[sortKeyRaw];

    const from = (page - 1) * limit;
    const { data, count, error } = await query
      .order(sortColumn || "created_at", {
        ascending: sortColumn ? sortDirRaw === "asc" : false,
      })
      // Pemecah seri: SO hasil import punya created_at sama.
      .order("id", { ascending: false })
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
  }, [
    debouncedSearch,
    asalFilters,
    dateFrom,
    dateTo,
    barangFilter,
    sortOrder,
    page,
    limit,
  ]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const resetFilters = () => {
    resetSearchQuery();
    resetBarangInput();
    urlState.reset();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");
  const activeFilters: ActiveFilter[] = [];
  if (asalFilters.length > 0)
    activeFilters.push({
      key: "asal",
      label: "Asal Data",
      value: optionLabels(ASAL_OPTIONS, asalFilters),
      onRemove: () => setAsalFilters([]),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });
  if (barangFilter)
    activeFilters.push({
      key: "barang",
      label: "Barang",
      value: barangFilter,
      onRemove: () => {
        resetBarangInput();
        urlState.set({ barang: "" }, { resetPage: true });
      },
    });

  const handleRowClick = (id: number) => {
    setSelectedId(id);
    setDetailOpen(true);
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: any, id: CsoColumnId) => {
    switch (id) {
      case "so_no":
        return (
          <TableCell className="font-bold text-foreground uppercase text-sm">
            {r.so_no}
            {r.no_po && (
              <code className="block text-[10px] font-medium text-muted-foreground normal-case">
                PO: {r.no_po}
              </code>
            )}
          </TableCell>
        );
      case "customer":
        return (
          <TableCell>
            <span className="text-xs font-bold text-foreground uppercase">
              {r.customer?.customer_name || "-"}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {r.customer?.customer_no}
            </span>
          </TableCell>
        );
      case "so_tanggal_input":
        return (
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
              {r.so_tanggal_input ? formatDate(r.so_tanggal_input) : "-"}
            </div>
          </TableCell>
        );
      case "due_date":
        return (
          <TableCell className="text-center text-xs font-bold text-foreground uppercase">
            {r.due_date ? formatDate(r.due_date) : "-"}
          </TableCell>
        );
      case "site":
        return (
          <TableCell className="text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
              {r.site || "-"}
            </span>
          </TableCell>
        );
      case "item":
        return (
          <TableCell className="text-center text-xs font-bold">
            {r.items?.length ?? 0}
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
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari No. SO, No. PO, atau Site..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={CSO_SEARCH_FIELDS}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Asal Data">
                <MultiSelect
                  placeholder="Semua Asal"
                  selected={asalFilters}
                  onChange={setAsalFilters}
                  options={ASAL_OPTIONS}
                />
              </FilterField>

              <FilterField label="Barang">
                <Input
                  placeholder="Part number / nama"
                  value={barangInput}
                  onChange={(e) => setBarangInput(e.target.value)}
                  className="h-9 text-xs font-medium"
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tgl Input SO">
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
              Array.from({ length: limit }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "Belum ada SO Consignment"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="group hover:bg-muted/30 cursor-pointer h-16"
                  onClick={() => handleRowClick(r.id)}
                >
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(r, id)}</React.Fragment>
                  ))}
                  <TableCell
                    className="text-right pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActionsMenu>
                      <DropdownMenuItem onSelect={() => handleRowClick(r.id)}>
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
          currentPage={page}
          totalItems={totalCount}
          limit={limit}
          itemLabel="SO Consignment"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
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
