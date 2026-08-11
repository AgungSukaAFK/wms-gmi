"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import { getUserPermissions } from "@/services/role-actions";
import { Loader2 } from "lucide-react";

interface DailyResetGuardProps {
  children: React.ReactNode;
  userId: string;
}

export function DailyResetGuard({ children, userId }: DailyResetGuardProps) {
  const { setSession, clearSession, profile, lastLoginDate } = useAuthStore();
  const [isInitializing, setIsInitializing] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      const supabase = createClient();

      // Daily re-login enforcement ditangani oleh proxy (cookie wms_login_date).
      // Jika kita sampai di sini, sesi sudah valid untuk hari ini — jadi cukup
      // pastikan store cache (profil/role/permission) ter-refresh:
      // saat store kosong, ganti akun, ATAU sudah ganti hari.
      const today = new Date().toLocaleDateString("sv-SE");
      const shouldReinitialize =
        !profile || profile.id !== userId || lastLoginDate !== today;
      if (shouldReinitialize && userId) {
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
      }

      if (isMounted) {
        setIsInitializing(false);
      }
    };

    initSession();

    return () => {
      isMounted = false;
    };
  }, [userId, setSession, profile, lastLoginDate]);

  if (isInitializing) {
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
