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
import {
  Calendar as CalendarIcon,
  Eye,
  MapPin,
  Navigation2,
  Truck,
  Package,
  User,
  Plus,
} from "lucide-react";
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
import {
  DELIVERY_TRACKING_LABEL,
  DELIVERY_TRACKING_ORDER,
} from "@/components/delivery/delivery-tracking-control";
import { SHIPMENT_LABEL } from "@/lib/shipment";
import { DeliveryDetailSheet } from "@/components/delivery/delivery-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { completedFilterStatuses } from "@/lib/document-status";
import { MultiSelect } from "@/components/ui/multi-select";
import { StatusBadge } from "@/components/status-badge";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const DELIVERY_SORT_COLUMNS: Record<string, string> = {
  dlv_kode: "dlv_kode",
  created_at: "created_at",
  status: "status",
};

// Harus sama dengan kolom yang dicari di fetchData.
const DLV_SEARCH_FIELDS = ["Kode Delivery", "PIC", "No. Resi"];

const DLV_STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Completed", value: "completed" },
];

const DLV_TRACKING_OPTIONS = DELIVERY_TRACKING_ORDER.map((value) => ({
  label: DELIVERY_TRACKING_LABEL[value],
  value,
}));

const DLV_SHIPMENT_OPTIONS = Object.entries(SHIPMENT_LABEL).map(
  ([value, label]) => ({ label, value }),
);

const DLV_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di DELIVERY_SORT_COLUMNS.
const DLV_COLUMNS = [
  { id: "dlv_kode", label: "Delivery", sortDirection: "asc", className: `w-45 ${DLV_HEAD_CLASS}` },
  { id: "route", label: "Route / PIC", className: DLV_HEAD_CLASS },
  { id: "created_at", label: "Tanggal", sortDirection: "desc", className: `w-35 text-center ${DLV_HEAD_CLASS}` },
  { id: "status", label: "Status", sortDirection: "asc", className: `w-37.5 text-center ${DLV_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type DlvColumnId = (typeof DLV_COLUMNS)[number]["id"];

export default function DeliveriesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:delivery", DLV_COLUMNS);
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
  const tujuanFilters = urlState.list("tujuan");
  const setTujuanFilters = (v: string[]) =>
    urlState.set({ tujuan: v }, { resetPage: true });
  const trackingFilters = urlState.list("tracking");
  const setTrackingFilters = (v: string[]) =>
    urlState.set({ tracking: v }, { resetPage: true });
  const shipmentFilters = urlState.list("pengiriman");
  const setShipmentFilters = (v: string[]) =>
    urlState.set({ pengiriman: v }, { resetPage: true });
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
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Selected Delivery for Detail
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<number | null>(
    null,
  );
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
    // Filter isi item lewat embed alias, tanpa ikut mengambil datanya.
    const barangEmbed = barangFilter
      ? ", barang_cocok:delivery_items!inner(id)"
      : "";
    let query = supabase
      .from("deliveries")
      .select(
        `*, cabang_dari:cabang!deliveries_dari_cabang_id_fkey(nama_cabang), cabang_ke:cabang!deliveries_ke_cabang_id_fkey(nama_cabang)${barangEmbed}`,
        {
          count: "exact",
        },
      );

    if (debouncedSearch) {
      query = query.or(
        `dlv_kode.ilike.${orIlikePattern(debouncedSearch)},pic.ilike.${orIlikePattern(debouncedSearch)},no_resi.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }
    if (statusFilters.length > 0) {
      const expanded = statusFilters.flatMap((s) =>
        s === "completed" ? completedFilterStatuses() : [s],
      );
      query = query.in("status", Array.from(new Set(expanded)));
    }
    if (locationFilters.length > 0)
      query = query.in("dari_cabang_id", locationFilters);
    if (tujuanFilters.length > 0)
      query = query.in("ke_cabang_id", tujuanFilters);
    if (trackingFilters.length > 0)
      query = query.in("tracking_status", trackingFilters);
    if (shipmentFilters.length > 0)
      query = query.in("shipment_type", shipmentFilters);
    // created_at bertipe timestamp: batas memakai awal & akhir hari lokal,
    // supaya data di tanggal "sampai" tetap ikut.
    if (dateFrom)
      query = query.gte("created_at", new Date(`${dateFrom}T00:00:00`).toISOString());
    if (dateTo)
      query = query.lte("created_at", new Date(`${dateTo}T23:59:59.999`).toISOString());

    if (barangFilter) {
      query = query.or(
        `part_number.ilike.${orIlikePattern(barangFilter)},part_name.ilike.${orIlikePattern(barangFilter)}`,
        { referencedTable: "barang_cocok" },
      );
    }

    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = DELIVERY_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "created_at";
    const ascending = sortColumn ? sortDirRaw === "asc" : false;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order(sortField, { ascending })
      .range(from, to);

    if (!error) {
      setDeliveries(data || []);
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
    locationFilters,
    tujuanFilters,
    trackingFilters,
    shipmentFilters,
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
      label: "Gudang Asal",
      value: optionLabels(locationOptions, locationFilters),
      onRemove: () => setLocationFilters([]),
    });
  if (tujuanFilters.length > 0)
    activeFilters.push({
      key: "tujuan",
      label: "Gudang Tujuan",
      value: optionLabels(locationOptions, tujuanFilters),
      onRemove: () => setTujuanFilters([]),
    });
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(DLV_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (trackingFilters.length > 0)
    activeFilters.push({
      key: "tracking",
      label: "Tracking",
      value: optionLabels(DLV_TRACKING_OPTIONS, trackingFilters),
      onRemove: () => setTrackingFilters([]),
    });
  if (shipmentFilters.length > 0)
    activeFilters.push({
      key: "pengiriman",
      label: "Pengiriman",
      value: optionLabels(DLV_SHIPMENT_OPTIONS, shipmentFilters),
      onRemove: () => setShipmentFilters([]),
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
    setSelectedDeliveryId(id);
    setDetailOpen(true);
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (dlv: any, id: DlvColumnId) => {
    switch (id) {
      case "dlv_kode":
        return (
          <TableCell>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-sm border border-primary/20">
                <Package className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-foreground tracking-tight uppercase text-sm">
                  {dlv.dlv_kode}
                </span>
                {dlv.no_resi && (
                  <span className="text-[9px] text-muted-foreground uppercase font-bold">
                    Resi: {dlv.no_resi}
                  </span>
                )}
              </div>
            </div>
          </TableCell>
        );
      case "route":
        return (
          <TableCell>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase">
                <MapPin className="h-3 w-3 text-muted-foreground" />{" "}
                {dlv.cabang_dari?.nama_cabang} →{" "}
                {dlv.cabang_ke?.nama_cabang}
              </div>
              <div className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-tight">
                <User className="h-3 w-3" /> {dlv.pic}
              </div>
            </div>
          </TableCell>
        );
      case "created_at":
        return (
          <TableCell className="text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-bold text-foreground uppercase">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
              {formatDate(dlv.created_at)}
            </div>
          </TableCell>
        );
      case "status":
        return (
          <TableCell className="text-center">
            <StatusBadge status={dlv.status} />
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
                Delivery Manager
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Inter-Warehouse Goods Transfer
              </p>
            </div>
          </div>
          <Link href="/deliveries/create">
            <Button className="gap-2 font-bold uppercase text-xs h-10">
              <Plus className="h-4 w-4" /> New Delivery
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Kode, PIC, atau Resi..."
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={DLV_SEARCH_FIELDS}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField
                label="Gudang Asal"
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

              <FilterField label="Gudang Tujuan">
                <MultiSelect
                  placeholder="Semua Tujuan"
                  searchable
                  selected={tujuanFilters}
                  onChange={setTujuanFilters}
                  options={locationOptions}
                />
              </FilterField>

              <FilterField label="Status">
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={DLV_STATUS_OPTIONS}
                />
              </FilterField>

              <FilterField label="Tracking">
                <MultiSelect
                  placeholder="Semua Tracking"
                  selected={trackingFilters}
                  onChange={setTrackingFilters}
                  options={DLV_TRACKING_OPTIONS}
                />
              </FilterField>

              <FilterField label="Pengiriman">
                <MultiSelect
                  placeholder="Semua Pengiriman"
                  selected={shipmentFilters}
                  onChange={setShipmentFilters}
                  options={DLV_SHIPMENT_OPTIONS}
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
              <FilterField label="Tanggal Dibuat">
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
            ) : deliveries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "DATA DELIVERY TIDAK DITEMUKAN"}
                </TableCell>
              </TableRow>
            ) : (
              deliveries.map((dlv) => (
                <TableRow
                  key={dlv.id}
                  className="group hover:bg-muted/30 transition-all border-b border-border/50 h-20 cursor-pointer"
                  onClick={() => handleRowClick(dlv.id)}
                >
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(dlv, id)}</React.Fragment>
                  ))}
                  <TableCell
                    className="text-right pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActionsMenu>
                      <DropdownMenuItem onSelect={() => handleRowClick(dlv.id)}>
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
          itemLabel="Delivery"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <DeliveryDetailSheet
        deliveryId={selectedDeliveryId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={fetchData}
      />
    </>
  );
}
