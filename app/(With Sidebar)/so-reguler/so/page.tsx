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
  ReceiptText,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  Eye,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import {
  SO_KATEGORI_OPTIONS,
  SO_STATUS_LABEL,
  canCreateSO,
} from "@/lib/so-reguler";
import { SoStatusBadge } from "@/components/so-reguler/so-status-badge";
import { CustomerInfoPopover } from "@/components/customers/customer-info-popover";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const SORT_COLUMNS: Record<string, string> = {
  so_kode: "so_kode",
  so_tanggal: "so_tanggal",
  so_due_date: "so_due_date",
  so_status: "so_status",
};

// Harus sama dengan kolom yang dicari di fetchData.
const SO_SEARCH_FIELDS = ["Kode SO", "PIC", "No. PO Customer", "Marketing"];

const SO_STATUS_OPTIONS = Object.entries(SO_STATUS_LABEL).map(
  ([value, label]) => ({ label, value }),
);

const SO_KATEGORI_FILTER_OPTIONS = SO_KATEGORI_OPTIONS.map((k) => ({
  label: k,
  value: k,
}));

const ASAL_OPTIONS = [
  { label: "Input Web", value: "web" },
  { label: "Import", value: "import" },
];

const SO_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di SORT_COLUMNS.
const SO_COLUMNS = [
  { id: "so_kode", label: "Kode SO", sortDirection: "asc", className: SO_HEAD_CLASS },
  { id: "customer", label: "Customer", className: SO_HEAD_CLASS },
  { id: "so_tanggal", label: "Tanggal", sortDirection: "desc", className: `text-center ${SO_HEAD_CLASS}` },
  { id: "so_due_date", label: "Deadline", sortDirection: "asc", className: `text-center ${SO_HEAD_CLASS}` },
  { id: "so_status", label: "Status", sortDirection: "asc", className: `text-center ${SO_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type SoColumnId = (typeof SO_COLUMNS)[number]["id"];

export default function SoRegulerPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [canCreate, setCanCreate] = useState(false);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:so-reguler", SO_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
  const kategoriFilters = urlState.list("kategori");
  const setKategoriFilters = (v: string[]) =>
    urlState.set({ kategori: v }, { resetPage: true });
  const asalFilters = urlState.list("asal");
  const setAsalFilters = (v: string[]) =>
    urlState.set({ asal: v }, { resetPage: true });
  const dateFrom = urlState.get("dari");
  const setDateFrom = (v: string) =>
    urlState.set({ dari: v }, { resetPage: true });
  const dateTo = urlState.get("sampai");
  const setDateTo = (v: string) =>
    urlState.set({ sampai: v }, { resetPage: true });
  const dueFrom = urlState.get("deadline_dari");
  const setDueFrom = (v: string) =>
    urlState.set({ deadline_dari: v }, { resetPage: true });
  const dueTo = urlState.get("deadline_sampai");
  const setDueTo = (v: string) =>
    urlState.set({ deadline_sampai: v }, { resetPage: true });
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
    // Filter isi item lewat embed alias, supaya jumlah item tidak ikut tersaring.
    const barangEmbed = barangFilter
      ? ", barang_cocok:so_reguler_items!inner(id)"
      : "";
    let query = supabase
      .from("so_reguler")
      .select(
        `*, customer:customers!customer_id(customer_name), so_reguler_items(count)${barangEmbed}`,
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `so_kode.ilike.${orIlikePattern(debouncedSearch)},so_pic.ilike.${orIlikePattern(debouncedSearch)},customer_po_no.ilike.${orIlikePattern(debouncedSearch)},marketing_name.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }
    if (statusFilters.length > 0) query = query.in("so_status", statusFilters);
    if (kategoriFilters.length > 0) query = query.in("kategori", kategoriFilters);
    if (asalFilters.length === 1)
      query = query.eq("so_is_import", asalFilters[0] === "import");
    if (dateFrom) query = query.gte("so_tanggal", dateFrom);
    if (dateTo) query = query.lte("so_tanggal", dateTo);
    if (dueFrom) query = query.gte("so_due_date", dueFrom);
    if (dueTo) query = query.lte("so_due_date", dueTo);

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
      .range(from, from + limit - 1);

    if (!error) {
      setRows(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [
    debouncedSearch,
    statusFilters,
    kategoriFilters,
    asalFilters,
    dateFrom,
    dateTo,
    dueFrom,
    dueTo,
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
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(SO_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (kategoriFilters.length > 0)
    activeFilters.push({
      key: "kategori",
      label: "Kategori",
      value: optionLabels(SO_KATEGORI_FILTER_OPTIONS, kategoriFilters),
      onRemove: () => setKategoriFilters([]),
    });
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
  if (dueFrom || dueTo)
    activeFilters.push({
      key: "deadline",
      label: "Deadline",
      value: formatFilterRange(dueFrom, dueTo, formatFilterDate),
      onRemove: () =>
        urlState.set({ deadline_dari: "", deadline_sampai: "" }, { resetPage: true }),
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

  const handleRowClick = (id: number) => router.push(`/so-reguler/so/${id}`);

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: any, id: SoColumnId) => {
    switch (id) {
      case "so_kode":
        return (
          <TableCell className="font-bold text-foreground uppercase text-sm">
            {r.so_kode}
            <span className="block text-[10px] font-medium text-muted-foreground normal-case">
              {r.kategori ? `${r.kategori} · ` : ""}
              {r.customer_po_no ? `PO ${r.customer_po_no} · ` : ""}
              {r.so_reguler_items?.[0]?.count ?? 0} item ·{" "}
              {r.marketing_name || r.so_pic || "-"}
            </span>
          </TableCell>
        );
      case "customer":
        return (
          <TableCell>
            <CustomerInfoPopover
              customerId={r.customer_id}
              customerName={r.customer?.customer_name}
              className="text-xs font-bold uppercase text-success"
            />
          </TableCell>
        );
      case "so_tanggal":
        return (
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
              {r.so_tanggal ? formatDate(r.so_tanggal) : "-"}
            </div>
          </TableCell>
        );
      case "so_due_date":
        return (
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-destructive uppercase">
              <Clock className="h-3.5 w-3.5 text-destructive/40" />
              {r.so_due_date ? formatDate(r.so_due_date) : "-"}
            </div>
          </TableCell>
        );
      case "so_status":
        return (
          <TableCell className="text-center">
            <SoStatusBadge status={r.so_status} />
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
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Kode SO, No. PO, atau PIC..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={SO_SEARCH_FIELDS}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={SO_STATUS_OPTIONS}
                />
              </FilterField>

              <FilterField label="Kategori">
                <MultiSelect
                  placeholder="Semua Kategori"
                  selected={kategoriFilters}
                  onChange={setKategoriFilters}
                  options={SO_KATEGORI_FILTER_OPTIONS}
                />
              </FilterField>

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
              <FilterField label="Tanggal SO">
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
              <FilterField label="Deadline">
                <FilterRange
                  from={
                    <DatePickerString
                      value={dueFrom}
                      onChange={setDueFrom}
                      placeholder="Dari"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                  to={
                    <DatePickerString
                      value={dueTo}
                      onChange={setDueTo}
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
          className="min-w-[900px]"
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
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "Belum ada SO Reguler"}
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
          itemLabel="SO Reguler"
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
