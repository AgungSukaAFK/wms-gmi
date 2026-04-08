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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  MoreHorizontal,
  Plus,
  Search,
  FileSpreadsheet,
  Pencil,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Package,
  ArrowRight,
  FilterX,
  LayoutGrid,
  List,
  SortAsc,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { useRouter, useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { createBarang, updateBarang, deleteBarang, getBarangStockDetails } from "@/services/barang-actions";
import { updateStock } from "@/services/stock-actions";

interface Barang {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
  created_at: string;
}

interface StockDetail {
  id: number;
  nama_cabang: string;
  qty: number;
  min_qty: number;
  max_qty: number;
  status: string;
}

interface BarangClientProps {
  initialData: Barang[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  initialQuery: string;
  initialSort: string;
  initialView: "table" | "grid";
}

export default function BarangClient({
  initialData,
  totalCount,
  currentPage,
  pageSize,
  initialQuery,
  initialSort,
  initialView,
}: BarangClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Search & Filters
  const [search, setSearch] = useState(initialQuery);
  const [debouncedSearch] = useDebounce(search, 500);

  // Modals & States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingBarang, setEditingBarang] = useState<Barang | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stock Edit Modal (for Drawer use)
  const [isStockEditOpen, setIsStockEditOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<StockDetail | null>(null);

  // Sheet (Stock Details)
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedBarang, setSelectedBarang] = useState<Barang | null>(null);
  const [stockDetails, setStockDetails] = useState<StockDetail[]>([]);
  const [isLoadingStock, setIsLoadingStock] = useState(false);

  // Pagination states
  const [jumpPage, setJumpPage] = useState(currentPage.toString());

  // Sync Search with URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedSearch) params.set("q", debouncedSearch);
    else params.delete("q");
    params.set("page", "1");
    router.push(`/barang?${params.toString()}`);
  }, [debouncedSearch]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`/barang?${params.toString()}`);
    setJumpPage(newPage.toString());
  };

  const handleLimitChange = (newLimit: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", newLimit);
    params.set("page", "1");
    router.push(`/barang?${params.toString()}`);
  };

  const handleSortChange = (newSort: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", newSort);
    params.set("page", "1");
    router.push(`/barang?${params.toString()}`);
  };

  const handleViewChange = (newView: "table" | "grid") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", newView);
    router.push(`/barang?${params.toString()}`);
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
    router.push("/barang");
  };

  const handleRowClick = async (barang: Barang) => {
    setSelectedBarang(barang);
    setIsSheetOpen(true);
    setIsLoadingStock(true);
    const details = await getBarangStockDetails(barang.id);
    setStockDetails(details);
    setIsLoadingStock(false);
  };

  const handleStockUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
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
      setIsStockEditOpen(false);
      // Refresh drawer data
      if (selectedBarang) {
        const details = await getBarangStockDetails(selectedBarang.id);
        setStockDetails(details);
      }
    } else {
      toast.error("Gagal memperbarui stok: " + result.error);
    }
  };

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = {
      part_number: (formData.get("part_number") as string).trim(),
      part_name: (formData.get("part_name") as string).trim(),
      part_satuan: (formData.get("part_satuan") as string).trim(),
    };

    const result = await createBarang(data);
    setIsSubmitting(false);

    if (result.success) {
      toast.success("Barang berhasil ditambahkan");
      setIsAddModalOpen(false);
    } else {
      toast.error("Gagal menambahkan barang: " + result.error);
    }
  };

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingBarang) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data = {
      part_number: (formData.get("part_number") as string).trim(),
      part_name: (formData.get("part_name") as string).trim(),
      part_satuan: (formData.get("part_satuan") as string).trim(),
    };

    const result = await updateBarang(editingBarang.id, data);
    setIsSubmitting(false);

    if (result.success) {
      toast.success("Barang berhasil diperbarui");
      setIsEditModalOpen(false);
    } else {
      toast.error("Gagal memperbarui barang: " + result.error);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Hapus barang ${name}?`)) return;
    const result = await deleteBarang(id);
    if (result.success) {
      toast.success("Barang berhasil dihapus");
    } else {
      toast.error(result.error);
    }
  };

  const handleExport = () => {
    toast.info("Mengekspor halaman saat ini...");
    const ws = XLSX.utils.json_to_sheet(initialData.map((b, i) => ({
      No: (currentPage - 1) * pageSize + i + 1,
      "Part Number": b.part_number,
      "Nama Part": b.part_name,
      Satuan: b.part_satuan,
      "Tanggal Input": new Date(b.created_at).toLocaleDateString("id-ID"),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Barang");
    XLSX.writeFile(wb, `MASTER_BARANG_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-col gap-4 bg-white p-4 rounded-xl border shadow-sm">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
          <div className="relative w-full md:w-80 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="Cari Barang..."
              className="pl-9 bg-slate-50 border-slate-200 h-9 text-sm focus-visible:ring-1 focus-visible:ring-primary/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <Button variant="outline" size="sm" onClick={handleExport} className="flex-1 md:flex-none border-slate-200 hover:bg-slate-50">
              <FileSpreadsheet className="mr-2 h-3.5 w-3.5 text-green-600" />
              Export
            </Button>
            <Button size="sm" onClick={() => setIsAddModalOpen(true)} className="flex-1 md:flex-none bg-primary hover:bg-primary/90 shadow-sm">
              <Plus className="mr-2 h-3.5 w-3.5" />
              Barang Baru
            </Button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-3 border-t border-slate-100">
           <div className="flex items-center gap-4">
              <div className="flex p-0.5 bg-slate-100 rounded-md border border-slate-200">
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

              <div className="flex items-center gap-2">
                <SortAsc className="h-3.5 w-3.5 text-slate-400" />
                <Select value={initialSort} onValueChange={handleSortChange}>
                  <SelectTrigger className="h-8 w-[140px] bg-slate-50 border-slate-200 text-xs">
                    <SelectValue placeholder="Urutkan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name_asc">Nama (A-Z)</SelectItem>
                    <SelectItem value="name_desc">Nama (Z-A)</SelectItem>
                    <SelectItem value="latest">Terbaru</SelectItem>
                  </SelectContent>
                </Select>
              </div>
           </div>

           <Button variant="ghost" size="sm" onClick={handleReset} className="h-7 text-xs text-slate-400 hover:text-destructive">
              <FilterX className="h-3.5 w-3.5 mr-1" /> Reset
           </Button>
        </div>
      </div>

      {/* Content View */}
      {initialView === "table" ? (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50px] text-center">No</TableHead>
                <TableHead className="w-[180px]">Part Number</TableHead>
                <TableHead>Nama Suku Cadang</TableHead>
                <TableHead className="w-[100px]">Satuan</TableHead>
                <TableHead className="w-[80px] text-right pr-6">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialData.length > 0 ? (
                initialData.map((barang, index) => (
                  <TableRow 
                    key={barang.id} 
                    className="group cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => handleRowClick(barang)}
                  >
                    <TableCell className="text-center text-muted-foreground text-xs font-medium">
                      {(currentPage - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell>
                      <code className="text-[11px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                        {barang.part_number}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-700 text-sm group-hover:text-primary transition-colors line-clamp-1">
                        {barang.part_name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-500 uppercase font-semibold">{barang.part_satuan}</span>
                    </TableCell>
                    <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-7 w-7 p-0 hover:bg-slate-100 rounded-full">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 p-1.5 rounded-lg border-slate-200">
                          <DropdownMenuItem onClick={() => {
                            setEditingBarang(barang);
                            setIsEditModalOpen(true);
                          }} className="text-xs rounded-md">
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-xs text-destructive focus:text-destructive rounded-md"
                            onClick={() => handleDelete(barang.id, barang.part_name)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Hapus
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground text-sm">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-10" />
                    Belum ada data barang.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {initialData.length > 0 ? (
            initialData.map((barang) => (
              <div 
                key={barang.id} 
                className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-primary/40 relative overflow-hidden"
                onClick={() => handleRowClick(barang)}
              >
                <div className="flex justify-between items-start mb-2">
                   <div className="bg-primary/5 p-1.5 rounded-lg group-hover:bg-primary/10 transition-colors">
                      <Package className="h-3.5 w-3.5 text-primary/60" />
                   </div>
                   <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 w-6 p-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" 
                      onClick={(e) => {
                        e.stopPropagation();
                         setEditingBarang(barang);
                         setIsEditModalOpen(true);
                      }}
                   >
                     <Pencil className="h-3 w-3" />
                   </Button>
                </div>
                <div className="space-y-1">
                   <div className="text-[10px] font-mono font-bold text-slate-400 truncate">{barang.part_number}</div>
                   <h3 className="text-xs font-bold text-slate-700 line-clamp-2 leading-tight group-hover:text-primary transition-colors h-8">
                     {barang.part_name}
                   </h3>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-50 flex items-center justify-between">
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{barang.part_satuan}</span>
                   <div className="text-[8px] text-slate-300 font-mono italic">#{barang.id}</div>
                </div>
              </div>
            ))
          ) : (
             <div className="col-span-full bg-white rounded-xl border p-12 text-center text-muted-foreground italic text-sm">
                Belum ada data barang.
             </div>
          )}
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-3 rounded-xl border shadow-sm">
        <p className="text-xs text-muted-foreground whitespace-nowrap">
          Menampilkan <span className="font-bold text-slate-900">{(currentPage - 1) * pageSize + 1}-{(Math.min(currentPage * pageSize, totalCount))}</span> dari <span className="font-bold text-slate-900">{totalCount}</span>
        </p>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 pr-3 border-r border-slate-100">
            <span className="text-[10px] uppercase font-black text-slate-300">Show:</span>
            <Select value={pageSize.toString()} onValueChange={handleLimitChange}>
              <SelectTrigger className="h-7 w-[60px] bg-slate-50 border-slate-200 text-[10px] font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <form onSubmit={handleJumpPage} className="flex items-center gap-1.5">
            <Input 
              className="h-7 w-10 text-center p-0.5 bg-slate-50 border-slate-200 text-xs font-bold"
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
            />
            <span className="text-[10px] uppercase font-black text-slate-300">/ {totalPages}</span>
          </form>

          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ml-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 h-7 rounded-none px-2 hover:bg-white transition-colors"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 h-7 rounded-none px-2 border-l border-slate-200 hover:bg-white transition-colors"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Side Panel Detail Stok */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-hidden flex flex-col border-l border-slate-200 shadow-xl">
          <div className="bg-slate-50 p-6 border-b border-slate-200">
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2 text-primary mb-1">
                <Package className="h-4 w-4" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Inventory Status</span>
              </div>
              <SheetTitle className="text-xl font-bold text-slate-900 leading-tight">
                {selectedBarang?.part_name}
              </SheetTitle>
              <div className="flex items-center gap-2 mt-2">
                <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 font-mono text-xs">
                  {selectedBarang?.part_number}
                </code>
                <Badge variant="outline" className="text-[10px] h-5 bg-white font-bold">{selectedBarang?.part_satuan}</Badge>
              </div>
            </SheetHeader>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 bg-white">
            {isLoadingStock ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary/30" />
                <p className="text-xs text-muted-foreground font-medium animate-pulse">Memuat data lokasi...</p>
              </div>
            ) : stockDetails.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                   <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Sebaran Lokasi Cabang</h3>
                   <div className="text-[10px] font-bold text-slate-400 px-2 py-0.5 rounded-full border border-slate-100">{stockDetails.length} LOKASI</div>
                </div>

                <div className="space-y-2">
                  {stockDetails.map((stock) => (
                    <div 
                      key={stock.id} 
                      className="group bg-white p-3 rounded-xl border border-slate-200 hover:border-primary/30 transition-all flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="font-bold text-slate-700 text-sm leading-tight">{stock.nama_cabang}</div>
                        <div className="flex items-center gap-3 text-[9px] text-slate-400 font-bold">
                           <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-200" /> MIN: {stock.min_qty}</span>
                           <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-200" /> MAX: {stock.max_qty}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className={`text-lg font-black leading-none ${
                            stock.status === 'low' ? 'text-destructive' : 
                            stock.status === 'overstock' ? 'text-amber-500' : 'text-slate-900'
                          }`}>
                            {stock.qty}
                          </div>
                          <Badge 
                            variant="secondary" 
                            className={`text-[8px] h-3.5 px-1 mt-1 font-black uppercase tracking-widest ${
                              stock.status === 'low' ? 'bg-destructive/5 text-destructive border-none' : 
                              stock.status === 'overstock' ? 'bg-amber-50 text-amber-600 border-none' : 
                              stock.status === 'normal' ? 'bg-green-50 text-green-600 border-none' : 'bg-slate-50 text-slate-400'
                            }`}
                          >
                            {stock.status === 'unknown' ? 'Unset' : stock.status}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1 pr-1">
                           <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0 rounded-lg hover:bg-primary/5 hover:text-primary transition-colors border border-transparent hover:border-primary/10"
                              onClick={() => {
                                 setEditingStock(stock);
                                 setIsStockEditOpen(true);
                              }}
                           >
                              <Pencil className="h-3.5 w-3.5" />
                           </Button>
                           <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0 rounded-lg hover:bg-slate-100 transition-colors"
                              onClick={() => router.push(`/stock?q=${selectedBarang?.part_number}&cabang=${stock.id}`)}
                           >
                              <ArrowRight className="h-3.5 w-3.5" />
                           </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-16 text-muted-foreground italic text-xs">
                <FilterX className="h-10 w-10 mx-auto mb-3 opacity-10" />
                No inventory data available.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Modal Edit Stok (Shortcut) */}
      <Dialog open={isStockEditOpen} onOpenChange={setIsStockEditOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-[400px] rounded-2xl p-6 translate-x-[-50%] translate-y-[-50%]">
          <form onSubmit={handleStockUpdate}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold">Update Inventory</DialogTitle>
              <DialogDescription className="space-y-1">
                <div className="text-primary font-bold">{selectedBarang?.part_name}</div>
                <div className="text-[10px] uppercase font-black text-slate-400 tracking-widest">{editingStock?.nama_cabang}</div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
               <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex flex-col items-center">
                  <Label className="text-[10px] font-black uppercase text-slate-400 mb-2">Quantity Fisik</Label>
                  <Input 
                    name="qty" 
                    type="number" 
                    defaultValue={editingStock?.qty} 
                    className="h-14 text-3xl font-black bg-transparent border-none text-center focus-visible:ring-0 focus-visible:ring-offset-0"
                    required 
                    autoFocus
                  />
               </div>

               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Safety Stock</Label>
                    <Input name="min_qty" type="number" defaultValue={editingStock?.min_qty} className="h-9 font-bold bg-white border-slate-200" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Maks. Kapasitas</Label>
                    <Input name="max_qty" type="number" defaultValue={editingStock?.max_qty} className="h-9 font-bold bg-white border-slate-200" required />
                  </div>
               </div>
            </div>

            <DialogFooter className="mt-8 flex items-center gap-3 sm:justify-between">
              <Button type="button" variant="ghost" className="flex-1 rounded-xl font-bold text-slate-400" onClick={() => setIsStockEditOpen(false)}>Batal</Button>
              <Button type="submit" disabled={isSubmitting} className="flex-1 rounded-xl bg-primary font-bold shadow-md shadow-primary/20">
                 {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan Perubahan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Form Master Barang */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-[400px] rounded-2xl p-6 translate-x-[-50%] translate-y-[-50%]">
          <form onSubmit={handleAdd}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold">Barang Baru</DialogTitle>
              <DialogDescription className="text-xs">
                Daftarkan item ke katalog inventori perusahaan.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Part Number</Label>
                <Input id="part_number" name="part_number" placeholder="Contoh: 11L-ARB02-X" required className="bg-white border-slate-200 h-10" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nama Suku Cadang</Label>
                <Input id="part_name" name="part_name" placeholder="Masukan nama lengkap..." required className="bg-white border-slate-200 h-10" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Satuan</Label>
                <Input id="part_satuan" name="part_satuan" placeholder="Ea, Set, Meter..." required className="bg-white border-slate-200 h-10" />
              </div>
            </div>
            <DialogFooter className="mt-8 flex gap-3">
              <Button type="button" variant="ghost" className="flex-1 rounded-xl font-bold text-slate-400" onClick={() => setIsAddModalOpen(false)}>Batal</Button>
              <Button type="submit" disabled={isSubmitting} className="flex-1 rounded-xl bg-primary font-bold">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "Tambah Item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-[400px] rounded-2xl p-6 translate-x-[-50%] translate-y-[-50%]">
          <form onSubmit={handleEdit}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold transition-all">Edit Katalog</DialogTitle>
              <DialogDescription className="text-xs">
                Perbarui detail untuk item <span className="font-bold text-primary">{editingBarang?.part_number}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Part Number</Label>
                <Input 
                  id="edit_part_number" 
                  name="part_number" 
                  defaultValue={editingBarang?.part_number} 
                  required 
                  className="bg-white border-slate-200 h-10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nama Suku Cadang</Label>
                <Input 
                  id="edit_part_name" 
                  name="part_name" 
                  defaultValue={editingBarang?.part_name} 
                  required 
                  className="bg-white border-slate-200 h-10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-slate-400 ml-1">Satuan</Label>
                <Input 
                  id="edit_part_satuan" 
                  name="part_satuan" 
                  defaultValue={editingBarang?.part_satuan} 
                  required 
                  className="bg-white border-slate-200 h-10"
                />
              </div>
            </div>
            <DialogFooter className="mt-8 flex gap-3">
              <Button type="button" variant="ghost" className="flex-1 rounded-xl font-bold text-slate-400" onClick={() => setIsEditModalOpen(false)}>Batal</Button>
              <Button type="submit" disabled={isSubmitting} className="flex-1 rounded-xl bg-primary font-bold">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "Simpan Perubahan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
