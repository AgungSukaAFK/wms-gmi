"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  PackageSearch,
  ArrowRight,
  CalendarClock,
  AlertTriangle,
  MapPin,
} from "lucide-react";
import type { PlanningSupply } from "@/type";
import { businessToday } from "@/lib/business-date";

const SORT_ACCESSORS: Record<string, (r: PlanningSupply) => string | number> = {
  part_number: (r) => r.part_number || "",
  qty: (r) => r.qty || 0,
  deadline: (r) => r.deadline || "",
  status: (r) => r.status || "",
};

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  in_transit: {
    label: "Dalam Pengiriman",
    className: "bg-primary/10 text-primary border-primary/30",
  },
  received: {
    label: "Diterima",
    className: "bg-success/10 text-success border-success/30",
  },
  cancelled: {
    label: "Dibatalkan",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

// Harus sama dengan kolom yang dicari di `filtered`.
const PLANNING_SEARCH_FIELDS = ["Part Number", "Nama Barang", "Kode MR", "Kode Delivery"];

const PLANNING_STATUS_LABEL: Record<string, string> = {
  active: "Dalam Pengiriman",
  received: "Diterima",
  cancelled: "Dibatalkan",
  all: "Semua Status",
};

const DEADLINE_LABEL: Record<string, string> = {
  overdue: "Lewat deadline",
  on_time: "Belum lewat",
  no_deadline: "Tanpa deadline",
};

const PLANNING_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di SORT_ACCESSORS.
const PLANNING_COLUMNS = [
  { id: "part_number", label: "Barang", sortDirection: "asc", className: PLANNING_HEAD_CLASS },
  { id: "rute", label: "Rute", className: PLANNING_HEAD_CLASS },
  { id: "qty", label: "Qty", sortDirection: "desc", className: `text-center ${PLANNING_HEAD_CLASS}` },
  { id: "deadline", label: "Deadline", sortDirection: "asc", className: PLANNING_HEAD_CLASS },
  { id: "referensi", label: "Referensi", className: PLANNING_HEAD_CLASS },
  { id: "status", label: "Status / Keterangan", sortDirection: "asc", className: PLANNING_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type PlanningColumnId = (typeof PLANNING_COLUMNS)[number]["id"];

export default function PlanningSupplyPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PlanningSupply[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);

  const columnOrder = useColumnOrder("wms:table-column-order:planning-supply", PLANNING_COLUMNS);
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilter = urlState.get("status", "active");
  const setStatusFilter = (v: string) =>
    urlState.set({ status: v === "active" ? "" : v }, { resetPage: true });
  const sourceFilters = urlState.list("asal");
  const setSourceFilters = (v: string[]) =>
    urlState.set({ asal: v }, { resetPage: true });
  const destFilters = urlState.list("tujuan");
  const setDestFilters = (v: string[]) =>
    urlState.set({ tujuan: v }, { resetPage: true });
  const deadlineFilter = urlState.get("kondisi");
  const setDeadlineFilter = (v: string) =>
    urlState.set({ kondisi: v === "all" ? "" : v }, { resetPage: true });
  const deadlineFrom = urlState.get("deadline_dari");
  const setDeadlineFrom = (v: string) =>
    urlState.set({ deadline_dari: v }, { resetPage: true });
  const deadlineTo = urlState.get("deadline_sampai");
  const setDeadlineTo = (v: string) =>
    urlState.set({ deadline_sampai: v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const today = businessToday();

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("id, nama, cabang_id, cabang(nama_cabang)")
        .eq("id", user.id)
        .single();
      setProfile(prof);

      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      const roleNames = (roleRows || [])
        .map((r: any) => r?.roles?.name)
        .filter(Boolean);
      setIsModerator(roleNames.includes("moderator"));
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    if (!profile) return;
    setLoading(true);

    let query = supabase
      .from("planning_supplies")
      .select(
        "*, mrs(mr_kode), deliveries(dlv_kode), source_cabang:cabang!source_cabang_id(nama_cabang), dest_cabang:cabang!dest_cabang_id(nama_cabang)",
      )
      .order("created_at", { ascending: false });

    // Admin divisi hanya melihat barang yang akan masuk ke cabangnya.
    // Moderator melihat semua cabang.
    if (!isModerator && profile.cabang_id) {
      query = query.eq("dest_cabang_id", profile.cabang_id);
    }

    if (statusFilter === "active") {
      query = query.eq("status", "in_transit");
    } else if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query.limit(500);
    if (!error) setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, isModerator, statusFilter]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        q &&
        ![r.part_number, r.part_name, r.mrs?.mr_kode, r.deliveries?.dlv_kode]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
        return false;
      if (
        sourceFilters.length > 0 &&
        !sourceFilters.includes(String(r.source_cabang_id))
      )
        return false;
      if (
        destFilters.length > 0 &&
        !destFilters.includes(String(r.dest_cabang_id))
      )
        return false;
      const deadline = (r.deadline || "").slice(0, 10);
      if (deadlineFrom && (!deadline || deadline < deadlineFrom)) return false;
      if (deadlineTo && (!deadline || deadline > deadlineTo)) return false;
      const overdue =
        r.status === "in_transit" && !!deadline && deadline < today;
      if (deadlineFilter === "overdue" && !overdue) return false;
      if (deadlineFilter === "on_time" && overdue) return false;
      if (deadlineFilter === "no_deadline" && deadline) return false;
      return true;
    });
  }, [
    rows,
    debouncedSearch,
    sourceFilters,
    destFilters,
    deadlineFrom,
    deadlineTo,
    deadlineFilter,
    today,
  ]);

  // Opsi gudang diambil dari data yang sudah dimuat.
  const cabangOptions = (
    pick: (r: PlanningSupply) => [number, string | undefined],
  ) =>
    [
      ...new Map(
        rows
          .map(pick)
          .filter(([, name]) => !!name)
          .map(([id, name]) => [String(id), name as string]),
      ),
    ]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  const sourceOptions = cabangOptions((r) => [
    r.source_cabang_id,
    r.source_cabang?.nama_cabang,
  ]);
  const destOptions = cabangOptions((r) => [
    r.dest_cabang_id,
    r.dest_cabang?.nama_cabang,
  ]);

  const sorted = useMemo(() => {
    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const accessor = SORT_ACCESSORS[sortKeyRaw];
    if (!accessor) return filtered;
    const ascending = sortDirRaw === "asc";
    return [...filtered].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) return ascending ? -1 : 1;
      if (av > bv) return ascending ? 1 : -1;
      return 0;
    });
  }, [filtered, sortOrder]);

  const totalInTransitQty = useMemo(
    () =>
      rows
        .filter((r) => r.status === "in_transit")
        .reduce((sum, r) => sum + (r.qty || 0), 0),
    [rows],
  );

  const isOverdue = (r: PlanningSupply) =>
    r.status === "in_transit" && r.deadline && r.deadline < today;

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
  const activeFilters: ActiveFilter[] = [];
  if (statusFilter !== "active")
    activeFilters.push({
      key: "status",
      label: "Status",
      value: PLANNING_STATUS_LABEL[statusFilter] ?? statusFilter,
      onRemove: () => setStatusFilter("active"),
    });
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");
  if (sourceFilters.length > 0)
    activeFilters.push({
      key: "asal",
      label: "Gudang Asal",
      value: optionLabels(sourceOptions, sourceFilters),
      onRemove: () => setSourceFilters([]),
    });
  if (destFilters.length > 0)
    activeFilters.push({
      key: "tujuan",
      label: "Gudang Tujuan",
      value: optionLabels(destOptions, destFilters),
      onRemove: () => setDestFilters([]),
    });
  if (DEADLINE_LABEL[deadlineFilter])
    activeFilters.push({
      key: "kondisi",
      label: "Deadline",
      value: DEADLINE_LABEL[deadlineFilter],
      onRemove: () => setDeadlineFilter("all"),
    });
  if (deadlineFrom || deadlineTo)
    activeFilters.push({
      key: "deadline",
      label: "Tgl Deadline",
      value: formatFilterRange(deadlineFrom, deadlineTo, formatFilterDate),
      onRemove: () =>
        urlState.set(
          { deadline_dari: "", deadline_sampai: "" },
          { resetPage: true },
        ),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (r: PlanningSupply, id: PlanningColumnId) => {
    const meta = STATUS_META[r.status] || { label: r.status, className: "" };
    const overdue = isOverdue(r);

    switch (id) {
      case "part_number":
        return (
          <TableCell>
            <div className="font-mono text-xs font-bold text-foreground">
              {r.part_number}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {r.part_name}
            </div>
          </TableCell>
        );
      case "rute":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className="text-muted-foreground">
                {r.source_cabang?.nama_cabang || "-"}
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-foreground">
                {r.dest_cabang?.nama_cabang || "-"}
              </span>
            </div>
          </TableCell>
        );
      case "qty":
        return (
          <TableCell className="text-center font-black text-sm">
            {r.qty} <span className="text-[10px] font-normal text-muted-foreground">{r.satuan}</span>
          </TableCell>
        );
      case "deadline":
        return (
          <TableCell>
            {r.deadline ? (
              <div
                className={`flex items-center gap-1 text-[11px] font-bold ${
                  overdue ? "text-destructive" : "text-foreground"
                }`}
              >
                {overdue ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <CalendarClock className="h-3 w-3" />
                )}
                {r.deadline}
                {overdue && (
                  <span className="text-[9px] uppercase">
                    (lewat)
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                -
              </span>
            )}
          </TableCell>
        );
      case "referensi":
        return (
          <TableCell>
            <div className="text-[11px] font-bold text-foreground">
              {r.deliveries?.dlv_kode || "-"}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {r.mrs?.mr_kode || ""}
            </div>
          </TableCell>
        );
      case "status":
        return (
          <TableCell>
            <Badge
              variant="outline"
              className={`text-[9px] font-bold uppercase ${meta.className}`}
            >
              {meta.label}
            </Badge>
            {r.status === "cancelled" && r.note && (
              <div className="mt-1 text-[10px] text-destructive font-medium max-w-55">
                {r.note}
              </div>
            )}
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
              <PackageSearch className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Barang dalam Pengiriman
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                {isModerator
                  ? "Barang akan masuk — semua cabang"
                  : `Barang akan masuk ke ${
                      profile?.cabang?.nama_cabang || "cabang Anda"
                    }`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Total Dalam Pengiriman
            </span>
            <span className="text-lg font-black text-primary">
              {totalInTransitQty}
            </span>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari PN, nama barang, kode MR/Delivery..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={PLANNING_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Dalam Pengiriman</SelectItem>
                    <SelectItem value="received">Diterima</SelectItem>
                    <SelectItem value="cancelled">Dibatalkan</SelectItem>
                    <SelectItem value="all">Semua Status</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Gudang Asal">
                <MultiSelect
                  placeholder="Semua Gudang"
                  icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
                  searchable
                  selected={sourceFilters}
                  onChange={setSourceFilters}
                  options={sourceOptions}
                />
              </FilterField>
              {isModerator && (
                <FilterField label="Gudang Tujuan">
                  <MultiSelect
                    placeholder="Semua Gudang"
                    icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
                    searchable
                    selected={destFilters}
                    onChange={setDestFilters}
                    options={destOptions}
                  />
                </FilterField>
              )}
              <FilterField label="Kondisi Deadline">
                <Select
                  value={deadlineFilter || "all"}
                  onValueChange={setDeadlineFilter}
                >
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    {Object.entries(DEADLINE_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>
            <FilterRangeFields>
              <FilterField label="Deadline">
                <FilterRange
                  from={
                    <DatePickerString
                      value={deadlineFrom}
                      onChange={setDeadlineFrom}
                      placeholder="Dari"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                  to={
                    <DatePickerString
                      value={deadlineTo}
                      onChange={setDeadlineTo}
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
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter"
                    : "Tidak ada data barang dalam pengiriman"}
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
          itemLabel="Barang"
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
