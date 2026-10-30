"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link, { useLinkStatus } from "next/link";
import { ChevronDown, Loader2, type LucideIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSidebarGroupVisibility } from "@/lib/sidebar/menu-visibility";
import { setPendingNavUrl, usePendingNavUrl } from "@/lib/sidebar/nav-pending";
import { usePathname } from "next/navigation";

type NavItem = {
  label?: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  badge?: number;
  dot?: boolean;
  items?: {
    title: string;
    url: string;
  }[];
};

// Ikon diganti spinner selama navigasi pending (prefetch belum selesai /
// route dinamis), ukuran slot tetap jadi tidak ada layout shift.
function NavItemIcon({
  icon: Icon,
  pending: navPending,
}: {
  icon?: LucideIcon;
  pending?: boolean;
}) {
  const { pending } = useLinkStatus();
  if (pending || navPending) {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin" />;
  }
  return Icon ? <Icon className="h-4 w-4 shrink-0" /> : null;
}

// Kursor harus diam sebentar di menu baru dianggap niat — kursor yang cuma
// lewat (nyapu sidebar) jangan memicu prefetch.
const HOVER_INTENT_MS = 150;

function NavMainItem({ item }: { item: NavItem }) {
  // Prefetch baru jalan setelah ada niat (hover/sentuh/fokus). Sidebar punya
  // puluhan link — prefetch semua yang kelihatan di viewport = puluhan request
  // lewat proxy (masing-masing query ke Supabase) tiap kali app dibuka.
  const [intent, setIntent] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const pendingUrl = usePendingNavUrl();
  const isPending = pendingUrl === item.url;
  // Selama ada navigasi berjalan, highlight pindah ke menu yang diklik
  // supaya terasa responsif.
  const isActive = pendingUrl ? isPending : item.isActive;
  const markIntent = () => setIntent(true);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={item.title} asChild>
        <Link
          href={item.url}
          prefetch={intent ? null : false}
          onMouseEnter={() => {
            if (intent) return;
            hoverTimer.current = setTimeout(markIntent, HOVER_INTENT_MS);
          }}
          onMouseLeave={() => clearTimeout(hoverTimer.current)}
          onTouchStart={markIntent}
          onFocus={markIntent}
          aria-busy={isPending || undefined}
          onClick={(e) => {
            // Buka di tab baru / klik tengah: tidak ada navigasi di tab ini,
            // jadi jangan tampilkan loading.
            if (
              e.defaultPrevented ||
              e.button !== 0 ||
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey ||
              e.altKey
            )
              return;
            // Navigasi client-side tidak reload halaman, jadi sheet sidebar
            // mobile harus ditutup manual.
            if (isMobile) setOpenMobile(false);
            if (item.url !== pathname) setPendingNavUrl(item.url);
          }}
          className={cn(
            "w-full flex gap-4 items-center rounded-md px-3 py-2 transition-colors hover:bg-accent active:scale-[0.98] active:bg-accent",
            isActive && "bg-primary/5",
            isPending && "bg-primary/10",
          )}
        >
          <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <NavItemIcon icon={item.icon} pending={isPending} />
            {item.dot && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />
            )}
          </span>
          <span className="grow text-left">{item.title}</span>
          {item.badge != null && item.badge > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function NavMain({
  items,
  label = "Menu",
  collapsed = false,
  onToggle,
  hideable = true,
  searching = false,
}: {
  label?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  items: NavItem[];
  /**
   * false = tombol "Atur" tidak muncul & semua item selalu tampil (grup
   * Bantuan, lihat lib/sidebar/nav-config.ts).
   */
  hideable?: boolean;
  /**
   * Sedang mode pencarian: `items` sudah disaring & diurutkan oleh
   * app-sidebar.tsx, jadi tampilkan apa adanya (termasuk menu yang
   * disembunyikan lewat "Atur") & sembunyikan tombol "Atur".
   */
  searching?: boolean;
}) {
  const { hiddenUrls, toggleUrl } = useSidebarGroupVisibility(label);
  // Popover Radix baru dirender setelah mount: id aria-controls dari useId
  // bisa beda antara SSR & klien (hydration mismatch), jadi sebelum mount
  // cukup tampilkan tombol biasa yang tampilannya sama.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const showAtur = hideable && !searching && items.length > 0;
  const visibleItems = showAtur
    ? items.filter((item) => !hiddenUrls.includes(item.url))
    : items;
  const aturButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 shrink-0 px-2 text-[11px] font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
    >
      Atur
    </Button>
  );

  return (
    <SidebarGroup>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between px-2"
        >
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform group-data-[collapsible=icon]:hidden",
              collapsed && "-rotate-90",
            )}
          />
        </button>
        {showAtur && !mounted && aturButton}
        {showAtur && mounted && (
          <Popover>
            <PopoverTrigger asChild>{aturButton}</PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <div className="mb-2 space-y-1">
                <p className="text-sm font-medium leading-none">
                  Atur menu {label}
                </p>
                <p className="text-xs text-muted-foreground">
                  Pilih menu yang ingin ditampilkan. Pengaturan ini hanya
                  tersimpan di perangkat ini.
                </p>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {items.map((item) => {
                  const hidden = hiddenUrls.includes(item.url);
                  return (
                    <label
                      key={item.url}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={!hidden}
                        onCheckedChange={(checked) =>
                          toggleUrl(item.url, checked !== true)
                        }
                      />
                      {item.icon && (
                        <item.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="grow truncate">{item.title}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {!collapsed && (
        <SidebarMenu>
          {visibleItems.map((item) => (
            <NavMainItem key={item.url} item={item} />
          ))}
          {visibleItems.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              Semua menu di grup ini disembunyikan.
            </p>
          )}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}

const subscribeNoop = () => () => {};
