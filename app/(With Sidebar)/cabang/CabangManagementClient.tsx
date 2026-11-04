"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import {
  createCabang,
  deleteCabangWithConfirmation,
  getCabangManagementList,
  updateCabang,
} from "@/services/master-actions";

type CabangFormState = {
  nama_cabang: string;
  kode_cabang: string;
  alamat: string;
  is_active: boolean;
};

const emptyForm: CabangFormState = {
  nama_cabang: "",
  kode_cabang: "",
  alamat: "",
  is_active: true,
};

// Harus sama dengan kolom yang dicari di filteredRows.
const CABANG_SEARCH_FIELDS = ["Nama Cabang", "Kode"];

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  deleted: "Terhapus",
};

const CABANG_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di filteredRows.
const CABANG_COLUMNS = [
  { id: "nama_cabang", label: "Nama Cabang", sortDirection: "asc", className: CABANG_HEAD_CLASS },
  { id: "kode_cabang", label: "Kode", sortDirection: "asc", className: `w-35 ${CABANG_HEAD_CLASS}` },
  { id: "alamat", label: "Alamat", className: CABANG_HEAD_CLASS },
  { id: "is_active", label: "Status", sortDirection: "asc", className: `w-28 ${CABANG_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type CabangColumnId = (typeof CABANG_COLUMNS)[number]["id"];

export default function CabangManagementClient() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:cabang", CABANG_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [search, setSearch, resetSearch] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusParam = urlState.get("status");
  const statusFilter: "all" | "active" | "inactive" =
    statusParam === "active" || statusParam === "inactive"
      ? statusParam
      : "all";
  const setStatusFilter = (v: string) =>
    urlState.set({ status: v === "all" ? "" : v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CabangFormState>(emptyForm);

  const [deletingCabang, setDeletingCabang] = useState<any>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const fetchCabang = async () => {
    setLoading(true);
    const result = await getCabangManagementList();

    if (result.error) {
      toast.error(result.error);
      setRows([]);
    } else {
      setRows(result.data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchCabang();
  }, []);

  const filteredRows = useMemo(() => {
    let data = [...rows];

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      data = data.filter(
        (r) =>
          (r.nama_cabang || "").toLowerCase().includes(q) ||
          (r.kode_cabang || "").toLowerCase().includes(q),
      );
    }

    if (statusFilter === "active") {
      data = data.filter((r) => r.is_active);
    } else if (statusFilter === "inactive") {
      data = data.filter((r) => !r.is_active);
    }

    if (sortOrder) {
      const [sortKey, dir] = sortOrder.split(/_(asc|desc)$/);
      const ascending = dir === "asc";
      const getValue = (r: any) => {
        switch (sortKey) {
          case "nama_cabang":
            return r.nama_cabang || "";
          case "kode_cabang":
            return r.kode_cabang || "";
          case "is_active":
            return r.is_active ? 1 : 0;
          default:
            return "";
        }
      };
      data.sort((a, b) => {
        const va = getValue(a);
        const vb = getValue(b);
        if (va < vb) return ascending ? -1 : 1;
        if (va > vb) return ascending ? 1 : -1;
        return 0;
      });
    }

    return data;
  }, [rows, debouncedSearch, statusFilter, sortOrder]);

  const totalCount = filteredRows.length;
  const paginatedRows = useMemo(() => {
    const from = (page - 1) * limit;
    return filteredRows.slice(from, from + limit);
  }, [filteredRows, page, limit]);

  useEffect(() => {
    // Tunggu data: selama loading totalCount 0, `?page=` di URL jangan terhapus.
    if (loading) return;
    const maxPage = Math.max(1, Math.ceil(totalCount / limit));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [loading, totalCount, limit, page]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (row: any) => {
    setEditingId(row.id);
    setForm({
      nama_cabang: row.nama_cabang || "",
      kode_cabang: row.kode_cabang || "",
      alamat: row.alamat || "",
      is_active: Boolean(row.is_active),
    });
    setDialogOpen(true);
  };

  const openDeleteDialog = (row: any) => {
    setDeletingCabang(row);
    setDeleteConfirmText("");
    setDeleteDialogOpen(true);
  };

  const resetFilters = () => {
    resetSearch();
    urlState.reset();
  };

  const handleSubmit = async () => {
    if (!form.nama_cabang.trim() || !form.kode_cabang.trim()) {
      toast.error("Nama dan kode cabang wajib diisi.");
      return;
    }

    setSubmitting(true);

    const result = editingId
      ? await updateCabang(editingId, form)
      : await createCabang(form);

    setSubmitting(false);

    if (!result.success) {
      toast.error(result.error || "Gagal menyimpan cabang.");
      return;
    }

    toast.success(
      editingId
        ? "Cabang berhasil diperbarui."
        : "Cabang berhasil dibuat. Stok default 0 ditambahkan untuk semua barang.",
    );
    setDialogOpen(false);
    await fetchCabang();
  };

  const handleDelete = async () => {
    if (!deletingCabang) return;

    setSubmitting(true);
    const result = await deleteCabangWithConfirmation(
      deletingCabang.id,
      deleteConfirmText,
    );
    setSubmitting(false);

    if (!result.success) {
      const refs = Array.isArray((result as any).references)
        ? (result as any).references.join(" | ")
        : "";
      toast.error(
        refs
          ? `${result.error} (${refs})`
          : result.error || "Gagal menghapus cabang.",
      );
      return;
    }

    toast.success("Cabang berhasil dihapus.");
    setDeleteDialogOpen(false);
    setDeletingCabang(null);
    setDeleteConfirmText("");
    await fetchCabang();
  };

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (statusFilter !== "all")
    activeFilters.push({
      key: "status",
      label: "Status",
      value: STATUS_LABEL[statusFilter],
      onRemove: () => setStatusFilter("all"),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (row: any, id: CabangColumnId) => {
    switch (id) {
      case "nama_cabang":
        return (
          <TableCell className="text-xs font-semibold text-foreground">
            {row.nama_cabang}
          </TableCell>
        );
      case "kode_cabang":
        return (
          <TableCell className="text-xs font-semibold text-muted-foreground uppercase">
            {row.kode_cabang}
          </TableCell>
        );
      case "alamat":
        return (
          <TableCell
            className="max-w-60 truncate text-xs text-muted-foreground"
            title={row.alamat || ""}
          >
            {row.alamat || "-"}
          </TableCell>
        );
      case "is_active":
        return (
          <TableCell>
            <Badge
              variant={row.is_active ? "default" : "secondary"}
              className="text-[10px] uppercase"
            >
              {row.is_active ? "Aktif" : "Nonaktif"}
            </Badge>
          </TableCell>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Master Cabang
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Kelola lokasi cabang untuk seluruh modul sistem
              </p>
            </div>
          </div>
          <Button
            className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase"
            onClick={openCreateDialog}
          >
            <Plus className="h-4 w-4" /> Tambah Cabang
          </Button>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari nama atau kode cabang..."
            value={search}
            onChange={setSearch}
            searchableFields={CABANG_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>
          </FilterPanel>
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[900px]"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
              className="hover:bg-transparent h-10"
            >
              <TableHead className="w-14 text-center text-[10px] font-black uppercase text-muted-foreground">
                No
              </TableHead>
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sortOrder, onSort: handleSortChange }}
                />
              ))}
              <TableHead className="w-20 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">
                Aksi
              </TableHead>
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : paginatedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-40 text-center text-muted-foreground italic text-sm"
                >
                  Tidak ada data cabang.
                </TableCell>
              </TableRow>
            ) : (
              paginatedRows.map((row, index) => (
                <TableRow
                  key={row.id}
                  className="group hover:bg-muted/30 transition-all border-b border-border/50 h-14"
                >
                  <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">
                    {(page - 1) * limit + index + 1}
                  </TableCell>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(row, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => openEditDialog(row)}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => openDeleteDialog(row)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Hapus
                      </DropdownMenuItem>
                    </RowActionsMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={page}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Cabang"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val, 10));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Cabang" : "Tambah Cabang Baru"}
            </DialogTitle>
            <DialogDescription>
              Perubahan cabang akan memengaruhi modul inventory, procurement,
              dan approval template.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nama Cabang</Label>
              <Input
                value={form.nama_cabang}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, nama_cabang: e.target.value }))
                }
                placeholder="Contoh: GMI-BPN"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kode Cabang</Label>
              <Input
                value={form.kode_cabang}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, kode_cabang: e.target.value }))
                }
                placeholder="Contoh: BPN"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Alamat</Label>
              <Textarea
                value={form.alamat}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, alamat: e.target.value }))
                }
                placeholder="Alamat lengkap cabang"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.is_active ? "active" : "inactive"}
                onValueChange={(val) =>
                  setForm((prev) => ({ ...prev, is_active: val === "active" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="inactive">Nonaktif</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingId ? (
                "Simpan"
              ) : (
                "Tambah"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Cabang</DialogTitle>
            <DialogDescription>
              Aksi ini permanen. Untuk konfirmasi, ketik persis nama cabang:
              <span className="font-bold">
                {" "}
                {deletingCabang?.nama_cabang || "-"}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Konfirmasi Nama Cabang</Label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Ketik nama cabang"
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={
                submitting ||
                deleteConfirmText.trim() !== (deletingCabang?.nama_cabang || "")
              }
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Hapus"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
