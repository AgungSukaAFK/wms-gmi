"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
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
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Calculator,
  ArrowUpDown,
  Eye,
  MapPin,
  Navigation2,
  Calendar,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { JobCostingDetailSheet } from "@/components/job-costing/job-costing-detail-sheet";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/lib/toast";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  completedFilterStatuses,
  normalizeDocumentStatus,
} from "@/lib/document-status";
import { formatDate } from "@/lib/utils";
import { orIlikePattern } from "@/lib/supabase/search-filter";

const JOB_SORT_COLUMNS: Record<string, string> = {
  job_kode: "job_kode",
  job_tanggal: "job_tanggal",
  finish_part: "finish_part",
  status: "status",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  approved: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  completed: "bg-muted text-foreground/70 border-border",
  rejected: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
};

// Harus sama dengan kolom yang dicari di fetchJobs.
const JOB_SEARCH_FIELDS = ["Batch No", "Deskripsi", "Finish Part"];

const JOB_STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Completed", value: "completed" },
  { label: "Rejected", value: "rejected" },
];

const JOB_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di JOB_SORT_COLUMNS.
const JOB_COLUMNS = [
  { id: "job_kode", label: "Batch No", sortDirection: "asc", className: JOB_HEAD_CLASS },
  { id: "job_tanggal", label: "Tanggal", sortDirection: "desc", className: JOB_HEAD_CLASS },
  { id: "finish_part", label: "Finish Part", sortDirection: "asc", className: JOB_HEAD_CLASS },
  { id: "status", label: "Status", sortDirection: "asc", className: JOB_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type JobColumnId = (typeof JOB_COLUMNS)[number]["id"];

export default function JobCostingListPage() {
  const supabase = createClient();
  const profile = useAuthStore((s) => s.profile);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:job-costing", JOB_COLUMNS);
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
  const sortOrder = urlState.get("sort", "newest");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "newest" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }: { data: any[] | null }) =>
        setAvailableCabang(data || []),
      );
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const from = (page - 1) * limit;

    let query = supabase
      .from("job_costing")
      .select(
        "*, cabang!job_costing_cabang_id_fkey(nama_cabang), job_costing_items(id, qty, unit_price)",
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `job_kode.ilike.${orIlikePattern(debouncedSearch)},description.ilike.${orIlikePattern(debouncedSearch)},finish_part.ilike.${orIlikePattern(debouncedSearch)}`,
      );
    }
    if (statusFilters.length > 0) {
      const expanded = statusFilters.flatMap((s) =>
        s === "completed" ? completedFilterStatuses() : [s],
      );
      query = query.in("status", Array.from(new Set(expanded)));
    }
    if (locationFilters.length > 0)
      query = query.in("cabang_id", locationFilters);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = JOB_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "created_at";
    const ascending = sortColumn ? sortDirRaw === "asc" : sortOrder === "oldest";

    query = query
      .order(sortField, { ascending })
      .range(from, from + limit - 1);

    const { data, count, error } = await query;
    if (error) {
      toast.error(`Gagal memuat Job Costing: ${error.message}`);
      setJobs([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    setJobs(data || []);
    setTotalCount(count || 0);
    setLoading(false);
  }, [
    debouncedSearch,
    statusFilters,
    locationFilters,
    dateFrom,
    dateTo,
    sortOrder,
    page,
    limit,
  ]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const setMyLocationFilter = () => {
    if (profile?.cabang_id) {
      setLocationFilters([String(profile.cabang_id)]);
    }
  };

  const resetFilters = () => {
    resetSearchQuery();
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
  if (statusFilters.length > 0)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: optionLabels(JOB_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (locationFilters.length > 0)
    activeFilters.push({
      key: "lokasi",
      label: "Cabang",
      value: optionLabels(locationOptions, locationFilters),
      onRemove: () => setLocationFilters([]),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  const handleRowClick = (id: number) => {
    setSelectedJobId(id);
    setSheetOpen(true);
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (job: any, id: JobColumnId) => {
    switch (id) {
      case "job_kode":
        return (
          <TableCell className="font-mono text-xs font-bold text-primary">
            {job.job_kode}
          </TableCell>
        );
      case "job_tanggal":
        return (
          <TableCell>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(job.job_tanggal || job.created_at)}
            </div>
          </TableCell>
        );
      case "finish_part":
        return (
          <TableCell className="text-sm max-w-55 truncate">
            {job.finish_part || job.description || "-"}
          </TableCell>
        );
      case "status":
        return (
          <TableCell>
            {(() => {
              const normalizedStatus = normalizeDocumentStatus(
                job.status,
              );
              return (
                <Badge
                  variant="outline"
                  className={`text-[10px] font-bold capitalize ${STATUS_COLORS[normalizedStatus] ?? ""}`}
                >
                  {normalizedStatus}
                </Badge>
              );
            })()}
          </TableCell>
        );
    }
  };

  return (
    <>
      <JobCostingDetailSheet
        jobId={selectedJobId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onRefresh={fetchJobs}
      />

      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-md flex items-center justify-center shadow-sm text-primary-foreground">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                Daftar Job Costing
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Kelola dan pantau biaya per pekerjaan
              </p>
            </div>
          </div>

          <Link href="/job-costing/create">
            <Button className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase">
              <Plus className="h-4 w-4" /> Buat Job Baru
            </Button>
          </Link>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari Batch No"
              value={searchQuery}
              onChange={setSearchQuery}
              searchableFields={JOB_SEARCH_FIELDS}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField
                label="Cabang"
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
                  options={JOB_STATUS_OPTIONS}
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
                    <SelectItem value="newest">Terbaru</SelectItem>
                    <SelectItem value="oldest">Terlama</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Tanggal">
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
              <TableHead className="w-14">No</TableHead>
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
            ) : jobs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data yang sesuai filter."
                    : "Belum ada Job Costing."}
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job, idx) => (
                <TableRow
                  key={job.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => handleRowClick(job.id)}
                >
                  <TableCell className="text-xs text-muted-foreground">
                    {(page - 1) * limit + idx + 1}
                  </TableCell>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(job, id)}</React.Fragment>
                  ))}
                  <TableCell
                    className="text-right pr-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActionsMenu>
                      <DropdownMenuItem onSelect={() => handleRowClick(job.id)}>
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
          itemLabel="Job Costing"
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
