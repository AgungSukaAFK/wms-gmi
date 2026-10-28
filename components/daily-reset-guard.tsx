"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import { getUserPermissions } from "@/services/role-actions";
import { Loader2 } from "lucide-react";

interface DailyResetGuardProps {
  children: React.ReactNode;
  // null selama layout belum selesai cek user — children dirender apa adanya.
  userId: string | null;
}

export function DailyResetGuard({ children, userId }: DailyResetGuardProps) {
  const { setSession, clearSession, profile, lastLoginDate } = useAuthStore();
  const router = useRouter();

  // Daily re-login enforcement ditangani oleh proxy (cookie wms_login_date).
  // Jika kita sampai di sini, sesi sudah valid untuk hari ini — jadi cukup
  // pastikan store cache (profil/role/permission) ter-refresh:
  // saat store kosong, ganti akun, ATAU sudah ganti hari.
  // Selama cache masih valid, children tetap ter-mount (tanpa spinner) supaya
  // halaman tidak di-unmount lalu fetch ulang semua datanya.
  const today = new Date().toLocaleDateString("sv-SE");
  const needsInit =
    !!userId && (!profile || profile.id !== userId || lastLoginDate !== today);

  useEffect(() => {
    if (!needsInit || !userId) return;
    let isMounted = true;

    const initSession = async () => {
      const supabase = createClient();

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*, cabang(id, nama_cabang, kode_cabang)")
        .eq("id", userId)
        .single();

      if (!profileData || profileError) {
        // Sesi/akun sudah tidak valid — bersihkan cache lokal supaya
        // login berikutnya tidak mewarisi data yang stale, lalu paksa login ulang.
        clearSession();
        await supabase.auth.signOut();
        if (isMounted) {
          router.push("/auth/login");
        }
        return;
      }

      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("roles(id, name, label, color, description)")
        .eq("user_id", userId);

      const permissions = await getUserPermissions(userId);

      setSession(
        {
          ...profileData,
          roles: rolesData?.map((r: any) => r.roles).filter(Boolean) ?? [],
        },
        permissions,
      );
    };

    initSession();

    return () => {
      isMounted = false;
    };
  }, [needsInit, userId, setSession, clearSession, router]);

  if (needsInit) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground animate-pulse">
            Menyiapkan sesi...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
