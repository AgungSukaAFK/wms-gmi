import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/server";
import { getAllRoles } from "@/services/role-actions";
import RoleManagementClient from "./RoleManagementClient";
import { redirect } from "next/navigation";

export default async function RoleManagementPage() {
  const supabase = await createClient();

  // Proteksi: Hanya Moderator yang boleh masuk ke sini
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login");
  }

  // Cek role user di profiles (Sistem transisi: cek v_user_permissions)
  const { data: userRoles } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);
  
  const isModerator = userRoles?.some((r: any) => r.roles.name === 'moderator');
  
  if (!isModerator) {
    return (
      <Content>
        <div className="flex h-[400px] items-center justify-center border-2 border-dashed rounded-xl">
          <div className="text-center">
            <h2 className="text-xl font-bold text-destructive">Akses Ditolak</h2>
            <p className="text-muted-foreground">Hanya Moderator (Superuser) yang memiliki izin untuk mengakses halaman manajemen role.</p>
          </div>
        </div>
      </Content>
    );
  }

  const { data: roles } = await getAllRoles();
  const { data: cabangList } = await supabase
    .from("cabang")
    .select("id, nama_cabang")
    .order("nama_cabang");

  return (
    <Content>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Role & Permission Management</h1>
          <p className="text-muted-foreground">
            Konfigurasi matriks hak akses halaman dan cabang secara dinamis untuk setiap jabatan.
          </p>
        </div>
        
        <RoleManagementClient 
          initialRoles={roles || []} 
          cabangList={cabangList || []} 
        />
      </div>
    </Content>
  );
}
