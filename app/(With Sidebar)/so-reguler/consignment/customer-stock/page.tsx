"use client";

import React, { useEffect, useState } from "react";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Warehouse } from "lucide-react";
import { Content } from "@/components/content";
import { ListSearchInput } from "@/components/list-search-input";
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
import { getCustomerStockList } from "@/services/consignment-penerimaan-actions";

// Harus sama dengan kolom yang dicari di `filtered`.
const STOCK_SEARCH_FIELDS = ["Customer", "Part Number", "Nama Barang"];

const QTY_OPTIONS = [
  { label: "Stok positif (> 0)", value: "positif" },
  { label: "Stok minus (< 0)", value: "minus" },
];

const STOCK_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di row.
const STOCK_COLUMNS = [
  { id: "customer_name", label: "Customer", sortDirection: "asc", className: STOCK_HEAD_CLASS },
  { id: "part_number", label: "PN Internal / Desc", sortDirection: "asc", className: STOCK_HEAD_CLASS },
  { id: "qty", label: "Qty", sortDirection: "desc", className: `text-right ${STOCK_HEAD_CLASS}` },
  { id: "updated_at", label: "Update Terakhir", sortDirection: "desc", className: STOCK_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type StockColumnId = (typeof STOCK_COLUMNS)[number]["id"];

const getStockSortValue = (r: any, key: string) => r[key];

export default function CustomerStockPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const columnOrder = useColumnOrder("wms:table-column-order:customer-stock", STOCK_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const customerFilters = urlState.list("customer");
  const setCustomerFilters = (v: string[]) =>
    urlState.set({ customer: v }, { resetPage: true });
  const qtyFilters = urlState.list("qty");
  const setQtyFilters = (v: string[]) =>
    urlState.set({ qty: v }, { resetPage: true });
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
    getCustomerStockList().then((res) => {
      setRows(res.data || []);
      setLoading(false);
    });
  }, []);

  const filtered = rows.filter((r) => {
    if (
      customerFilters.length > 0 &&
      !customerFilters.includes(String(r.customer_id ?? ""))
    )
      return false;
    if (qtyFilters.length > 0) {
      const key = Number(r.qty) < 0 ? "minus" : "positif";
      if (!qtyFilters.includes(key)) return false;
    }
    // updated_at = timestamp; bandingkan per tanggal lokal.
    const updated = r.updated_at
      ? new Date(r.updated_at).toLocaleDateString("en-CA")
      : "";
    if (dateFrom && (!updated || updated < dateFrom)) return false;
    if (dateTo && (!updated || updated > dateTo)) return false;
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      r.customer_name?.toLowerCase().includes(q) ||
      r.part_number?.toLowerCase().includes(q) ||
      r.part_name?.toLowerCase().includes(q)
    );
  });

  const sorted = sortRows(filtered, sortOrder, getStockSortValue);
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

  // Opsi customer diambil dari data yang sudah dimuat.
  const customerOptions = [
    ...new Map(
      rows
        .filter((r) => r.customer_id != null && r.customer_name)
        .map((r) => [String(r.customer_id), r.customer_name as string]),
    ),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (customerFilters.length > 0)
    activeFilters.push({
      key: "customer",
      label: "Customer",
      value: optionLabels(customerOptions, customerFilters),
      onRemove: () => setCustomerFilters([]),
    });
  if (qtyFilters.length > 0)
    activeFilters.push({
      key: "qty",
      label: "Qty",
      value: optionLabels(QTY_OPTIONS, qtyFilters),
      onRemove: () => setQtyFilters([]),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Update Terakhir",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: any, id: StockColumnId) => {
    switch (id) {
      case "customer_name":
        return (
          <TableCell className="text-xs font-semibold">{r.customer_name}</TableCell>
        );
      case "part_number":
        return (
          <TableCell>
            <code className="block text-xs font-bold">{r.part_number}</code>
            <span className="block text-[10px] text-muted-foreground">{r.part_name}</span>
          </TableCell>
        );
      case "qty":
        return (
          <TableCell className="text-right text-xs font-bold">
            {r.qty} {r.part_satuan}
          </TableCell>
        );
      case "updated_at":
        return (
          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
            {r.updated_at ? new Date(r.updated_at).toLocaleString("id-ID") : "-"}
          </TableCell>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
            <Warehouse className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
              Stok di Customer
            </h1>
            <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
              Barang consignment yang sudah diterima & ada di gudang customer
            </p>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari customer, PN, atau nama part..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={STOCK_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Customer">
                <MultiSelect
                  placeholder="Semua Customer"
                  searchable
                  selected={customerFilters}
                  onChange={setCustomerFilters}
                  options={customerOptions}
                />
              </FilterField>
              <FilterField label="Qty">
                <MultiSelect
                  placeholder="Semua"
                  selected={qtyFilters}
                  onChange={setQtyFilters}
                  options={QTY_OPTIONS}
                />
              </FilterField>
            </FilterFields>
            <FilterRangeFields>
              <FilterField label="Update Terakhir">
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
          className="min-w-[800px]"
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
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {debouncedSearch || activeFilters.length > 0
                    ? "Tidak ada data yang sesuai filter"
                    : "Belum ada stok di customer"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((r) => (
                <TableRow key={r.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(r, id)}</React.Fragment>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={safePage}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Stok"
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
