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

export default function MaterialRequestPage() {
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
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [availableCabang, setAvailableCabang] = useState<any[]>([]);

  // Selected MR for Detail
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*, roles:user_roles(roles(name))")
        .eq("id", user.id)
        .single();
      
      if (profile) {
        setUserProfile({
          ...profile,
          isAdmin: (profile.roles as any[]).some(r => r.roles.name === "admin"),
          isModerator: (profile.roles as any[]).some(r => r.roles.name === "moderator"),
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
      query = query.or(`mr_kode.ilike.%${debouncedSearch}%,mr_pic.ilike.%${debouncedSearch}%`);
    }

    if (statusFilter !== "all") {
      query = query.eq("mr_status", statusFilter);
    }

    if (priorityFilter !== "all") {
      query = query.eq("mr_priority", priorityFilter);
    }

    if (locationFilter !== "all") {
      query = query.eq("cabang_id", locationFilter);
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
  }, [debouncedSearch, statusFilter, priorityFilter, locationFilter, dateFrom, dateTo, page, limit]);

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setLocationFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const setMyLocationFilter = () => {
    if (userProfile?.cabang_id) {
      setLocationFilter(userProfile.cabang_id.toString());
      setPage(1);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-100 font-semibold text-[10px] uppercase">Open</Badge>;
      case "approved":
        return <Badge className="bg-green-600 text-white font-semibold text-[10px] uppercase">Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="font-semibold text-[10px] uppercase">Rejected</Badge>;
      case "done":
        return <Badge className="bg-slate-900 text-white font-semibold text-[10px] uppercase">Done</Badge>;
      case "closed":
        return <Badge variant="secondary" className="font-semibold text-[10px] uppercase">Closed</Badge>;
      default:
        return <Badge variant="outline" className="font-semibold text-[10px] uppercase">{status}</Badge>;
    }
  };

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "P1": return <Badge className="bg-red-600 text-white text-[9px] font-bold px-1.5 h-4 min-w-[32px] justify-center">P1</Badge>;
      case "P2": return <Badge className="bg-orange-500 text-white text-[9px] font-bold px-1.5 h-4 min-w-[32px] justify-center">P2</Badge>;
      case "P3": return <Badge variant="secondary" className="text-blue-600 bg-blue-100 border-none text-[9px] font-bold px-1.5 h-4 min-w-[32px] justify-center">P3</Badge>;
      case "P4": return <Badge variant="secondary" className="text-slate-400 bg-slate-100 border-none text-[9px] font-bold px-1.5 h-4 min-w-[32px] justify-center">P4</Badge>;
      default: return null;
    }
  };

  const getNextApprover = (mr: any) => {
    if (mr.mr_status !== "open") return null;
    const nextStep = mr.approvals?.find((a: any) => a.status === "pending");
    return nextStep ? nextStep.nama : null;
  };

  const handleRowClick = (id: number) => {
    setSelectedMrId(id);
    setDetailOpen(true);
  };

  return (
    <Content className="bg-slate-50 min-screen">
      <div className="max-w-7xl mx-auto py-6 px-4 space-y-4">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-slate-900 rounded flex items-center justify-center shadow-sm text-white">
               <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">MATERIAL REQUEST</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">
                Manajemen Permintaan Barang Internal
              </p>
            </div>
          </div>
          
          {(userProfile?.isAdmin || userProfile?.isModerator) && (
            <Link href="/mr/create">
              <Button className="shrink-0 gap-2 bg-blue-600 hover:bg-blue-700 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase text-white transition-all">
                <Plus className="h-4 w-4" /> BUAT MR BARU
              </Button>
            </Link>
          )}
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm space-y-3">
          <div className="flex flex-col lg:flex-row gap-3">
             <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Cari Kode MR atau PIC..."
                  className="pl-9 h-9 border-slate-200 bg-slate-50/50 focus:bg-white transition-all rounded-md text-xs font-medium text-slate-900"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                />
             </div>

             <div className="flex flex-wrap items-center gap-2">
                <Select value={locationFilter} onValueChange={(val) => { setLocationFilter(val); setPage(1); }}>
                  <SelectTrigger className="w-[160px] h-9 border-slate-200 bg-white rounded-md text-xs font-semibold text-slate-900">
                    <div className="flex items-center gap-2">
                       <MapPin className="h-3 w-3 text-slate-400" />
                       <SelectValue placeholder="Semua Lokasi" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="all">Semua Lokasi</SelectItem>
                    {availableCabang.map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.nama_cabang}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={priorityFilter} onValueChange={(val) => { setPriorityFilter(val); setPage(1); }}>
                  <SelectTrigger className="w-[120px] h-9 border-slate-200 bg-white rounded-md text-xs font-bold text-slate-900">
                    <div className="flex items-center gap-2">
                       <AlertTriangle className="h-3 w-3 text-slate-400" />
                       <SelectValue placeholder="Prioritas" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="all">Semua Prioritas</SelectItem>
                    <SelectItem value="P1">P1 - EMERGENCY</SelectItem>
                    <SelectItem value="P2">P2 - HIGH</SelectItem>
                    <SelectItem value="P3">P3 - NORMAL</SelectItem>
                    <SelectItem value="P4">P4 - LOW</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val); setPage(1); }}>
                  <SelectTrigger className="w-[130px] h-9 border-slate-200 bg-white rounded-md text-xs font-bold text-slate-900">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="open">Open (Pending)</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="done">Done / Receipt</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>

                <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />

                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md px-2 py-0.5">
                   <CalendarIcon className="h-3 w-3 text-slate-400" />
                   <Input 
                    type="date"
                    className="h-7 w-[120px] p-0 border-0 bg-transparent text-[10px] font-semibold focus-visible:ring-0 text-slate-900"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                   />
                   <span className="text-[10px] text-slate-400 font-bold">-</span>
                   <Input 
                    type="date"
                    className="h-7 w-[120px] p-0 border-0 bg-transparent text-[10px] font-semibold focus-visible:ring-0 text-slate-900"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                   />
                </div>

                <Button 
                   variant="ghost" 
                   size="sm" 
                   className="h-9 px-3 text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1.5 uppercase"
                   onClick={setMyLocationFilter}
                   disabled={!userProfile?.cabang_id}
                >
                   <Navigation2 className="h-3 w-3" />
                   LOKASI SAYA
                </Button>

                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-9 px-2 text-slate-400 hover:text-red-500 gap-1 transition-colors"
                  onClick={resetFilters}
                >
                  <FilterX className="h-3.5 w-3.5" />
                </Button>
             </div>
          </div>
        </div>

        {/* Table Container */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="flex-1 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50 border-b border-slate-100">
                <TableRow className="hover:bg-transparent h-10 text-slate-900">
                  <TableHead className="w-[50px] text-center font-bold text-[10px] uppercase text-slate-500">No</TableHead>
                  <TableHead className="w-[60px] text-center font-bold text-[10px] uppercase text-slate-500">Urgency</TableHead>
                  <TableHead className="w-[180px] font-bold text-[10px] uppercase text-slate-500">Kode MR</TableHead>
                  <TableHead className="font-bold text-[10px] uppercase text-slate-500">PIC & Lokasi</TableHead>
                  <TableHead className="w-[130px] font-bold text-[10px] uppercase text-slate-500 text-center">Tanggal</TableHead>
                  <TableHead className="w-[170px] font-bold text-[10px] uppercase text-slate-500 text-center">Status</TableHead>
                  <TableHead className="text-right w-[80px] pr-6 font-bold text-[10px] uppercase text-slate-500">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                     <TableCell colSpan={7} className="h-40 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                           <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                           <span className="text-[10px] font-bold text-slate-400 uppercase">Memuat Data...</span>
                        </div>
                     </TableCell>
                  </TableRow>
                ) : mrs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-40 text-center text-slate-400 italic text-sm">
                      {statusFilter !== 'all' || locationFilter !== 'all' || dateFrom || dateTo ? 'Tidak ada data yang sesuai filter.' : 'Tidak ada permintaan barang yang ditemukan.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  mrs.map((mr, index) => {
                    const nextApprover = getNextApprover(mr);
                    
                    return (
                      <TableRow 
                        key={mr.id} 
                        className="hover:bg-slate-50/50 transition-colors group border-b border-slate-50 last:border-0 h-16 cursor-pointer"
                        onClick={() => handleRowClick(mr.id)}
                      >
                        <TableCell className="text-center text-slate-400 text-[10px] font-semibold font-mono">
                          {(page - 1) * limit + index + 1}
                        </TableCell>
                        <TableCell className="text-center">
                           {getPriorityBadge(mr.mr_priority)}
                        </TableCell>
                        <TableCell>
                           <span className="font-bold text-slate-900 text-sm group-hover:text-blue-600 transition-colors">
                             {mr.mr_kode}
                           </span>
                        </TableCell>
                        <TableCell>
                           <div className="flex flex-col py-1">
                              <div className="flex items-center gap-2">
                                 <span className="font-bold text-xs text-slate-800 uppercase tracking-tight">{mr.mr_pic}</span>
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                 <MapPin className="h-2.5 w-2.5 text-slate-300" />
                                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                                   {mr.cabang?.nama_cabang || "Unknown Site"}
                                 </span>
                              </div>
                           </div>
                        </TableCell>
                        <TableCell className="text-center">
                           <div className="flex flex-col items-center gap-0.5">
                              <div className="flex items-center gap-1 text-xs font-bold text-slate-700">
                                 <CalendarIcon className="h-3 w-3 text-slate-300" />
                                 {new Date(mr.mr_tanggal).toLocaleDateString("id-ID", { day: 'numeric', month: 'short', year: 'numeric' })}
                              </div>
                              <div className="flex items-center gap-1 opacity-60">
                                 <span className="text-[8px] text-red-500 font-bold uppercase">DUE:</span>
                                 <span className="text-[8px] text-slate-500 font-bold">{new Date(mr.mr_due_date).toLocaleDateString("id-ID", { day: 'numeric', month: 'short' })}</span>
                              </div>
                           </div>
                        </TableCell>
                        <TableCell className="text-center">
                           <div className="flex flex-col items-center gap-1.5">
                              {getStatusBadge(mr.mr_status)}
                              {nextApprover && (
                                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                   <Clock className="h-2.5 w-2.5" />
                                   Menunggu: <span className="text-slate-900">{nextApprover}</span>
                                </div>
                              )}
                           </div>
                        </TableCell>
                        <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all shadow-none"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50/20">
            <DataTablePagination
              totalCount={totalCount}
              pageSize={limit}
              currentPage={page}
              onPageChange={setPage}
              onPageSizeChange={(val) => { setLimit(parseInt(val)); setPage(1); }}
              itemLabel="Material Request"
            />
          </div>
        </div>
      </div>

      <MRDetailSheet 
        mrId={selectedMrId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </Content>
  );
}
