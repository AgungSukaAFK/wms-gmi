import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/server";
import { getAllRoles } from "@/services/role-actions";
import UserTableClient from "./UserTableClient";
import { redirect } from "next/navigation";

export default async function UsersPage() {
  const supabase = await createClient();

  // Proteksi: Hanya Moderator yang boleh masuk ke sini
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login");
  }

  const { data: userRoles } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id);

  const isModerator = userRoles?.some((r: any) => r.roles.name === "moderator");

  if (!isModerator) {
    return (
      <Content>
        <div className="flex h-100 items-center justify-center border-2 border-dashed rounded-xl">
          <div className="text-center">
            <h2 className="text-xl font-bold text-destructive">
              Akses Ditolak
            </h2>
            <p className="text-muted-foreground">
              Hanya Moderator (Superuser) yang memiliki izin untuk mengelola
              pengguna.
            </p>
          </div>
        </div>
      </Content>
    );
  }

  // Fetch profiles with roles and cabang info
  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang), user_roles(roles(*))")
    .order("created_at", { ascending: false });

  // Fetch cabang list for the edit modal
  const { data: cabangList, error: cabangError } = await supabase
    .from("cabang")
    .select("id, nama_cabang")
    .order("nama_cabang");

  // Fetch all available roles for the editor
  const { data: allRoles } = await getAllRoles();

  if (usersError || cabangError) {
    return (
      <Content>
        <div className="p-4 bg-destructive/10 text-destructive rounded-md border border-destructive">
          Error loading users: {usersError?.message || cabangError?.message}
        </div>
      </Content>
    );
  }

  // Tidy up user roles format
  const mappedUsers = (users || []).map((u: any) => ({
    ...u,
    roles: u.user_roles?.map((ur: any) => ur.roles).filter(Boolean) || [],
  }));

  return (
    <>
      <UserTableClient
        users={mappedUsers}
        cabangList={cabangList || []}
        allRoles={allRoles || []}
      />
    </>
  );
}
