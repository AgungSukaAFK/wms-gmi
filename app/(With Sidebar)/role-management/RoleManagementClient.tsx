"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
  { path: "/peminjaman", label: "Peminjaman Alat" },
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

export default function RoleManagementClient({ initialRoles, cabangList }: { initialRoles: Role[], cabangList: Cabang[] }) {
  const [activeTab, setActiveTab] = useState("permissions");
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(initialRoles[0]?.id || null);
  const [permissions, setPermissions] = useState<{ page_path: string; cabang_id: number | null }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load permissions saat role dipilih
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
    return permissions.some(p => p.page_path === path && p.cabang_id === cabangId);
  };

  const togglePermission = (path: string, cabangId: number | null) => {
    setPermissions(prev => {
      const exists = prev.find(p => p.page_path === path && p.cabang_id === cabangId);
      if (exists) {
        return prev.filter(p => !(p.page_path === path && p.cabang_id === cabangId));
      } else {
        return [...prev, { page_path: path, cabang_id: cabangId }];
      }
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
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
          <TabsTrigger value="permissions">Matrix Permissions</TabsTrigger>
          <TabsTrigger value="roles">Manage Roles</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Permission Matrix</CardTitle>
                <CardDescription>Atur hak akses halaman per role dan per cabang.</CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <Select 
                  value={selectedRoleId?.toString()} 
                  onValueChange={(v) => setSelectedRoleId(parseInt(v))}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Pilih Role" />
                  </SelectTrigger>
                  <SelectContent>
                    {initialRoles.map(r => (
                      <SelectItem key={r.id} value={r.id.toString()} className="capitalize">{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleSave} disabled={isSaving || !selectedRoleId}>
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan Perubahan
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex h-[400px] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto shadow-sm">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="w-[250px] sticky left-0 bg-slate-50 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.05)] border-r">Halaman / Modul</TableHead>
                        <TableHead className="text-center bg-blue-50/50">Global (Semua Cabang)</TableHead>
                        {cabangList.map(c => (
                          <TableHead key={c.id} className="text-center min-w-[120px]">{c.nama_cabang}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {AVAILABLE_PAGES.map(page => (
                        <TableRow key={page.path} className="hover:bg-slate-50/50">
                          <TableCell className="font-medium sticky left-0 bg-white z-10 border-r shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                            {page.label}
                            <div className="text-[10px] font-normal text-muted-foreground">{page.path}</div>
                          </TableCell>
                          
                          {/* Checkbox Global */}
                          <TableCell className="text-center bg-blue-50/20">
                            <Checkbox 
                              checked={isChecked(page.path, null)}
                              onCheckedChange={() => togglePermission(page.path, null)}
                            />
                          </TableCell>

                          {/* Checkbox Per Cabang */}
                          {cabangList.map(c => (
                            <TableCell key={c.id} className="text-center">
                              <Checkbox 
                                checked={isChecked(page.path, c.id)}
                                onCheckedChange={() => togglePermission(page.path, c.id)}
                                disabled={isChecked(page.path, null)} 
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-slate-50 border-t py-3">
              <p className="text-xs text-muted-foreground">
                <strong>Tip:</strong> Centang satu kali di kolom "Global" untuk memberi akses ke semua cabang sekaligus.
              </p>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-6">
           <Card>
             <CardHeader>
               <CardTitle>Daftar Role Sistem</CardTitle>
               <CardDescription>Master daftar jabatan yang digunakan dalam aplikasi.</CardDescription>
             </CardHeader>
             <CardContent>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {initialRoles.map(role => (
                   <div key={role.id} className="p-4 border rounded-lg flex items-center justify-between shadow-sm bg-white hover:border-blue-200 transition-colors">
                     <div className="flex items-center gap-3">
                       <div className="h-3 w-3 rounded-full bg-slate-400" />
                       <div>
                         <p className="font-semibold capitalize text-sm">{role.label}</p>
                         <p className="text-xs text-muted-foreground">{role.name}</p>
                       </div>
                     </div>
                     <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" disabled>
                       <Trash2 className="h-4 w-4" />
                     </Button>
                   </div>
                 ))}
                 <Button variant="outline" className="h-[68px] border-dashed border-2 flex flex-col gap-1 items-center justify-center hover:bg-slate-50" disabled>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Tambah Role Baru</span>
                 </Button>
               </div>
             </CardContent>
           </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
