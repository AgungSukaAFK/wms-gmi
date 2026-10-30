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
  ShoppingCart,
  Calendar,
  User,
  Building2,
  ChevronRight,
  MapPin,
  Navigation2,
  Loader2,
  ArrowUpDown,
  Package,
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
import { PODetailSheet } from "@/components/po/po-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { completedFilterStatuses } from "@/lib/document-status";
import { summarizeApprovals } from "@/lib/approval-progress";
import { MultiSelect } from "@/components/ui/multi-select";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  OUTSTANDING_FILTER_OPTIONS,
  type OutstandingFilter,
} from "@/lib/po-outstanding";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import {
  type ActiveFilter,
  FilterPanel,
  filterOptionLabel,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";

const PO_SORT_COLUMNS: Record<string, string> = {
  po_kode: "po_kode",
  po_tanggal: "po_tanggal",
  po_status: "po_status",
  po_receive_status: "po_receive_status",
};

const PO_STATUS_OPTIONS = [
  { label: "Pending Approval", value: "open" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Completed", value: "completed" },
];

const PO_RECEIVE_OPTIONS = [
  { label: "Menunggu", value: "pending" },
  { label: "Partial", value: "partial" },
  { label: "Selesai", value: "complete" },
];

export default function POListPage() {
  const supabase = createClient();
  const [pos, setPos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);

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
  const receiveStatusFilters = urlState.list("status_terima");
  const setReceiveStatusFilters = (v: string[]) =>
    urlState.set({ status_terima: v }, { resetPage: true });
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
  // Filter PO Outstanding (import ERP). "unlinked"/"linked" butuh daftar PO
  // yang masih punya item belum terhubung ke PR (dimuat terpisah).
  const outstandingParam = urlState.get("outstanding");
  const outstandingFilter: OutstandingFilter | "none" =
    OUTSTANDING_FILTER_OPTIONS.find((o) => o.value === outstandingParam)
      ?.value ?? "none";
  const setOutstandingFilter = (v: OutstandingFilter | "none") =>
    urlState.set({ outstanding: v === "none" ? "" : v }, { resetPage: true });
  const [unlinkedOstPoIds, setUnlinkedOstPoIds] = useState<number[] | null>(
    null,
  );

  // Pagination
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  // Detail Sheet
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
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
          isPurchasing: (profile.roles as any[]).some(
            (r) => r.roles.name === "purchasing",
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

  const buildFilteredPoQuery = () => {
    let query = supabase.from("pos").select(
      `
        id, po_kode, po_tanggal, po_estimasi, po_status, po_receive_status,
        po_pic, po_detail_status, po_payment_term, approvals, created_at,
        po_jenis, po_pr_referensi, so_id, so_reguler(id, so_kode), cabang_id,
        po_is_outstanding, cabang(nama_cabang),
        prs(
          id, pr_kode, cabang_id,
          cabang(nama_cabang),
          profiles(nama)
        ),
        po_items(id, vendor_id, vendors(vendor_name))
      `,
      { count: "exact" },
    );

    if (debouncedSearch) {
      query = query.ilike("po_kode", `%${debouncedSearch}%`);
    }

    if (statusFilters.length > 0) {
      const expanded = statusFilters.flatMap((s) =>
        s === "completed" ? completedFilterStatuses() : [s],
      );
      query = query.in("po_status", Array.from(new Set(expanded)));
    }

    if (receiveStatusFilters.length > 0) {
      query = query.in("po_receive_status", receiveStatusFilters);
    }

    // pos.cabang_id (bukan prs.cabang_id lagi): PO Non-PR tidak punya PR.
    // PO reguler di-backfill/diisi trigger dari PR-nya, jadi hasilnya sama.
    if (locationFilters.length > 0) {
      query = query.in("cabang_id", locationFilters);
    }

    if (dateFrom) query = query.gte("po_tanggal", dateFrom);
    if (dateTo) query = query.lte("po_tanggal", dateTo);

    if (outstandingFilter !== "none") {
      query = query.eq("po_is_outstanding", true);
      const ids = unlinkedOstPoIds || [];
      if (outstandingFilter === "unlinked") {
        query = query.in("id", ids.length > 0 ? ids : [-1]);
      } else if (outstandingFilter === "linked" && ids.length > 0) {
        query = query.not("id", "in", `(${ids.join(",")})`);
      }
    }

    return query;
  };

  const needsUnlinkedIds =
    outstandingFilter === "unlinked" || outstandingFilter === "linked";

  const fetchUnlinkedOstPoIds = async () => {
    const ids = new Set<number>();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("po_items")
        .select("po_id, pos!inner(po_is_outstanding)")
        .is("pr_item_id", null)
        .eq("pos.po_is_outstanding", true)
        .range(from, from + pageSize - 1);
      if (error) {
        toast.error(error.message);
        break;
      }
      for (const row of data || []) ids.add(row.po_id);
      if (!data || data.length < pageSize) break;
    }
    setUnlinkedOstPoIds(Array.from(ids));
  };

  const fetchPOs = async () => {
    if (needsUnlinkedIds && unlinkedOstPoIds === null) return;
    setLoading(true);

    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = PO_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "created_at";
    const ascending = sortColumn
      ? sortDirRaw === "asc"
      : sortOrder === "oldest";

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await buildFilteredPoQuery()
      .order(sortField, { ascending })
      .range(from, to);

    if (!error) {
      setPos(data || []);
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
        const { data, error } = await buildFilteredPoQuery()
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

      // PR asal (bisa >1) per PO via po_items.pr_item_id -> pr_items.pr_id.
      const poIds = allRows.map((po) => po.id);
      const prCodesByPo = new Map<number, string[]>();
      for (let i = 0; i < poIds.length; i += 1000) {
        const chunk = poIds.slice(i, i + 1000);
        const { data } = await supabase
          .from("po_items")
          .select("po_id, pr_item_id, pr_items(pr_id, prs(pr_kode))")
          .in("po_id", chunk);
        for (const row of data || []) {
          const prItem = Array.isArray(row.pr_items)
            ? row.pr_items[0]
            : (row.pr_items as any);
          const prs = prItem?.prs;
          const kode = Array.isArray(prs) ? prs[0]?.pr_kode : prs?.pr_kode;
          if (!kode) continue;
          const list = prCodesByPo.get(row.po_id) || [];
          list.push(kode);
          prCodesByPo.set(row.po_id, list);
        }
      }

      const sheetData = allRows.map((po, index) => {
        const vendorNames = Array.from(
          new Set(
            (po.po_items || [])
              .map((i: any) => i.vendors?.vendor_name)
              .filter(Boolean),
          ),
        );
        return {
          NO: index + 1,
          "KODE PO": po.po_kode || "-",
          "PR ASAL":
            po.po_jenis === "non_pr"
              ? `NON-PR${po.po_pr_referensi ? ` (Ref: ${po.po_pr_referensi})` : ""}`
              : po.po_jenis === "so"
                ? `SO ${po.so_reguler?.so_kode || "-"}`
                : Array.from(new Set(prCodesByPo.get(po.id) || [])).join(", ") ||
                po.prs?.pr_kode ||
                "-",
          VENDOR: vendorNames.join(", ") || "-",
          PIC: po.po_pic || "-",
          TANGGAL: toExcelDate(po.po_tanggal),
          ESTIMASI: toExcelDate(po.po_estimasi),
          STATUS: po.po_status || "-",
          "RECEIVE STATUS": po.po_receive_status || "-",
          OUTSTANDING: po.po_is_outstanding ? "Ya" : "",
        };
      });

      const ws = jsonToSheetWithDates(sheetData, ["TANGGAL", "ESTIMASI"]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Purchase Order");
      XLSX.writeFile(
        wb,
        `PURCHASE_ORDER_${new Date().toISOString().slice(0, 10)}.xlsx`,
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
    if (needsUnlinkedIds) fetchUnlinkedOstPoIds();
    else setUnlinkedOstPoIds(null);
  }, [outstandingFilter]);

  useEffect(() => {
    fetchPOs();
  }, [
    outstandingFilter,
    unlinkedOstPoIds,
    debouncedSearch,
    statusFilters,
    receiveStatusFilters,
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
      label: "Approval",
      value: optionLabels(PO_STATUS_OPTIONS, statusFilters),
      onRemove: () => setStatusFilters([]),
    });
  if (receiveStatusFilters.length > 0)
    activeFilters.push({
      key: "status_terima",
      label: "Terima",
      value: optionLabels(PO_RECEIVE_OPTIONS, receiveStatusFilters),
      onRemove: () => setReceiveStatusFilters([]),
    });
  if (outstandingFilter !== "none")
    activeFilters.push({
      key: "outstanding",
      label: "Outstanding",
      value: filterOptionLabel(OUTSTANDING_FILTER_OPTIONS, outstandingFilter),
      onRemove: () => setOutstandingFilter("none"),
    });
  if (dateFrom || dateTo)
    activeFilters.push({
      key: "tanggal",
      label: "Tanggal",
      value: formatFilterRange(dateFrom, dateTo, formatFilterDate),
      onRemove: () => urlState.set({ dari: "", sampai: "" }, { resetPage: true }),
    });

  const handleRowClick = (id: number) => {
    setSelectedPoId(id);
    setSheetOpen(true);
  };

  const hasActiveFilters =
    statusFilters.length > 0 ||
    receiveStatusFilters.length > 0 ||
    locationFilters.length > 0 ||
    dateFrom !== "" ||
    dateTo !== "" ||
    outstandingFilter !== "none" ||
    sortOrder !== "newest";

  const getApprovalStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-semibold text-[10px] uppercase"
          >
            Pending Approval
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success text-success-foreground font-semibold text-[10px] uppercase">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge
            variant="destructive"
            className="font-semibold text-[10px] uppercase"
          >
            Rejected
          </Badge>
        );
      case "completed":
      case "closed":
        return (
          <Badge className="bg-foreground text-background font-semibold text-[10px] uppercase">
            Completed
          </Badge>
        );
      default:
        return (
          <Badge
            variant="secondary"
            className="font-semibold text-[10px] uppercase"
          >
            {status}
          </Badge>
        );
    }
  };

  const getReceiveStatusBadge = (status: string) => {
    switch (status) {
      case "complete":
        return (
          <Badge className="bg-success text-success-foreground font-semibold text-[10px] uppercase">
            Selesai
          </Badge>
        );
      case "partial":
        return (
          <Badge
            variant="outline"
            className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30 font-semibold text-[10px] uppercase dark:text-amber-300 dark:border-amber-800"
          >
            Partial
          </Badge>
        );
      default:
        return (
          <Badge
            variant="secondary"
            className="font-semibold text-[10px] uppercase text-muted-foreground"
          >
            Menunggu
          </Badge>
        );
    }
  };

  const getVendorNames = (poItems: any[]) => {
    const names = [
      ...new Set(
        (poItems || []).map((i: any) => i.vendors?.vendor_name).filter(Boolean),
      ),
    ] as string[];
    return names;
  };

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Purchase Order (PO)
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Manajemen Pembelian &amp; Penerimaan Barang
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
            {(userProfile?.isAdmin || userProfile?.isPurchasing) && (
              <Link href="/po/create">
                <Button className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase">
                  <Plus className="h-4 w-4" /> Buat PO Baru
                </Button>
              </Link>
            )}
          </div>
        </div>
      </Content>

      {/* Section 2: Filter Bar */}
      <Content>
        <div className="space-y-3">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari Kode PO..."
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
                <label className="text-sm font-medium">Status Approval</label>
                <MultiSelect
                  placeholder="Semua Status"
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  options={PO_STATUS_OPTIONS}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Status Terima</label>
                <MultiSelect
                  placeholder="Semua Status Terima"
                  icon={<Package className="h-3 w-3 text-muted-foreground" />}
                  selected={receiveStatusFilters}
                  onChange={setReceiveStatusFilters}
                  options={PO_RECEIVE_OPTIONS}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">PO Outstanding</label>
                <Select
                  value={outstandingFilter}
                  onValueChange={(val) =>
                    setOutstandingFilter(val as OutstandingFilter | "none")
                  }
                >
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue placeholder="PO Outstanding" />
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="none">Semua PO</SelectItem>
                    {OUTSTANDING_FILTER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Tanggal PO</label>
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
                    <SelectItem value="po_tanggal_desc">Tanggal Dok ↓</SelectItem>
                    <SelectItem value="po_tanggal_asc">Tanggal Dok ↑</SelectItem>
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
                  sortKey="po_kode"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="w-52 text-[10px] font-black uppercase text-muted-foreground"
                >
                  Purchase Order ID
                </SortableTableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Sumber PR / Lokasi
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Vendor(s)
                </TableHead>
                <SortableTableHead
                  sortKey="po_status"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="justify-center text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Progress Approval
                </SortableTableHead>
                <SortableTableHead
                  sortKey="po_receive_status"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="justify-center text-center text-[10px] font-black uppercase text-muted-foreground"
                >
                  Penerimaan
                </SortableTableHead>
                <SortableTableHead
                  sortKey="po_tanggal"
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
                  <TableCell colSpan={7} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">
                        Memuat Data...
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : pos.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[10px]"
                  >
                    {hasActiveFilters || searchQuery
                      ? "Tidak ada data yang sesuai filter."
                      : "DATA PURCHASE ORDER TIDAK DITEMUKAN"}
                  </TableCell>
                </TableRow>
              ) : (
                pos.map((po) => {
                  const vendorNames = getVendorNames(po.po_items);
                  const pr = po.prs;
                  return (
                    <TableRow
                      key={po.id}
                      className="group hover:bg-muted/30 transition-all border-b border-border/50 h-16 cursor-pointer"
                      onClick={() => handleRowClick(po.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-sm border border-primary/20">
                            <ShoppingCart className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-foreground tracking-tight uppercase text-sm">
                                {po.po_kode}
                              </span>
                              {po.po_jenis === "konsinyasi" && (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 text-[8px] font-black uppercase border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800"
                                >
                                  Rekonsil Konsinyasi
                                </Badge>
                              )}
                              {po.po_is_outstanding && (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 text-[8px] font-black uppercase border-primary/40 bg-primary/10 text-primary"
                                >
                                  Outstanding
                                </Badge>
                              )}
                            </div>
                            {po.po_detail_status && (
                              <p className="text-[9px] text-muted-foreground font-medium mt-0.5">
                                {po.po_detail_status}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase">
                            <User className="h-3 w-3 text-muted-foreground" />{" "}
                            {po.po_pic || pr?.profiles?.nama || "-"}
                          </div>
                          <div className="flex items-center gap-1.5 text-[9px] font-medium text-muted-foreground uppercase tracking-tight">
                            <Building2 className="h-3 w-3" />{" "}
                            {pr?.cabang?.nama_cabang ||
                              po.cabang?.nama_cabang ||
                              "-"}
                          </div>
                          {po.po_jenis === "so" ? (
                            <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-mono">
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[8px] font-bold uppercase border-primary/40 text-primary"
                              >
                                SO
                              </Badge>
                              {po.so_reguler?.so_kode && (
                                <Link
                                  href={`/so-reguler/so/${po.so_id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="truncate max-w-40 hover:underline"
                                >
                                  {po.so_reguler.so_kode}
                                </Link>
                              )}
                            </div>
                          ) : po.po_jenis === "non_pr" ? (
                            <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-mono">
                              <Badge
                                variant="outline"
                                className="h-4 px-1 text-[8px] font-bold uppercase border-warning/40 text-warning"
                              >
                                Non-PR
                              </Badge>
                              {po.po_pr_referensi && (
                                <span className="truncate max-w-40">
                                  {po.po_pr_referensi}
                                </span>
                              )}
                            </div>
                          ) : (
                            pr?.pr_kode && (
                              <div className="text-[9px] text-muted-foreground font-mono">
                                ↑ {pr.pr_kode}
                              </div>
                            )
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {vendorNames.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground/50 italic">
                              -
                            </span>
                          ) : (
                            vendorNames.slice(0, 2).map((name) => (
                              <Badge
                                key={name}
                                variant="secondary"
                                className="text-[9px] font-semibold uppercase"
                              >
                                {name}
                              </Badge>
                            ))
                          )}
                          {vendorNames.length > 2 && (
                            <Badge
                              variant="outline"
                              className="text-[9px] font-semibold"
                            >
                              +{vendorNames.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          {getApprovalStatusBadge(po.po_status)}
                          {(() => {
                            const summary = summarizeApprovals(po.approvals);
                            if (summary.totalCount === 0) return null;
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
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {getReceiveStatusBadge(po.po_receive_status)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-2 text-xs font-bold text-foreground uppercase tracking-tighter">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground/40" />
                          {formatDate(po.po_tanggal)}
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
                  );
                })
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
            itemLabel="Purchase Order"
          />
        </div>
      </Content>

      <PODetailSheet
        poId={selectedPoId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onUpdate={fetchPOs}
      />
    </>
  );
}
