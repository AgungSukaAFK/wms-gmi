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
  const router = useRouter();
  const { isNewDay, clearSession, setSession, profile } = useAuthStore();
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const initSession = async () => {
      const supabase = createClient();

      // 1. Cek apakah harus reset harian
      if (isNewDay()) {
        console.log("Daily reset triggered: New day detected.");
        clearSession();
        await supabase.auth.signOut();
        router.push("/auth/login");
        return;
      }

      // 2. Jika store kosong (misal hard refresh), fetch ulang data dari DB
      if (!profile && userId) {
        console.log("Re-initializing session store...");
        
        const { data: profileData } = await supabase
          .from("profiles")
          .select("*, cabang(id, nama_cabang, kode_cabang)")
          .eq("id", userId)
          .single();

        const { data: rolesData } = await supabase
          .from("user_roles")
          .select("roles(id, name, label, color, description)")
          .eq("user_id", userId);

        const permissions = await getUserPermissions(userId);

        if (profileData) {
          setSession(
            {
              ...profileData,
              roles: rolesData?.map((r: any) => r.roles).filter(Boolean) ?? [],
            },
            permissions
          );
        }
      }
      
      setIsInitializing(false);
    };

    initSession();
  }, [userId, isNewDay, clearSession, setSession, profile, router]);

  if (isInitializing) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground animate-pulse">Menyiapkan sesi...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
