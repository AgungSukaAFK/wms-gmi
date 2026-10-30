"use client";

// Aksi di sisi kanan top bar (layout "With Sidebar"): Inbox notifikasi dan
// menu Profil. Profil diambil dari useAuthStore (diisi DailyResetGuard saat
// login), jadi top bar tidak menambah query sendiri.

import { useMemo, useSyncExternalStore } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { TopbarInbox } from "./topbar-inbox";
import { TopbarProfile } from "./topbar-profile";

export type TopbarProfileData = {
  id: string;
  email: string;
  nama: string | null;
  /** Bentuk sama dgn NavProfile (lib/sidebar/nav-config.ts). */
  roles: { name: string }[];
};

const subscribeNoop = () => () => {};

/** Profil user yang login (null selama belum mount / belum ada sesi). */
export function useTopbarProfileData(): TopbarProfileData | null {
  const profile = useAuthStore((s) => s.profile);
  // Store di-persist ke localStorage: saat SSR selalu kosong, jadi baru
  // dipakai setelah mount supaya tidak hydration mismatch.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  return useMemo(() => {
    if (!mounted || !profile) return null;
    return {
      id: profile.id,
      email: profile.email ?? "",
      nama: profile.nama ?? null,
      roles: (profile.roles ?? [])
        .filter((r) => !!r?.name)
        .map((r) => ({ name: r.name })),
    };
  }, [mounted, profile]);
}

export function TopbarActions() {
  const profile = useTopbarProfileData();

  return (
    <div className="flex items-center gap-1 sm:gap-0.5">
      <TopbarInbox userId={profile?.id ?? null} />
      <div className="mx-1 h-5 w-px bg-border sm:mx-1.5" aria-hidden />
      <TopbarProfile profile={profile} />
    </div>
  );
}
