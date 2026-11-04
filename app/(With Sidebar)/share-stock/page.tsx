"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Eye,
  MapPin,
  Truck,
  Navigation2,
  Package,
  User,
} from "lucide-react";
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
import { completedFilterStatuses } from "@/lib/document-status";
import { ShareStockDetailSheet } from "@/components/share-stock/share-stock-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const STATUS_LABELS: Record<string, string> = { done: "Done", closed: "Closed" };

const SHARE_STOCK_SORT_COLUMNS: Record<string, string> = {
  mr_kode: "mr_kode",
  mr_tanggal: "mr_tanggal",
  mr_status: "mr_status",
};

// Harus sama dengan kolom yang dicari di fetchData.
const SS_SEARCH_FIELDS = ["Kode MR", "PIC"];

const SS_STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Completed", value: "completed" },
];

const SS_PRIORITY_OPTIONS = [
  { label: "P1 - EMERGENCY", value: "P1" },
  { label: "P2 - HIGH", value: "P2" },
  { label: "P3 - NORMAL", value: "P3" },
  { label: "P4 - LOW", value: "P4" },
];

const SS_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di SHARE_STOCK_SORT_COLUMNS.
const SS_COLUMNS = [
  { id: "mr_kode", label: "Material Request", sortDirection: "asc", className: `w-45 ${SS_HEAD_CLASS}` },
  { id: "personnel", label: "Personnel / Source", className: SS_HEAD_CLASS },
  { id: "pemasok", label: "Gudang Asal (Pemasok)", className: SS_HEAD_CLASS },
  { id: "peminta", label: "Gudang Tujuan (Peminta)", className: SS_HEAD_CLASS },
  { id: "mr_tanggal", label: "Tanggal MR", sortDirection: "desc", className: `w-35 text-center ${SS_HEAD_CLASS}` },
  { id: "mr_status", label: "Status MR", sortDirection: "asc", className: `w-37.5 text-center ${SS_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type SsColumnId = (typeof SS_COLUMNS)[number]["id"];

export default function ShareStockPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [mrs, setMrs] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:share-stock", SS_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
  const priorityFilters = urlState.list("prioritas");
  const setPriorityFilters = (v: string[]) =>
    urlState.set({ prioritas: v }, { resetPage: true });
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
  const sortOrder = urlState.get("sort", "newest");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "newest" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Selected MR for Detail
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchUserInfo = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      setUserProfile(profile);

      // Default: pre-select lokasi peminta sesuai cabang user dari profil.
      // Hanya kalau URL belum berisi filter, supaya link yang dibagikan tetap
      // sesuai; replace supaya tombol Back tidak kembali ke URL tanpa lokasi.
      if (profile?.cabang_id && !window.location.search) {
        urlState.set(
          { lokasi: [profile.cabang_id.toString()] },
          { replace: true },
        );
      }
    }

    const { data: cabangData } = await supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang");
    setAvailableCabang(cabangData || []);
  };

  const fetchData = async () => {
    setLoading(true);
    // Fetch MRs that have at least one item with share stock requirements
    // Filter isi item lewat embed alias, supaya mr_items tetap utuh.
    const barangEmbed = barangFilter
      ? ", barang_cocok:mr_items!inner(id)"
      : "";
    let query = supabase
      .from("mrs")
      .select(
        `*, cabang(nama_cabang), mr_items!inner(item_priority, qty_sharestock_total, mr_sharestock_allocations(source_cabang_id, source_cabang:cabang!source_cabang_id(nama_cabang)))${barangEmbed}`,
        {
          count: "exact",
        },
      )
      .gt("mr_items.qty_sharestock_total", 0);

    if (debouncedSearch) {
      query = query.or(
        `mr_kode.ilike.${orIlikePattern(debouncedSearch)},mr_pic.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }
    if (statusFilters.length > 0) {
      const expanded = statusFilters.flatMap((s) =>
        s === "completed" ? completedFilterStatuses() : [s],
      );
      query = query.in("mr_status", Array.from(new Set(expanded)));
    }
    // Prioritas sekarang per-item; filter berdasarkan item share-stock yang
    // sudah diembed di atas (bukan lagi kolom mrs.mr_priority).
    if (priorityFilters.length > 0)
      query = query.in("mr_items.item_priority", priorityFilters);
    if (locationFilters.length > 0)
      query = query.in("cabang_id", locationFilters);
    if (dateFrom) query = query.gte("mr_tanggal", dateFrom);
    if (dateTo) query = query.lte("mr_tanggal", dateTo);

    if (barangFilter) {
      query = query.or(
        `part_number.ilike.${orIlikePattern(barangFilter)},part_name.ilike.${orIlikePattern(barangFilter)}`,
        { referencedTable: "barang_cocok" },
      );
    }

    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = SHARE_STOCK_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "created_at";
    const ascending = sortColumn
      ? sortDirRaw === "asc"
      : sortOrder === "oldest";
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order(sortField, { ascending })
      .range(from, to);

    if (!error) {
      setMrs(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUserInfo();
  }, []);

  useEffect(() => {
    fetchData();
  }, [
    debouncedSearch,
    statusFilters,
    priorityFilters,
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

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "P1":
        return (
          <Badge
            variant="destructive"
            className="text-[9px] font-bold px-1.5 h-4 justify-center"
          >
            P1
          </Badge>
        );
      case "P2":
        return (
          <Badge className="bg-warning text-warning-foreground text-[9px] font-bold px-1.5 h-4 justify-center">
            P2
          </Badge>
        );
      case "P3":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 text-[9px] font-bold px-1.5 h-4 justify-center"
          >
            P3
          </Badge>
        );
      case "P4":
        return (
          <Badge
            variant="secondary"
            className="text-muted-foreground text-[9px] font-bold px-1.5 h-4 justify-center"
          >
            P4
          </Badge>
        );
      default:
        return null;
    }
  };

  // Kumpulkan daftar gudang pemasok (source cabang) unik dari semua alokasi item share stock
  const getSupplierCabangs = (mr: any): string[] => {
    const names = new Set<string>();
    (mr.mr_items || []).forEach((item: any) => {
      (item.mr_sharestock_allocations || []).forEach((alloc: any) => {
        const name = alloc.source_cabang?.nama_cabang;
        if (name) names.add(name);
      });
    });
    return Array.from(names);
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
      value: optionLabels(SS_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (priorityFilters.length > 0)
    activeFilters.push({
      key: "prioritas",
      label: "Prioritas",
      value: priorityFilters.join(", "),
      onRemove: () => setPriorityFilters([]),
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
    setSelectedMrId(id);
    setDetailOpen(true);
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (mr: any, id: SsColumnId) => {
    switch (id) {
      case "mr_kode":
        return (
          <TableCell>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-sm border border-primary/20">
                <Package className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-foreground tracking-tight uppercase text-sm">
                  {mr.mr_kode}
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Array.from(
                    new Set(
                      (mr.mr_items || [])
                        .map((i: any) => i.item_priority)
                        .filter(Boolean),
                    ),
                  ).map((p: any) => (
                    <React.Fragment key={p}>
                      {getPriorityBadge(p)}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </TableCell>
        );
      case "personnel":
        return (
          <TableCell>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase">
                <User className="h-3 w-3 text-muted-foreground" />{" "}
                {mr.mr_pic}
              </div>
              <div className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-tight">
                <MapPin className="h-3 w-3" />{" "}
                {mr.cabang?.nama_cabang}
              </div>
            </div>
          </TableCell>
        );
      case "pemasok":
        return (
          <TableCell>
            {(() => {
              const suppliers = getSupplierCabangs(mr);
              if (suppliers.length === 0)
                return (
                  <span className="text-[10px] font-medium text-muted-foreground/40 uppercase">
                    —
                  </span>
                );
              return (
                <div className="flex flex-col gap-1">
                  {suppliers.map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase"
                    >
                      <Navigation2 className="h-3 w-3 text-primary" />{" "}
                      {name}
                    </div>
                  ))}
                </div>
              );
            })()}
          </TableCell>
        );
      case "peminta":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase">
              <MapPin className="h-3 w-3 text-success" />{" "}
              {mr.cabang?.nama_cabang}
            </div>
          </TableCell>
        );
      case "mr_tanggal":
        return (
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-bold text-foreground uppercase">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
              {formatDate(mr.mr_tanggal)}
            </div>
          </TableCell>
        );
      case "mr_status":
        return (
          <TableCell className="text-center">
            <StatusBadge status={mr.mr_status} label={STATUS_LABELS[mr.mr_status ?? ""]} />
          </TableCell>
        );
    }
  };

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Share Stock Fulfillment
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Internal Inventory Transfer Manager
              </p>
            </div>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Kode MR atau PIC..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={SS_SEARCH_FIELDS}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField
                label="Lokasi Peminta"
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

              <FilterField label="Status MR">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={SS_STATUS_OPTIONS}
                />
              </FilterField>

              <FilterField label="Prioritas">
                <MultiSelect
                  placeholder="Semua Prioritas"
                  icon={<AlertTriangle className="h-3 w-3 text-muted-foreground" />}
                  selected={priorityFilters}
                  onChange={setPriorityFilters}
                  options={SS_PRIORITY_OPTIONS}
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
              <FilterField label="Tanggal MR">
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
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : mrs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "DATA SHARE STOCK TIDAK DITEMUKAN"}
                </TableCell>
              </TableRow>
            ) : (
              mrs.map((mr) => (
                <TableRow
                  key={mr.id}
                  className="group hover:bg-muted/30 transition-all border-b border-border/50 h-20 cursor-pointer"
                  onClick={() => handleRowClick(mr.id)}
                >
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(mr, id)}</React.Fragment>
                  ))}
                  <TableCell
                    className="text-right pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActionsMenu>
                      <DropdownMenuItem onSelect={() => handleRowClick(mr.id)}>
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
          itemLabel="MR"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <ShareStockDetailSheet
        mrId={selectedMrId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={fetchData}
      />
    </>
  );
}
