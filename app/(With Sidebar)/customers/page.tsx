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
import {
  Building2,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  Search,
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
import { useDebounce } from "use-debounce";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { toast } from "sonner";
import {
  createCustomer,
  getCustomerList,
  toggleCustomerStatus,
  updateCustomer,
} from "@/services/master-actions";

type CustomerFormState = {
  customer_name: string;
  address: string;
  telephone: string;
  email: string;
  pic_name: string;
  is_active: boolean;
};

const emptyCustomerForm: CustomerFormState = {
  customer_name: "",
  address: "",
  telephone: "",
  email: "",
  pic_name: "",
  is_active: true,
};

export default function CustomersPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 350);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(
    null,
  );
  const [form, setForm] = useState<CustomerFormState>(emptyCustomerForm);

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
    setCanWrite(
      roles.some((r: string) => ["logistik", "marketing", "admin"].includes(r)),
    );
  };

  const fetchCustomers = async () => {
    setLoading(true);
    const result = await getCustomerList({
      page,
      limit,
      search: debouncedSearch,
      is_aktif: statusFilter,
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
  }, [page, limit, debouncedSearch, statusFilter]);

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
    });
    setDialogOpen(true);
  };

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPage(1);
  };

  const hasActiveFilters = useMemo(
    () => Boolean(search) || statusFilter !== "all",
    [search, statusFilter],
  );

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
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari nama, kode, email, atau PIC customer..."
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
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Nama Customer
                </TableHead>
                <TableHead className="w-35 text-[10px] font-black uppercase text-muted-foreground">
                  Kode Customer
                </TableHead>
                <TableHead className="w-50 text-[10px] font-black uppercase text-muted-foreground">
                  Email / PIC
                </TableHead>
                <TableHead className="w-28 text-[10px] font-black uppercase text-muted-foreground text-center">
                  Status
                </TableHead>
                <TableHead className="w-30 text-[10px] font-black uppercase text-muted-foreground text-right pr-6">
                  Aksi
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">
                        Memuat Customer...
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : customers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-40 text-center text-muted-foreground italic text-sm"
                  >
                    {hasActiveFilters
                      ? "Tidak ada data customer yang sesuai filter."
                      : "Belum ada data customer."}
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((customer, index) => (
                  <TableRow
                    key={customer.id}
                    className="group hover:bg-muted/30 transition-all border-b border-border/50 h-15"
                  >
                    <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">
                      {(page - 1) * limit + index + 1}
                    </TableCell>
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
                    <TableCell>
                      <span className="font-mono text-xs font-bold text-primary">
                        {customer.customer_no}
                      </span>
                    </TableCell>
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
                    <TableCell className="text-center">
                      <Badge
                        variant={customer.is_active ? "default" : "secondary"}
                        className="text-[10px] font-bold uppercase"
                      >
                        {customer.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditDialog(customer)}
                          disabled={!canWrite}
                          title="Edit customer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleToggleStatus(customer.id)}
                          disabled={!canWrite}
                          title="Toggle status"
                        >
                          <ToggleLeft className="h-3.5 w-3.5" />
                        </Button>
                      </div>
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
            itemLabel="Customer"
          />
        </div>
      </Content>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-140">
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
