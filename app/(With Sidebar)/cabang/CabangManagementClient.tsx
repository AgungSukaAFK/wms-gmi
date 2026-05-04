"use client";

import { useEffect, useMemo, useState } from "react";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  Search,
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
import { useDebounce } from "use-debounce";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { toast } from "sonner";
import {
  createCabang,
  deleteCabangWithConfirmation,
  getCabangManagementList,
  updateCabang,
} from "@/services/master-actions";

type CabangFormState = {
  nama_cabang: string;
  kode_cabang: string;
  is_active: boolean;
};

const emptyForm: CabangFormState = {
  nama_cabang: "",
  kode_cabang: "",
  is_active: true,
};

export default function CabangManagementClient() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 350);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

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

    return data;
  }, [rows, debouncedSearch, statusFilter]);

  const totalCount = filteredRows.length;
  const paginatedRows = useMemo(() => {
    const from = (page - 1) * limit;
    return filteredRows.slice(from, from + limit);
  }, [filteredRows, page, limit]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(totalCount / limit));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [totalCount, limit, page]);

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
      is_active: Boolean(row.is_active),
    });
    setDialogOpen(true);
  };

  const openDeleteDialog = (row: any) => {
    setDeletingCabang(row);
    setDeleteConfirmText("");
    setDeleteDialogOpen(true);
  };

  const hasActiveFilters = useMemo(
    () => Boolean(search) || statusFilter !== "all",
    [search, statusFilter],
  );

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPage(1);
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
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari nama atau kode cabang..."
              className="pl-9 h-9 border-input bg-muted/40 focus:bg-background transition-all rounded-md text-xs font-medium text-foreground"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <Select
              value={statusFilter}
              onValueChange={(val: "all" | "active" | "inactive") => {
                setStatusFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-45 border-input bg-background text-xs font-semibold text-foreground">
                <SelectValue placeholder="Filter Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                className="h-9 px-3 text-xs font-semibold"
                onClick={resetFilters}
              >
                <FilterX className="h-3.5 w-3.5" /> Reset
              </Button>
            )}
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="flex-1 overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="w-12.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                  No
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Nama Cabang
                </TableHead>
                <TableHead className="w-35 text-[10px] font-black uppercase text-muted-foreground">
                  Kode
                </TableHead>
                <TableHead className="w-28 text-[10px] font-black uppercase text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="w-26 text-right text-[10px] font-black uppercase text-muted-foreground">
                  Aksi
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-30 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Memuat...
                    </div>
                  </TableCell>
                </TableRow>
              ) : paginatedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-30 text-center text-muted-foreground"
                  >
                    Tidak ada data cabang.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows.map((row, idx) => (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    <TableCell className="text-center text-xs font-medium text-muted-foreground">
                      {(page - 1) * limit + idx + 1}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-foreground">
                      {row.nama_cabang}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-muted-foreground uppercase">
                      {row.kode_cabang}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.is_active ? "default" : "secondary"}
                        className="text-[10px] uppercase"
                      >
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditDialog(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => openDeleteDialog(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="border-t border-border px-4 py-2">
          <DataTablePagination
            totalCount={totalCount}
            pageSize={limit}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={(val) => {
              setLimit(parseInt(val, 10));
              setPage(1);
            }}
            itemLabel="Cabang"
          />
        </div>
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
