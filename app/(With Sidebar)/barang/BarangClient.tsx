"use client";

import React, { useState } from "react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  Plus,
  FileSpreadsheet,
  Pencil,
  Trash2,
  Loader2,
  Package,
  LayoutGrid,
  List,
  QrCode,
  RotateCcw,
  X,
  ArrowRight,
  FilterX,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { useRouter, useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { jsonToSheetWithDates, toExcelDate } from "@/lib/excel";
import {
  createBarang,
  updateBarang,
  deleteBarang,
  bulkDeleteBarang,
  restoreBarang,
  getBarangStockDetails,
} from "@/services/barang-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkEditBarangDialog } from "@/components/barang/bulk-edit-barang-dialog";
import { updateStock } from "@/services/stock-actions";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  FilterRange,
  FilterRangeFields,
  formatFilterDate,
  formatFilterRange,
} from "@/components/filter-panel";
import { ListSearchInput } from "@/components/list-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { useColumnOrder } from "@/hooks/use-column-order";
import { DatePickerString } from "@/components/date-picker-string";
import { toYmdLocal } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { canEditStock } from "@/lib/stock-permissions";
import { BarcodePrintDialog } from "@/components/barang/barcode-print-dialog";
import { useConfirmDialog } from "@/components/confirm-dialog";

interface Barang {
  id: number;
  part_number: string;
  part_name: string;
  part_satuan: string;
  created_at: string;
  deleted_at?: string | null;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000];

interface StockDetail {
  id: number;
  cabang_id: number;
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
  initialUpdatedFrom: string;
  initialUpdatedTo: string;
  initialStatus: "active" | "deleted";
}

// Harus sama dengan kolom yang dicari di barang/page.tsx.
const BARANG_SEARCH_FIELDS = ["Part Number", "Nama Barang"];

const BARANG_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di barang/page.tsx.
const BARANG_COLUMNS = [
  { id: "part_number", label: "Part Number", sortDirection: "asc", className: `w-45 ${BARANG_HEAD_CLASS}` },
  { id: "name", label: "Nama Suku Cadang", sortDirection: "asc", className: BARANG_HEAD_CLASS },
  { id: "part_satuan", label: "Satuan", sortDirection: "asc", className: `w-25 ${BARANG_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type BarangColumnId = (typeof BARANG_COLUMNS)[number]["id"];

export default function BarangClient({
  initialData,
  totalCount,
  currentPage,
  pageSize,
  initialQuery,
  initialSort,
  initialView,
  initialUpdatedFrom,
  initialUpdatedTo,
  initialStatus,
}: BarangClientProps) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const router = useRouter();
  const searchParams = useSearchParams();

  const columnOrder = useColumnOrder("wms:table-column-order:barang", BARANG_COLUMNS);

  /** Ubah query string + kembali ke halaman 1. */
  const pushFilter = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.set("page", "1");
    router.push(`/barang?${params.toString()}`);
  };

  // Search & Filters
  const [search, setSearch, resetSearch] = useUrlSearchInput(
    initialQuery,
    (value) =>
      pushFilter((params) => {
        if (value) params.set("q", value);
        else params.delete("q");
      }),
  );
  const updatedFrom = initialUpdatedFrom;
  const setUpdatedFrom = (value: string) =>
    pushFilter((params) => {
      if (value) params.set("updated_from", value);
      else params.delete("updated_from");
    });
  const updatedTo = initialUpdatedTo;
  const setUpdatedTo = (value: string) =>
    pushFilter((params) => {
      if (value) params.set("updated_to", value);
      else params.delete("updated_to");
    });

  const profile = useAuthStore((s) => s.profile);
  const isModerator = (profile?.roles || []).some(
    (r) => r?.name === "moderator",
  );
  const isDeletedView = initialStatus === "deleted";

  // Pilih banyak (moderator): edit massal / hapus / pulihkan. Pilihan bertahan
  // saat ganti halaman, direset saat filter berubah supaya tidak ada barang
  // tersembunyi ikut terproses.
  const [selectedRows, setSelectedRows] = useState<Record<number, Barang>>({});
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const selectedList = Object.values(selectedRows);
  const pageAllSelected =
    initialData.length > 0 && initialData.every((b) => selectedRows[b.id]);

  const filterKey = [
    initialQuery,
    initialUpdatedFrom,
    initialUpdatedTo,
    initialStatus,
  ].join("|");
  const [selectionFilterKey, setSelectionFilterKey] = useState(filterKey);
  if (selectionFilterKey !== filterKey) {
    setSelectionFilterKey(filterKey);
    setSelectedRows({});
  }

  const toggleRow = (barang: Barang, checked: boolean) =>
    setSelectedRows((prev) => {
      const next = { ...prev };
      if (checked) next[barang.id] = barang;
      else delete next[barang.id];
      return next;
    });

  const togglePage = (checked: boolean) =>
    setSelectedRows((prev) => {
      const next = { ...prev };
      for (const b of initialData) {
        if (checked) next[b.id] = b;
        else delete next[b.id];
      }
      return next;
    });

  // Modals & States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingBarang, setEditingBarang] = useState<Barang | null>(null);
  const [barcodeBarang, setBarcodeBarang] = useState<Barang | null>(null);
  const [isBarcodeDialogOpen, setIsBarcodeDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stock Edit Modal (for Drawer use)
  const [isStockEditOpen, setIsStockEditOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<StockDetail | null>(null);

  // Sheet (Stock Details)
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedBarang, setSelectedBarang] = useState<Barang | null>(null);
  const [stockDetails, setStockDetails] = useState<StockDetail[]>([]);
  const [isLoadingStock, setIsLoadingStock] = useState(false);

  const totalPages = Math.ceil(totalCount / pageSize);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`/barang?${params.toString()}`);
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

  const handleStatusChange = (newStatus: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newStatus === "deleted") params.set("status", "deleted");
    else params.delete("status");
    params.set("page", "1");
    router.push(`/barang?${params.toString()}`);
  };

  const handleViewChange = (newView: "table" | "grid") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", newView);
    router.push(`/barang?${params.toString()}`);
  };

  const handleReset = () => {
    resetSearch();
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

  const DELETE_NOTE =
    "Barang disembunyikan dari master & pilihan dokumen baru. Dokumen yang sudah memakai barang ini tetap utuh dan tidak berubah.";

  const handleDelete = async (id: number, name: string) => {
    if (
      !(await confirm({
        title: `Hapus barang ${name}?`,
        description: DELETE_NOTE,
        confirmText: "Hapus",
        destructive: true,
      }))
    )
      return;
    const toastId = toast.loading(`Menghapus barang ${name}...`);
    const result = await deleteBarang(id);
    if (result.success) {
      toast.success(`Barang ${name} berhasil dihapus`, { id: toastId });
    } else {
      toast.error(`Gagal menghapus barang: ${result.error}`, { id: toastId });
    }
  };

  const handleBulkDelete = async () => {
    const ids = selectedList.map((b) => b.id);
    if (
      !(await confirm({
        title: `Hapus ${ids.length} barang terpilih?`,
        description: `${DELETE_NOTE} Barang yang masih punya stok akan dilewati.`,
        confirmText: "Hapus",
        destructive: true,
      }))
    )
      return;
    const toastId = toast.loading(`Menghapus ${ids.length} barang...`);
    const result = await bulkDeleteBarang(ids);
    if (!result.success) {
      toast.error(`Gagal menghapus barang: ${result.error}`, { id: toastId });
      return;
    }
    const skipped = result.skipped || [];
    if (skipped.length > 0) {
      const preview = skipped
        .slice(0, 5)
        .map((s) => `${s.part_number} (${s.reason.toLowerCase()})`)
        .join(", ");
      toast.warning(
        `${result.deleted} barang dihapus, ${skipped.length} dilewati`,
        {
          id: toastId,
          description:
            preview + (skipped.length > 5 ? `, dan ${skipped.length - 5} lainnya` : ""),
          duration: 10000,
        },
      );
    } else {
      toast.success(`${result.deleted} barang berhasil dihapus`, { id: toastId });
    }
    setSelectedRows({});
  };

  const handleRestore = async (ids: number[]) => {
    const toastId = toast.loading(`Memulihkan ${ids.length} barang...`);
    const result = await restoreBarang(ids);
    if (!result.success) {
      toast.error(`Gagal memulihkan barang: ${result.error}`, { id: toastId });
      return;
    }
    toast.success(`${result.restored} barang berhasil dipulihkan`, { id: toastId });
    setSelectedRows({});
  };

  const handleExport = () => {
    toast.info("Mengekspor halaman saat ini...");
    const ws = jsonToSheetWithDates(
      initialData.map((b, i) => ({
        No: (currentPage - 1) * pageSize + i + 1,
        "Part Number": b.part_number,
        "Nama Part": b.part_name,
        Satuan: b.part_satuan,
        "Tanggal Input": toExcelDate(b.created_at),
      })),
      ["Tanggal Input"],
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Barang");
    XLSX.writeFile(wb, `MASTER_BARANG_${toYmdLocal()}.xlsx`);
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (isDeletedView)
    activeFilters.push({
      key: "status",
      label: "Status",
      value: "Terhapus",
      onRemove: () => handleStatusChange("active"),
    });
  if (updatedFrom || updatedTo)
    activeFilters.push({
      key: "updated",
      label: "Diubah",
      value: formatFilterRange(updatedFrom, updatedTo, formatFilterDate),
      onRemove: () =>
        pushFilter((params) => {
          params.delete("updated_from");
          params.delete("updated_to");
        }),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (barang: Barang, id: BarangColumnId) => {
    switch (id) {
      case "part_number":
        return (
          <TableCell>
            <div className="font-bold text-foreground text-sm tracking-tight group-hover:text-primary transition-colors uppercase">
              {barang.part_number}
            </div>
          </TableCell>
        );
      case "name":
        return (
          <TableCell>
            <div className="text-muted-foreground text-xs font-medium truncate">
              {barang.part_name}
            </div>
            {barang.deleted_at && (
              <div className="text-[10px] font-semibold text-destructive">
                Dihapus{" "}
                {new Date(barang.deleted_at).toLocaleDateString("id-ID")}
              </div>
            )}
          </TableCell>
        );
      case "part_satuan":
        return (
          <TableCell>
            <span className="text-xs text-muted-foreground uppercase font-semibold">
              {barang.part_satuan}
            </span>
          </TableCell>
        );
    }
  };

  return (
    <>
      {confirmDialog}
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
        <div className="space-y-3">
          <div className="flex flex-col gap-4 md:flex-row">
            <ListSearchInput
              placeholder="Cari part number atau nama..."
              value={search}
              onChange={setSearch}
              searchableFields={BARANG_SEARCH_FIELDS}
            />
            <div className="flex shrink-0 self-start p-0.5 bg-muted rounded-md border border-border">
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
          </div>

          <FilterPanel activeFilters={activeFilters} onReset={handleReset}>
            <FilterFields>
              <FilterField label="Urutan">
                <Select value={initialSort} onValueChange={handleSortChange}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue placeholder="Urutkan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name_asc">Nama (A-Z)</SelectItem>
                    <SelectItem value="name_desc">Nama (Z-A)</SelectItem>
                    <SelectItem value="latest">Terbaru</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              {isModerator && (
                <FilterField label="Status">
                  <Select value={initialStatus} onValueChange={handleStatusChange}>
                    <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="deleted">Terhapus</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterField>
              )}
            </FilterFields>

            <FilterRangeFields>
              <FilterField label="Terakhir Diubah">
                <FilterRange
                  from={
                    <DatePickerString
                      value={updatedFrom}
                      onChange={setUpdatedFrom}
                      placeholder="Dari"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                  to={
                    <DatePickerString
                      value={updatedTo}
                      onChange={setUpdatedTo}
                      placeholder="Sampai"
                      className="h-9 w-full text-xs font-medium"
                    />
                  }
                />
              </FilterField>
            </FilterRangeFields>
          </FilterPanel>
        </div>
      </Content>

      {/* Section 3: Content View + Pagination */}
      <Content>
        {isModerator && selectedList.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <span className="text-xs font-bold text-foreground">
              {selectedList.length} barang dipilih
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold"
                onClick={() => setSelectedRows({})}
              >
                <X className="h-3.5 w-3.5" /> Batal Pilih
              </Button>
              {isDeletedView ? (
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-bold"
                  onClick={() => handleRestore(selectedList.map((b) => b.id))}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Pulihkan Terpilih
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs font-bold"
                    onClick={() => setIsBulkEditOpen(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit Massal
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 gap-1.5 text-xs font-bold"
                    onClick={handleBulkDelete}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Hapus Terpilih
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {/* Table View */}
        {initialView === "table" ? (
          <>
            {columnOrder.isCustomOrder && (
              <ColumnOrderReset onReset={columnOrder.resetOrder} />
            )}
            <StickyHeaderTable
              className="table-fixed min-w-[800px]"
              containerClassName="rounded-md border"
              header={
                <ReorderableHeaderRow
                  order={columnOrder.order}
                  onMove={columnOrder.moveColumn}
                  className="hover:bg-transparent border-b border-border h-10"
                >
                  {isModerator && (
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        checked={pageAllSelected}
                        onCheckedChange={(v) => togglePage(v === true)}
                        disabled={initialData.length === 0}
                        aria-label="Pilih semua di halaman ini"
                      />
                    </TableHead>
                  )}
                  <TableHead className="w-12.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                    No
                  </TableHead>
                  {columnOrder.orderedColumns.map((column) => (
                    <ReorderableTableHead
                      key={column.id}
                      column={column}
                      sort={{ currentSort: initialSort, onSort: handleSortChange }}
                    />
                  ))}
                  <TableHead className="w-20 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">
                    Aksi
                  </TableHead>
                </ReorderableHeaderRow>
              }
            >
              <TableBody>
                {initialData.length > 0 ? (
                  initialData.map((barang, index) => (
                    <TableRow
                      key={barang.id}
                      className="group cursor-pointer hover:bg-muted/30 transition-colors border-b border-border/50 h-14"
                      onClick={() => handleRowClick(barang)}
                    >
                      {isModerator && (
                        <TableCell
                          className="pl-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={!!selectedRows[barang.id]}
                            onCheckedChange={(v) => toggleRow(barang, v === true)}
                            aria-label={`Pilih ${barang.part_number}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-center text-muted-foreground text-xs font-medium font-mono">
                        {(currentPage - 1) * pageSize + index + 1}
                      </TableCell>
                      {columnOrder.order.map((id) => (
                        <React.Fragment key={id}>{renderCell(barang, id)}</React.Fragment>
                      ))}
                      <TableCell
                        className="text-right pr-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <RowActionsMenu>
                          {isDeletedView ? (
                            <DropdownMenuItem
                              onSelect={() => handleRestore([barang.id])}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" /> Pulihkan
                            </DropdownMenuItem>
                          ) : (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditingBarang(barang);
                                  setIsEditModalOpen(true);
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setBarcodeBarang(barang);
                                  setIsBarcodeDialogOpen(true);
                                }}
                              >
                                <QrCode className="mr-2 h-4 w-4" /> Cetak QR Code
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => handleDelete(barang.id, barang.part_name)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Hapus
                              </DropdownMenuItem>
                            </>
                          )}
                        </RowActionsMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={isModerator ? 6 : 5}
                      className="h-32 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[10px]"
                    >
                      <Package className="h-8 w-8 mx-auto mb-2 opacity-10" />
                      {activeFilters.length > 0 || initialQuery
                        ? "TIDAK ADA BARANG YANG SESUAI FILTER"
                        : "BELUM ADA DATA BARANG"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </StickyHeaderTable>
          </>
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
                    {!isDeletedView && (
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
                    )}
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

        <TablePaginationFooter
          currentPage={currentPage}
          totalItems={totalCount}
          limit={pageSize}
          limitOptions={PAGE_SIZE_OPTIONS}
          itemLabel="Barang"
          onPageChange={handlePageChange}
          onLimitChange={handleLimitChange}
          className="mt-6"
        />
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
                          {canEditStock(profile, stock.cabang_id) && (
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
                          )}
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

      <BarcodePrintDialog
        open={isBarcodeDialogOpen}
        onOpenChange={setIsBarcodeDialogOpen}
        barang={barcodeBarang}
      />

      {isBulkEditOpen && (
        <BulkEditBarangDialog
          open={isBulkEditOpen}
          onOpenChange={setIsBulkEditOpen}
          rows={selectedList}
          onSaved={() => {
            setIsBulkEditOpen(false);
            setSelectedRows({});
          }}
        />
      )}
    </>
  );
}
