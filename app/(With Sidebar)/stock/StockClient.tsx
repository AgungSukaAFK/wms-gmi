"use client";

import { useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  FileSpreadsheet,
  Pencil,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FilterX,
  LayoutGrid,
  MapPin,
  TrendingUp,
  List,
  SortAsc,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { useRouter, useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { updateStock } from "@/services/stock-actions";

interface StockRecord {
  id: number;
  part_id: number;
  cabang_id: number;
  qty: number;
  min_qty: number;
  max_qty: number;
  status: string;
  part_number: string;
  part_name: string;
  part_satuan: string;
  nama_cabang: string;
  kode_cabang: string;
}

interface Cabang {
  id: number;
  nama_cabang: string;
}

interface StockClientProps {
  initialData: StockRecord[];
  totalCount: number;
  cabangList: Cabang[];
  currentPage: number;
  pageSize: number;
  initialQuery: string;
  initialCabang: string;
  initialStatus: string;
  initialSort: string;
  initialView: "table" | "grid";
}

export default function StockClient({
  initialData,
  totalCount,
  cabangList,
  currentPage,
  pageSize,
  initialQuery,
  initialCabang,
  initialStatus,
  initialSort,
  initialView,
}: StockClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialQuery);
  const [debouncedSearch] = useDebounce(search, 500);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<StockRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter states
  const [selectedCabang, setSelectedCabang] = useState(initialCabang || "all");
  const [selectedStatus, setSelectedStatus] = useState(initialStatus || "all");

  // Pagination states
  const [jumpPage, setJumpPage] = useState(currentPage.toString());

  // Sync filters with URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (debouncedSearch) params.set("q", debouncedSearch);
    else params.delete("q");

    if (selectedCabang && selectedCabang !== "all") params.set("cabang", selectedCabang);
    else params.delete("cabang");

    if (selectedStatus && selectedStatus !== "all") params.set("status", selectedStatus);
    else params.delete("status");

    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  }, [debouncedSearch, selectedCabang, selectedStatus]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`/stock?${params.toString()}`);
    setJumpPage(newPage.toString());
  };

  const handleLimitChange = (newLimit: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", newLimit);
    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  };

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", newSort);
    params.set("page", "1");
    router.push(`/stock?${params.toString()}`);
  };

  const handleViewChange = (newView: "table" | "grid") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", newView);
    router.push(`/stock?${params.toString()}`);
  };

  const handleJumpPage = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(jumpPage);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      handlePageChange(p);
    } else {
      setJumpPage(currentPage.toString());
    }
  };

  const handleReset = () => {
    setSearch("");
    setSelectedCabang("all");
    setSelectedStatus("all");
    router.push("/stock");
  };

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingStock) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = {
      qty: parseInt(formData.get("qty") as string),
      min_qty: parseInt(formData.get("min_qty") as string),
      max_qty: parseInt(formData.get("max_qty") as string),
    };

    const result = await updateStock(editingStock.id, data);
    setIsSubmitting(false);

    if (result.success) {
      toast.success("Stok berhasil diperbarui");
      setIsEditModalOpen(false);
    } else {
      toast.error("Gagal memperbarui stok: " + result.error);
    }
  };

  const handleExport = () => {
    toast.info("Mengekspor data filter saat ini...");
    const ws = XLSX.utils.json_to_sheet(initialData.map((s, i) => ({
      No: (currentPage - 1) * pageSize + i + 1,
      "Part Number": s.part_number,
      "Nama Part": s.part_name,
      Satuan: s.part_satuan,
      Lokasi: s.nama_cabang,
      Qty: s.qty,
      Min: s.min_qty,
      Max: s.max_qty,
      Status: s.status.toUpperCase(),
    })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stok Monitoring");
    XLSX.writeFile(wb, `STOCK_REPORT_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const getStatusBadge = (stock: StockRecord) => {
    const base = "text-[9px] uppercase tracking-wider h-4 px-1.5 border-none font-black cursor-pointer hover:opacity-80 transition-opacity";
    const status = stock.status;
    
    let badge;
    switch (status) {
      case "low":
        badge = <Badge className={`${base} bg-destructive/5 text-destructive`}>Low</Badge>;
        break;
      case "overstock":
        badge = <Badge className={`${base} bg-amber-50 text-amber-600`}>Over</Badge>;
        break;
      case "normal":
        badge = <Badge className={`${base} bg-green-50 text-green-600`}>Safe</Badge>;
        break;
      case "unknown":
        badge = <Badge className={`${base} bg-slate-50 text-slate-400`}>Unset</Badge>;
        break;
      default:
        badge = <Badge variant="outline" className={base}>{status}</Badge>;
    }

    return (
      <div onClick={(e) => {
        e.stopPropagation();
        setEditingStock(stock);
        setIsEditModalOpen(true);
      }}>
        {badge}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters Panel */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-tight">Stock Monitoring</h2>
          </div>
          <div className="flex p-0.5 bg-slate-100 rounded-lg border border-slate-200">
            <Button 
                variant="ghost" 
                size="sm" 
                className={`h-7 px-3 text-xs ${initialView === "table" ? 'shadow-sm bg-white text-slate-900 font-bold' : 'text-slate-500'}`}
                onClick={() => handleViewChange("table")}
            >
                <List className="h-3.5 w-3.5 mr-1.5" /> Tabel
            </Button>
            <Button 
                variant="ghost" 
                size="sm"
                className={`h-7 px-3 text-xs ${initialView === "grid" ? 'shadow-sm bg-white text-slate-900 font-bold' : 'text-slate-500'}`}
                onClick={() => handleViewChange("grid")}
            >
                <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> Kartu
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Cari Barang</Label>
            <div className="relative group text-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                placeholder="PN / Nama..."
                className="pl-9 bg-slate-50 border-slate-200 h-9 text-sm focus-visible:ring-1 focus-visible:ring-primary/20"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          
          <div className="space-y-1">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Lokasi</Label>
            <Select value={selectedCabang} onValueChange={setSelectedCabang}>
              <SelectTrigger className="bg-slate-50 border-slate-200 h-9 text-xs">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="Semua Lokasi" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Lokasi</SelectItem>
                {cabangList.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Status</Label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="bg-slate-50 border-slate-200 h-9 text-xs">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="Semua Status" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kondisi</SelectItem>
                <SelectItem value="normal">Normal (Safe)</SelectItem>
                <SelectItem value="low">Low Stock</SelectItem>
                <SelectItem value="overstock">Overstock</SelectItem>
                <SelectItem value="unknown">Unset</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
               <Label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Urutan</Label>
               <Select value={initialSort} onValueChange={handleSortChange}>
                  <SelectTrigger className="bg-slate-50 border-slate-200 h-9 text-xs">
                    <div className="flex items-center gap-2">
                      <SortAsc className="h-3.5 w-3.5 text-slate-400" />
                      <SelectValue placeholder="Urutkan" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qty_asc">Stok Terkecil</SelectItem>
                    <SelectItem value="qty_desc">Stok Terbanyak</SelectItem>
                    <SelectItem value="name_asc">Nama (A-Z)</SelectItem>
                    <SelectItem value="name_desc">Nama (Z-A)</SelectItem>
                  </SelectContent>
                </Select>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} className="h-9 w-9 p-0 border-slate-200">
              <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset} className="h-9 w-9 p-0 text-slate-400 hover:text-red-500">
               <FilterX className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content View */}
      {initialView === "table" ? (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50px] text-center">No</TableHead>
                <TableHead className="w-[250px]">Informasi Suku Cadang</TableHead>
                <TableHead className="w-[180px]">Lokasi Cabang</TableHead>
                <TableHead className="text-center w-[90px]">Stock</TableHead>
                <TableHead className="text-center w-[110px] text-[10px] uppercase text-slate-400 font-black">Limit</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[60px] text-right pr-4">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialData.length > 0 ? (
                initialData.map((stock, index) => (
                  <TableRow key={stock.id} className="hover:bg-slate-50 transition-colors group">
                    <TableCell className="text-center text-muted-foreground text-xs font-medium">
                      {(currentPage - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <code className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1 py-0.5 rounded w-fit">
                          {stock.part_number}
                        </code>
                        <span className="font-bold text-slate-700 text-sm line-clamp-1">{stock.part_name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-600 text-[13px]">{stock.nama_cabang}</span>
                        <span className="text-[9px] text-slate-400 uppercase font-black tracking-tight">{stock.kode_cabang}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`text-lg font-black ${
                        stock.status === 'low' ? 'text-destructive' : 
                        stock.status === 'overstock' ? 'text-amber-500' : 'text-slate-900'
                      }`}>
                        {stock.qty}
                      </span>
                    </TableCell>
                    <TableCell className="text-center font-mono text-[11px] text-slate-400 font-bold">
                       {stock.min_qty} / {stock.max_qty}
                    </TableCell>
                    <TableCell>
                        {getStatusBadge(stock)}
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 hover:bg-primary/5 hover:text-primary transition-all rounded-full"
                        onClick={() => {
                          setEditingStock(stock);
                          setIsEditModalOpen(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                    <Package className="h-10 w-10 mx-auto mb-2 opacity-5 italic" />
                    Belum ada data lokasi.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
           {initialData.length > 0 ? (
              initialData.map((stock) => (
                <div 
                  key={stock.id} 
                  className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative overflow-hidden"
                  onClick={() => {
                    setEditingStock(stock);
                    setIsEditModalOpen(true);
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                     <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{stock.kode_cabang}</span>
                     <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-bold">
                        {stock.part_satuan}
                     </div>
                  </div>

                  <code className="text-[9px] font-mono text-primary/60 mb-1 block">{stock.part_number}</code>
                  <h3 className="font-bold text-slate-700 line-clamp-2 h-8 mb-2 text-[11px] leading-tight group-hover:text-primary transition-colors">
                    {stock.part_name}
                  </h3>

                  <div className="flex items-end justify-between mt-auto pt-2 border-t border-slate-50">
                     <div className="flex flex-col">
                        <div className={`text-2xl font-black leading-none ${
                          stock.status === 'low' ? 'text-destructive' : 
                          stock.status === 'overstock' ? 'text-amber-500' : 'text-slate-900'
                        }`}>
                            {stock.qty}
                        </div>
                     </div>
                     <div className="flex flex-col items-end gap-1">
                        {getStatusBadge(stock)}
                        <div className="text-[8px] font-black text-slate-300">
                            M: {stock.min_qty}
                        </div>
                     </div>
                  </div>
                </div>
              ))
           ) : (
                <div className="col-span-full bg-white rounded-xl border border-slate-200 p-16 text-center text-muted-foreground italic text-sm">
                    Data tidak ditemukan.
                </div>
           )}
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-3 rounded-xl border shadow-sm">
        <p className="text-xs text-muted-foreground whitespace-nowrap font-medium">
          Ditemukan <span className="font-bold text-slate-900">{totalCount} Item</span>
        </p>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 pr-3 border-r border-slate-100">
            <span className="text-[10px] uppercase font-black text-slate-300">ROWS:</span>
            <Select value={pageSize.toString()} onValueChange={handleLimitChange}>
              <SelectTrigger className="h-7 w-[60px] bg-slate-50 border-slate-200 text-xs font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <form onSubmit={handleJumpPage} className="flex items-center gap-1.5 focus-within:opacity-100 transition-opacity">
            <Input 
              className="h-7 w-12 text-center bg-slate-50 border-slate-200 text-xs font-bold"
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
            />
            <span className="text-[10px] uppercase font-black text-slate-300">/ {totalPages}</span>
          </form>

          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ml-2 transition-all">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 hover:bg-white transition-colors"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 border-l border-slate-200 hover:bg-white transition-colors"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Configuration Modal (Refined) */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-[400px] rounded-2xl p-6 shadow-2xl border-slate-100 translate-x-[-50%] translate-y-[-50%]">
          <form onSubmit={handleEditSubmit}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold tracking-tight">Konfigurasi Inventori</DialogTitle>
              <DialogDescription className="space-y-1">
                <div className="font-bold text-primary text-sm mt-1">{editingStock?.part_name}</div>
                <div className="text-[10px] uppercase font-black text-slate-400 tracking-widest flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> {editingStock?.nama_cabang}
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="p-4 bg-slate-50 rounded-xl flex flex-col items-center">
                <Label htmlFor="qty" className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Stok Fisik</Label>
                <Input
                  id="qty"
                  name="qty"
                  type="number"
                  min="0"
                  defaultValue={editingStock?.qty}
                  className="text-4xl font-black h-16 bg-transparent border-none text-center focus-visible:ring-0 focus-visible:ring-offset-0"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="min_qty" className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Limit Minimum</Label>
                  <Input
                    id="min_qty"
                    name="min_qty"
                    type="number"
                    min="0"
                    defaultValue={editingStock?.min_qty}
                    className="bg-white border-slate-200 font-bold h-10 shadow-sm"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max_qty" className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Limit Maksimum</Label>
                  <Input
                    id="max_qty"
                    name="max_qty"
                    type="number"
                    min="0"
                    defaultValue={editingStock?.max_qty}
                    className="bg-white border-slate-200 font-bold h-10 shadow-sm"
                    required
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="mt-8 flex gap-3">
              <Button type="button" variant="ghost" className="flex-1 font-bold text-slate-400 rounded-xl" onClick={() => setIsEditModalOpen(false)}>Kembali</Button>
              <Button type="submit" disabled={isSubmitting} className="flex-1 bg-primary font-bold rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-95">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Perubahan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
