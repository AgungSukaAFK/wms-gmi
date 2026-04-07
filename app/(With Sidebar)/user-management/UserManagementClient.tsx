// src/app/(With Sidebar)/user-management/UserManagementClient.tsx

"use client";

import { Content } from "@/components/content";
import { PaginationComponent } from "@/components/pagination"; // Pastikan path ini benar
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Newspaper, Search, Edit } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { formatDateFriendly } from "@/lib/utils";
import { LIMIT_OPTIONS } from "@/type/enum";

interface UserProfile {
  id: string;
  nama: string;
  email: string;
  role: string;
  is_active: boolean;
  cabang_id: number | null;
  signature: string | null;
  created_at: string;
  cabang?: { nama_cabang: string };
}

const dataRole: string[] = ["admin", "warehouse", "approver", "purchasing"];

export function UserManagementClientContent() {
  const s = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // State
  const [userList, setUserList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [isPending, startTransition] = useTransition();
  const [cabangOptions, setCabangOptions] = useState<{ id: number, nama_cabang: string }[]>([]);

  // State dari URL
  const currentPage = Number(searchParams.get("page") || "1");
  const searchTerm = searchParams.get("search") || "";
  const roleFilter = searchParams.get("role") || "";
  const statusFilter = searchParams.get("status") || "";
  const cabangFilter = searchParams.get("cabang") || "";
  const limit = Number(searchParams.get("limit") || 25);

  // State untuk input form
  const [searchInput, setSearchInput] = useState(searchTerm);

  const createQueryString = useCallback(
    (paramsToUpdate: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(paramsToUpdate).forEach(([name, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
        ) {
          params.set(name, String(value));
        } else {
          params.delete(name);
        }
      });
      // Reset ke halaman 1 jika filter atau limit berubah
      if (Object.keys(paramsToUpdate).some((k) => k !== "page")) {
        params.set("page", "1");
      }
      return params.toString();
    },
    [searchParams]
  );

  useEffect(() => {
    async function fetchCabang() {
      const { data } = await s.from("cabang").select("id, nama_cabang").eq("is_active", true);
      if (data) setCabangOptions(data);
    }
    fetchCabang();
  }, [s]);

  // Fetch data user
  useEffect(() => {
    async function fetchUsers() {
      setLoading(true);

      const from = (currentPage - 1) * limit;
      const to = from + limit - 1;

      let query = s.from("profiles").select(`*, cabang(nama_cabang)`, { count: "exact" });

      if (searchTerm)
        query = query.or(`nama.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);

      if (roleFilter) query = query.eq("role", roleFilter);
      if (statusFilter) query = query.eq("is_active", statusFilter === "active");
      if (cabangFilter) query = query.eq("cabang_id", cabangFilter);

      query = query.range(from, to).order("created_at", { ascending: false });

      const { data, error, count } = await query;

      if (error) {
        toast.error("Gagal mengambil data user: " + error.message);
        setUserList([]);
      } else {
        setUserList((data as UserProfile[]) || []);
        setTotalItems(count || 0);
      }
      setLoading(false);
    }
    fetchUsers();
  }, [
    s,
    currentPage,
    searchTerm,
    roleFilter,
    statusFilter,
    cabangFilter,
    limit,
  ]);

  // Efek untuk debounce pencarian
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput !== searchTerm) {
        startTransition(() => {
          router.push(
            `${pathname}?${createQueryString({ search: searchInput })}`
          );
        });
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [searchInput, searchTerm, pathname, router, createQueryString]);

  // Handler untuk filter
  const handleFilterChange = (
    updates: Record<string, string | number | undefined>
  ) => {
    startTransition(() => {
      router.push(`${pathname}?${createQueryString(updates)}`);
    });
  };

  const handleDownloadExcel = async () => {
    setIsExporting(true);
    toast.info("Mempersiapkan data lengkap untuk diunduh...");

    try {
      let query = s
        .from("profiles")
        .select(`nama, email, role, is_active, cabang(nama_cabang), created_at`);

      if (searchTerm)
        query = query.or(`nama.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
      if (roleFilter) query = query.eq("role", roleFilter);
      if (statusFilter) query = query.eq("is_active", statusFilter === "active");
      if (cabangFilter) query = query.eq("cabang_id", cabangFilter);

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.warning("Tidak ada data user untuk diekspor sesuai filter.");
        return;
      }

      const formattedData = data.map((user: any) => ({
        Nama: user.nama,
        Email: user.email,
        Role: user.role,
        Cabang: user.cabang?.nama_cabang || "-",
        Status: user.is_active ? "Aktif" : "Menunggu Approval",
        "Tanggal Dibuat": formatDateFriendly(user.created_at),
      }));

      const worksheet = XLSX.utils.json_to_sheet(formattedData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Daftar User");
      XLSX.writeFile(
        workbook,
        `Daftar_User_${new Date().toISOString().split("T")[0]}.xlsx`
      );

      toast.success("Data user berhasil diunduh!");
    } catch (error: any) {
      toast.error("Gagal mengunduh data", { description: error.message });
    } finally {
      setIsExporting(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    toast.loading("Mengubah status user...");
    const { error } = await s.from("profiles").update({ is_active: !currentStatus }).eq("id", userId);
    toast.dismiss();

    if (error) {
      toast.error("Gagal mengubah status", { description: error.message });
    } else {
      toast.success("Status user berhasil diubah!");
      setUserList(userList.map(u => u.id === userId ? { ...u, is_active: !currentStatus } : u));
    }
  };

  return (
    <Content title="Persetujuan & Manajemen User" size="lg" className="col-span-12">
      {/* --- Filter Section --- */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Cari nama atau email..."
              className="pl-10"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button
            onClick={handleDownloadExcel}
            disabled={isExporting}
            className="w-full md:w-auto"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Newspaper className="mr-2 h-4 w-4" />
            )}
            Download Excel
          </Button>
        </div>

        <div className="p-4 border rounded-lg bg-muted/50">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Role</label>
              <Select
                onValueChange={(value) =>
                  handleFilterChange({
                    role: value === "all" ? undefined : value,
                  })
                }
                defaultValue={roleFilter || "all"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Role</SelectItem>
                  {dataRole.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Cabang</label>
              <Select
                onValueChange={(value) =>
                  handleFilterChange({
                    cabang: value === "all" ? undefined : value,
                  })
                }
                defaultValue={cabangFilter || "all"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter cabang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Cabang</SelectItem>
                  {cabangOptions.map((opt) => (
                    <SelectItem key={opt.id} value={String(opt.id)}>
                      {opt.nama_cabang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Status</label>
              <Select
                onValueChange={(value) =>
                  handleFilterChange({
                    status: value === "all" ? undefined : value,
                  })
                }
                defaultValue={statusFilter || "all"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="pending">Menunggu Approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* --- Table Section --- */}
      <div className="border rounded-md overflow-x-auto">
        <Table className="min-w-[1000px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">No</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading || isPending ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24">
                  <div className="flex justify-center items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Memuat data...
                  </div>
                </TableCell>
              </TableRow>
            ) : userList.length > 0 ? (
              userList.map((user, index) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {(currentPage - 1) * limit + index + 1}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {user.nama || "-"}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.cabang?.nama_cabang || "-"}</TableCell>
                  <TableCell>{user.role || "-"}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {user.is_active ? "Aktif" : "Pending"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={user.is_active ? "destructive" : "default"}
                      size="sm"
                      onClick={() => toggleUserStatus(user.id, user.is_active)}
                    >
                      {user.is_active ? "Nonaktifkan" : "Setujui"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24">
                  Tidak ada user yang ditemukan.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* --- Pagination & Limit Section --- */}
      <div className="mt-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Tampilkan</span>
          <Select
            value={String(limit)}
            onValueChange={(value) => handleFilterChange({ limit: value })}
          >
            <SelectTrigger className="w-[70px]">
              <SelectValue placeholder={limit} />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_OPTIONS?.map((opt) => (
                <SelectItem key={opt} value={String(opt)}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>dari {totalItems} user.</span>
        </div>
        <PaginationComponent
          currentPage={currentPage}
          totalItems={totalItems}
          itemsPerPage={limit}
          basePath={pathname}
        />
      </div>
    </Content>
  );
}
