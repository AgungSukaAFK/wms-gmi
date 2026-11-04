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
  MapPin,
  Pencil,
  Plus,
  ToggleLeft,
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
  createCustomer,
  getCustomerList,
  toggleCustomerStatus,
  updateCustomer,
} from "@/services/master-actions";
import { CustomerSitesDialog } from "@/components/customers/customer-sites-dialog";

const CUSTOMER_SORT_COLUMNS: Record<string, string> = {
  customer_name: "customer_name",
  customer_no: "customer_no",
  email: "email",
  is_active: "is_active",
};

type CustomerType = "consignment" | "non_consignment" | "both";

type CustomerFormState = {
  customer_name: string;
  address: string;
  telephone: string;
  email: string;
  pic_name: string;
  is_active: boolean;
  customer_type: CustomerType;
};

const emptyCustomerForm: CustomerFormState = {
  customer_name: "",
  address: "",
  telephone: "",
  email: "",
  pic_name: "",
  is_active: true,
  customer_type: "non_consignment",
};

const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  consignment: "Consignment",
  non_consignment: "Non-Consignment",
  both: "Keduanya",
};

// Harus sama dengan kolom yang dicari di getCustomerList.
const CUSTOMER_SEARCH_FIELDS = ["Nama", "Kode", "Email", "PIC"];

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  deleted: "Terhapus",
};

const CUSTOMER_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di CUSTOMER_SORT_COLUMNS.
const CUSTOMER_COLUMNS = [
  { id: "customer_name", label: "Nama Customer", sortDirection: "asc", className: CUSTOMER_HEAD_CLASS },
  { id: "customer_no", label: "Kode Customer", sortDirection: "asc", className: `w-35 ${CUSTOMER_HEAD_CLASS}` },
  { id: "email", label: "Email / PIC", sortDirection: "asc", className: `w-50 ${CUSTOMER_HEAD_CLASS}` },
  { id: "jenis", label: "Jenis", className: `w-32 ${CUSTOMER_HEAD_CLASS}` },
  { id: "is_active", label: "Status", sortDirection: "asc", className: `w-28 text-center ${CUSTOMER_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type CustomerColumnId = (typeof CUSTOMER_COLUMNS)[number]["id"];

export default function CustomersPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:customer", CUSTOMER_COLUMNS);
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
  const typeParam = urlState.get("jenis");
  const typeFilter: "all" | CustomerType =
    typeParam in CUSTOMER_TYPE_LABEL ? (typeParam as CustomerType) : "all";
  const setTypeFilter = (v: string) =>
    urlState.set({ jenis: v === "all" ? "" : v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "customer_name_asc");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "customer_name_asc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(
    null,
  );
  const [form, setForm] = useState<CustomerFormState>(emptyCustomerForm);

  const [canWrite, setCanWrite] = useState(false);
  const [sitesCustomer, setSitesCustomer] = useState<any | null>(null);

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
      roles.some((r: string) => ["marketing", "moderator"].includes(r)),
    );
  };

  const fetchCustomers = async () => {
    setLoading(true);
    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = CUSTOMER_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "customer_name";
    const ascending = sortColumn ? sortDirRaw === "asc" : true;

    const result = await getCustomerList({
      page,
      limit,
      search: debouncedSearch,
      is_aktif: statusFilter,
      customer_type: typeFilter,
      sortField,
      ascending,
    });

    if (result.error) {
      toast.error(result.error);
      setCustomers([]);
      setTotalCount(0);
    } else {
      setCustomers(result.data || []);
      setTotalCount(result.total || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRBAC();
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [page, limit, debouncedSearch, statusFilter, typeFilter, sortOrder]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const openCreateDialog = () => {
    setEditingCustomerId(null);
    setForm(emptyCustomerForm);
    setDialogOpen(true);
  };

  const openEditDialog = (customer: any) => {
    setEditingCustomerId(customer.id);
    setForm({
      customer_name: customer.customer_name || "",
      address: customer.address || "",
      telephone: customer.telephone || "",
      email: customer.email || "",
      pic_name: customer.pic_name || "",
      is_active: Boolean(customer.is_active),
      customer_type: (customer.customer_type as CustomerType) || "non_consignment",
    });
    setDialogOpen(true);
  };

  const resetFilters = () => {
    resetSearch();
    urlState.reset();
  };

  const handleSubmit = async () => {
    if (!form.customer_name.trim()) {
      toast.error("Nama customer wajib diisi");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        customer_name: form.customer_name,
        address: form.address,
        telephone: form.telephone,
        email: form.email,
        pic_name: form.pic_name,
        is_active: form.is_active,
        customer_type: form.customer_type,
      };

      const result = editingCustomerId
        ? await updateCustomer(editingCustomerId, payload)
        : await createCustomer(payload);

      if (!result.success) {
        toast.error(result.error || "Gagal menyimpan customer");
        return;
      }

      toast.success(
        editingCustomerId
          ? "Customer berhasil diperbarui"
          : "Customer berhasil dibuat",
      );
      setDialogOpen(false);
      setEditingCustomerId(null);
      setForm(emptyCustomerForm);
      await fetchCustomers();
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (customerId: number) => {
    const result = await toggleCustomerStatus(customerId);
    if (!result.success) {
      toast.error(result.error || "Gagal mengubah status customer");
      return;
    }
    toast.success("Status customer berhasil diubah");
    await fetchCustomers();
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
  if (typeFilter !== "all")
    activeFilters.push({
      key: "jenis",
      label: "Jenis",
      value: CUSTOMER_TYPE_LABEL[typeFilter],
      onRemove: () => setTypeFilter("all"),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (customer: any, id: CustomerColumnId) => {
    switch (id) {
      case "customer_name":
        return (
          <TableCell>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-foreground uppercase">
                {customer.customer_name}
              </span>
              <span className="text-[10px] text-muted-foreground line-clamp-1">
                {customer.address || "-"}
              </span>
            </div>
          </TableCell>
        );
      case "customer_no":
        return (
          <TableCell>
            <span className="font-mono text-xs font-bold text-primary">
              {customer.customer_no}
            </span>
          </TableCell>
        );
      case "email":
        return (
          <TableCell>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-foreground">
                {customer.email || "-"}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase">
                PIC: {customer.pic_name || "-"}
              </span>
            </div>
          </TableCell>
        );
      case "jenis":
        return (
          <TableCell>
            <Badge
              variant={
                customer.customer_type === "consignment"
                  ? "default"
                  : customer.customer_type === "both"
                    ? "outline"
                    : "secondary"
              }
              className="text-[10px] font-bold uppercase"
            >
              {CUSTOMER_TYPE_LABEL[
                (customer.customer_type as CustomerType) ||
                  "non_consignment"
              ]}
            </Badge>
          </TableCell>
        );
      case "is_active":
        return (
          <TableCell className="text-center">
            <Badge
              variant={customer.is_active ? "default" : "secondary"}
              className="text-[10px] font-bold uppercase"
            >
              {customer.is_active ? "Aktif" : "Nonaktif"}
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
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Customer Management
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Master Data Pelanggan / Klien
              </p>
            </div>
          </div>

          {canWrite ? (
            <Button
              className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase"
              onClick={openCreateDialog}
            >
              <Plus className="h-4 w-4" /> Tambah Customer
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
            placeholder="Cari nama, kode, email, atau PIC..."
            value={search}
            onChange={setSearch}
            searchableFields={CUSTOMER_SEARCH_FIELDS}
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
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="Jenis Customer">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9 border-input bg-background text-xs font-bold text-foreground">
                    <SelectValue placeholder="Jenis Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Jenis</SelectItem>
                    <SelectItem value="consignment">Consignment</SelectItem>
                    <SelectItem value="non_consignment">Non-Consignment</SelectItem>
                    <SelectItem value="both">Keduanya</SelectItem>
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
          className="min-w-[1000px]"
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
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-40 text-center text-muted-foreground italic text-sm"
                >
                  {activeFilters.length > 0 || debouncedSearch
                    ? "Tidak ada data customer yang sesuai filter."
                    : "Belum ada data customer."}
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer, index) => (
                <TableRow
                  key={customer.id}
                  className="group hover:bg-muted/30 transition-all border-b border-border/50 h-14"
                >
                  <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">
                    {(page - 1) * limit + index + 1}
                  </TableCell>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(customer, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => setSitesCustomer(customer)}
                      >
                        <MapPin className="mr-2 h-4 w-4" /> Kelola Site
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canWrite}
                        onSelect={() => openEditDialog(customer)}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canWrite}
                        onSelect={() => handleToggleStatus(customer.id)}
                      >
                        <ToggleLeft className="mr-2 h-4 w-4" /> Ubah Status
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
          itemLabel="Customer"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val, 10));
            setPage(1);
          }}
          className="mt-6"
        />
      </Content>

      <CustomerSitesDialog
        customer={sitesCustomer}
        open={!!sitesCustomer}
        onOpenChange={(open) => {
          if (!open) setSitesCustomer(null);
        }}
        canWrite={canWrite}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-140">
          <DialogHeader>
            <DialogTitle>
              {editingCustomerId ? "Edit Customer" : "Tambah Customer Baru"}
            </DialogTitle>
            <DialogDescription>
              Lengkapi data customer untuk proses SPB / external delivery.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Nama Customer</Label>
              <Input
                value={form.customer_name}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    customer_name: e.target.value,
                  }))
                }
                placeholder="PT Pelanggan Sejahtera"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Alamat</Label>
              <Input
                value={form.address}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="Alamat customer"
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
                placeholder="customer@mail.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label>PIC Name</Label>
              <Input
                value={form.pic_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, pic_name: e.target.value }))
                }
                placeholder="Nama PIC customer"
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

            <div className="space-y-1.5">
              <Label>Jenis Customer</Label>
              <Select
                value={form.customer_type}
                onValueChange={(val: CustomerType) =>
                  setForm((prev) => ({ ...prev, customer_type: val }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consignment">Consignment</SelectItem>
                  <SelectItem value="non_consignment">
                    Non-Consignment
                  </SelectItem>
                  <SelectItem value="both">Keduanya</SelectItem>
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
              ) : editingCustomerId ? (
                "Simpan Perubahan"
              ) : (
                "Tambah Customer"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
