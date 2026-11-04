"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FileSpreadsheet, Eye, PackageCheck, Printer } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { getConsignmentPrList } from "@/services/vendor-consignment-actions";

const STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  approved: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  completed: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  rejected: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
};

function ProgressCell({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1 min-w-24">
      <span className="text-xs font-bold">
        {done} / {total}
      </span>
      <div className="h-1.5 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Harus sama dengan kolom yang dicari di `filtered`.
const PR_SEARCH_FIELDS = ["Kode PR", "Vendor", "Part Number"];

const PR_STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Completed", value: "completed" },
  { label: "Rejected", value: "rejected" },
];

const PR_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di getPrSortValue.
const PR_COLUMNS = [
  { id: "pr_kode", label: "Kode PR", sortDirection: "asc", className: PR_HEAD_CLASS },
  { id: "pr_tanggal", label: "Tanggal", sortDirection: "desc", className: PR_HEAD_CLASS },
  { id: "vendor", label: "Vendor", sortDirection: "asc", className: PR_HEAD_CLASS },
  { id: "gudang", label: "Gudang", sortDirection: "asc", className: PR_HEAD_CLASS },
  { id: "pr_status", label: "Status", sortDirection: "asc", className: PR_HEAD_CLASS },
  { id: "total_gr", label: "Diterima (GR)", sortDirection: "desc", className: PR_HEAD_CLASS },
  { id: "total_po", label: "Ter-PO", sortDirection: "desc", className: PR_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type PrColumnId = (typeof PR_COLUMNS)[number]["id"];

const getPrSortValue = (pr: any, key: string) => {
  if (key === "vendor") return pr.vendors?.vendor_name;
  if (key === "gudang") return pr.cabang?.nama_cabang;
  return pr[key];
};

const canCreateGr = (pr: any) =>
  ["approved", "completed"].includes(pr.pr_status) &&
  (pr.pr_items || []).some((i: any) => i.sisa_gr > 0);

export default function ConsignmentPrPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const columnOrder = useColumnOrder("wms:table-column-order:vendor-consignment-pr", PR_COLUMNS);
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
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => {
    getConsignmentPrList().then((res) => {
      setRows(res.data || []);
      setLoading(false);
    });
  }, []);

  const filtered = rows.filter((pr) => {
    const q = debouncedSearch.toLowerCase();
    const matchSearch =
      !q ||
      pr.pr_kode?.toLowerCase().includes(q) ||
      pr.vendors?.vendor_name?.toLowerCase().includes(q) ||
      (pr.pr_items || []).some((i: any) => i.part_number?.toLowerCase().includes(q));
    const matchStatus =
      statusFilters.length === 0 || statusFilters.includes(pr.pr_status);
    const tanggal = (pr.pr_tanggal || "").slice(0, 10);
    const matchTanggal =
      (!dateFrom || tanggal >= dateFrom) && (!dateTo || tanggal <= dateTo);
    return matchSearch && matchStatus && matchTanggal;
  });

  const sorted = sortRows(filtered, sortOrder, getPrSortValue);
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
      value: optionLabels(PR_STATUS_OPTIONS, statusFilters),
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
  const renderCell = (pr: any, id: PrColumnId) => {
    switch (id) {
      case "pr_kode":
        return (
          <TableCell className="font-bold text-xs">
            <Link href={`/pr/${pr.id}`} className="hover:underline">
              {pr.pr_kode}
            </Link>
          </TableCell>
        );
      case "pr_tanggal":
        return (
          <TableCell className="text-xs whitespace-nowrap">{formatDate(pr.pr_tanggal)}</TableCell>
        );
      case "vendor":
        return (
          <TableCell className="text-xs">{pr.vendors?.vendor_name || "-"}</TableCell>
        );
      case "gudang":
        return (
          <TableCell className="text-xs">{pr.cabang?.nama_cabang || "-"}</TableCell>
        );
      case "pr_status":
        return (
          <TableCell>
            <Badge variant="outline" className={`text-[10px] font-bold uppercase ${STATUS_TONE[pr.pr_status] || ""}`}>
              {pr.pr_status}
            </Badge>
          </TableCell>
        );
      case "total_gr":
        return (
          <TableCell>
            <ProgressCell done={pr.total_gr} total={pr.total_qty} />
          </TableCell>
        );
      case "total_po":
        return (
          <TableCell>
            <ProgressCell done={pr.total_po} total={pr.total_qty} />
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
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">PR Konsinyasi</h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Daftar barang titipan yang di-share ke supplier · progres GR & PO Rekonsil (FIFO)
              </p>
            </div>
          </div>
          <Link href="/vendor-consignment/pr/create">
            <Button className="h-9 gap-2 text-xs font-bold uppercase">
              <Plus className="h-4 w-4" /> Buat PR Konsinyasi
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari kode PR, vendor, atau part number..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={PR_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={PR_STATUS_OPTIONS}
                />
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal PR">
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
          className="min-w-[1100px]"
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
                    : "Belum ada PR Konsinyasi"}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((pr) => (
                <TableRow key={pr.id}>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(pr, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => setDetail(pr)}
                      >
                        <Eye className="mr-2 h-4 w-4" /> Detail Item
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/pr/${pr.id}/print`}>
                          <Printer className="mr-2 h-4 w-4" /> Cetak untuk Supplier
                        </Link>
                      </DropdownMenuItem>
                      {canCreateGr(pr) && (
                        <DropdownMenuItem asChild>
                          <Link href={`/vendor-consignment/gr/create?pr=${pr.id}`}>
                            <PackageCheck className="mr-2 h-4 w-4" /> Terima Barang (GR)
                          </Link>
                        </DropdownMenuItem>
                      )}
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
          itemLabel="PR"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.pr_kode}</DialogTitle>
            <DialogDescription>
              {detail?.vendors?.vendor_name} · {detail?.cabang?.nama_cabang}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="h-9">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Part</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Qty PR</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Diterima</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground">Ter-PO</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.pr_items || []).map((i: any) => (
                  <TableRow key={i.id} className="h-11">
                    <TableCell>
                      <code className="block text-xs font-bold">{i.part_number}</code>
                      <span className="block text-[10px] text-muted-foreground">{i.part_name}</span>
                      {i.rejected && (
                        <Badge variant="destructive" className="mt-1 text-[9px]">Ditolak</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold">
                      {i.qty} {i.satuan}
                    </TableCell>
                    <TableCell className="text-right text-xs">{i.qty_gr}</TableCell>
                    <TableCell className="text-right text-xs">{i.qty_po}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
