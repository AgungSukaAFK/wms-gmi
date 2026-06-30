"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { canCreateMR } from "@/lib/mr-permissions";
import { MultiSelect } from "@/components/ui/multi-select";
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
  Plus,
  Search,
  FileText,
  Loader2,
  Calendar as CalendarIcon,
  MapPin,
  ClipboardList,
  FilterX,
  Navigation2,
  Clock,
  AlertTriangle,
  Trash2,
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
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { MRDetailSheet } from "@/components/mr/mr-detail-sheet";
import { DatePickerString } from "@/components/date-picker-string";
import { completedFilterStatuses } from "@/lib/document-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteMR } from "@/services/procurement-actions";
import { toast } from "sonner";

export default function MaterialRequestPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [mrs, setMrs] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);

  // Pagination & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [priorityFilters, setPriorityFilters] = useState<string[]>([]);
  const [accurateFilter, setAccurateFilter] = useState<string>("all");
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

  const fetchData = async () => {
    setLoading(true);
    let query = supabase
      .from("mrs")
      .select("*, cabang(nama_cabang)", { count: "exact" });

    if (debouncedSearch) {
      query = query.or(
        `mr_kode.ilike.%${debouncedSearch}%,mr_pic.ilike.%${debouncedSearch}%`,
      );
    }

    if (statusFilters.length > 0) {
      // "completed" adalah status virtual yang diekspansi ke beberapa status nyata.
      const expanded = statusFilters.flatMap((s) =>
        s === "completed" ? completedFilterStatuses() : [s],
      );
      query = query.in("mr_status", Array.from(new Set(expanded)));
    }

    if (priorityFilters.length > 0) {
      query = query.in("mr_priority", priorityFilters);
    }

    if (accurateFilter !== "all") {
      query = query.eq("accurate", accurateFilter === "yes");
    }

    if (locationFilters.length > 0) {
      query = query.in("cabang_id", locationFilters);
    }

    if (dateFrom) {
      query = query.gte("mr_tanggal", dateFrom);
    }
    if (dateTo) {
      query = query.lte("mr_tanggal", dateTo);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("Error fetching MRS:", error);
    } else {
      setMrs(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUser();
  }, []);

  useEffect(() => {
    fetchData();
  }, [
    debouncedSearch,
    statusFilters,
    priorityFilters,
    accurateFilter,
    locationFilters,
    dateFrom,
    dateTo,
    page,
    limit,
  ]);

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilters([]);
    setPriorityFilters([]);
    setAccurateFilter("all");
    setLocationFilters([]);
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const setMyLocationFilter = () => {
    if (userProfile?.cabang_id) {
      setLocationFilters([userProfile.cabang_id.toString()]);
      setPage(1);
    }
  };

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
            variant="outline"
            className="font-semibold text-[10px] uppercase"
          >
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
            className="text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center"
          >
            P1
          </Badge>
        );
      case "P2":
        return (
          <Badge className="bg-warning text-warning-foreground text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center">
            P2
          </Badge>
        );
      case "P3":
        return (
          <Badge
            variant="outline"
            className="text-primary border-primary/30 bg-primary/10 text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center"
          >
            P3
          </Badge>
        );
      case "P4":
        return (
          <Badge
            variant="secondary"
            className="text-muted-foreground text-[9px] font-bold px-1.5 h-4 min-w-8 justify-center"
          >
            P4
          </Badge>
        );
      default:
        return null;
    }
  };

  const getNextApprover = (mr: any) => {
    if (mr.mr_status !== "open") return null;
    const nextStep = mr.approvals?.find((a: any) => a.status === "pending");
    return nextStep ? nextStep.nama : null;
  };

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mrToDelete, setMrToDelete] = useState<{ id: number; kode: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleRowClick = (id: number) => {
    setSelectedMrId(id);
    setDetailOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, mr: any) => {
    e.stopPropagation();
    setMrToDelete({ id: mr.id, kode: mr.mr_kode });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!mrToDelete) return;
    setDeleting(true);
    const res = await deleteMR(mrToDelete.id);
    setDeleting(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`MR ${mrToDelete.kode} berhasil dihapus.`);
    setDeleteDialogOpen(false);
    setMrToDelete(null);
    fetchData();
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                MATERIAL REQUEST
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Manajemen Permintaan Barang Internal
              </p>
            </div>
          </div>

          {canCreateMR(
            (userProfile?.roles as any[])?.map((r: any) => r.roles?.name),
          ) && (
            <Link href="/mr/create">
              <Button className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase transition-all">
                <Plus className="h-4 w-4" /> BUAT MR BARU
              </Button>
            </Link>
          )}
        </div>
      </Content>

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

            <MultiSelect
              className="w-full sm:w-42.5"
              placeholder="Semua Prioritas"
              icon={<AlertTriangle className="h-3 w-3 text-muted-foreground" />}
              selected={priorityFilters}
              onChange={(vals) => {
                setPriorityFilters(vals);
                setPage(1);
              }}
              options={[
                { label: "P1 - EMERGENCY", value: "P1" },
                { label: "P2 - HIGH", value: "P2" },
                { label: "P3 - NORMAL", value: "P3" },
                { label: "P4 - LOW", value: "P4" },
              ]}
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
                { label: "Open (Pending)", value: "open" },
                { label: "Approved", value: "approved" },
                { label: "Rejected", value: "rejected" },
                { label: "Completed", value: "completed" },
              ]}
            />

            {/* ACCURATE_HIDDEN: filter disembunyikan */}
            {false && (
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
            )}

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

      <Content className="overflow-hidden">
        <div className="flex-1 overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent h-10 text-foreground">
                <TableHead className="w-12.5 text-center font-bold text-[10px] uppercase text-muted-foreground">
                  No
                </TableHead>
                <TableHead className="w-15 text-center font-bold text-[10px] uppercase text-muted-foreground">
                  Urgency
                </TableHead>
                <TableHead className="w-45 font-bold text-[10px] uppercase text-muted-foreground">
                  Kode MR
                </TableHead>
                <TableHead className="font-bold text-[10px] uppercase text-muted-foreground">
                  PIC & Lokasi
                </TableHead>
                <TableHead className="w-32.5 font-bold text-[10px] uppercase text-muted-foreground text-center">
                  Tanggal
                </TableHead>
                <TableHead
                  style={{ width: 170 }}
                  className="font-bold text-[10px] uppercase text-muted-foreground text-center"
                >
                  Status
                </TableHead>
                {/* ACCURATE_HIDDEN */}
                {false && (
                  <TableHead className="w-32.5 font-bold text-[10px] uppercase text-muted-foreground text-center">
                    Accurate
                  </TableHead>
                )}
                <TableHead className="text-right w-24 pr-4 font-bold text-[10px] uppercase text-muted-foreground">
                  Aksi
                </TableHead>
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
              ) : mrs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-40 text-center text-muted-foreground italic text-sm"
                  >
                    {statusFilters.length > 0 ||
                    accurateFilter !== "all" ||
                    locationFilters.length > 0 ||
                    dateFrom ||
                    dateTo
                      ? "Tidak ada data yang sesuai filter."
                      : "Tidak ada permintaan barang yang ditemukan."}
                  </TableCell>
                </TableRow>
              ) : (
                mrs.map((mr, index) => {
                  const nextApprover = getNextApprover(mr);

                  return (
                    <TableRow
                      key={mr.id}
                      className="hover:bg-muted/40 transition-colors group border-b border-border/40 last:border-0 h-16 cursor-pointer"
                      onClick={() => handleRowClick(mr.id)}
                    >
                      <TableCell className="text-center text-muted-foreground text-[10px] font-semibold font-mono">
                        {(page - 1) * limit + index + 1}
                      </TableCell>
                      <TableCell className="text-center">
                        {getPriorityBadge(mr.mr_priority)}
                      </TableCell>
                      <TableCell>
                        <span className="font-bold text-foreground text-sm group-hover:text-primary transition-colors">
                          {mr.mr_kode}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col py-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-foreground uppercase tracking-tight">
                              {mr.mr_pic}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">
                              {mr.cabang?.nama_cabang || "Unknown Site"}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="flex items-center gap-1 text-xs font-bold text-foreground">
                            <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                            {new Date(mr.mr_tanggal).toLocaleDateString(
                              "id-ID",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              },
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-60">
                            <span className="text-[8px] text-destructive font-bold uppercase">
                              DUE:
                            </span>
                            <span className="text-[8px] text-muted-foreground font-bold">
                              {new Date(mr.mr_due_date).toLocaleDateString(
                                "id-ID",
                                { day: "numeric", month: "short" },
                              )}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          {getStatusBadge(mr.mr_status)}
                          {mr.is_frozen && (
                            <Badge className="bg-sky-500 text-white border-none text-[9px] font-bold uppercase">
                              Frozen
                            </Badge>
                          )}
                          {nextApprover && (
                            <div className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground uppercase tracking-tighter">
                              <Clock className="h-2.5 w-2.5" />
                              Menunggu:{" "}
                              <span className="text-foreground">
                                {nextApprover}
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      {/* ACCURATE_HIDDEN */}
                      {false && (
                        <TableCell className="text-center">
                          <Badge
                            variant={mr.accurate ? "default" : "secondary"}
                            className="text-[10px] font-bold uppercase"
                          >
                            {mr.accurate ? "Sudah" : "Belum"}
                          </Badge>
                        </TableCell>
                      )}
                      <TableCell
                        className="text-right pr-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-all shadow-none"
                            onClick={() => handleRowClick(mr.id)}
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                          {userProfile?.isModerator && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-all shadow-none"
                              onClick={(e) => handleDeleteClick(e, mr)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
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
            itemLabel="Material Request"
          />
        </div>
      </Content>

      <MRDetailSheet
        mrId={selectedMrId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Material Request?</AlertDialogTitle>
            <AlertDialogDescription>
              MR <span className="font-bold text-foreground">{mrToDelete?.kode}</span> akan dihapus permanen.
              Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Ya, Hapus"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
