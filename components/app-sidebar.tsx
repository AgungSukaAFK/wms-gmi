// components/app-sidebar.tsx

"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "./nav-user";
import { Button } from "@/components/ui/button";
import { SidebarSearch } from "@/components/sidebar-search";
import { useUpdateWebBadge } from "@/hooks/use-update-web-badge";
import { useAuthStore } from "@/stores/auth-store";
import { useNotification } from "@/components/providers/NotificationProvider";
import { buildNavGroups } from "@/lib/sidebar/nav-config";
import {
  normalizeSearch,
  scoreMenuItem,
  searchMenuItems,
  useSidebarSearch,
} from "@/lib/sidebar/menu-search";
import { setPendingNavUrl } from "@/lib/sidebar/nav-pending";
import { SearchX } from "lucide-react";

function saveCollapsed(updated: Record<string, boolean>) {
  try {
    window.localStorage.setItem(
      "sidebarCollapsedGroups",
      JSON.stringify(updated),
    );
  } catch {
    // abaikan
  }
  return updated;
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const currentPath = usePathname();
  const router = useRouter();

  const [user, setUser] = React.useState<any>(null);
  const [profile, setProfile] = React.useState<any>(null);
  const { unreadCount } = useNotification();
  // Grup yang dilipat, per kunci grup di lib/sidebar/nav-config.ts.
  type CollapsedGroups = Record<string, boolean>;
  const [collapsedGroups, setCollapsedGroups] = React.useState<CollapsedGroups>(
    {},
  );

  // Load persisted sidebar state from localStorage after mount (client only)
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("sidebarCollapsedGroups");
      if (saved) setCollapsedGroups(JSON.parse(saved));
    } catch {
      // abaikan (parse error / localStorage diblokir)
    }
  }, []);

  React.useEffect(() => {
    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const getUser = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (!data.user || error) {
        // Supabase tidak terjangkau ≠ sesi invalid — jangan tendang ke login,
        // coba lagi sebentar lagi.
        if (isAuthRetryableFetchError(error)) {
          retryTimer = setTimeout(getUser, 3000);
          return;
        }
        if (error) {
          await supabase.auth.signOut();
        }
        // Bersihkan cache profil/permission tersimpan (localStorage) supaya
        // sesi baru tidak mewarisi data akun yang sudah invalid.
        useAuthStore.getState().clearSession();
        router.push("/auth/login");
        return;
      }

      if (data.user) {
        setUser(data.user);

        // Fetch profile with roles using the new RBAC structure
        const { data: profileWithRoles } = await supabase
          .from("profiles")
          .select(
            `
            *,
            roles:user_roles(
              roles(id, name, label, color)
            )
          `,
          )
          .eq("id", data.user.id)
          .single();

        if (!isMounted) return;

        if (profileWithRoles) {
          // Transform the nested join into a flat roles array
          const flattenedProfile = {
            ...profileWithRoles,
            roles: (profileWithRoles.roles as any[]).map((r) => r.roles),
          };
          setProfile(flattenedProfile);
        }
      }
    };

    getUser();

    return () => {
      isMounted = false;
      clearTimeout(retryTimer);
    };
  }, [router]);

  const { isNew: hasNewUpdateWeb } = useUpdateWebBadge(user?.id);

  // Daftar menu per hak akses ada di lib/sidebar/nav-config.ts; di sini
  // tinggal badge & status aktif.
  const baseNavGroups = React.useMemo(() => buildNavGroups(profile), [profile]);

  const markActive = React.useCallback(
    (items: any[]) => {
      const matchingUrls = items
        .map((item) => item.url as string)
        .filter(
          (url) =>
            currentPath === url ||
            (url !== "/dashboard" && currentPath.startsWith(`${url}/`)),
        );

      const activeUrl =
        matchingUrls.sort((a, b) => b.length - a.length)[0] || null;

      return items.map((item) => ({
        ...item,
        isActive: item.url === activeUrl,
      }));
    },
    [currentPath],
  );

  const toggleGroup = React.useCallback((key: string) => {
    setCollapsedGroups((prev) => saveCollapsed({ ...prev, [key]: !prev[key] }));
  }, []);

  const setAllCollapsed = React.useCallback(
    (collapsed: boolean) => {
      setCollapsedGroups(() =>
        saveCollapsed(
          Object.fromEntries(baseNavGroups.map((g) => [g.key, collapsed])),
        ),
      );
    },
    [baseNavGroups],
  );

  const allCollapsed =
    baseNavGroups.length > 0 &&
    baseNavGroups.every((g) => collapsedGroups[g.key]);

  const navGroups = React.useMemo(() => {
    const badges: Record<string, { badge?: number; dot?: boolean }> = {
      "/notifications": { badge: unreadCount },
      "/update-web": { dot: hasNewUpdateWeb },
    };
    return baseNavGroups.map((g) => ({
      ...g,
      items: markActive(
        g.items.map((item) =>
          item.url in badges ? { ...item, ...badges[item.url] } : item,
        ),
      ),
    }));
  }, [baseNavGroups, markActive, unreadCount, hasNewUpdateWeb]);

  const { query, setQuery } = useSidebarSearch();
  const searching = normalizeSearch(query) !== "";

  // Saat mencari: saring & urutkan tiap grup, grup tanpa hasil disembunyikan,
  // dan semua grup dipaksa terbuka biar hasilnya kelihatan.
  const shownGroups = React.useMemo(() => {
    if (!searching) return navGroups;
    return navGroups
      .map((g) => ({ ...g, items: searchMenuItems(g.items, query, g.label) }))
      .filter((g) => g.items.length > 0);
  }, [navGroups, query, searching]);

  const openTopResult = () => {
    if (!searching) return;
    // Hasil paling relevan di antara semua grup.
    let best: { url: string; score: number } | null = null;
    for (const g of navGroups) {
      for (const item of g.items) {
        const score = scoreMenuItem(query, item, g.label);
        if (score > 0 && (!best || score > best.score))
          best = { url: item.url, score };
      }
    }
    if (!best) return;
    if (best.url !== currentPath) setPendingNavUrl(best.url);
    router.push(best.url);
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-4 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            W
          </div>
          <div className="flex flex-col gap-0.5 leading-none overflow-hidden group-data-[state=collapsed]:hidden">
            <span className="font-semibold text-lg tracking-tight truncate">
              WMS-GMI
            </span>
            <span className="text-xs text-muted-foreground truncate">
              Internal System
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarSearch
        query={query}
        onQueryChange={setQuery}
        onSubmit={openTopResult}
      />

      <SidebarContent>
        {!searching && (
          <div className="px-2 pb-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[10px] font-semibold"
              onClick={() => setAllCollapsed(!allCollapsed)}
            >
              {allCollapsed ? "Buka Semua" : "Lipat Semua"}
            </Button>
          </div>
        )}

        {shownGroups.map((group) => (
          <NavMain
            key={group.key}
            label={group.label}
            items={group.items}
            hideable={group.hideable}
            searching={searching}
            collapsed={searching ? false : !!collapsedGroups[group.key]}
            onToggle={() => toggleGroup(group.key)}
          />
        ))}

        {searching && shownGroups.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
            <SearchX className="h-6 w-6 opacity-60" />
            <p>
              Tidak ada menu untuk &ldquo;
              <span className="font-medium text-foreground">{query}</span>
              &rdquo;
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Hapus pencarian
            </button>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter>
        {user && (
          <NavUser
            user={{
              avatar: `https://ui-avatars.com/api/?name=${
                profile?.nama || user.email
              }`,
              email: user.email || "",
              name: profile?.nama || "-",
            }}
          />
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
