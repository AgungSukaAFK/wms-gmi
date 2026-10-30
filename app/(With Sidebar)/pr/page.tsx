"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import * as XLSX from "xlsx";
import { jsonToSheetWithDates, toExcelDate } from "@/lib/excel";
import { toast } from "sonner";
import { Content } from "@/components/content";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  FileText,
  Calendar,
  User,
  Building2,
  ChevronRight,
  MapPin,
  Navigation2,
  Loader2,
  ArrowUpDown,
  Download,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import Link from "next/link";
import { PRDetailSheet } from "@/components/pr/pr-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { completedFilterStatuses } from "@/lib/document-status";
import { summarizeApprovals } from "@/lib/approval-progress";
import { MultiSelect } from "@/components/ui/multi-select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  PrConvertStatusBadge,
  PR_CONVERT_STATUS_LABEL,
} from "@/components/pr/pr-convert-status-badge";
import { StatusBadge } from "@/components/status-badge";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import {
  type ActiveFilter,
  FilterPanel,
  filterOptionLabel,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";

const PR_SORT_COLUMNS: Record<string, string> = {
  pr_kode: "pr_kode",
  pr_tanggal: "pr_tanggal",
  pr_status: "pr_status",
  accurate: "accurate",
};

const PR_STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Completed", value: "completed" },
];

const PR_CONVERT_OPTIONS = [
  { label: PR_CONVERT_STATUS_LABEL.pending, value: "pending" },
  { label: PR_CONVERT_STATUS_LABEL.partial, value: "partial" },
  { label: PR_CONVERT_STATUS_LABEL.complete, value: "complete" },
];

const ACCURATE_OPTIONS = [
  { label: "Semua Accurate", value: "all" },
  { label: "Sudah Input", value: "yes" },
  { label: "Belum Input", value: "no" },
];

export default function PRListPage() {
  const supabase = createClient();
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Filters & pagination - disimpan di URL (hooks/use-url-list-state.ts),
  // jadi bisa di-share & tombol Back browser bekerja. Setter di bawah tetap
  // bernama seperti useState lama.
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilters = urlState.list("status");
  const setStatusFilters = (v: string[]) =>
    urlState.set({ status: v }, { resetPage: true });
  const convertStatusFilters = urlState.list("status_po");
  const setConvertStatusFilters = (v: string[]) =>
    urlState.set({ status_po: v }, { resetPage: true });
  const accurateFilter = urlState.get("accurate", "all");
  const setAccurateFilter = (v: string) =>
    urlState.set({ accurate: v === "all" ? "" : v }, { resetPage: true });
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

  // Detail Sheet State
  const [selectedPrId, setSelectedPrId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const fetchUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*, roles:user_roles(roles(name))")
        .eq("id", user.id)
        .single();
      if (profile) {
        setUserProfile({
          ...profile,
          isAdmin: (profile.roles as any[]).some(
            (r) => r.roles.name === "admin",
          ),
          isModerator: (profile.roles as any[]).some(
            (r) => r.roles.name === "moderator",
          ),
        });
      }
    }
    const { data: cabangData } = await supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang");
    setAvailableCabang(cabangData || []);
  };

  const buildFilteredPrQuery = () => {
    let query = supabase
      .from("prs")
      .select("*, cabang(nama_cabang), profiles(nama)", { count: "exact" });

    if (debouncedSearch) {
      query = query.ilike("pr_kode", `%${debouncedSearch}%`);
    }

    if (statusFilters.length > 0) {
      const expanded = statusFilters.flatMap((s) =>
        s === "completed" ? completedFilterStatuses() : [s],
      );
      query = query.in("pr_status", Array.from(new Set(expanded)));
    }

    if (convertStatusFilters.length > 0) {
      query = query.in("pr_convert_status", convertStatusFilters);
    }

    if (accurateFilter !== "all") {
      query = query.eq("accurate", accurateFilter === "yes");
    }

    if (locationFilters.length > 0) {
      query = query.in("cabang_id", locationFilters);
    }

    if (dateFrom) {
      query = query.gte("pr_tanggal", dateFrom);
    }
    if (dateTo) {
      query = query.lte("pr_tanggal", dateTo);
    }

    return query;
  };

  const fetchPRs = async () => {
    setLoading(true);
    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = PR_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "created_at";
    const ascending = sortColumn
      ? sortDirRaw === "asc"
      : sortOrder === "oldest";

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await buildFilteredPrQuery()
      .order(sortField, { ascending })
      .range(from, to);

    if (!error) {
      setPrs(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const pageSize = 1000;
      const allRows: any[] = [];
      for (let pageIndex = 0; ; pageIndex += 1) {
        const from = pageIndex * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildFilteredPrQuery()
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) {
          toast.error(error.message || "Gagal mengambil data untuk export.");
          return;
        }

        allRows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }

      if (allRows.length === 0) {
        toast.error("Tidak ada data untuk diekspor.");
        return;
      }

      // Ambil MR asal untuk tiap PR (bisa lebih dari satu).
      const prIds = allRows.map((pr) => pr.id);
      const mrCodesByPr = new Map<number, string[]>();
      for (let i = 0; i < prIds.length; i += 1000) {
        const chunk = prIds.slice(i, i + 1000);
        const { data } = await supabase
          .from("pr_items")
          .select("pr_id, mrs(mr_kode)")
          .in("pr_id", chunk);
        for (const row of data || []) {
          const kode = Array.isArray(row.mrs)
            ? row.mrs[0]?.mr_kode
            : (row.mrs as any)?.mr_kode;
          if (!kode) continue;
          const list = mrCodesByPr.get(row.pr_id) || [];
          list.push(kode);
          mrCodesByPr.set(row.pr_id, list);
        }
      }

      const sheetData = allRows.map((pr, index) => {
        const summary = summarizeApprovals(pr.approvals);
        return {
          NO: index + 1,
          "KODE PR": pr.pr_kode || "-",
          "MR ASAL":
            Array.from(new Set(mrCodesByPr.get(pr.id) || [])).join(", ") || "-",
          PIC: pr.profiles?.nama || "-",
          LOKASI: pr.cabang?.nama_cabang || "-",
          TANGGAL: toExcelDate(pr.pr_tanggal),
          STATUS: pr.pr_status || "-",
          "PROGRES APPROVAL": `${summary.approvedCount}/${summary.totalCount}`,
          "CONVERT STATUS": pr.pr_convert_status || "-",
          ACCURATE: pr.accurate ? "Sudah" : "Belum",
        };
      });

      const ws = jsonToSheetWithDates(sheetData, ["TANGGAL"]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Purchase Request");
      XLSX.writeFile(
        wb,
        `PURCHASE_REQUEST_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`Export Excel berhasil (${allRows.length} baris).`);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    fetchPRs();
  }, [
    debouncedSearch,
    statusFilters,
    convertStatusFilters,
    accurateFilter,
    locationFilters,
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
      value: optionLabels(PR_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (convertStatusFilters.length > 0)
    activeFilters.push({
      key: "status_po",
      label: "Status PO",
      value: optionLabels(PR_CONVERT_OPTIONS, convertStatusFilters),
      onRemove: () => setConvertStatusFilters([]),
    });
  if (accurateFilter !== "all")
    activeFilters.push({
      key: "accurate",
      label: "Accurate",
      value: filterOptionLabel(ACCURATE_OPTIONS, accurateFilter),
      onRemove: () => setAccurateFilter("all"),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  const handleRowClick = (id: number) => {
    setSelectedPrId(id);
    setSheetOpen(true);
  };

  const hasActiveFilters =
    statusFilters.length > 0 ||
    convertStatusFilters.length > 0 ||
    accurateFilter !== "all" ||
    locationFilters.length > 0 ||
    dateFrom !== "" ||
    dateTo !== "" ||
    sortOrder !== "newest";

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Purchase Request (PR)
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                External Procurement Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={loading || exporting}
              className="gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase transition-all"
            >
              <Download className="h-4 w-4" />
              {exporting ? "MENGEKSPOR..." : "EXPORT EXCEL"}
            </Button>
            <Link href="/pr/create">
              <Button className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase">
                <Plus className="h-4 w-4" /> Buat PR Baru
              </Button>
            </Link>
          </div>
        </div>
      </Content>

      {/* Section 2: Filter Bar */}
      <Content>
        <div className="space-y-3">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari Kode PR..."
              className="pl-9 h-9 border-input bg-muted/40 focus:bg-background transition-all rounded-md text-xs font-medium text-foreground"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium">Lokasi</label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
                    onClick={setMyLocationFilter}
                    disabled={!userProfile?.cabang_id}
                  >
                    <Navigation2 className="h-3 w-3" />
                    Lokasi saya
                  </button>
                </div>
                <MultiSelect
                  placeholder="Semua Lokasi"
                  icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
                  searchable
                  selected={locationFilters}
                  onChange={setLocationFilters}
                  options={locationOptions}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Status</label>
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={PR_STATUS_OPTIONS}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Status PO</label>
                <MultiSelect
                  placeholder="Semua Status PO"
                  selected={convertStatusFilters}
                  onChange={setConvertStatusFilters}
                  options={PR_CONVERT_OPTIONS}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Accurate</label>
                <Select value={accurateFilter} onValueChange={setAccurateFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
                    <SelectValue placeholder="Accurate" />
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    {ACCURATE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Tanggal PR</label>
                <div className="grid grid-cols-2 gap-2">
                  <DatePickerString
                    value={dateFrom}
                    onChange={setDateFrom}
                    placeholder="Dari"
                    className="h-9 w-full text-xs font-medium"
                  />
                  <DatePickerString
                    value={dateTo}
                    onChange={setDateTo}
                    placeholder="Sampai"
                    className="h-9 w-full text-xs font-medium"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Urutan</label>
                <Select value={sortOrder} onValueChange={handleSortChange}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                      <SelectValue placeholder="Urutan" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="newest">Terbaru Dibuat</SelectItem>
                    <SelectItem value="oldest">Terlama Dibuat</SelectItem>
                    <SelectItem value="pr_tanggal_desc">Tanggal Dok ↓</SelectItem>
                    <SelectItem value="pr_tanggal_asc">Tanggal Dok ↑</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FilterPanel>
        </div>
      </Content>

      {/* Section 3: Table */}
      <Content className="overflow-hidden">
        <div>
          <Table containerClassName="max-h-[75vh] overflow-y-auto">
            <TableHeader className="bg-muted/50 border-b border-border [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
              <TableRow className="hover:bg-transparent h-10">
                <SortableTableHead
                  sortKey="pr_kode"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="w-50 text-[10px] font-black uppercase text-muted-foreground"
                >
                  Purchase Request ID
                </SortableTableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Personnel / Source
                </TableHead>
                <SortableTableHead
                  sortKey="pr_status"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="justify-center text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Status
                </SortableTableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Progress Approval
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Status PO
                </TableHead>
                <SortableTableHead
                  sortKey="accurate"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="justify-center text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Accurate
                </SortableTableHead>
                <SortableTableHead
                  sortKey="pr_tanggal"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  defaultDir="desc"
                  className="justify-end text-right text-[10px] font-black uppercase text-muted-foreground pr-6"
                >
                  Tanggal Dokumen
                </SortableTableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">
                        Memuat Data...
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : prs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[10px]"
                  >
                    {hasActiveFilters || searchQuery
                      ? "Tidak ada data yang sesuai filter."
                      : "DATA PURCHASE REQUEST TIDAK DITEMUKAN"}
                  </TableCell>
                </TableRow>
              ) : (
                prs.map((pr) => (
                  <TableRow
                    key={pr.id}
                    className="group hover:bg-muted/30 transition-all border-b border-border/50 h-16 cursor-pointer"
                    onClick={() => handleRowClick(pr.id)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-sm border border-primary/20">
                          <FileText className="h-4 w-4" />
                        </div>
                        <span className="font-bold text-foreground tracking-tight uppercase text-sm">
                          {pr.pr_kode}
                        </span>
                        {pr.pr_jenis === "konsinyasi" && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[8px] font-black uppercase border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800"
                          >
                            Konsinyasi
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase">
                          <User className="h-3 w-3 text-muted-foreground" />{" "}
                          {pr.profiles?.nama}
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-tight">
                          <Building2 className="h-3 w-3" />{" "}
                          {pr.cabang?.nama_cabang}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusBadge status={pr.pr_status} />
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        const summary = summarizeApprovals(pr.approvals);
                        return (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[11px] font-bold text-foreground">
                              {summary.approvedCount}/{summary.totalCount}{" "}
                              Disetujui
                            </span>
                            {summary.pendingApprover && (
                              <span className="text-[9px] font-medium text-warning uppercase tracking-tight">
                                Menunggu: {summary.pendingApprover.nama}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-center">
                      <PrConvertStatusBadge status={pr.pr_convert_status} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={pr.accurate ? "default" : "secondary"}
                        className="text-[10px] font-bold uppercase"
                      >
                        {pr.accurate ? "Sudah" : "Belum"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex items-center justify-end gap-2 text-xs font-bold text-foreground uppercase tracking-tighter">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground/40" />
                        {formatDate(pr.pr_tanggal)}
                      </div>
                    </TableCell>
                    <TableCell className="pr-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-md hover:bg-muted transition-all group-hover:bg-muted border border-transparent group-hover:border-border"
                      >
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="p-4 border-t border-border bg-muted/30">
          <DataTablePagination
            totalCount={totalCount}
            pageSize={limit}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={(val) => {
              setLimit(parseInt(val));
              setPage(1);
            }}
            itemLabel="Purchase Request"
          />
        </div>
      </Content>

      <PRDetailSheet
        prId={selectedPrId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdate={fetchPRs}
      />
    </>
  );
}
