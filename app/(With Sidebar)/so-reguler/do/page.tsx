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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { MultiSelect } from "@/components/ui/multi-select";
import { useDebounce } from "use-debounce";
import { useRouter } from "next/navigation";
import {
  Truck,
  Search,
  MapPin,
  Plus,
  Printer,
  ArrowRight,
  Calendar as CalendarIcon,
  ChevronRight,
} from "lucide-react";
import { DoRegulerDetailSheet } from "@/components/do-reguler/do-reguler-detail-sheet";

export default function DoRegulerPage() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    supabase
      .from("cabang")
      .select("id, nama_cabang")
      .eq("is_active", true)
      .order("nama_cabang")
      .then(({ data }) => setAvailableCabang(data || []));
  }, []);

  const fetchData = async () => {
    setLoading(true);
    let query = supabase
      .from("do_reguler")
      .select(
        "*, dari:cabang!dari_cabang_id(nama_cabang), customer:customers!customer_id(customer_name)",
        { count: "exact" },
      );

    if (debouncedSearch) {
      query = query.or(
        `do_kode.ilike.%${debouncedSearch}%,kode_po.ilike.%${debouncedSearch}%,pic.ilike.%${debouncedSearch}%`,
      );
    }
    if (statusFilters.length > 0) query = query.in("status", statusFilters);
    if (locationFilters.length > 0)
      query = query.in("dari_cabang_id", locationFilters);

    const from = (page - 1) * limit;
    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (!error) {
      setRows(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [debouncedSearch, statusFilters, locationFilters, page, limit]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-success text-success-foreground font-bold text-[10px] uppercase">
            Aktif
          </Badge>
        );
      case "completed":
        return (
          <Badge className="bg-foreground text-background font-bold text-[10px] uppercase">
            Selesai
          </Badge>
        );
      case "cancelled":
        return (
          <Badge
            variant="destructive"
            className="font-bold text-[10px] uppercase"
          >
            Dibatalkan
          </Badge>
        );
      default:
        return (
          <Badge
            variant="secondary"
            className="font-bold text-[10px] uppercase"
          >
            {status}
          </Badge>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                DO Reguler
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Delivery Order tanpa SPB ke customer
              </p>
            </div>
          </div>
          <Button
            onClick={() => router.push("/so-reguler/do/create")}
            className="shrink-0 gap-2 font-bold text-xs h-9 uppercase"
          >
            <Plus className="h-4 w-4" /> Buat DO Reguler
          </Button>
        </div>
      </Content>

      <Content>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari Kode DO, Kode PO, atau PIC..."
              className="pl-9 h-9 bg-muted/40 text-xs font-medium"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <MultiSelect
            className="w-full sm:w-45"
            placeholder="Semua Gudang"
            icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
            searchable
            selected={locationFilters}
            onChange={(v) => {
              setLocationFilters(v);
              setPage(1);
            }}
            options={availableCabang.map((c) => ({
              label: c.nama_cabang,
              value: c.id.toString(),
            }))}
          />
          <MultiSelect
            className="w-full sm:w-44"
            placeholder="Semua Status"
            selected={statusFilters}
            onChange={(v) => {
              setStatusFilters(v);
              setPage(1);
            }}
            options={[
              { label: "Aktif", value: "active" },
              { label: "Selesai", value: "completed" },
              { label: "Dibatalkan", value: "cancelled" },
            ]}
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent h-12">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Kode DO
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Gudang → Customer
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Tanggal
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Status
                </TableHead>
                <TableHead className="w-32 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array(5)
                  .fill(0)
                  .map((_, i) => (
                    <TableRow key={i}>
                      <TableCell
                        colSpan={5}
                        className="h-16 animate-pulse bg-muted/20"
                      />
                    </TableRow>
                  ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada DO Reguler
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="group hover:bg-muted/30 cursor-pointer h-16"
                    onClick={() => {
                      setSelectedId(r.id);
                      setDetailOpen(true);
                    }}
                  >
                    <TableCell className="font-bold text-foreground uppercase text-sm">
                      {r.do_kode}
                      {r.kode_po && (
                        <code className="block text-[10px] font-medium text-muted-foreground normal-case">
                          PO: {r.kode_po}
                        </code>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase">
                        {r.dari?.nama_cabang}
                        <ArrowRight className="h-3.5 w-3.5 text-primary" />
                        <span className="text-success">
                          {r.customer?.customer_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-foreground uppercase">
                        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        {r.do_tanggal
                          ? new Date(r.do_tanggal).toLocaleDateString("id-ID", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {getStatusBadge(r.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            window.open(
                              `/so-reguler/do/print/${r.id}`,
                              "_blank",
                            );
                          }}
                        >
                          <Printer className="mr-1.5 h-3.5 w-3.5" />
                          Cetak
                        </Button>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary inline" />
                      </div>
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
            itemLabel="DO Reguler"
          />
        </div>
      </Content>

      <DoRegulerDetailSheet
        doId={selectedId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={fetchData}
      />
    </>
  );
}
