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
  Building2,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  ToggleLeft,
  Trash2,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
  bulkDeleteVendors,
  createVendor,
  deleteVendor,
  getVendorList,
  restoreVendors,
  toggleVendorStatus,
  updateVendor,
} from "@/services/master-actions";
import { useConfirmDialog } from "@/components/confirm-dialog";
import {
  BulkEditVendorDialog,
  type BulkEditVendorRow,
} from "@/components/vendors/bulk-edit-vendor-dialog";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000];

const DELETE_NOTE =
  "Vendor disembunyikan dari master & pilihan dokumen baru. PR/PO/SPB/IT yang sudah memakai vendor ini tetap utuh dan tidak berubah.";

type VendorFormState = {
  vendor_name: string;
  address: string;
  telephone: string;
  email: string;
  pic_name: string;
  is_active: boolean;
};

const emptyVendorForm: VendorFormState = {
  vendor_name: "",
  address: "",
  telephone: "",
  email: "",
  pic_name: "",
  is_active: true,
};

// Harus sama dengan kolom yang dicari di getVendorList.
const VENDOR_SEARCH_FIELDS = ["Nama", "Kode", "Email", "PIC"];

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  deleted: "Terhapus",
};

const VENDOR_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di service.
const VENDOR_COLUMNS = [
  { id: "vendor_name", label: "Nama Vendor", sortDirection: "asc", className: VENDOR_HEAD_CLASS },
  { id: "vendor_no", label: "Kode Vendor", sortDirection: "asc", className: `w-35 ${VENDOR_HEAD_CLASS}` },
  { id: "email_pic", label: "Email / PIC", className: `w-50 ${VENDOR_HEAD_CLASS}` },
  { id: "is_active", label: "Status", sortDirection: "asc", className: `w-28 text-center ${VENDOR_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type VendorColumnId = (typeof VENDOR_COLUMNS)[number]["id"];

export default function VendorsPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:vendor", VENDOR_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [search, setSearch, resetSearch] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const [isModerator, setIsModerator] = useState(false);
  const statusParam = urlState.get("status");
  // "deleted" = vendor yang sudah dihapus (soft delete), khusus moderator:
  // nilai ini bisa datang dari URL, jadi perannya dicek di sini.
  const statusFilter: "all" | "active" | "inactive" | "deleted" =
    statusParam === "active" ||
    statusParam === "inactive" ||
    (statusParam === "deleted" && isModerator)
      ? statusParam
      : "all";
  const setStatusFilter = (v: string) =>
    urlState.set({ status: v === "all" ? "" : v }, { resetPage: true });
  const isDeletedView = statusFilter === "deleted";
  const sortOrder = urlState.get("sort", "vendor_name_asc");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "vendor_name_asc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<number | null>(null);
  const [form, setForm] = useState<VendorFormState>(emptyVendorForm);

  const [canWrite, setCanWrite] = useState(false);

  // Pilih banyak (moderator): edit massal / hapus / pulihkan. Pilihan bertahan
  // saat ganti halaman, direset saat filter berubah supaya tidak ada vendor
  // tersembunyi ikut terproses.
  const [selectedRows, setSelectedRows] = useState<
    Record<number, BulkEditVendorRow>
  >({});
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const selectedList = Object.values(selectedRows);
  const pageAllSelected =
    vendors.length > 0 && vendors.every((v) => selectedRows[v.id]);

  const filterKey = `${debouncedSearch}|${statusFilter}`;
  const [selectionFilterKey, setSelectionFilterKey] = useState(filterKey);
  if (selectionFilterKey !== filterKey) {
    setSelectionFilterKey(filterKey);
    setSelectedRows({});
  }

  const toggleRow = (vendor: BulkEditVendorRow, checked: boolean) =>
    setSelectedRows((prev) => {
      const next = { ...prev };
      if (checked) next[vendor.id] = vendor;
      else delete next[vendor.id];
      return next;
    });

  const togglePage = (checked: boolean) =>
    setSelectedRows((prev) => {
      const next = { ...prev };
      for (const v of vendors) {
        if (checked) next[v.id] = v;
        else delete next[v.id];
      }
      return next;
    });

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
    setCanWrite(
      roles.some((r: string) =>
        ["purchasing", "admin", "moderator"].includes(r),
      ),
    );
    setIsModerator(roles.includes("moderator"));
  };

  const fetchVendors = async () => {
    setLoading(true);
    const result = await getVendorList({
      page,
      limit,
      search: debouncedSearch,
      is_aktif: isDeletedView ? "all" : statusFilter,
      deleted: isDeletedView,
      sort: sortOrder,
    });

    if (result.error) {
      toast.error(result.error);
      setVendors([]);
      setTotalCount(0);
    } else {
      setVendors(result.data || []);
      setTotalCount(result.total || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRBAC();
  }, []);

  useEffect(() => {
    fetchVendors();
  }, [page, limit, debouncedSearch, statusFilter, sortOrder]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const openCreateDialog = () => {
    setEditingVendorId(null);
    setForm(emptyVendorForm);
    setDialogOpen(true);
  };

  const openEditDialog = (vendor: any) => {
    setEditingVendorId(vendor.id);
    setForm({
      vendor_name: vendor.vendor_name || "",
      address: vendor.address || "",
      telephone: vendor.telephone || "",
      email: vendor.email || "",
      pic_name: vendor.pic_name || "",
      is_active: Boolean(vendor.is_active),
    });
    setDialogOpen(true);
  };

  const resetFilters = () => {
    resetSearch();
    urlState.reset();
  };

  const handleSubmit = async () => {
    if (!form.vendor_name.trim()) {
      toast.error("Nama vendor wajib diisi");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        vendor_name: form.vendor_name,
        address: form.address,
        telephone: form.telephone,
        email: form.email,
        pic_name: form.pic_name,
        is_active: form.is_active,
      };

      const result = editingVendorId
        ? await updateVendor(editingVendorId, payload)
        : await createVendor(payload);

      if (!result.success) {
        toast.error(result.error || "Gagal menyimpan vendor");
        return;
      }

      toast.success(
        editingVendorId
          ? "Vendor berhasil diperbarui"
          : "Vendor berhasil dibuat",
      );
      setDialogOpen(false);
      setEditingVendorId(null);
      setForm(emptyVendorForm);
      await fetchVendors();
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (vendorId: number) => {
    const result = await toggleVendorStatus(vendorId);
    if (!result.success) {
      toast.error(result.error || "Gagal mengubah status vendor");
      return;
    }
    toast.success("Status vendor berhasil diubah");
    await fetchVendors();
  };

  const handleDelete = async (vendorId: number) => {
    if (
      !(await confirm({
        title: "Hapus vendor ini?",
        description: DELETE_NOTE,
        confirmText: "Hapus",
        destructive: true,
      }))
    ) {
      return;
    }

    const toastId = toast.loading("Menghapus vendor...");
    const result = await deleteVendor(vendorId);
    if (!result.success) {
      toast.error(result.error || "Gagal menghapus vendor", { id: toastId });
      return;
    }

    toast.success("Vendor berhasil dihapus", { id: toastId });
    await fetchVendors();
  };

  const handleBulkDelete = async () => {
    const ids = selectedList.map((v) => v.id);
    if (
      !(await confirm({
        title: `Hapus ${ids.length} vendor terpilih?`,
        description: `${DELETE_NOTE} Vendor yang masih punya stok titipan akan dilewati.`,
        confirmText: "Hapus",
        destructive: true,
      }))
    ) {
      return;
    }

    const toastId = toast.loading(`Menghapus ${ids.length} vendor...`);
    const result = await bulkDeleteVendors(ids);
    if (!result.success) {
      toast.error(result.error || "Gagal menghapus vendor", { id: toastId });
      return;
    }

    const skipped = result.skipped || [];
    if (skipped.length > 0) {
      const preview = skipped
        .slice(0, 5)
        .map((s) => s.vendor_no)
        .join(", ");
      toast.warning(
        `${result.deleted} vendor dihapus, ${skipped.length} dilewati (masih ada stok titipan)`,
        {
          id: toastId,
          description:
            preview +
            (skipped.length > 5 ? `, dan ${skipped.length - 5} lainnya` : ""),
          duration: 10000,
        },
      );
    } else {
      toast.success(`${result.deleted} vendor berhasil dihapus`, {
        id: toastId,
      });
    }
    setSelectedRows({});
    await fetchVendors();
  };

  const handleRestore = async (ids: number[]) => {
    const toastId = toast.loading(`Memulihkan ${ids.length} vendor...`);
    const result = await restoreVendors(ids);
    if (!result.success) {
      toast.error(result.error || "Gagal memulihkan vendor", { id: toastId });
      return;
    }
    toast.success(`${result.restored} vendor berhasil dipulihkan`, {
      id: toastId,
    });
    setSelectedRows({});
    await fetchVendors();
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
  const renderCell = (vendor: any, id: VendorColumnId) => {
    switch (id) {
      case "vendor_name":
        return (
          <TableCell>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-foreground uppercase">
                {vendor.vendor_name}
              </span>
              <span className="text-[10px] text-muted-foreground line-clamp-1">
                {vendor.address || "-"}
              </span>
              {vendor.deleted_at && (
                <span className="text-[10px] font-semibold text-destructive">
                  Dihapus{" "}
                  {new Date(vendor.deleted_at).toLocaleDateString(
                    "id-ID",
                  )}
                </span>
              )}
            </div>
          </TableCell>
        );
      case "vendor_no":
        return (
          <TableCell>
            <span className="font-mono text-xs font-bold text-primary">
              {vendor.vendor_no}
            </span>
          </TableCell>
        );
      case "email_pic":
        return (
          <TableCell>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-foreground">
                {vendor.email || "-"}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase">
                PIC: {vendor.pic_name || "-"}
              </span>
            </div>
          </TableCell>
        );
      case "is_active":
        return (
          <TableCell className="text-center">
            <Badge
              variant={vendor.is_active ? "default" : "secondary"}
              className="text-[10px] font-bold uppercase"
            >
              {vendor.is_active ? "Aktif" : "Nonaktif"}
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
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Vendor Management
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Master Data Supplier / Rekanan
              </p>
            </div>
          </div>

          {canWrite ? (
            <Button
              className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase"
              onClick={openCreateDialog}
            >
              <Plus className="h-4 w-4" /> Tambah Vendor
            </Button>
          ) : (
            <Badge
              variant="secondary"
              className="text-[10px] uppercase font-bold"
            >
              View Only (Warehouse)
            </Badge>
          )}
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari nama, kode, email, atau PIC..."
            value={search}
            onChange={setSearch}
            searchableFields={VENDOR_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Status">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                    {isModerator && (
                      <SelectItem value="deleted">Terhapus</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </FilterField>
            </FilterFields>
          </FilterPanel>
        </div>
      </Content>

      <Content>
        {isModerator && selectedList.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <span className="text-xs font-bold text-foreground">
              {selectedList.length} vendor dipilih
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
                  onClick={() => handleRestore(selectedList.map((v) => v.id))}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Pulihkan Terpilih
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs font-bold"
                    onClick={() => setBulkEditOpen(true)}
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
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[1000px]"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
              className="hover:bg-transparent h-10"
            >
              {isModerator && (
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={pageAllSelected}
                    onCheckedChange={(v) => togglePage(v === true)}
                    disabled={loading || vendors.length === 0}
                    aria-label="Pilih semua di halaman ini"
                  />
                </TableHead>
              )}
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
                  <TableCell colSpan={isModerator ? 7 : 6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : vendors.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isModerator ? 7 : 6}
                  className="h-40 text-center text-muted-foreground italic text-sm"
                >
                  {isDeletedView
                    ? "Tidak ada vendor terhapus."
                    : activeFilters.length > 0 || debouncedSearch
                      ? "Tidak ada data vendor yang sesuai filter."
                      : "Belum ada data vendor."}
                </TableCell>
              </TableRow>
            ) : (
              vendors.map((vendor, index) => (
                <TableRow
                  key={vendor.id}
                  className="group hover:bg-muted/30 transition-all border-b border-border/50 h-14"
                >
                  {isModerator && (
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={!!selectedRows[vendor.id]}
                        onCheckedChange={(v) => toggleRow(vendor, v === true)}
                        aria-label={`Pilih ${vendor.vendor_no}`}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">
                    {(page - 1) * limit + index + 1}
                  </TableCell>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(vendor, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      {isDeletedView ? (
                        <DropdownMenuItem
                          disabled={!isModerator}
                          onSelect={() => handleRestore([vendor.id])}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Pulihkan
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem
                            disabled={!canWrite}
                            onSelect={() => openEditDialog(vendor)}
                          >
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canWrite}
                            onSelect={() => handleToggleStatus(vendor.id)}
                          >
                            <ToggleLeft className="mr-2 h-4 w-4" /> Ubah Status
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={!canWrite}
                            onSelect={() => handleDelete(vendor.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Hapus
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowActionsMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          limitOptions={PAGE_SIZE_OPTIONS}
          currentPage={page}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Vendor"
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
              {editingVendorId ? "Edit Vendor" : "Tambah Vendor Baru"}
            </DialogTitle>
            <DialogDescription>
              Lengkapi data vendor untuk kebutuhan pembuatan Purchase Order.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Nama Vendor</Label>
              <Input
                value={form.vendor_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, vendor_name: e.target.value }))
                }
                placeholder="PT Vendor Makmur"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Alamat</Label>
              <Input
                value={form.address}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="Alamat vendor"
              />
            </div>

            <div className="space-y-1.5">
              <Label>No Telepon</Label>
              <Input
                value={form.telephone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, telephone: e.target.value }))
                }
                placeholder="08xxxxxxxxxx"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="vendor@mail.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label>PIC Name</Label>
              <Input
                value={form.pic_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pic_name: e.target.value }))
                }
                placeholder="Nama PIC vendor"
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
              ) : editingVendorId ? (
                "Simpan Perubahan"
              ) : (
                "Tambah Vendor"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {bulkEditOpen && (
        <BulkEditVendorDialog
          open={bulkEditOpen}
          onOpenChange={setBulkEditOpen}
          rows={selectedList}
          onSaved={async () => {
            setBulkEditOpen(false);
            setSelectedRows({});
            await fetchVendors();
          }}
        />
      )}
    </>
  );
}
