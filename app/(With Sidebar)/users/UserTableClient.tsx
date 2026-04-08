"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import {
  MoreHorizontal,
  ShieldCheck,
  ShieldAlert,
  UserCog,
  UserMinus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  toggleUserStatus,
  updateUserDetail,
  deleteUserProfile,
} from "@/services/user-actions";

interface UserProfile {
  id: string;
  nama: string;
  email: string;
  nrp: string;
  role: string;
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
}

const ROLES = ["admin", "warehouse", "finance", "approver", "purchasing", "ga"];

export default function UserTableClient({ users, cabangList }: UserTableClientProps) {
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);

  // Controlled state — Radix UI Select tidak compatible dengan FormData
  const [editRole, setEditRole] = useState("");
  const [editCabangId, setEditCabangId] = useState("");

  const filteredUsers = users.filter(
    (u) =>
      u.nama.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.nrp && u.nrp.includes(search))
  );

  const handleToggleStatus = async (user: UserProfile) => {
    const label = user.is_active ? "Nonaktifkan" : "Aktifkan";
    if (!confirm(`${label} user ${user.nama}?`)) return;

    setLoadingUserId(user.id);
    const result = await toggleUserStatus(user.id, user.is_active);
    setLoadingUserId(null);

    if (result.success) {
      toast.success(user.is_active ? "Akses user dicabut" : "User berhasil diaktifkan");
    } else {
      toast.error("Gagal mengubah status: " + result.error);
    }
  };

  const handleEdit = (user: UserProfile) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditCabangId(user.cabang_id?.toString() ?? "");
    setIsEditModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editingUser) return;
    if (!editRole) {
      toast.error("Role harus dipilih");
      return;
    }

    setIsUpdating(true);
    const result = await updateUserDetail(editingUser.id, {
      role: editRole,
      cabang_id: parseInt(editCabangId) || 0,
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
    if (!confirm(`Hapus user ${user.nama}? Tindakan ini tidak dapat dibatalkan.`)) return;

    setLoadingUserId(user.id);
    const result = await deleteUserProfile(user.id);
    setLoadingUserId(null);

    if (result.success) {
      toast.success("User berhasil dihapus");
    } else {
      toast.error("Gagal menghapus user: " + result.error);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex items-center justify-between">
        <Input
          placeholder="Cari Nama, Email, atau NRP..."
          className="max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="text-sm text-muted-foreground">{filteredUsers.length} pengguna</p>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Email / NRP</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[60px]">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.nama}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{user.email}</span>
                      <span className="text-xs text-muted-foreground">{user.nrp || "-"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{user.cabang?.nama_cabang || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "destructive"}>
                      {user.is_active ? "Aktif" : "Pending Approval"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {loadingUserId === user.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Buka menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => handleEdit(user)}>
                            <UserCog className="mr-2 h-4 w-4" />
                            Edit Role & Cabang
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleStatus(user)}>
                            {user.is_active ? (
                              <>
                                <ShieldAlert className="mr-2 h-4 w-4 text-destructive" />
                                Cabut Akses
                              </>
                            ) : (
                              <>
                                <ShieldCheck className="mr-2 h-4 w-4 text-green-600" />
                                Buka Akses (Approve)
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(user)}
                            className="text-destructive focus:text-destructive"
                          >
                            <UserMinus className="mr-2 h-4 w-4" />
                            Hapus User
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Tidak ada data user.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Akun Pengguna</DialogTitle>
            <DialogDescription>
              Sesuaikan role dan penempatan cabang untuk{" "}
              <strong>{editingUser?.nama}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nama</Label>
              <Input value={editingUser?.nama ?? ""} disabled />
            </div>

            <div className="space-y-2">
              <Label>Role / Jabatan</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role} className="capitalize">
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Penempatan Cabang</Label>
              <Select value={editCabangId} onValueChange={setEditCabangId}>
                <SelectTrigger>
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
    </div>
  );
}
