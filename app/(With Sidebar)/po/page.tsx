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
  ShoppingCart,
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
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { PODetailSheet } from "@/components/po/po-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { completedFilterStatuses } from "@/lib/document-status";
import { MultiSelect } from "@/components/ui/multi-select";

export default function POListPage() {
  const supabase = createClient();
  const [pos, setPos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [receiveStatusFilters, setReceiveStatusFilters] = useState<string[]>(
    [],
  );
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<string>("newest");

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

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
        prs!inner(
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

    if (locationFilters.length > 0) {
      query = query.in("prs.cabang_id", locationFilters);
    }

    if (dateFrom) query = query.gte("po_tanggal", dateFrom);
    if (dateTo) query = query.lte("po_tanggal", dateTo);

    return query;
  };

  const fetchPOs = async () => {
    setLoading(true);

    const sortField =
      sortOrder === "tanggal_desc" || sortOrder === "tanggal_asc"
        ? "po_tanggal"
        : "created_at";
    const ascending = sortOrder === "oldest" || sortOrder === "tanggal_asc";

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
            Array.from(new Set(prCodesByPo.get(po.id) || [])).join(", ") ||
            po.prs?.pr_kode ||
            "-",
          VENDOR: vendorNames.join(", ") || "-",
          PIC: po.po_pic || "-",
          TANGGAL: po.po_tanggal
            ? new Date(po.po_tanggal).toLocaleDateString("id-ID")
            : "-",
          ESTIMASI: po.po_estimasi
            ? new Date(po.po_estimasi).toLocaleDateString("id-ID")
            : "-",
          STATUS: po.po_status || "-",
          "RECEIVE STATUS": po.po_receive_status || "-",
        };
      });

      const ws = XLSX.utils.json_to_sheet(sheetData);
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
    fetchPOs();
  }, [
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

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilters([]);
    setReceiveStatusFilters([]);
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
    setSelectedPoId(id);
    setSheetOpen(true);
  };

  const hasActiveFilters =
    statusFilters.length > 0 ||
    receiveStatusFilters.length > 0 ||
    locationFilters.length > 0 ||
    dateFrom !== "" ||
    dateTo !== "" ||
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
            className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30 font-semibold text-[10px] uppercase"
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Cari Kode PO..."
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
              className="w-full sm:w-42"
              placeholder="Status Approval"
              selected={statusFilters}
              onChange={(vals) => {
                setStatusFilters(vals);
                setPage(1);
              }}
              options={[
                { label: "Pending Approval", value: "open" },
                { label: "Approved", value: "approved" },
                { label: "Rejected", value: "rejected" },
                { label: "Completed", value: "completed" },
              ]}
            />

            <MultiSelect
              className="w-full sm:w-40"
              placeholder="Status Terima"
              icon={<Package className="h-3 w-3 text-muted-foreground" />}
              selected={receiveStatusFilters}
              onChange={(vals) => {
                setReceiveStatusFilters(vals);
                setPage(1);
              }}
              options={[
                { label: "Menunggu", value: "pending" },
                { label: "Partial", value: "partial" },
                { label: "Selesai", value: "complete" },
              ]}
            />

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
                <TableHead className="w-52 text-[10px] font-black uppercase text-muted-foreground">
                  Purchase Order ID
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Sumber PR / Lokasi
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Vendor(s)
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Approval
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Penerimaan
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
                            <span className="font-bold text-foreground tracking-tight uppercase text-sm">
                              {po.po_kode}
                            </span>
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
                            {pr?.cabang?.nama_cabang || "-"}
                          </div>
                          {pr?.pr_kode && (
                            <div className="text-[9px] text-muted-foreground font-mono">
                              ↑ {pr.pr_kode}
                            </div>
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
                        {getApprovalStatusBadge(po.po_status)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getReceiveStatusBadge(po.po_receive_status)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-2 text-xs font-bold text-foreground uppercase tracking-tighter">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground/40" />
                          {new Date(po.po_tanggal).toLocaleDateString("id-ID", {
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
