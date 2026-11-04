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
import { DatePickerString } from "@/components/date-picker-string";
import {
  TRACKING_LABEL,
  TRACKING_ORDER,
} from "@/components/item-transfer/item-transfer-tracking-control";
import { MultiSelect } from "@/components/ui/multi-select";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  MapPin,
  Navigation2,
  Plus,
  ArrowRight,
  Calendar as CalendarIcon,
  Eye,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/stores/auth-store";
import { ItemTransferDetailSheet } from "@/components/item-transfer/item-transfer-detail-sheet";
import {
  BulkDeleteItemTransferDialog,
  type BulkDeleteItemTransferRow,
} from "@/components/item-transfer/bulk-delete-item-transfer-dialog";
import { formatDate } from "@/lib/utils";
import { summarizeApprovals } from "@/lib/approval-progress";
import {
  buildItemTransferWorkbook,
  downloadWorkbook,
  type ItExportItem,
} from "@/lib/item-transfer-export";
import { StatusBadge } from "@/components/status-badge";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const STATUS_LABELS: Record<string, string> = { open: "Menunggu Approval", completed: "Selesai", done: "Selesai" };

const IT_SORT_COLUMNS: Record<string, string> = {
  it_kode: "it_kode",
  it_tanggal: "it_tanggal",
  status: "status",
};

// Harus sama dengan kolom yang dicari di buildFilteredQuery.
const IT_SEARCH_FIELDS = ["Kode IT", "PIC"];

const IT_STATUS_OPTIONS = [
  { label: "Menunggu Approval", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Selesai", value: "completed" },
];

const IT_TRACKING_OPTIONS = TRACKING_ORDER.map((value) => ({
  label: TRACKING_LABEL[value],
  value,
}));

const IT_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di IT_SORT_COLUMNS.
const IT_COLUMNS = [
  { id: "it_kode", label: "Kode IT", sortDirection: "asc", className: IT_HEAD_CLASS },
  { id: "rute", label: "Rute Gudang", className: IT_HEAD_CLASS },
  { id: "it_tanggal", label: "Tanggal", sortDirection: "desc", className: `text-center ${IT_HEAD_CLASS}` },
  { id: "status", label: "Status", sortDirection: "asc", className: `text-center ${IT_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type ItColumnId = (typeof IT_COLUMNS)[number]["id"];

export default function ItemTransferPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:item-transfer", IT_COLUMNS);
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
  const trackingFilters = urlState.list("tracking");
  const setTrackingFilters = (v: string[]) =>
    urlState.set({ tracking: v }, { resetPage: true });
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

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Hapus massal (moderator). Pilihan bertahan saat ganti halaman, direset
  // saat filter/pencarian berubah supaya tidak ada IT tersembunyi ikut terhapus.
  const profile = useAuthStore((s) => s.profile);
  const isModerator = (profile?.roles || []).some((r: any) => r?.name === "moderator");
  const [selectedRows, setSelectedRows] = useState<Record<number, BulkDeleteItemTransferRow>>({});
  // Direset di sini (bukan di setter) supaya ikut berlaku saat filter berubah
  // lewat tombol Back atau chip.
  const selectionKey = JSON.stringify([
    debouncedSearch,
    statusFilters,
    locationFilters,
    trackingFilters,
    barangFilter,
    dateFrom,
    dateTo,
  ]);
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    setSelectedRows({});
  }
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const selectedList = Object.values(selectedRows);
  const pageAllSelected = rows.length > 0 && rows.every((r) => selectedRows[r.id]);

  const toSelectionRow = (r: any): BulkDeleteItemTransferRow => ({
    id: r.id,
    it_kode: r.it_kode,
    status: r.status,
    stock_released: Boolean(r.stock_released),
    it_is_consignment: r.it_is_consignment,
  });

  const toggleRow = (r: any, checked: boolean) =>
    setSelectedRows((prev) => {
      const next = { ...prev };
      if (checked) next[r.id] = toSelectionRow(r);
      else delete next[r.id];
      return next;
    });

  const togglePage = (checked: boolean) =>
    setSelectedRows((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (checked) next[r.id] = toSelectionRow(r);
        else delete next[r.id];
      }
      return next;
    });

  useEffect(() => {
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setAvailableCabang(data || []));
  }, []);

  // Dipakai bersama oleh list & export supaya hasil export = filter di layar.
  // Mode "all" melepas seluruh filter (export "Semua data").
  const buildFilteredQuery = (
    withCount = false,
    mode: ExcelDownloadMode = "filtered",
  ) => {
    const filtered = mode === "filtered";
    // Filter isi item lewat embed alias, tanpa ikut mengambil datanya.
    const barangEmbed =
      filtered && barangFilter
        ? ", barang_cocok:item_transfer_items!inner(id)"
        : "";
    let query = supabase
      .from("item_transfers")
      .select(
        `*, dari:cabang!dari_cabang_id(nama_cabang), tujuan:cabang!ke_cabang_id(nama_cabang)${barangEmbed}`,
        withCount ? { count: "exact" } : undefined,
      );

    if (!filtered) return query;

    if (debouncedSearch) {
      query = query.or(
        `it_kode.ilike.${orIlikePattern(debouncedSearch)},pic.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }
    if (statusFilters.length > 0) query = query.in("status", statusFilters);
    if (locationFilters.length > 0)
      query = query.or(
        `dari_cabang_id.in.(${locationFilters.join(",")}),ke_cabang_id.in.(${locationFilters.join(",")})`,
      );
    if (trackingFilters.length > 0)
      query = query.in("tracking_status", trackingFilters);
    if (dateFrom) query = query.gte("it_tanggal", dateFrom);
    if (dateTo) query = query.lte("it_tanggal", dateTo);

    if (barangFilter) {
      query = query.or(
        `part_number.ilike.${orIlikePattern(barangFilter)},part_name.ilike.${orIlikePattern(barangFilter)}`,
        { referencedTable: "barang_cocok" },
      );
    }

    return query;
  };

  const getSort = () => {
    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = IT_SORT_COLUMNS[sortKeyRaw];
    return {
      field: sortColumn || "created_at",
      ascending: sortColumn ? sortDirRaw === "asc" : false,
    };
  };

  const fetchData = async () => {
    setLoading(true);
    const query = buildFilteredQuery(true);
    const { field, ascending } = getSort();
    const from = (page - 1) * limit;
    const { data, count, error } = await query
      .order(field, { ascending })
      .range(from, from + limit - 1);

    if (!error) {
      setRows(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  const fetchAllCount = async () => {
    const { count, error } = await supabase
      .from("item_transfers")
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count || 0;
  };

  const exportExcel = async (mode: ExcelDownloadMode) => {
    setExporting(true);
    const toastId = toast.loading("Menyiapkan data Item Transfer...");
    try {
      const pageSize = 1000;
      const { field, ascending } = getSort();
      const transfers: any[] = [];
      for (let pageIndex = 0; ; pageIndex += 1) {
        const from = pageIndex * pageSize;
        const { data, error } = await buildFilteredQuery(false, mode)
          .order(field, { ascending })
          .order("id", { ascending })
          .range(from, from + pageSize - 1);
        if (error) {
          toast.error(error.message || "Gagal mengambil data untuk export.", {
            id: toastId,
          });
          return;
        }
        transfers.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      if (transfers.length === 0) {
        toast.warning("Tidak ada data untuk diekspor.", { id: toastId });
        return;
      }

      // Item per IT + referensi MR/RI (kalau IT dibuat dari RI). Di-chunk per
      // 200 IT dan di-paginate karena 1 chunk bisa > 1000 baris item.
      const itIds = transfers.map((t) => t.id);
      const items: ItExportItem[] = [];
      for (let i = 0; i < itIds.length; i += 200) {
        const chunk = itIds.slice(i, i + 200);
        for (let pageIndex = 0; ; pageIndex += 1) {
          const from = pageIndex * pageSize;
          const { data, error } = await supabase
            .from("item_transfer_items")
            .select(
              "it_id, part_number, part_name, satuan, qty, mr_items(mrs(mr_kode)), receive_items(receives(ri_kode))",
            )
            .in("it_id", chunk)
            .order("it_id")
            .order("id")
            .range(from, from + pageSize - 1);
          if (error) {
            toast.error(error.message || "Gagal mengambil item transfer.", {
              id: toastId,
            });
            return;
          }
          for (const row of (data || []) as any[]) {
            const mrItem = Array.isArray(row.mr_items)
              ? row.mr_items[0]
              : row.mr_items;
            const riItem = Array.isArray(row.receive_items)
              ? row.receive_items[0]
              : row.receive_items;
            items.push({
              it_id: row.it_id,
              part_number: row.part_number,
              part_name: row.part_name,
              satuan: row.satuan,
              qty: row.qty,
              mr_kode: mrItem?.mrs?.mr_kode ?? null,
              ri_kode: riItem?.receives?.ri_kode ?? null,
            });
          }
          if (!data || data.length < pageSize) break;
        }
      }

      const uids = Array.from(
        new Set(
          transfers
            .flatMap((t) => [t.uid_requester, t.uid_receiver])
            .filter(Boolean),
        ),
      ) as string[];
      const profilesMap: Record<string, string> = {};
      for (let i = 0; i < uids.length; i += 200) {
        const { data } = await supabase
          .from("profiles")
          .select("id, nama")
          .in("id", uids.slice(i, i + 200));
        (data || []).forEach((p: any) => (profilesMap[p.id] = p.nama));
      }

      const filterParts =
        mode === "all"
          ? []
          : [
              ...(debouncedSearch ? [`Cari "${debouncedSearch}"`] : []),
              ...activeFilters.map((f) => `${f.label}: ${f.value}`),
            ];

      const wb = await buildItemTransferWorkbook({
        transfers,
        items,
        profilesMap,
        filterDescription: filterParts.join("; ") || "Semua data",
      });
      await downloadWorkbook(
        wb,
        `ITEM_TRANSFER_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(
        `Export Excel berhasil (${transfers.length} dokumen, ${items.length} item).`,
        { id: toastId },
      );
    } catch (err: any) {
      toast.error(err?.message || "Gagal membuat file Excel.", { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [
    debouncedSearch,
    statusFilters,
    locationFilters,
    trackingFilters,
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

  const setMyLocationFilter = () => {
    if (profile?.cabang_id) {
      setLocationFilters([profile.cabang_id.toString()]);
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
      value: optionLabels(IT_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (trackingFilters.length > 0)
    activeFilters.push({
      key: "tracking",
      label: "Tracking",
      value: optionLabels(IT_TRACKING_OPTIONS, trackingFilters),
      onRemove: () => setTrackingFilters([]),
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
  const renderCell = (r: any, id: ItColumnId) => {
    switch (id) {
      case "it_kode":
        return (
          <TableCell className="font-bold text-foreground uppercase text-sm">
            {r.it_kode}
            {r.it_is_consignment && (
              <Badge variant="outline" className="ml-1.5 text-[9px] font-bold normal-case border-violet-300 text-violet-700">
                Konsinyasi
              </Badge>
            )}
          </TableCell>
        );
      case "rute":
        return (
          <TableCell>
            <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase">
              {r.dari?.nama_cabang}
              <ArrowRight className="h-3.5 w-3.5 text-primary" />
              {r.tujuan?.nama_cabang}
            </div>
          </TableCell>
        );
      case "it_tanggal":
        return (
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
              {r.it_tanggal ? formatDate(r.it_tanggal) : "-"}
            </div>
          </TableCell>
        );
      case "status":
        return (
          <TableCell className="text-center">
            {(() => {
              const pendingApprover =
                r.status === "open"
                  ? summarizeApprovals(r.approvals).pendingApprover
                  : null;
              return (
                <div className="flex flex-col items-center gap-0.5">
                  <StatusBadge status={r.status} label={STATUS_LABELS[r.status ?? ""]} />
                  {pendingApprover && (
                    <span className="text-[9px] font-medium text-warning uppercase tracking-tight">
                      Menunggu: {pendingApprover.nama}
                    </span>
                  )}
                </div>
              );
            })()}
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
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Item Transfer
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Pemindahan stok antar gudang
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={() => router.push("/item-transfer/create")}
              className="shrink-0 gap-2 font-bold text-xs h-9 uppercase"
            >
              <Plus className="h-4 w-4" /> Buat Item Transfer
            </Button>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Kode IT atau PIC..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={IT_SEARCH_FIELDS}
            />
            <ExcelDownloadMenu
              itemLabel="Item Transfer"
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
                    disabled={!profile?.cabang_id}
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
                  options={IT_STATUS_OPTIONS}
                />
              </FilterField>

              <FilterField label="Tracking">
                <MultiSelect
                  placeholder="Semua Tracking"
                  selected={trackingFilters}
                  onChange={setTrackingFilters}
                  options={IT_TRACKING_OPTIONS}
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
              <FilterField label="Tanggal IT">
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
        {isModerator && selectedList.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
            <span className="text-xs font-bold text-foreground">
              {selectedList.length} Item Transfer dipilih
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold"
                onClick={() => setSelectedRows({})}
              >
                <X className="h-3.5 w-3.5" /> Batal Pilih
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 gap-1.5 text-xs font-bold"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Hapus Terpilih
              </Button>
            </div>
          </div>
        )}
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
              {isModerator && (
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={pageAllSelected}
                    onCheckedChange={(v) => togglePage(v === true)}
                    disabled={loading || rows.length === 0}
                    aria-label="Pilih semua di halaman ini"
                  />
                </TableHead>
              )}
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
                  <TableCell colSpan={isModerator ? 6 : 5}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isModerator ? 6 : 5}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "Belum ada Item Transfer"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="group hover:bg-muted/30 cursor-pointer h-16"
                  onClick={() => handleRowClick(r.id)}
                >
                  {isModerator && (
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={!!selectedRows[r.id]}
                        onCheckedChange={(v) => toggleRow(r, v === true)}
                        aria-label={`Pilih ${r.it_kode}`}
                      />
                    </TableCell>
                  )}
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
          itemLabel="Item Transfer"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <ItemTransferDetailSheet
        itId={selectedId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={fetchData}
      />

      {isModerator && bulkDeleteOpen && (
        <BulkDeleteItemTransferDialog
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          rows={selectedList}
          onFinished={(deletedIds) => {
            setSelectedRows((prev) => {
              const next = { ...prev };
              for (const id of deletedIds) delete next[id];
              return next;
            });
            const pageEmptied = rows.every((r) => deletedIds.includes(r.id));
            if (pageEmptied && page > 1) setPage(page - 1);
            else fetchData();
          }}
        />
      )}
    </>
  );
}
