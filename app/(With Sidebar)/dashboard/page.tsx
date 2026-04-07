import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, cabang(nama_cabang)")
    .eq("id", user?.id)
    .single();

  return (
    <Content>

      <div className="flex flex-col space-y-8 p-6">
        <div className="flex flex-col space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard WMS-GMI</h1>
          <p className="text-muted-foreground">
            Selamat datang kembali, {profile?.nama || "Pengguna"}. Anda login sebagai {profile?.role}.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-card text-card-foreground shadow">
            <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
              <h3 className="tracking-tight text-sm font-medium">Cabang Aktif</h3>
            </div>
            <div className="p-6 pt-0">
              <div className="text-2xl font-bold">{profile?.cabang?.nama_cabang || "Pusat"}</div>
            </div>
          </div>

          <div className="rounded-xl border bg-card text-card-foreground shadow">
            <div className="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
              <h3 className="tracking-tight text-sm font-medium">Status Akun</h3>
            </div>
            <div className="p-6 pt-0">
              <div className="text-2xl font-bold text-green-600">Aktif</div>
            </div>
          </div>
        </div>
      </div>
    </Content>

  );
}
