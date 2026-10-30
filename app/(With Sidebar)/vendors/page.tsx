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
  Building2,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
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
import { useDebounce } from "use-debounce";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { toast } from "sonner";
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

export default function VendorsPage() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 350);
  // "deleted" = vendor yang sudah dihapus (soft delete), khusus moderator.
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive" | "deleted"
  >("all");
  const isDeletedView = statusFilter === "deleted";
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sortOrder, setSortOrder] = useState("vendor_name_asc");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<number | null>(null);
  const [form, setForm] = useState<VendorFormState>(emptyVendorForm);

  const [canWrite, setCanWrite] = useState(false);
  const [isModerator, setIsModerator] = useState(false);

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
    setSearch("");
    setStatusFilter("all");
    setSortOrder("vendor_name_asc");
    setPage(1);
  };

  const hasActiveFilters = useMemo(
    () =>
      Boolean(search) ||
      statusFilter !== "all" ||
      sortOrder !== "vendor_name_asc",
    [search, statusFilter, sortOrder],
  );

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
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari nama, kode, email, atau PIC vendor..."
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
              onValueChange={(
                val: "all" | "active" | "inactive" | "deleted",
              ) => {
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
                {isModerator && (
                  <SelectItem value="deleted">Terhapus</SelectItem>
                )}
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
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50 border-b border-border">
              <TableRow className="hover:bg-transparent h-10">
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
                <SortableTableHead
                  sortKey="vendor_name"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="text-[10px] font-black uppercase text-muted-foreground"
                >
                  Nama Vendor
                </SortableTableHead>
                <SortableTableHead
                  sortKey="vendor_no"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="w-35 text-[10px] font-black uppercase text-muted-foreground"
                >
                  Kode Vendor
                </SortableTableHead>
                <TableHead className="w-50 text-[10px] font-black uppercase text-muted-foreground">
                  Email / PIC
                </TableHead>
                <SortableTableHead
                  sortKey="is_active"
                  currentSort={sortOrder}
                  onSort={handleSortChange}
                  className="w-28 text-[10px] font-black uppercase text-muted-foreground justify-center text-center"
                >
                  Status
                </SortableTableHead>
                <TableHead className="w-40 text-[10px] font-black uppercase text-muted-foreground text-right pr-6">
                  Aksi
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={isModerator ? 7 : 6}
                    className="h-40 text-center"
                  >
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">
                        Memuat Vendor...
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : vendors.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isModerator ? 7 : 6}
                    className="h-40 text-center text-muted-foreground italic text-sm"
                  >
                    {isDeletedView
                      ? "Tidak ada vendor terhapus."
                      : hasActiveFilters
                      ? "Tidak ada data vendor yang sesuai filter."
                      : "Belum ada data vendor."}
                  </TableCell>
                </TableRow>
              ) : (
                vendors.map((vendor, index) => (
                  <TableRow
                    key={vendor.id}
                    className="group hover:bg-muted/30 transition-all border-b border-border/50 h-15"
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
                    <TableCell>
                      <span className="font-mono text-xs font-bold text-primary">
                        {vendor.vendor_no}
                      </span>
                    </TableCell>
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
                    <TableCell className="text-center">
                      <Badge
                        variant={vendor.is_active ? "default" : "secondary"}
                        className="text-[10px] font-bold uppercase"
                      >
                        {vendor.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      {isDeletedView ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs font-semibold"
                          onClick={() => handleRestore([vendor.id])}
                          disabled={!isModerator}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Pulihkan
                        </Button>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(vendor)}
                            disabled={!canWrite}
                            title="Edit vendor"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleToggleStatus(vendor.id)}
                            disabled={!canWrite}
                            title="Toggle status"
                          >
                            <ToggleLeft className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(vendor.id)}
                            disabled={!canWrite}
                            title="Hapus vendor"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
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
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            itemLabel="Vendor"
          />
        </div>
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
