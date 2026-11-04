"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  Loader2,
  Pencil,
  Plus,
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
import { toast } from "@/lib/toast";
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

// Harus sama dengan kolom yang dicari di getUnitList.
const UNIT_SEARCH_FIELDS = ["Kode Unit", "Tipe Unit", "Brand"];

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  deleted: "Terhapus",
};

const UNIT_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di service.
const UNIT_COLUMNS = [
  { id: "kode_unit", label: "Kode Unit", sortDirection: "asc", className: `w-48 ${UNIT_HEAD_CLASS}` },
  { id: "tipe_unit", label: "Tipe Unit", sortDirection: "asc", className: UNIT_HEAD_CLASS },
  { id: "brand", label: "Brand", sortDirection: "asc", className: `w-44 ${UNIT_HEAD_CLASS}` },
  { id: "is_active", label: "Status", sortDirection: "asc", className: `w-28 text-center ${UNIT_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type UnitColumnId = (typeof UNIT_COLUMNS)[number]["id"];

export default function UnitsPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:unit", UNIT_COLUMNS);
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
  const brandFilter = urlState.get("brand", "all");
  const setBrandFilter = (v: string) =>
    urlState.set({ brand: v === "all" ? "" : v }, { resetPage: true });
  const sortOrder = urlState.get("sort", DEFAULT_SORT);
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === DEFAULT_SORT ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

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
    resetSearch();
    urlState.reset();
  };

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

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (statusFilter !== "all")
    activeFilters.push({
      key: "status",
      label: "Status",
      value: STATUS_LABEL[statusFilter],
      onRemove: () => setStatusFilter("all"),
    });
  if (brandFilter !== "all")
    activeFilters.push({
      key: "brand",
      label: "Brand",
      value: brandFilter === "__none__" ? "Tanpa Brand" : brandFilter,
      onRemove: () => setBrandFilter("all"),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (unit: UnitRow, id: UnitColumnId) => {
    switch (id) {
      case "kode_unit":
        return (
          <TableCell>
            <span className="font-mono text-xs font-bold text-primary">
              {unit.kode_unit}
            </span>
          </TableCell>
        );
      case "tipe_unit":
        return (
          <TableCell>
            <span className="text-sm font-semibold text-foreground">
              {unit.tipe_unit}
            </span>
          </TableCell>
        );
      case "brand":
        return (
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
        );
      case "is_active":
        return (
          <TableCell className="text-center">
            <Badge
              variant={unit.is_active ? "default" : "secondary"}
              className="text-[10px] font-bold uppercase"
            >
              {unit.is_active ? "Aktif" : "Nonaktif"}
            </Badge>
          </TableCell>
        );
    }
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
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari kode unit, tipe, atau brand..."
            value={search}
            onChange={setSearch}
            searchableFields={UNIT_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Brand">
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
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
              </FilterField>

              <FilterField label="Status">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
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
              {canWrite && (
              <TableHead className="w-20 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">
                Aksi
              </TableHead>
              )}
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={canWrite ? 6 : 5}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : units.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canWrite ? 6 : 5}
                  className="h-40 text-center text-muted-foreground italic text-sm"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data unit yang sesuai filter."
                    : "Belum ada data unit."}
                </TableCell>
              </TableRow>
            ) : (
              units.map((unit, index) => (
                <TableRow
                  key={unit.id}
                  className="group hover:bg-muted/30 transition-all border-b border-border/50 h-14"
                >
                  <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">
                    {(page - 1) * limit + index + 1}
                  </TableCell>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(unit, id)}</React.Fragment>
                  ))}
                  {canWrite && (
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => openEditDialog(unit)}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => handleToggleStatus(unit.id)}
                      >
                        <ToggleLeft className="mr-2 h-4 w-4" /> Ubah Status
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => handleDelete(unit)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Hapus
                      </DropdownMenuItem>
                    </RowActionsMenu>
                  </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={page}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Unit"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val, 10));
            setPage(1);
          }}
          className="mt-6"
        />
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
