"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import * as XLSX from "xlsx";
import { jsonToSheetWithDates, toExcelDate } from "@/lib/excel";
import { toast } from "@/lib/toast";
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
import {
  ExcelDownloadMenu,
  type ExcelDownloadMode,
} from "@/components/excel-download-menu";
import { StatusBadge } from "@/components/status-badge";
import { orIlikePattern } from "@/lib/supabase/search-filter";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Eye,
  MapPin,
  Navigation2,
  PackageCheck,
  Calendar,
  User,
  Building2,
  ArrowUpDown,
  ShoppingCart,
  Package,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { ReceiveDetailSheet } from "@/components/receive/receive-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";

const RECEIVE_SORT_COLUMNS: Record<string, string> = {
  ri_kode: "ri_kode",
  ri_tanggal: "ri_tanggal",
  ri_pic: "ri_pic",
  ri_status: "ri_status",
};

// Harus sama dengan kolom yang dicari di buildFilteredRiQuery.
const RI_SEARCH_FIELDS = ["Kode RI", "PIC"];

const RI_STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Completed", value: "completed" },
  { label: "Rejected", value: "rejected" },
];

const RI_ASAL_OPTIONS = [
  { label: "Input Web", value: "web" },
  { label: "Import", value: "import" },
];

const RI_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di RECEIVE_SORT_COLUMNS.
const RI_COLUMNS = [
  { id: "ri_kode", label: "Kode RI", sortDirection: "asc", className: `pl-5 w-40 ${RI_HEAD_CLASS}` },
  { id: "ri_tanggal", label: "Tanggal", sortDirection: "desc", className: `w-36 ${RI_HEAD_CLASS}` },
  { id: "po", label: "No. PO", className: `w-36 ${RI_HEAD_CLASS}` },
  { id: "lokasi", label: "Lokasi", className: `w-44 ${RI_HEAD_CLASS}` },
  { id: "ri_pic", label: "PIC", sortDirection: "asc", className: RI_HEAD_CLASS },
  { id: "ri_status", label: "Status", sortDirection: "asc", className: `text-center w-28 ${RI_HEAD_CLASS}` },
  { id: "items", label: "Items", className: `text-center w-24 ${RI_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type RiColumnId = (typeof RI_COLUMNS)[number]["id"];

export default function ReceiveItemPage() {
  const supabase = createClient();
  const [receives, setReceives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:receive", RI_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const locationFilters = urlState.list("lokasi");
  const setLocationFilters = (v: string[]) =>
    urlState.set({ lokasi: v }, { resetPage: true });
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
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
  const sortOrder = urlState.get("sort", "newest");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "newest" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  // Detail Sheet
  const [selectedReceiveId, setSelectedReceiveId] = useState<number | null>(
    null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  const fetchUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*, cabang(id, nama_cabang)")
        .eq("id", user.id)
        .single();
      if (profile) setUserProfile(profile);
    }
    const { data: cabangData } = await supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang");
    setAvailableCabang(cabangData || []);
  };

  // Mode "all" melepas seluruh filter (export "Semua data").
  const buildFilteredRiQuery = (mode: ExcelDownloadMode = "filtered") => {
    const filtered = mode === "filtered";
    // Filter isi item lewat embed alias, supaya receive_items tetap utuh
    // (jumlah item di tabel tidak ikut tersaring).
    const barangEmbed =
      filtered && barangFilter ? ", barang_cocok:receive_items!inner(id)" : "";
    let query = supabase.from("receives").select(
      `
          id, ri_kode, ri_tanggal, ri_pic, ri_keterangan, ri_status, created_at,
          cabang(id, nama_cabang),
          pos(id, po_kode),
          receive_items(id)${barangEmbed}
        `,
      { count: "exact" },
    );

    if (!filtered) return query;

    if (debouncedSearch) {
      query = query.or(
        `ri_kode.ilike.${orIlikePattern(debouncedSearch)},ri_pic.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }

    if (locationFilters.length > 0) {
      query = query.in("cabang_id", locationFilters);
    }

    if (dateFrom) query = query.gte("ri_tanggal", dateFrom);
    if (dateTo) query = query.lte("ri_tanggal", dateTo);

    if (statusFilters.length > 0) {
      query = query.in("ri_status", statusFilters);
    }

    if (asalFilters.length === 1) {
      query = query.eq("ri_is_import", asalFilters[0] === "import");
    }

    if (barangFilter) {
      query = query.or(
        `part_number.ilike.${orIlikePattern(barangFilter)},part_name.ilike.${orIlikePattern(barangFilter)}`,
        { referencedTable: "barang_cocok" },
      );
    }

    return query;
  };

  const fetchReceives = async () => {
    setLoading(true);

    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = RECEIVE_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "created_at";
    const ascending = sortColumn
      ? sortDirRaw === "asc"
      : sortOrder === "oldest";
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await buildFilteredRiQuery()
      .order(sortField, { ascending })
      .range(from, to);

    if (!error) {
      setReceives(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  const fetchAllCount = async () => {
    const { count, error } = await supabase
      .from("receives")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count || 0;
  };

  const exportExcel = async (mode: ExcelDownloadMode) => {
    setExporting(true);
    const toastId = toast.loading("Menyiapkan data Receive...");
    try {
      const pageSize = 1000;
      const allRows: any[] = [];
      for (let pageIndex = 0; ; pageIndex += 1) {
        const from = pageIndex * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildFilteredRiQuery(mode)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) {
          toast.error(error.message || "Gagal mengambil data untuk export.", {
            id: toastId,
          });
          return;
        }

        allRows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      if (allRows.length === 0) {
        toast.warning("Tidak ada data untuk diekspor.", { id: toastId });
        return;
      }

      const sheetData = allRows.map((ri, index) => ({
        NO: index + 1,
        "KODE RECEIVE": ri.ri_kode || "-",
        "PO ASAL": ri.pos?.po_kode || "-",
        PIC: ri.ri_pic || "-",
        LOKASI: ri.cabang?.nama_cabang || "-",
        TANGGAL: toExcelDate(ri.ri_tanggal),
        STATUS: ri.ri_status || "-",
      }));

      const ws = jsonToSheetWithDates(sheetData, ["TANGGAL"]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Receive Item");
      XLSX.writeFile(
        wb,
        `RECEIVE_ITEM_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`Export Excel berhasil (${allRows.length} baris).`, {
        id: toastId,
      });
    } catch (err: any) {
      toast.error(`Gagal export Excel: ${err?.message || err}`, { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    fetchReceives();
  }, [
    debouncedSearch,
    locationFilters,
    statusFilters,
    asalFilters,
    barangFilter,
    dateFrom,
    dateTo,
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

  const setMyLocationFilter = () => {
    if (userProfile?.cabang_id) {
      setLocationFilters([userProfile.cabang_id.toString()]);
    }
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
      label: "Lokasi",
      value: optionLabels(locationOptions, locationFilters),
      onRemove: () => setLocationFilters([]),
    });
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(RI_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (asalFilters.length > 0)
    activeFilters.push({
      key: "asal",
      label: "Asal Data",
      value: optionLabels(RI_ASAL_OPTIONS, asalFilters),
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
    setSelectedReceiveId(id);
    setSheetOpen(true);
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (ri: any, id: RiColumnId) => {
    switch (id) {
      case "ri_kode":
        return (
          <TableCell className="pl-5">
            <span className="font-black text-xs text-foreground font-mono uppercase tracking-wide">
              {ri.ri_kode}
            </span>
          </TableCell>
        );
      case "ri_tanggal":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Calendar className="h-3 w-3 shrink-0" />
              {formatDate(ri.ri_tanggal)}
            </div>
          </TableCell>
        );
      case "po":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <ShoppingCart className="h-3 w-3 text-muted-foreground shrink-0" />
              {ri.pos?.po_kode ?? "-"}
            </div>
          </TableCell>
        );
      case "lokasi":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Building2 className="h-3 w-3 shrink-0" />
              {ri.cabang?.nama_cabang ?? "-"}
            </div>
          </TableCell>
        );
      case "ri_pic":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <User className="h-3 w-3 shrink-0" />
              {ri.ri_pic}
            </div>
          </TableCell>
        );
      case "ri_status":
        return (
          <TableCell className="text-center">
            <StatusBadge status={ri.ri_status || "open"} />
          </TableCell>
        );
      case "items":
        return (
          <TableCell className="text-center">
            <Badge
              variant="secondary"
              className="text-[10px] font-bold gap-1"
            >
              <Package className="h-3 w-3" />
              {ri.receive_items?.length ?? 0}
            </Badge>
          </TableCell>
        );
    }
  };

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Receive Item
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Penerimaan Barang dari Purchase Order
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
<Link href="/receive/create">
              <Button className="gap-2 font-bold text-xs uppercase h-9">
                <Plus className="h-4 w-4" />
                Buat Penerimaan
              </Button>
            </Link>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Kode RI atau PIC..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={RI_SEARCH_FIELDS}
            />
            <ExcelDownloadMenu
              itemLabel="RI"
              filteredCount={totalCount}
              fetchAllCount={fetchAllCount}
              onDownload={exportExcel}
              isExporting={exporting}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField
                label="Lokasi"
                action={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
                    onClick={setMyLocationFilter}
                    disabled={!userProfile?.cabang_id}
                  >
                    <Navigation2 className="h-3 w-3" />
                    Lokasi saya
                  </button>
                }
              >
                <MultiSelect
                  placeholder="Semua Lokasi"
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
                  options={RI_STATUS_OPTIONS}
                />
              </FilterField>

              <FilterField label="Asal Data">
                <MultiSelect
                  placeholder="Semua Asal"
                  selected={asalFilters}
                  onChange={setAsalFilters}
                  options={RI_ASAL_OPTIONS}
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

              <FilterField label="Urutan">
                <Select value={sortOrder} onValueChange={handleSortChange}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <div className="flex min-w-0 items-center gap-2">
                      <ArrowUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        <SelectValue placeholder="Urutan" />
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="newest">Terbaru Dibuat</SelectItem>
                    <SelectItem value="oldest">Terlama Dibuat</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal RI">
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
              Array.from({ length: limit }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : receives.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "Belum ada data penerimaan"}
                </TableCell>
              </TableRow>
            ) : (
              receives.map((ri) => (
                <TableRow
                  key={ri.id}
                  className="cursor-pointer hover:bg-muted/40 border-b border-border/50 h-14 transition-colors"
                  onClick={() => handleRowClick(ri.id)}
                >
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(ri, id)}</React.Fragment>
                  ))}
                  <TableCell
                    className="text-right pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActionsMenu>
                      <DropdownMenuItem onSelect={() => handleRowClick(ri.id)}>
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
          itemLabel="RI"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <ReceiveDetailSheet
        receiveId={selectedReceiveId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
