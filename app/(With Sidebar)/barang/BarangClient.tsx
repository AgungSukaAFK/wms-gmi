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
import {
  createBarang,
  updateBarang,
  deleteBarang,
  getBarangStockDetails,
} from "@/services/barang-actions";
import { updateStock } from "@/services/stock-actions";
import { Content } from "@/components/content";
import { toYmdLocal } from "@/lib/utils";

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
    const ws = XLSX.utils.json_to_sheet(
      initialData.map((b, i) => ({
        No: (currentPage - 1) * pageSize + i + 1,
        "Part Number": b.part_number,
        "Nama Part": b.part_name,
        Satuan: b.part_satuan,
        "Tanggal Input": new Date(b.created_at).toLocaleDateString("id-ID"),
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Barang");
    XLSX.writeFile(wb, `MASTER_BARANG_${toYmdLocal()}.xlsx`);
  };

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Master Barang
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Katalog Suku Cadang &amp; Material
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="gap-2 font-bold text-xs border-input hover:bg-muted/40"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
              Export
            </Button>
            <Button
              size="sm"
              onClick={() => setIsAddModalOpen(true)}
              className="gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase"
            >
              <Plus className="h-4 w-4" /> Barang Baru
            </Button>
          </div>
        </div>
      </Content>

      {/* Section 2: Filter Bar */}
      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari Barang..."
              className="pl-9 h-9 border-input bg-muted/40 focus:bg-background transition-all rounded-md text-xs font-medium text-foreground"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <div className="flex p-0.5 bg-muted rounded-md border border-border">
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-3 text-xs ${
                  initialView === "table"
                    ? "shadow-sm bg-background text-foreground font-bold"
                    : "text-muted-foreground"
                }`}
                onClick={() => handleViewChange("table")}
              >
                <List className="h-3.5 w-3.5 mr-1.5" /> Tabel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-3 text-xs ${
                  initialView === "grid"
                    ? "shadow-sm bg-background text-foreground font-bold"
                    : "text-muted-foreground"
                }`}
                onClick={() => handleViewChange("grid")}
              >
                <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> Kartu
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <SortAsc className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={initialSort} onValueChange={handleSortChange}>
                <SelectTrigger className="h-8 w-full border-input bg-background text-xs font-semibold text-foreground sm:w-35">
                  <SelectValue placeholder="Urutkan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name_asc">Nama (A-Z)</SelectItem>
                  <SelectItem value="name_desc">Nama (Z-A)</SelectItem>
                  <SelectItem value="latest">Terbaru</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-8 px-2 text-muted-foreground hover:text-destructive gap-1 transition-colors"
            >
              <FilterX className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Content>

      {/* Section 3: Content View + Pagination */}
      <Content className="overflow-hidden">
        {/* Table View */}
        {initialView === "table" ? (
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent border-b border-border h-10">
                  <TableHead className="w-12.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                    No
                  </TableHead>
                  <TableHead className="w-45 text-[10px] font-black uppercase text-muted-foreground">
                    Part Number
                  </TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                    Nama Suku Cadang
                  </TableHead>
                  <TableHead className="w-25 text-[10px] font-black uppercase text-muted-foreground">
                    Satuan
                  </TableHead>
                  <TableHead className="w-20 text-right pr-6 text-[10px] font-black uppercase text-muted-foreground">
                    Aksi
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialData.length > 0 ? (
                  initialData.map((barang, index) => (
                    <TableRow
                      key={barang.id}
                      className="group cursor-pointer hover:bg-muted/30 transition-colors border-b border-border/50 h-14"
                      onClick={() => handleRowClick(barang)}
                    >
                      <TableCell className="text-center text-muted-foreground text-xs font-medium font-mono">
                        {(currentPage - 1) * pageSize + index + 1}
                      </TableCell>
                      <TableCell>
                        <div className="font-bold text-foreground text-sm tracking-tight group-hover:text-primary transition-colors uppercase">
                          {barang.part_number}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-muted-foreground text-xs font-medium truncate">
                          {barang.part_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground uppercase font-semibold">
                          {barang.part_satuan}
                        </span>
                      </TableCell>
                      <TableCell
                        className="text-right pr-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-7 w-7 p-0 hover:bg-muted rounded-full"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-40 p-1.5 rounded-lg border-border"
                          >
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingBarang(barang);
                                setIsEditModalOpen(true);
                              }}
                              className="text-xs rounded-md"
                            >
                              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-xs text-destructive focus:text-destructive rounded-md"
                              onClick={() =>
                                handleDelete(barang.id, barang.part_name)
                              }
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
                    <TableCell
                      colSpan={5}
                      className="h-32 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[10px]"
                    >
                      <Package className="h-8 w-8 mx-auto mb-2 opacity-10" />
                      BELUM ADA DATA BARANG
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          /* Grid View */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-1">
            {initialData.length > 0 ? (
              initialData.map((barang) => (
                <div
                  key={barang.id}
                  className="bg-background p-3 rounded-xl border border-border hover:shadow-md transition-all cursor-pointer group hover:border-primary/40 relative overflow-hidden"
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
                    <div className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors leading-tight uppercase">
                      {barang.part_number}
                    </div>
                    <h3 className="text-[10px] font-medium text-muted-foreground truncate leading-tight">
                      {barang.part_name}
                    </h3>
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between">
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-tighter">
                      {barang.part_satuan}
                    </span>
                    <div className="text-[8px] text-muted-foreground/30 font-mono italic">
                      #{barang.id}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full p-12 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[10px]">
                Belum ada data barang.
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        <div className="flex flex-col items-start justify-between gap-4 p-4 border-t border-border bg-muted/30 md:flex-row md:items-center">
          <p className="text-xs text-muted-foreground whitespace-nowrap">
            Menampilkan{" "}
            <span className="font-bold text-foreground">
              {(currentPage - 1) * pageSize + 1}-
              {Math.min(currentPage * pageSize, totalCount)}
            </span>{" "}
            dari <span className="font-bold text-foreground">{totalCount}</span>
          </p>

          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-nowrap">
            <div className="flex items-center gap-1.5 pr-3 md:border-r md:border-border">
              <span className="text-[10px] uppercase font-black text-muted-foreground">
                Show:
              </span>
              <Select
                value={pageSize.toString()}
                onValueChange={handleLimitChange}
              >
                <SelectTrigger className="h-7 w-15 bg-muted/40 border-input text-[10px] font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <form
              onSubmit={handleJumpPage}
              className="flex items-center gap-1.5"
            >
              <Input
                className="h-7 w-10 text-center p-0.5 bg-muted/40 border-input text-xs font-bold"
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
              />
              <span className="text-[10px] uppercase font-black text-muted-foreground">
                / {totalPages}
              </span>
            </form>

            <div className="flex items-center rounded-lg border border-border bg-muted/40 overflow-hidden ml-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-none px-2 hover:bg-background transition-colors"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-none px-2 border-l border-border hover:bg-background transition-colors"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Content>

      {/* Side Panel Detail Stok */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 overflow-hidden flex flex-col border-l border-border shadow-xl"
        >
          <SheetTitle className="sr-only">Detail Stok Barang</SheetTitle>
          <div className="bg-muted/40 p-6 border-b border-border">
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2 text-primary mb-1">
                <Package className="h-4 w-4" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Inventory Status
                </span>
              </div>
              <div className="text-xl font-black text-primary leading-tight font-mono uppercase tracking-tight truncate">
                {selectedBarang?.part_number}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="text-xs text-muted-foreground truncate max-w-62.5">
                  {selectedBarang?.part_name}
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 bg-background font-bold"
                >
                  {selectedBarang?.part_satuan}
                </Badge>
              </div>
            </SheetHeader>
          </div>

          <div className="flex-1 overflow-y-auto p-5 bg-background">
            {isLoadingStock ? (
              <div className="flex flex-col items-center justify-center h-48 space-y-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary/30" />
                <p className="text-xs text-muted-foreground font-medium animate-pulse">
                  Memuat data lokasi...
                </p>
              </div>
            ) : stockDetails.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">
                    Sebaran Lokasi Cabang
                  </h3>
                  <div className="text-[10px] font-bold text-muted-foreground px-2 py-0.5 rounded-full border border-border">
                    {stockDetails.length} LOKASI
                  </div>
                </div>

                <div className="space-y-2">
                  {stockDetails.map((stock) => (
                    <div
                      key={stock.id}
                      className="group bg-background p-3 rounded-xl border border-border hover:border-primary/30 transition-all flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="font-bold text-foreground text-sm leading-tight">
                          {stock.nama_cabang}
                        </div>
                        <div className="flex items-center gap-3 text-[9px] text-muted-foreground font-bold">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-border" />{" "}
                            MIN: {stock.min_qty}
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-border" />{" "}
                            MAX: {stock.max_qty}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div
                            className={`text-lg font-black leading-none ${
                              stock.status === "low"
                                ? "text-destructive"
                                : stock.status === "overstock"
                                  ? "text-warning"
                                  : "text-foreground"
                            }`}
                          >
                            {stock.qty}
                          </div>
                          <Badge
                            variant="secondary"
                            className={`text-[8px] h-3.5 px-1 mt-1 font-black uppercase tracking-widest ${
                              stock.status === "low"
                                ? "bg-destructive/5 text-destructive border-none"
                                : stock.status === "overstock"
                                  ? "bg-warning/10 text-warning border-none"
                                  : stock.status === "normal"
                                    ? "bg-success/10 text-success border-none"
                                    : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {stock.status === "unknown"
                              ? "Unset"
                              : stock.status}
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
                            className="h-8 w-8 p-0 rounded-lg hover:bg-muted transition-colors"
                            onClick={() =>
                              router.push(
                                `/stock?q=${selectedBarang?.part_number}&cabang=${stock.id}`,
                              )
                            }
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
        <DialogContent className="w-[calc(100%-2rem)] max-w-100 rounded-2xl p-6">
          <form onSubmit={handleStockUpdate}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold">
                Update Inventory
              </DialogTitle>
              <DialogDescription className="space-y-1">
                <div className="text-primary font-black font-mono uppercase tracking-tight truncate">
                  {selectedBarang?.part_number}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {selectedBarang?.part_name}
                </div>
                <div className="text-[10px] uppercase font-black text-muted-foreground tracking-widest">
                  {editingStock?.nama_cabang}
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="p-4 bg-muted/40 rounded-xl border border-border flex flex-col items-center">
                <Label className="text-[10px] font-black uppercase text-muted-foreground mb-2">
                  Quantity Fisik
                </Label>
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
                  <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                    Safety Stock
                  </Label>
                  <Input
                    name="min_qty"
                    type="number"
                    defaultValue={editingStock?.min_qty}
                    className="h-9 font-bold bg-background border-input"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                    Maks. Kapasitas
                  </Label>
                  <Input
                    name="max_qty"
                    type="number"
                    defaultValue={editingStock?.max_qty}
                    className="h-9 font-bold bg-background border-input"
                    required
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="mt-8 flex items-center gap-3 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                className="flex-1 rounded-xl font-bold text-muted-foreground"
                onClick={() => setIsStockEditOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-primary font-bold shadow-md shadow-primary/20"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Simpan Perubahan"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Form Master Barang — Tambah */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-100 rounded-2xl p-6">
          <form onSubmit={handleAdd}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold">
                Barang Baru
              </DialogTitle>
              <DialogDescription className="text-xs">
                Daftarkan item ke katalog inventori perusahaan.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                  Part Number
                </Label>
                <Input
                  id="part_number"
                  name="part_number"
                  placeholder="Contoh: 11L-ARB02-X"
                  required
                  className="bg-background border-input h-10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                  Nama Suku Cadang
                </Label>
                <Input
                  id="part_name"
                  name="part_name"
                  placeholder="Masukan nama lengkap..."
                  required
                  className="bg-background border-input h-10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                  Satuan
                </Label>
                <Input
                  id="part_satuan"
                  name="part_satuan"
                  placeholder="Ea, Set, Meter..."
                  required
                  className="bg-background border-input h-10"
                />
              </div>
            </div>
            <DialogFooter className="mt-8 flex gap-3">
              <Button
                type="button"
                variant="ghost"
                className="flex-1 rounded-xl font-bold text-muted-foreground"
                onClick={() => setIsAddModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-primary font-bold"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  "Tambah Item"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Form Master Barang — Edit */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-100 rounded-2xl p-6">
          <form onSubmit={handleEdit}>
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold transition-all">
                Edit Katalog
              </DialogTitle>
              <DialogDescription className="text-xs">
                Perbarui detail untuk item{" "}
                <span className="font-bold text-primary">
                  {editingBarang?.part_number}
                </span>
                .
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                  Part Number
                </Label>
                <Input
                  id="edit_part_number"
                  name="part_number"
                  defaultValue={editingBarang?.part_number}
                  required
                  className="bg-background border-input h-10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                  Nama Suku Cadang
                </Label>
                <Input
                  id="edit_part_name"
                  name="part_name"
                  defaultValue={editingBarang?.part_name}
                  required
                  className="bg-background border-input h-10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-black uppercase text-muted-foreground ml-1">
                  Satuan
                </Label>
                <Input
                  id="edit_part_satuan"
                  name="part_satuan"
                  defaultValue={editingBarang?.part_satuan}
                  required
                  className="bg-background border-input h-10"
                />
              </div>
            </div>
            <DialogFooter className="mt-8 flex gap-3">
              <Button
                type="button"
                variant="ghost"
                className="flex-1 rounded-xl font-bold text-muted-foreground"
                onClick={() => setIsEditModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-primary font-bold"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  "Simpan Perubahan"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
