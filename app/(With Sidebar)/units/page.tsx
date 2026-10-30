"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  FilterX,
  Loader2,
  Pencil,
  Plus,
  Search,
  ToggleLeft,
  Tractor,
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
  createUnit,
  deleteUnit,
  getUnitList,
  getUnitOptions,
  toggleUnitStatus,
  updateUnit,
} from "@/services/master-actions";
import { useConfirmDialog } from "@/components/confirm-dialog";

type UnitRow = {
  id: number;
  kode_unit: string;
  tipe_unit: string;
  brand: string | null;
  is_active: boolean;
};

type UnitFormState = {
  kode_unit: string;
  tipe_unit: string;
  brand: string;
  is_active: boolean;
};

const emptyUnitForm: UnitFormState = {
  kode_unit: "",
  tipe_unit: "",
  brand: "",
  is_active: true,
};

const DEFAULT_SORT = "kode_unit_asc";

export default function UnitsPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 350);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortOrder, setSortOrder] = useState(DEFAULT_SORT);

  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [form, setForm] = useState<UnitFormState>(emptyUnitForm);

  const [canWrite, setCanWrite] = useState(false);

  const fetchRBAC = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setCanWrite(false);
      return;
    }

    const { data } = await supabase
      .from("user_roles")
      .select("roles(name)")
      .eq("user_id", user.id);

    const roles = (data || []).map((r: any) => r.roles?.name).filter(Boolean);
    setCanWrite(roles.includes("moderator"));
  };

  const fetchOptions = async () => {
    const result = await getUnitOptions();
    if (!result.error) {
      setBrandOptions(result.brands);
      setTypeOptions(result.types);
    }
  };

  const fetchUnits = async () => {
    setLoading(true);
    const result = await getUnitList({
      page,
      limit,
      search: debouncedSearch,
      brand: brandFilter,
      is_aktif: statusFilter,
      sort: sortOrder,
    });

    if (result.error) {
      toast.error(result.error);
      setUnits([]);
      setTotalCount(0);
    } else {
      setUnits(result.data || []);
      setTotalCount(result.total || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRBAC();
    fetchOptions();
  }, []);

  useEffect(() => {
    fetchUnits();
  }, [page, limit, debouncedSearch, brandFilter, statusFilter, sortOrder]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const openCreateDialog = () => {
    setEditingUnitId(null);
    setForm(emptyUnitForm);
    setDialogOpen(true);
  };

  const openEditDialog = (unit: UnitRow) => {
    setEditingUnitId(unit.id);
    setForm({
      kode_unit: unit.kode_unit || "",
      tipe_unit: unit.tipe_unit || "",
      brand: unit.brand || "",
      is_active: Boolean(unit.is_active),
    });
    setDialogOpen(true);
  };

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setBrandFilter("all");
    setSortOrder(DEFAULT_SORT);
    setPage(1);
  };

  const hasActiveFilters = useMemo(
    () =>
      Boolean(search) ||
      statusFilter !== "all" ||
      brandFilter !== "all" ||
      sortOrder !== DEFAULT_SORT,
    [search, statusFilter, brandFilter, sortOrder],
  );

  const handleSubmit = async () => {
    if (!form.kode_unit.trim()) {
      toast.error("Kode unit wajib diisi");
      return;
    }
    if (!form.tipe_unit.trim()) {
      toast.error("Tipe unit wajib diisi");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        kode_unit: form.kode_unit,
        tipe_unit: form.tipe_unit,
        brand: form.brand,
        is_active: form.is_active,
      };

      const result = editingUnitId
        ? await updateUnit(editingUnitId, payload)
        : await createUnit(payload);

      if (!result.success) {
        toast.error(result.error || "Gagal menyimpan unit");
        return;
      }

      toast.success(
        editingUnitId ? "Unit berhasil diperbarui" : "Unit berhasil dibuat",
      );
      setDialogOpen(false);
      setEditingUnitId(null);
      setForm(emptyUnitForm);
      await Promise.all([fetchUnits(), fetchOptions()]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (unitId: number) => {
    const result = await toggleUnitStatus(unitId);
    if (!result.success) {
      toast.error(result.error || "Gagal mengubah status unit");
      return;
    }
    toast.success("Status unit berhasil diubah");
    await fetchUnits();
  };

  const handleDelete = async (unit: UnitRow) => {
    if (
      !(await confirm({
        title: `Hapus unit ${unit.kode_unit}?`,
        confirmText: "Hapus",
        destructive: true,
      }))
    ) {
      return;
    }

    const toastId = toast.loading("Menghapus unit...");
    const result = await deleteUnit(unit.id);
    if (!result.success) {
      toast.error(result.error || "Gagal menghapus unit", { id: toastId });
      return;
    }

    toast.success("Unit berhasil dihapus", { id: toastId });
    await Promise.all([fetchUnits(), fetchOptions()]);
  };

  return (
    <>
      {confirmDialog}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Tractor className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Unit Management
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Master Data Kode Unit, Tipe Unit & Brand
              </p>
            </div>
          </div>

          {canWrite ? (
            <Button
              className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase"
              onClick={openCreateDialog}
            >
              <Plus className="h-4 w-4" /> Tambah Unit
            </Button>
          ) : (
            <Badge
              variant="secondary"
              className="text-[10px] uppercase font-bold"
            >
              View Only
            </Badge>
          )}
        </div>
      </Content>

      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari kode unit, tipe unit, atau brand..."
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
              value={brandFilter}
              onValueChange={(val) => {
                setBrandFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-48 border-input bg-background text-xs font-bold text-foreground">
                <SelectValue placeholder="Brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Brand</SelectItem>
                <SelectItem value="__none__">Tanpa Brand</SelectItem>
                {brandOptions.map((brand) => (
                  <SelectItem key={brand} value={brand}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(val: "all" | "active" | "inactive") => {
                setStatusFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-42.5 border-input bg-background text-xs font-bold text-foreground">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-muted-foreground hover:text-destructive gap-1 transition-colors"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
            >
              <FilterX className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent h-10">
                <TableHead className="w-14 text-center text-[10px] font-black uppercase text-muted-foreground">
                  No
                </TableHead>
                <SortableTableHead
                  sortKey="kode_unit"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="w-48 text-[10px] font-black uppercase text-muted-foreground"
                >
                  Kode Unit
                </SortableTableHead>
                <SortableTableHead
                  sortKey="tipe_unit"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground"
                >
                  Tipe Unit
                </SortableTableHead>
                <SortableTableHead
                  sortKey="brand"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="w-44 text-[10px] font-black uppercase text-muted-foreground"
                >
                  Brand
                </SortableTableHead>
                <SortableTableHead
                  sortKey="is_active"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="w-28 text-[10px] font-black uppercase text-muted-foreground justify-center text-center"
                >
                  Status
                </SortableTableHead>
                {canWrite && (
                  <TableHead className="w-40 text-[10px] font-black uppercase text-muted-foreground text-right pr-6">
                    Aksi
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">
                        Memuat Unit...
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : units.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-40 text-center text-muted-foreground italic text-sm"
                  >
                    {hasActiveFilters
                      ? "Tidak ada data unit yang sesuai filter."
                      : "Belum ada data unit."}
                  </TableCell>
                </TableRow>
              ) : (
                units.map((unit, index) => (
                  <TableRow
                    key={unit.id}
                    className="group hover:bg-muted/30 transition-all border-b border-border/50 h-12"
                  >
                    <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">
                      {(page - 1) * limit + index + 1}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs font-bold text-primary">
                        {unit.kode_unit}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-semibold text-foreground">
                        {unit.tipe_unit}
                      </span>
                    </TableCell>
                    <TableCell>
                      {unit.brand ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold uppercase"
                        >
                          {unit.brand}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={unit.is_active ? "default" : "secondary"}
                        className="text-[10px] font-bold uppercase"
                      >
                        {unit.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(unit)}
                            title="Edit unit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleToggleStatus(unit.id)}
                            title="Toggle status"
                          >
                            <ToggleLeft className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(unit)}
                            title="Hapus unit"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
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
              setLimit(parseInt(val, 10));
              setPage(1);
            }}
            itemLabel="Unit"
          />
        </div>
      </Content>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-140">
          <DialogHeader>
            <DialogTitle>
              {editingUnitId ? "Edit Unit" : "Tambah Unit Baru"}
            </DialogTitle>
            <DialogDescription>
              Kode unit wajib unik dan tipe unit wajib diisi. Brand boleh
              dikosongkan bila belum diketahui.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Kode Unit</Label>
              <Input
                value={form.kode_unit}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, kode_unit: e.target.value }))
                }
                placeholder="mis. DT4119"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Tipe Unit</Label>
              <Input
                list="unit-type-options"
                value={form.tipe_unit}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, tipe_unit: e.target.value }))
                }
                placeholder="mis. AROCS 4845K"
              />
              <datalist id="unit-type-options">
                {typeOptions.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label>Brand</Label>
              <Input
                list="unit-brand-options"
                value={form.brand}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    brand: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="mis. MERCEDES-BENZ"
              />
              <datalist id="unit-brand-options">
                {brandOptions.map((brand) => (
                  <option key={brand} value={brand} />
                ))}
              </datalist>
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
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !canWrite}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Menyimpan...
                </>
              ) : editingUnitId ? (
                "Simpan Perubahan"
              ) : (
                "Tambah Unit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
