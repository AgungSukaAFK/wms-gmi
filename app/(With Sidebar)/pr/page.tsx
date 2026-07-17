"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";
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
  FilterX,
  Navigation2,
  Loader2,
  CalendarIcon,
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
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { PRDetailSheet } from "@/components/pr/pr-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { completedFilterStatuses } from "@/lib/document-status";
import { summarizeApprovals } from "@/lib/approval-progress";
import { MultiSelect } from "@/components/ui/multi-select";

export default function PRListPage() {
  const supabase = createClient();
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [accurateFilter, setAccurateFilter] = useState<string>("all");
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<string>("newest");

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

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
    const sortField =
      sortOrder === "tanggal_desc" || sortOrder === "tanggal_asc"
        ? "pr_tanggal"
        : "created_at";
    const ascending = sortOrder === "oldest" || sortOrder === "tanggal_asc";

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
          "MR ASAL": Array.from(
            new Set(mrCodesByPr.get(pr.id) || []),
          ).join(", ") || "-",
          PIC: pr.profiles?.nama || "-",
          LOKASI: pr.cabang?.nama_cabang || "-",
          TANGGAL: pr.pr_tanggal
            ? new Date(pr.pr_tanggal).toLocaleDateString("id-ID")
            : "-",
          STATUS: pr.pr_status || "-",
          "PROGRES APPROVAL": `${summary.approvedCount}/${summary.totalCount}`,
          "CONVERT STATUS": pr.pr_convert_status || "-",
          ACCURATE: pr.accurate ? "Sudah" : "Belum",
        };
      });

      const ws = XLSX.utils.json_to_sheet(sheetData);
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
    accurateFilter,
    locationFilters,
    dateFrom,
    dateTo,
    sortOrder,
    page,
    limit,
  ]);

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilters([]);
    setAccurateFilter("all");
    setLocationFilters([]);
    setDateFrom("");
    setDateTo("");
    setSortOrder("newest");
    setPage(1);
  };

  const setMyLocationFilter = () => {
    if (userProfile?.cabang_id) {
      setLocationFilters([userProfile.cabang_id.toString()]);
      setPage(1);
    }
  };

  const handleRowClick = (id: number) => {
    setSelectedPrId(id);
    setSheetOpen(true);
  };

  const hasActiveFilters =
    statusFilters.length > 0 ||
    accurateFilter !== "all" ||
    locationFilters.length > 0 ||
    dateFrom !== "" ||
    dateTo !== "" ||
    sortOrder !== "newest";

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-semibold text-[10px] uppercase"
          >
            Open
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
      case "done":
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Cari Kode PR..."
                className="pl-9 h-9 border-input bg-muted/40 focus:bg-background transition-all rounded-md text-xs font-medium text-foreground"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <MultiSelect
              className="w-full sm:w-45"
              placeholder="Semua Lokasi"
              icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
              searchable
              selected={locationFilters}
              onChange={(vals) => {
                setLocationFilters(vals);
                setPage(1);
              }}
              options={availableCabang.map((c) => ({
                label: c.nama_cabang,
                value: c.id.toString(),
              }))}
            />

            <MultiSelect
              className="w-full sm:w-40"
              placeholder="Semua Status"
              selected={statusFilters}
              onChange={(vals) => {
                setStatusFilters(vals);
                setPage(1);
              }}
              options={[
                { label: "Open", value: "open" },
                { label: "Approved", value: "approved" },
                { label: "Rejected", value: "rejected" },
                { label: "Completed", value: "completed" },
              ]}
            />

            <Select
              value={accurateFilter}
              onValueChange={(val) => {
                setAccurateFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-40 border-input bg-background text-xs font-bold text-foreground">
                <SelectValue placeholder="Accurate" />
              </SelectTrigger>
              <SelectContent className="rounded-md">
                <SelectItem value="all">Semua Accurate</SelectItem>
                <SelectItem value="yes">Sudah Input</SelectItem>
                <SelectItem value="no">Belum Input</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sortOrder}
              onValueChange={(val) => {
                setSortOrder(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-45 border-input bg-background text-xs font-semibold text-foreground">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                  <SelectValue placeholder="Urutan" />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-md">
                <SelectItem value="newest">Terbaru Dibuat</SelectItem>
                <SelectItem value="oldest">Terlama Dibuat</SelectItem>
                <SelectItem value="tanggal_desc">Tanggal Dok ↓</SelectItem>
                <SelectItem value="tanggal_asc">Tanggal Dok ↑</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 max-sm:w-full text-[10px] font-bold text-primary hover:text-primary hover:bg-primary/10 gap-1.5 uppercase"
              onClick={setMyLocationFilter}
              disabled={!userProfile?.cabang_id}
            >
              <Navigation2 className="h-3 w-3" />
              LOKASI SAYA
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-muted-foreground hover:text-destructive gap-1 transition-colors"
              onClick={resetFilters}
              disabled={!hasActiveFilters && !searchQuery}
            >
              <FilterX className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <CalendarIcon className="h-3 w-3 text-muted-foreground" />
              <DatePickerString
                value={dateFrom}
                onChange={(value) => {
                  setDateFrom(value);
                  setPage(1);
                }}
                placeholder="Tanggal dari"
                className="h-9 w-full text-xs font-medium sm:w-44"
              />
            </div>

            <div className="flex w-full items-center gap-2 sm:w-auto">
              <CalendarIcon className="h-3 w-3 text-muted-foreground" />
              <DatePickerString
                value={dateTo}
                onChange={(value) => {
                  setDateTo(value);
                  setPage(1);
                }}
                placeholder="Tanggal sampai"
                className="h-9 w-full text-xs font-medium sm:w-44"
              />
            </div>
          </div>
        </div>
      </Content>

      {/* Section 3: Table */}
      <Content className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent h-10">
                <TableHead className="w-50 text-[10px] font-black uppercase text-muted-foreground">
                  Purchase Request ID
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Personnel / Source
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Status
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Progress Approval
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Accurate
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-right pr-6">
                  Tanggal Dokumen
                </TableHead>
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
              ) : prs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
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
                      {getStatusBadge(pr.pr_status)}
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
                        {new Date(pr.pr_tanggal).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
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
