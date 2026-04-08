import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/server";
import UserTableClient from "./UserTableClient";

export default async function UsersPage() {
  const supabase = await createClient();

  // Fetch profiles with cabang info
  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .order("created_at", { ascending: false });

  // Fetch cabang list for the edit modal
  const { data: cabangList, error: cabangError } = await supabase
    .from("cabang")
    .select("id, nama_cabang")
    .order("nama_cabang");

  if (usersError || cabangError) {
    return (
      <Content>
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive">
          Error loading users: {usersError?.message || cabangError?.message}
        </div>
      </Content>
    );
  }

  return (
    <Content>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">
            Kelola data akun pengguna, persetujuan akses, dan penempatan cabang.
          </p>
        </div>
        
        <UserTableClient 
          users={users || []} 
          cabangList={cabangList || []} 
        />
      </div>
    </Content>
  );
}
