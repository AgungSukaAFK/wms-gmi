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
  Package,
  User,
  ChevronRight,
  Plus,
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
import { DeliveryDetailSheet } from "@/components/delivery/delivery-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import Link from "next/link";
import { completedFilterStatuses } from "@/lib/document-status";
import { MultiSelect } from "@/components/ui/multi-select";

export default function DeliveriesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);

  // Pagination & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Advanced Filters
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
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
    let query = supabase
      .from("deliveries")
      .select(
        "*, cabang_dari:cabang!deliveries_dari_cabang_id_fkey(nama_cabang), cabang_ke:cabang!deliveries_ke_cabang_id_fkey(nama_cabang)",
        {
          count: "exact",
        },
      );

    if (debouncedSearch) {
      query = query.or(
        `dlv_kode.ilike.%${debouncedSearch}%,pic.ilike.%${debouncedSearch}%`,
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
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
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
      case "completed":
      case "done":
      case "closed":
        return (
          <Badge className="bg-foreground text-background font-bold text-[10px] uppercase">
            Completed
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

      {/* Section 2: Filter Bar */}
      <Content>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Cari Kode Delivery atau PIC..."
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
              placeholder="Semua Status"
              selected={statusFilters}
              onChange={(vals) => {
                setStatusFilters(vals);
                setPage(1);
              }}
              options={[
                { label: "Open", value: "open" },
                { label: "Approved", value: "approved" },
                { label: "Completed", value: "completed" },
              ]}
            />

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
                setStatusFilters([]);
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
                  Delivery
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Route / PIC
                </TableHead>
                <TableHead className="w-35 text-[10px] font-black uppercase text-muted-foreground text-center">
                  Tanggal
                </TableHead>
                <TableHead className="w-37.5 text-[10px] font-black uppercase text-muted-foreground text-center">
                  Status
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
                        colSpan={5}
                        className="h-20 animate-pulse bg-muted/20"
                      />
                    </TableRow>
                  ))
              ) : deliveries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-48 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    DATA DELIVERY TIDAK DITEMUKAN
                  </TableCell>
                </TableRow>
              ) : (
                deliveries.map((dlv) => (
                  <TableRow
                    key={dlv.id}
                    className="group hover:bg-muted/30 transition-all border-b border-border/50 h-20 cursor-pointer"
                    onClick={() => {
                      setSelectedDeliveryId(dlv.id);
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
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2 text-xs font-bold text-foreground uppercase">
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        {new Date(dlv.created_at).toLocaleDateString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {getStatusBadge(dlv.status)}
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
            itemLabel="Delivery"
          />
        </div>
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
