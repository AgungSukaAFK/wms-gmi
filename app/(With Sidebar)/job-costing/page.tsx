"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
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
  Calculator,
  FilterX,
  Loader2,
  ArrowUpDown,
  ChevronRight,
  Navigation2,
  Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { JobCostingDetailSheet } from "@/components/job-costing/job-costing-detail-sheet";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import { DatePickerString } from "@/components/date-picker-string";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID");
}

export default function JobCostingListPage() {
  const supabase = createClient();
  const profile = useAuthStore((s) => s.profile);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 400);
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

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
        "*, cabang(nama_cabang), job_costing_items(id, qty, unit_price)",
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `job_kode.ilike.%${debouncedSearch}%,description.ilike.%${debouncedSearch}%,finish_part.ilike.%${debouncedSearch}%`,
      );
    }
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (locationFilter !== "all") query = query.eq("cabang_id", locationFilter);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

    query = query
      .order("created_at", { ascending: sortOrder === "oldest" })
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
    statusFilter,
    locationFilter,
    dateFrom,
    dateTo,
    sortOrder,
    page,
    limit,
  ]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    statusFilter,
    locationFilter,
    dateFrom,
    dateTo,
    sortOrder,
  ]);

  const setMyLocationFilter = () => {
    if (profile?.cabang_id) {
      setLocationFilter(String(profile.cabang_id));
      setPage(1);
    }
  };

  const hasFilters =
    debouncedSearch ||
    statusFilter !== "all" ||
    locationFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "";

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
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Cari Batch No"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 border-input bg-muted/40 focus:bg-background transition-all rounded-md text-xs font-medium text-foreground"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full sm:w-45 border-input bg-background text-xs font-semibold text-foreground">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="h-9 w-full sm:w-45 border-input bg-background text-xs font-semibold text-foreground">
                <SelectValue placeholder="Cabang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Cabang</SelectItem>
                {availableCabang.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {profile?.cabang_id && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs gap-1.5"
                onClick={setMyLocationFilter}
              >
                <Navigation2 className="h-3.5 w-3.5" /> Lokasi Saya
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs gap-1.5"
              onClick={() =>
                setSortOrder(sortOrder === "newest" ? "oldest" : "newest")
              }
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortOrder === "newest" ? "Terbaru" : "Terlama"}
            </Button>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs gap-1.5 text-muted-foreground"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setLocationFilter("all");
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                <FilterX className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <DatePickerString
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="Tanggal dari"
                className="h-9 w-full text-xs font-medium sm:w-44"
              />
            </div>

            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <DatePickerString
                value={dateTo}
                onChange={setDateTo}
                placeholder="Tanggal sampai"
                className="h-9 w-full text-xs font-medium sm:w-44"
              />
            </div>
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-[11px] font-bold uppercase w-14">
                  No
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase">
                  Batch No
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase">
                  Tanggal
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase">
                  Finish Part
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase">
                  Status
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase w-16">
                  Aksi
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : jobs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-muted-foreground text-sm"
                  >
                    {hasFilters
                      ? "Tidak ada hasil yang cocok."
                      : "Belum ada Job Costing."}
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job, idx) => {
                  return (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => {
                        setSelectedJobId(job.id);
                        setSheetOpen(true);
                      }}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        {(page - 1) * limit + idx + 1}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold text-primary">
                        {job.job_kode}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDate(job.job_tanggal || job.created_at)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm max-w-55 truncate">
                        {job.finish_part || job.description || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-bold capitalize ${STATUS_COLORS[job.status] ?? ""}`}
                        >
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Content>
        <DataTablePagination
          currentPage={page}
          pageSize={limit}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setLimit(parseInt(s));
            setPage(1);
          }}
        />
      </Content>
    </>
  );
}
