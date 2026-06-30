"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Search,
  Loader2,
  Calendar as CalendarIcon,
  MapPin,
  Truck,
  FilterX,
  Navigation2,
  Clock,
  AlertTriangle,
  ChevronRight,
  Package,
  User,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useDebounce } from "use-debounce";
import { Separator } from "@/components/ui/separator";
import { ShareStockDetailSheet } from "@/components/share-stock/share-stock-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { MultiSelect } from "@/components/ui/multi-select";

export default function ShareStockPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [mrs, setMrs] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);

  // Pagination & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Advanced Filters
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
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

      // Default: pre-select lokasi peminta sesuai cabang user dari profil
      if (profile?.cabang_id) {
        setLocationFilters([profile.cabang_id.toString()]);
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
    let query = supabase
      .from("mrs")
      .select(
        "*, cabang(nama_cabang), mr_items!inner(qty_sharestock_total, mr_sharestock_allocations(source_cabang_id, source_cabang:cabang!source_cabang_id(nama_cabang)))",
        {
          count: "exact",
        },
      )
      .gt("mr_items.qty_sharestock_total", 0);

    if (debouncedSearch) {
      query = query.or(
        `mr_kode.ilike.%${debouncedSearch}%,mr_pic.ilike.%${debouncedSearch}%`,
      );
    }
    if (statusFilter !== "all") query = query.eq("mr_status", statusFilter);
    if (priorityFilter !== "all")
      query = query.eq("mr_priority", priorityFilter);
    if (locationFilters.length > 0)
      query = query.in("cabang_id", locationFilters);
    if (dateFrom) query = query.gte("mr_tanggal", dateFrom);
    if (dateTo) query = query.lte("mr_tanggal", dateTo);

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
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
    statusFilter,
    priorityFilter,
    locationFilters,
    dateFrom,
    dateTo,
    page,
    limit,
  ]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 font-bold text-[10px] uppercase"
          >
            Open
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-success text-success-foreground font-bold text-[10px] uppercase">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge
            variant="destructive"
            className="font-bold text-[10px] uppercase"
          >
            Rejected
          </Badge>
        );
      case "done":
        return (
          <Badge className="bg-foreground text-background font-bold text-[10px] uppercase">
            Done
          </Badge>
        );
      case "closed":
        return (
          <Badge
            variant="secondary"
            className="font-bold text-[10px] uppercase text-muted-foreground"
          >
            Closed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="font-bold text-[10px] uppercase">
            {status}
          </Badge>
        );
    }
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

      {/* Section 2: Filter Bar */}
      <Content>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Cari Kode MR atau PIC..."
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

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all rounded-md"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setPriorityFilter("all");
                setLocationFilters([]);
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
            >
              <FilterX className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
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
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
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
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent h-12">
                <TableHead className="w-45 text-[10px] font-black uppercase text-muted-foreground">
                  Material Request
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Personnel / Source
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Gudang Asal (Pemasok)
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Gudang Tujuan (Peminta)
                </TableHead>
                <TableHead className="w-35 text-[10px] font-black uppercase text-muted-foreground text-center">
                  Tanggal MR
                </TableHead>
                <TableHead className="w-37.5 text-[10px] font-black uppercase text-muted-foreground text-center">
                  Status MR
                </TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(5)
                  .fill(0)
                  .map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell
                        colSpan={7}
                        className="h-20 animate-pulse bg-muted/20"
                      />
                    </TableRow>
                  ))
              ) : mrs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    DATA SHARE STOCK TIDAK DITEMUKAN
                  </TableCell>
                </TableRow>
              ) : (
                mrs.map((mr) => (
                  <TableRow
                    key={mr.id}
                    className="group hover:bg-muted/30 transition-all border-b border-border/50 h-20 cursor-pointer"
                    onClick={() => {
                      setSelectedMrId(mr.id);
                      setDetailOpen(true);
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shadow-sm border border-primary/20">
                          <Package className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-foreground tracking-tight uppercase text-sm">
                            {mr.mr_kode}
                          </span>
                          <div className="mt-1">
                            {getPriorityBadge(mr.mr_priority)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
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
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground uppercase">
                        <MapPin className="h-3 w-3 text-success" />{" "}
                        {mr.cabang?.nama_cabang}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2 text-xs font-bold text-foreground uppercase">
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        {new Date(mr.mr_tanggal).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {getStatusBadge(mr.mr_status)}
                    </TableCell>
                    <TableCell className="text-right">
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

        <div className="pt-4 border-t border-border">
          <DataTablePagination
            totalCount={totalCount}
            pageSize={limit}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={(val) => {
              setLimit(parseInt(val));
              setPage(1);
            }}
            itemLabel="Material Request"
          />
        </div>
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
