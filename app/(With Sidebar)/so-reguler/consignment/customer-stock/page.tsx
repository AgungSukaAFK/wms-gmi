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
  const [searchQuery, setSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
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
                  {debouncedSearch
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
