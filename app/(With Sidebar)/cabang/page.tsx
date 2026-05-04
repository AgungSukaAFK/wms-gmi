import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CabangManagementClient from "./CabangManagementClient";

export default async function CabangPage() {
  const supabase = await createClient();

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
              Hanya moderator yang memiliki izin untuk mengelola cabang.
            </p>
          </div>
        </div>
      </Content>
    );
  }

  return <CabangManagementClient />;
}
