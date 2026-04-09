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
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Role } from "@/type";

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

export default function UserTableClient({ users, cabangList, allRoles }: UserTableClientProps) {
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);

  // States untuk editor
  const [editRoleIds, setEditRoleIds] = useState<number[]>([]);
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
    setEditRoleIds(user.roles.map((r) => r.id));
    setEditCabangId(user.cabang_id?.toString() ?? "");
    setIsEditModalOpen(true);
  };

  const toggleRoleSelection = (roleId: number) => {
    setEditRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
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

  // Helper untuk menentukan warna badge
  const getBadgeColor = (color: string | null | undefined) => {
    switch (color) {
      case "red": return "bg-red-100 text-red-800 border-red-200 hover:bg-red-100";
      case "orange": return "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100";
      case "yellow": return "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100";
      case "green": return "bg-green-100 text-green-800 border-green-200 hover:bg-green-100";
      case "blue": return "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100";
      case "purple": return "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100";
      case "indigo": return "bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-100";
      case "cyan": return "bg-cyan-100 text-cyan-800 border-cyan-200 hover:bg-cyan-100";
      case "teal": return "bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-100";
      case "lime": return "bg-lime-100 text-lime-800 border-lime-200 hover:bg-lime-100";
      case "amber": return "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100";
      case "gray": return "bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100";
      case "slate": return "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-100";
      default: return "bg-secondary text-secondary-foreground";
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
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Email / NRP</TableHead>
              <TableHead>Roles</TableHead>
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
                      <span className="text-sm">{user.email}</span>
                      <span className="text-xs text-muted-foreground">{user.nrp || "-"}</span>
                    </div>
                  </TableCell>
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
                        <span className="text-xs text-muted-foreground italic">No role</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{user.cabang?.nama_cabang || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "destructive"} className="text-[10px]">
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
                            Edit Roles & Cabang
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
            <div className="space-y-4">
              <Label className="text-sm font-semibold">User Roles (Multiple)</Label>
              <div className="grid grid-cols-2 gap-3 p-3 border rounded-md bg-slate-50">
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
