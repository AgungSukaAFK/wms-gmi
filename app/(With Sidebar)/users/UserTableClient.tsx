"use client";

import React, { useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  filterOptionLabel,
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
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  ShieldCheck,
  ShieldAlert,
  UserCog,
  UserMinus,
  Loader2,
  Users,
  KeyRound,
  Eye,
  EyeOff,
  UserPlus,
} from "lucide-react";
import { toast } from "@/lib/toast";
import {
  toggleUserStatus,
  updateUserDetail,
  deleteUserProfile,
  resetUserPassword,
  createUserAccount,
} from "@/services/user-actions";
import type { Role } from "@/type";
import { useConfirmDialog } from "@/components/confirm-dialog";

interface UserProfile {
  id: string;
  nama: string;
  email: string;
  nrp: string;
  roles: Role[];
  is_active: boolean;
  cabang_id: number | null;
  cabang?: { nama_cabang: string };
}

interface Cabang {
  id: number;
  nama_cabang: string;
}

interface UserTableClientProps {
  users: UserProfile[];
  cabangList: Cabang[];
  allRoles: Role[];
}

// Harus sama dengan kolom yang dicari di filteredUsers.
const USER_SEARCH_FIELDS = ["Nama", "Email", "NRP"];

const USER_STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  inactive: "Pending Approval",
};

const USER_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di sortedUsers.
const USER_COLUMNS = [
  { id: "nama", label: "Nama", sortDirection: "asc", className: USER_HEAD_CLASS },
  { id: "email", label: "Email / NRP", className: USER_HEAD_CLASS },
  { id: "roles", label: "Roles", className: USER_HEAD_CLASS },
  { id: "cabang", label: "Cabang", sortDirection: "asc", className: USER_HEAD_CLASS },
  { id: "status", label: "Status", sortDirection: "asc", className: USER_HEAD_CLASS },
] as const satisfies readonly ReorderableColumn[];
type UserColumnId = (typeof USER_COLUMNS)[number]["id"];

export default function UserTableClient({
  users,
  cabangList,
  allRoles,
}: UserTableClientProps) {
  const { confirm, confirmDialog } = useConfirmDialog();
  // Filter, sort & halaman disimpan di URL (hooks/use-url-list-state.ts).
  const columnOrder = useColumnOrder("wms:table-column-order:users", USER_COLUMNS);
  const urlState = useUrlListState();
  const search = urlState.get("search");
  const [searchInput, setSearchInput, resetSearch] = useUrlSearchInput(
    search,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const statusFilter = urlState.get("status", "all");
  const setStatusFilter = (v: string) =>
    urlState.set({ status: v === "all" ? "" : v }, { resetPage: true });
  const cabangFilters = urlState.list("cabang");
  const setCabangFilters = (v: string[]) =>
    urlState.set({ cabang: v }, { resetPage: true });
  const roleFilters = urlState.list("role");
  const setRoleFilters = (v: string[]) =>
    urlState.set({ role: v }, { resetPage: true });
  const sortOrder = urlState.get("sort");
  const setSortOrder = (v: string) => urlState.set({ sort: v });
  const currentPage = urlState.getNumber("page", 1);
  const setCurrentPage = (p: number) =>
    urlState.set({ page: p === 1 ? "" : p });
  const pageSize = urlState.getNumber("limit", 25);
  const setPageSize = (n: number) =>
    urlState.set({ limit: n === 25 ? "" : n }, { resetPage: true });
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);

  const [editRoleIds, setEditRoleIds] = useState<number[]>([]);
  const [rolesTouched, setRolesTouched] = useState(false);
  const [editCabangId, setEditCabangId] = useState("");

  const [resetPasswordUser, setResetPasswordUser] = useState<UserProfile | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Create new account
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    nama: "",
    email: "",
    password: "",
    nrp: "",
    nomor_whatsapp: "",
    cabang_id: "",
  });
  const [createRoleIds, setCreateRoleIds] = useState<number[]>([]);
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  const filteredUsers = useMemo(() => {
    const searchLower = search.toLowerCase();

    return users.filter((u) => {
      const matchSearch =
        u.nama.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower) ||
        (u.nrp && u.nrp.includes(search));

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && u.is_active) ||
        (statusFilter === "inactive" && !u.is_active);

      const matchCabang =
        cabangFilters.length === 0 ||
        cabangFilters.includes(u.cabang_id?.toString() ?? "");

      const matchRole =
        roleFilters.length === 0 ||
        u.roles.some((r) => roleFilters.includes(r.id.toString()));

      return matchSearch && matchStatus && matchCabang && matchRole;
    });
  }, [users, search, statusFilter, cabangFilters, roleFilters]);

  const sortedUsers = useMemo(() => {
    if (!sortOrder) return filteredUsers;
    const [sortKey, dir] = sortOrder.split(/_(asc|desc)$/);
    const ascending = dir === "asc";
    const getValue = (u: UserProfile) => {
      switch (sortKey) {
        case "nama":
          return u.nama || "";
        case "cabang":
          return u.cabang?.nama_cabang || "";
        case "status":
          return u.is_active ? 1 : 0;
        default:
          return "";
      }
    };
    return [...filteredUsers].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return ascending ? -1 : 1;
      if (va > vb) return ascending ? 1 : -1;
      return 0;
    });
  }, [filteredUsers, sortOrder]);

  const resetFilters = () => {
    resetSearch();
    urlState.reset();
  };

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setCurrentPage(1);
  };

  const cabangOptions = cabangList.map((cabang) => ({
    label: cabang.nama_cabang,
    value: cabang.id.toString(),
  }));
  const roleOptions = allRoles.map((role) => ({
    label: role.label,
    value: role.id.toString(),
  }));

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const activeFilters: ActiveFilter[] = [];
  if (statusFilter !== "all")
    activeFilters.push({
      key: "status",
      label: "Status",
      value: USER_STATUS_LABEL[statusFilter] ?? statusFilter,
      onRemove: () => setStatusFilter("all"),
    });
  if (cabangFilters.length > 0)
    activeFilters.push({
      key: "cabang",
      label: "Cabang",
      value: cabangFilters
        .map((v) => filterOptionLabel(cabangOptions, v))
        .join(", "),
      onRemove: () => setCabangFilters([]),
    });
  if (roleFilters.length > 0)
    activeFilters.push({
      key: "role",
      label: "Role",
      value: roleFilters.map((v) => filterOptionLabel(roleOptions, v)).join(", "),
      onRemove: () => setRoleFilters([]),
    });

  const totalCount = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedUsers = sortedUsers.slice(startIndex, endIndex);

  const handleToggleStatus = async (user: UserProfile) => {
    const label = user.is_active ? "Nonaktifkan" : "Aktifkan";
    if (
      !(await confirm({
        title: `${label} user ${user.nama}?`,
        description: user.is_active
          ? "User tidak akan bisa login sampai diaktifkan lagi."
          : "User akan bisa login kembali.",
        confirmText: label,
        destructive: user.is_active,
      }))
    )
      return;

    setLoadingUserId(user.id);
    const result = await toggleUserStatus(user.id, user.is_active);
    setLoadingUserId(null);

    if (result.success) {
      toast.success(
        user.is_active ? "Akses user dicabut" : "User berhasil diaktifkan",
      );
    } else {
      toast.error("Gagal mengubah status: " + result.error);
    }
  };

  const handleEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditRoleIds(user.roles.map((r) => r.id));
    setRolesTouched(false);
    setEditCabangId(user.cabang_id?.toString() ?? "");
    setIsEditModalOpen(true);
  };

  const toggleRoleSelection = (roleId: number) => {
    setRolesTouched(true);
    setEditRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    );
  };

  const saveEdit = async () => {
    if (!editingUser) return;
    if (editRoleIds.length === 0) {
      toast.error("Setidaknya pilih satu role");
      return;
    }

    setIsUpdating(true);
    const result = await updateUserDetail(editingUser.id, {
      roleIds: editRoleIds,
      cabang_id: parseInt(editCabangId) || 0,
      updateRoles: rolesTouched,
    });
    setIsUpdating(false);

    if (result.success) {
      toast.success("Data user berhasil diperbarui");
      setIsEditModalOpen(false);
    } else {
      toast.error("Gagal memperbarui data: " + result.error);
    }
  };

  const handleDelete = async (user: UserProfile) => {
    if (
      !(await confirm({
        title: `Hapus user ${user.nama}?`,
        confirmText: "Hapus",
        destructive: true,
      }))
    )
      return;

    setLoadingUserId(user.id);
    const result = await deleteUserProfile(user.id);
    setLoadingUserId(null);

    if (result.success) {
      toast.success("User berhasil dihapus");
    } else {
      toast.error("Gagal menghapus user: " + result.error);
    }
  };

  const handleOpenResetPassword = (user: UserProfile) => {
    setResetPasswordUser(user);
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setIsResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser) return;
    if (newPassword !== confirmPassword) {
      toast.error("Password dan konfirmasi tidak cocok.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password minimal 6 karakter.");
      return;
    }

    setIsResetting(true);
    const result = await resetUserPassword(resetPasswordUser.id, newPassword);
    setIsResetting(false);

    if (result.success) {
      toast.success(`Password ${resetPasswordUser.nama} berhasil direset.`);
      setIsResetModalOpen(false);
    } else {
      toast.error("Gagal reset password: " + result.error);
    }
  };

  const openCreateModal = () => {
    setCreateForm({
      nama: "",
      email: "",
      password: "",
      nrp: "",
      nomor_whatsapp: "",
      cabang_id: "",
    });
    setCreateRoleIds([]);
    setShowCreatePassword(false);
    setIsCreateModalOpen(true);
  };

  const toggleCreateRole = (roleId: number) => {
    setCreateRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    );
  };

  const handleCreateAccount = async () => {
    if (!createForm.nama.trim()) return toast.error("Nama wajib diisi.");
    if (!createForm.email.trim()) return toast.error("Email wajib diisi.");
    if (createForm.password.length < 6)
      return toast.error("Password minimal 6 karakter.");
    if (!createForm.cabang_id) return toast.error("Pilih cabang.");
    if (createRoleIds.length === 0)
      return toast.error("Pilih minimal satu role.");

    setIsCreating(true);
    const result = await createUserAccount({
      nama: createForm.nama.trim(),
      email: createForm.email.trim(),
      password: createForm.password,
      nrp: createForm.nrp.trim() || undefined,
      nomor_whatsapp: createForm.nomor_whatsapp.trim() || undefined,
      cabang_id: parseInt(createForm.cabang_id),
      roleIds: createRoleIds,
      is_active: true,
    });
    setIsCreating(false);

    if (result.success) {
      toast.success(`Akun ${createForm.nama} berhasil dibuat.`);
      setIsCreateModalOpen(false);
    } else {
      toast.error("Gagal membuat akun: " + result.error);
    }
  };

  const getBadgeColor = (color: string | null | undefined) => {
    switch (color) {
      case "red":
        return "bg-destructive/10 text-destructive border-destructive/20";
      case "orange":
      case "amber":
      case "yellow":
        return "bg-warning/10 text-warning border-warning/20";
      case "green":
      case "teal":
      case "lime":
        return "bg-success/10 text-success border-success/20";
      case "blue":
      case "indigo":
      case "cyan":
      case "purple":
        return "bg-primary/10 text-primary border-primary/20";
      case "gray":
      case "slate":
        return "bg-muted text-muted-foreground border-border";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (user: UserProfile, id: UserColumnId) => {
    switch (id) {
      case "nama":
        return (
          <TableCell className="font-semibold text-foreground">
            {user.nama}
          </TableCell>
        );
      case "email":
        return (
          <TableCell>
            <div className="flex flex-col">
              <span className="text-sm text-foreground">
                {user.email}
              </span>
              <span className="text-xs text-muted-foreground">
                {user.nrp || "-"}
              </span>
            </div>
          </TableCell>
        );
      case "roles":
        return (
          <TableCell>
            <div className="flex flex-wrap gap-1">
              {user.roles.length > 0 ? (
                user.roles.map((r) => (
                  <Badge
                    key={r.id}
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 capitalize border shadow-sm ${getBadgeColor(r.color)}`}
                  >
                    {r.label}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground italic">
                  No role
                </span>
              )}
            </div>
          </TableCell>
        );
      case "cabang":
        return (
          <TableCell className="text-foreground">
            {user.cabang?.nama_cabang || "-"}
          </TableCell>
        );
      case "status":
        return (
          <TableCell>
            <Badge
              variant={user.is_active ? "default" : "destructive"}
              className="text-[10px]"
            >
              {user.is_active ? "Aktif" : "Pending Approval"}
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
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                USER MANAGEMENT
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Kelola akun, role, dan cabang pengguna
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase">
              {filteredUsers.length} pengguna
            </p>
            <Button onClick={openCreateModal} className="h-9 gap-2">
              <UserPlus className="h-4 w-4" />
              Buat Akun
            </Button>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari Nama, Email, atau NRP..."
            value={searchInput}
            onChange={setSearchInput}
            searchableFields={USER_SEARCH_FIELDS}
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
                    <SelectItem value="inactive">Pending Approval</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="Cabang">
                <MultiSelect
                  placeholder="Semua Cabang"
                  searchable
                  selected={cabangFilters}
                  onChange={setCabangFilters}
                  options={cabangOptions}
                />
              </FilterField>

              <FilterField label="Role">
                <MultiSelect
                  placeholder="Semua Role"
                  selected={roleFilters}
                  onChange={setRoleFilters}
                  options={roleOptions}
                />
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
            {paginatedUsers.length > 0 ? (
              paginatedUsers.map((user) => (
                <TableRow key={user.id} className="hover:bg-muted/30">
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(user, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    {loadingUserId === user.id ? (
                      <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <RowActionsMenu>
                        <DropdownMenuItem
                          onSelect={() => handleEdit(user)}
                        >
                          <UserCog className="mr-2 h-4 w-4" /> Edit Roles & Cabang
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => handleOpenResetPassword(user)}
                        >
                          <KeyRound className="mr-2 h-4 w-4" /> Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleToggleStatus(user)}>
                          {user.is_active ? (
                            <>
                              <ShieldAlert className="mr-2 h-4 w-4 text-destructive" />
                              Cabut Akses
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="mr-2 h-4 w-4 text-success" />
                              Buka Akses (Approve)
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => handleDelete(user)}
                        >
                          <UserMinus className="mr-2 h-4 w-4" /> Hapus User
                        </DropdownMenuItem>
                      </RowActionsMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  Tidak ada data user.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={safeCurrentPage}
          totalItems={totalCount}
          limit={pageSize}
          itemLabel="pengguna"
          onPageChange={setCurrentPage}
          onLimitChange={(value) => setPageSize(Number(value))}
          className="mt-6"
        />
      </Content>

      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="sm:max-w-130 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Buat Akun Pengguna Baru</DialogTitle>
            <DialogDescription>
              Akun langsung aktif dan bisa login tanpa verifikasi email.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Nama Lengkap *</Label>
                <Input
                  placeholder="Nama pengguna"
                  value={createForm.nama}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, nama: e.target.value }))
                  }
                  className="text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Email *</Label>
                <Input
                  type="email"
                  placeholder="email@contoh.com"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Password *</Label>
              <div className="relative">
                <Input
                  type={showCreatePassword ? "text" : "password"}
                  placeholder="Minimal 6 karakter"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, password: e.target.value }))
                  }
                  className="pr-10 text-sm"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCreatePassword((v) => !v)}
                >
                  {showCreatePassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">NRP (Opsional)</Label>
                <Input
                  placeholder="Nomor registrasi pegawai"
                  value={createForm.nrp}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, nrp: e.target.value }))
                  }
                  className="text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  No. WhatsApp (Opsional)
                </Label>
                <Input
                  placeholder="0812xxxx"
                  value={createForm.nomor_whatsapp}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      nomor_whatsapp: e.target.value,
                    }))
                  }
                  className="text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Penempatan Cabang *</Label>
              <Select
                value={createForm.cabang_id}
                onValueChange={(v) =>
                  setCreateForm((f) => ({ ...f, cabang_id: v }))
                }
              >
                <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                  <SelectValue placeholder="Pilih Cabang" />
                </SelectTrigger>
                <SelectContent>
                  {cabangList.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.nama_cabang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                User Roles (Multiple) *
              </Label>
              <div className="grid grid-cols-2 gap-3 p-3 border border-input rounded-md bg-muted/40">
                {allRoles.map((role) => (
                  <div key={role.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`create-role-${role.id}`}
                      checked={createRoleIds.includes(role.id)}
                      onCheckedChange={() => toggleCreateRole(role.id)}
                    />
                    <label
                      htmlFor={`create-role-${role.id}`}
                      className="text-xs font-medium leading-none cursor-pointer capitalize"
                    >
                      {role.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isCreating}
            >
              Batal
            </Button>
            <Button onClick={handleCreateAccount} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Membuat...
                </>
              ) : (
                "Buat Akun"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-106.25">
          <DialogHeader>
            <DialogTitle>Edit Akun Pengguna</DialogTitle>
            <DialogDescription>
              Sesuaikan role dan penempatan cabang untuk{" "}
              <strong>{editingUser?.nama}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-4">
              <Label className="text-sm font-semibold">
                User Roles (Multiple)
              </Label>
              <div className="grid grid-cols-2 gap-3 p-3 border border-input rounded-md bg-muted/40">
                {allRoles.map((role) => (
                  <div key={role.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`role-${role.id}`}
                      checked={editRoleIds.includes(role.id)}
                      onCheckedChange={() => toggleRoleSelection(role.id)}
                    />
                    <label
                      htmlFor={`role-${role.id}`}
                      className="text-xs font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize"
                    >
                      {role.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Penempatan Cabang</Label>
              <Select value={editCabangId} onValueChange={setEditCabangId}>
                <SelectTrigger className="h-9 border-input bg-background text-xs font-semibold text-foreground">
                  <SelectValue placeholder="Pilih Cabang" />
                </SelectTrigger>
                <SelectContent>
                  {cabangList.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.nama_cabang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditModalOpen(false)}
              disabled={isUpdating}
            >
              Batal
            </Button>
            <Button onClick={saveEdit} disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                "Simpan Perubahan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isResetModalOpen} onOpenChange={setIsResetModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set password baru untuk <strong>{resetPasswordUser?.nama}</strong>.
              User tidak perlu konfirmasi email.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Password Baru</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimal 6 karakter"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-10 text-sm"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Konfirmasi Password</Label>
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Ulangi password baru"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsResetModalOpen(false)}
              disabled={isResetting}
            >
              Batal
            </Button>
            <Button onClick={handleResetPassword} disabled={isResetting}>
              {isResetting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Mereset...
                </>
              ) : (
                "Reset Password"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
