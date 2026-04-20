"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield, Loader2, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Content } from "@/components/content";
import {
  getRolePermissions,
  setRolePermissions,
} from "@/services/role-actions";
import type { Role } from "@/type";

interface Cabang {
  id: number;
  nama_cabang: string;
}

const AVAILABLE_PAGES = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/stock", label: "Inventory Monitoring" },
  { path: "/receive", label: "Receiving (Barang Masuk)" },
  { path: "/deliveries", label: "Deliveries (Barang Keluar)" },
  { path: "/mr", label: "Material Request (MR)" },
  { path: "/pr", label: "Purchase Requisition (PR)" },
  { path: "/po", label: "Purchase Order (PO)" },
  { path: "/spb", label: "SPB (Surat Permintaan Barang)" },
  { path: "/return-spb", label: "Return SPB" },
  { path: "/job-costing", label: "Job Costing" },
  { path: "/barang", label: "Master Barang" },
  { path: "/vendors", label: "Master Vendor" },
  { path: "/customers", label: "Master Customer" },
  { path: "/users", label: "User Management" },
  { path: "/role-management", label: "Role & Permission" },
];

export default function RoleManagementClient({
  initialRoles,
  cabangList,
}: {
  initialRoles: Role[];
  cabangList: Cabang[];
}) {
  const [activeTab, setActiveTab] = useState("permissions");
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(
    initialRoles[0]?.id || null,
  );
  const [permissions, setPermissions] = useState<
    { page_path: string; cabang_id: number | null }[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (selectedRoleId) {
      loadPermissions(selectedRoleId);
    }
  }, [selectedRoleId]);

  const loadPermissions = async (roleId: number) => {
    setIsLoading(true);
    const { data } = await getRolePermissions(roleId);
    setPermissions(data || []);
    setIsLoading(false);
  };

  const isChecked = (path: string, cabangId: number | null) => {
    return permissions.some(
      (p) => p.page_path === path && p.cabang_id === cabangId,
    );
  };

  const togglePermission = (path: string, cabangId: number | null) => {
    setPermissions((prev) => {
      const exists = prev.find(
        (p) => p.page_path === path && p.cabang_id === cabangId,
      );
      if (exists) {
        return prev.filter(
          (p) => !(p.page_path === path && p.cabang_id === cabangId),
        );
      }
      return [...prev, { page_path: path, cabang_id: cabangId }];
    });
  };

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setIsSaving(true);
    const result = await setRolePermissions(selectedRoleId, permissions);
    setIsSaving(false);

    if (result.success) {
      toast.success("Permission berhasil diperbarui");
    } else {
      toast.error("Gagal menyimpan: " + result.error);
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-md flex items-center justify-center shadow-sm text-primary-foreground">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                ROLE MANAGEMENT
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Konfigurasi matriks hak akses role dan cabang
              </p>
            </div>
          </div>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 xl:w-100 h-9">
              <TabsTrigger
                value="permissions"
                className="text-xs font-semibold"
              >
                Matrix Permissions
              </TabsTrigger>
              <TabsTrigger value="roles" className="text-xs font-semibold">
                Manage Roles
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === "permissions" && (
            <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
              <Select
                value={selectedRoleId?.toString()}
                onValueChange={(v) => setSelectedRoleId(parseInt(v))}
              >
                <SelectTrigger className="h-9 w-full sm:w-45 border-input bg-background text-xs font-semibold text-foreground">
                  <SelectValue placeholder="Pilih Role" />
                </SelectTrigger>
                <SelectContent>
                  {initialRoles.map((r) => (
                    <SelectItem
                      key={r.id}
                      value={r.id.toString()}
                      className="capitalize"
                    >
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleSave}
                disabled={isSaving || !selectedRoleId}
                className="h-9 gap-2 font-bold text-xs shadow-sm rounded-md px-4 uppercase"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Simpan Perubahan
              </Button>
            </div>
          )}
        </div>
      </Content>

      <Content className="overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsContent value="permissions" className="mt-0">
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  Permission Matrix
                </h2>
                <p className="text-xs text-muted-foreground font-medium">
                  Atur hak akses halaman per role dan per cabang.
                </p>
              </div>

              {isLoading ? (
                <div className="flex h-100 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="rounded-md border border-border overflow-x-auto bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableHead className="w-62.5 sticky left-0 bg-muted/50 z-20 border-r border-border text-xs font-bold uppercase text-foreground">
                            Halaman / Modul
                          </TableHead>
                          <TableHead className="text-center bg-primary/10 text-primary text-xs font-bold uppercase">
                            Global (Semua Cabang)
                          </TableHead>
                          {cabangList.map((c) => (
                            <TableHead
                              key={c.id}
                              className="text-center min-w-30 text-xs font-bold uppercase text-foreground"
                            >
                              {c.nama_cabang}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {AVAILABLE_PAGES.map((page) => (
                          <TableRow
                            key={page.path}
                            className="hover:bg-muted/30"
                          >
                            <TableCell className="font-medium sticky left-0 bg-background z-10 border-r border-border">
                              {page.label}
                              <div className="text-[10px] font-normal text-muted-foreground">
                                {page.path}
                              </div>
                            </TableCell>

                            <TableCell className="text-center bg-primary/5">
                              <Checkbox
                                checked={isChecked(page.path, null)}
                                onCheckedChange={() =>
                                  togglePermission(page.path, null)
                                }
                              />
                            </TableCell>

                            {cabangList.map((c) => (
                              <TableCell key={c.id} className="text-center">
                                <Checkbox
                                  checked={isChecked(page.path, c.id)}
                                  onCheckedChange={() =>
                                    togglePermission(page.path, c.id)
                                  }
                                  disabled={isChecked(page.path, null)}
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        Tip:
                      </span>{" "}
                      Centang satu kali di kolom "Global" untuk memberi akses ke
                      semua cabang sekaligus.
                    </p>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="roles" className="mt-0">
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  Daftar Role Sistem
                </h2>
                <p className="text-xs text-muted-foreground font-medium">
                  Master daftar jabatan yang digunakan dalam aplikasi.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {initialRoles.map((role) => (
                  <Card
                    key={role.id}
                    className="border-border bg-background shadow-sm rounded-md"
                  >
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-3 w-3 rounded-full bg-primary/70" />
                        <div>
                          <p className="font-semibold capitalize text-sm text-foreground">
                            {role.label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {role.name}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive h-8 w-8"
                        disabled
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}

                <Button
                  variant="outline"
                  className="h-17 border-dashed border-2 border-input bg-muted/20 flex flex-col gap-1 items-center justify-center"
                  disabled
                >
                  <Plus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    Tambah Role Baru
                  </span>
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </Content>
    </>
  );
}
