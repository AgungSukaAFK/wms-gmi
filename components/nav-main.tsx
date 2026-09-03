"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function NavMain({
  items,
  label = "Menu",
  collapsed = false,
  onToggle,
}: {
  label?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  items: {
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
  }[];
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
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton tooltip={item.title} asChild>
                <a
                  href={item.url}
                  className={cn(
                    "w-full flex gap-4 items-center rounded-md px-3 py-2 transition-colors hover:bg-accent",
                    item.isActive && "bg-primary/5",
                  )}
                >
                  <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
                    {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
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
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}
