"use client";

import { useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";

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
function NavItemIcon({ icon: Icon }: { icon?: LucideIcon }) {
  const { pending } = useLinkStatus();
  if (pending) {
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
          onClick={() => {
            // Navigasi client-side tidak reload halaman, jadi sheet sidebar
            // mobile harus ditutup manual.
            if (isMobile) setOpenMobile(false);
          }}
          className={cn(
            "w-full flex gap-4 items-center rounded-md px-3 py-2 transition-colors hover:bg-accent",
            item.isActive && "bg-primary/5",
          )}
        >
          <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <NavItemIcon icon={item.icon} />
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
}: {
  label?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  items: NavItem[];
}) {
  return (
    <SidebarGroup>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2"
      >
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>

      {!collapsed && (
        <SidebarMenu>
          {items.map((item) => (
            <NavMainItem key={item.title} item={item} />
          ))}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}
