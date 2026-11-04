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
  Truck,
  MapPin,
  Plus,
  Printer,
  ArrowRight,
  Calendar as CalendarIcon,
  Eye,
} from "lucide-react";
import { DoRegulerDetailSheet } from "@/components/do-reguler/do-reguler-detail-sheet";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const STATUS_LABELS: Record<string, string> = { completed: "Selesai" };

const SORT_COLUMNS: Record<string, string> = {
  do_kode: "do_kode",
  do_tanggal: "do_tanggal",
  status: "status",
};

// Harus sama dengan kolom yang dicari di fetchData.
const DO_SEARCH_FIELDS = ["Kode DO", "Kode PO", "PIC"];

const DO_STATUS_OPTIONS = [
  { label: "Aktif", value: "active" },
  { label: "Selesai", value: "completed" },
  { label: "Dibatalkan", value: "cancelled" },
];

const DO_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di SORT_COLUMNS.
const DO_COLUMNS = [
  { id: "do_kode", label: "Kode DO", sortDirection: "asc", className: DO_HEAD_CLASS },
  { id: "rute", label: "Gudang → Customer", className: DO_HEAD_CLASS },
  { id: "do_tanggal", label: "Tanggal", sortDirection: "desc", className: `text-center ${DO_HEAD_CLASS}` },
  { id: "status", label: "Status", sortDirection: "asc", className: `text-center ${DO_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type DoColumnId = (typeof DO_COLUMNS)[number]["id"];

export default function DoRegulerPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:do-reguler", DO_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
  const locationFilters = urlState.list("lokasi");
  const setLocationFilters = (v: string[]) =>
    urlState.set({ lokasi: v }, { resetPage: true });
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

  useEffect(() => {
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setAvailableCabang(data || []));
  }, []);

  const fetchData = async () => {
    setLoading(true);
    // Filter isi item lewat embed alias, tanpa ikut mengambil datanya.
    const barangEmbed = barangFilter
      ? ", barang_cocok:do_reguler_items!inner(id)"
      : "";
    let query = supabase
      .from("do_reguler")
      .select(
        `*, dari:cabang!dari_cabang_id(nama_cabang), customer:customers!customer_id(customer_name), so:so_reguler!so_id(so_kode)${barangEmbed}`,
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `do_kode.ilike.${orIlikePattern(debouncedSearch)},kode_po.ilike.${orIlikePattern(debouncedSearch)},pic.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }
    if (statusFilters.length > 0) query = query.in("status", statusFilters);
    if (locationFilters.length > 0)
      query = query.in("dari_cabang_id", locationFilters);
    if (dateFrom) query = query.gte("do_tanggal", dateFrom);
    if (dateTo) query = query.lte("do_tanggal", dateTo);

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
    locationFilters,
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

  const locationOptions = availableCabang.map((c) => ({
    label: c.nama_cabang,
    value: c.id.toString(),
  }));

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");
  const activeFilters: ActiveFilter[] = [];
  if (locationFilters.length > 0)
    activeFilters.push({
      key: "lokasi",
      label: "Gudang",
      value: optionLabels(locationOptions, locationFilters),
      onRemove: () => setLocationFilters([]),
    });
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(DO_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
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
  const renderCell = (r: any, id: DoColumnId) => {
    switch (id) {
      case "do_kode":
        return (
          <TableCell className="font-bold text-foreground uppercase text-sm">
            {r.do_kode}
            {r.so?.so_kode && (
              <code className="block text-[10px] font-medium text-primary normal-case">
                SO: {r.so.so_kode}
              </code>
            )}
            {r.kode_po && (
              <code className="block text-[10px] font-medium text-muted-foreground normal-case">
                PO: {r.kode_po}
              </code>
            )}
          </TableCell>
        );
      case "rute":
        return (
          <TableCell>
            <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase">
              {r.dari?.nama_cabang}
              <ArrowRight className="h-3.5 w-3.5 text-primary" />
              <span className="text-success">
                {r.customer?.customer_name}
              </span>
            </div>
          </TableCell>
        );
      case "do_tanggal":
        return (
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
              {r.do_tanggal ? formatDate(r.do_tanggal) : "-"}
            </div>
          </TableCell>
        );
      case "status":
        return (
          <TableCell className="text-center">
            <StatusBadge status={r.status} label={STATUS_LABELS[r.status ?? ""]} />
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
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                DO Reguler
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Delivery Order tanpa SPB ke customer
              </p>
            </div>
          </div>
          <Button
            onClick={() => router.push("/so-reguler/do/create")}
            className="shrink-0 gap-2 font-bold text-xs h-9 uppercase"
          >
            <Plus className="h-4 w-4" /> Buat DO Reguler
          </Button>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Kode DO, Kode PO, atau PIC..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={DO_SEARCH_FIELDS}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Gudang">
                <MultiSelect
                  placeholder="Semua Gudang"
                  icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
                  searchable
                  selected={locationFilters}
                  onChange={setLocationFilters}
                  options={locationOptions}
                />
              </FilterField>

              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={DO_STATUS_OPTIONS}
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
              <FilterField label="Tanggal DO">
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
                  <TableCell colSpan={5}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "Belum ada DO Reguler"}
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
                      <DropdownMenuItem
                        onSelect={() =>
                          window.open(`/so-reguler/do/print/${r.id}`, "_blank")
                        }
                      >
                        <Printer className="mr-2 h-4 w-4" /> Cetak
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
          itemLabel="DO Reguler"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <DoRegulerDetailSheet
        doId={selectedId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={fetchData}
      />
    </>
  );
}
