"use client";

import React, { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Plus,
  Search,
  PackageCheck,
  Calendar,
  User,
  Building2,
  Loader2,
  FilterX,
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
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { ReceiveDetailSheet } from "@/components/receive/receive-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";

export default function ReceiveItemPage() {
  const supabase = createClient();
  const [receives, setReceives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [locationFilter, setLocationFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

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

  const fetchReceives = async () => {
    setLoading(true);

    let query = supabase.from("receives").select(
      `
          id, ri_kode, ri_tanggal, ri_pic, ri_keterangan, created_at,
          cabang(id, nama_cabang),
          pos(id, po_kode),
          receive_items(id)
        `,
      { count: "exact" },
    );

    if (debouncedSearch) {
      query = query.ilike("ri_kode", `%${debouncedSearch}%`);
    }

    if (locationFilter !== "all") {
      query = query.eq("cabang_id", locationFilter);
    }

    if (dateFrom) query = query.gte("ri_tanggal", dateFrom);
    if (dateTo) query = query.lte("ri_tanggal", dateTo);

    const ascending = sortOrder === "oldest";
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order("created_at", { ascending })
      .range(from, to);

    if (!error) {
      setReceives(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    fetchReceives();
  }, [
    debouncedSearch,
    locationFilter,
    dateFrom,
    dateTo,
    sortOrder,
    page,
    limit,
  ]);

  const resetFilters = () => {
    setSearchQuery("");
    setLocationFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortOrder("newest");
    setPage(1);
  };

  const hasActiveFilters =
    locationFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    sortOrder !== "newest";

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex items-center justify-between">
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
          <Link href="/receive/create">
            <Button className="gap-2 font-bold text-xs uppercase h-9">
              <Plus className="h-4 w-4" />
              Buat Penerimaan
            </Button>
          </Link>
        </div>
      </Content>

      {/* Filters */}
      <Content>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari kode RI..."
                className="h-9 pl-9 text-xs font-medium"
              />
            </div>

            <Select
              value={locationFilter}
              onValueChange={(v) => {
                setLocationFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-44 text-xs font-bold">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Semua Lokasi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-bold">
                  Semua Lokasi
                </SelectItem>
                {availableCabang.map((c) => (
                  <SelectItem
                    key={c.id}
                    value={c.id.toString()}
                    className="text-xs font-bold"
                  >
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={sortOrder}
              onValueChange={(v) => {
                setSortOrder(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-40 text-xs font-bold">
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest" className="text-xs font-bold">
                  Terbaru
                </SelectItem>
                <SelectItem value="oldest" className="text-xs font-bold">
                  Terlama
                </SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-9 gap-2 text-xs font-bold text-muted-foreground"
              >
                <FilterX className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
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
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
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

      {/* Table */}
      <Content>
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent border-b border-border h-11">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground pl-5 w-40">
                  Kode RI
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground w-36">
                  Tanggal
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground w-36">
                  No. PO
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground w-44">
                  Lokasi
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  PIC
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center w-24">
                  Items
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs font-medium">Memuat...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : receives.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <PackageCheck className="h-8 w-8 opacity-30" />
                      <p className="text-xs font-medium">
                        Belum ada data penerimaan
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                receives.map((ri) => (
                  <TableRow
                    key={ri.id}
                    className="cursor-pointer hover:bg-muted/40 border-b border-border/50 h-14 transition-colors"
                    onClick={() => {
                      setSelectedReceiveId(ri.id);
                      setSheetOpen(true);
                    }}
                  >
                    <TableCell className="pl-5">
                      <span className="font-black text-xs text-foreground font-mono uppercase tracking-wide">
                        {ri.ri_kode}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {new Date(ri.ri_tanggal).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <ShoppingCart className="h-3 w-3 text-muted-foreground shrink-0" />
                        {ri.pos?.po_kode ?? "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {ri.cabang?.nama_cabang ?? "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <User className="h-3 w-3 shrink-0" />
                        {ri.ri_pic}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-bold gap-1"
                      >
                        <Package className="h-3 w-3" />
                        {ri.receive_items?.length ?? 0}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && totalCount > 0 && (
          <div className="mt-4">
            <DataTablePagination
              currentPage={page}
              pageSize={limit}
              totalCount={totalCount}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setLimit(parseInt(s, 10));
                setPage(1);
              }}
            />
          </div>
        )}
      </Content>

      <ReceiveDetailSheet
        receiveId={selectedReceiveId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
