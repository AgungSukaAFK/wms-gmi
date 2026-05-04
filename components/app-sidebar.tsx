// components/app-sidebar.tsx

"use client";

import * as React from "react";
import { redirect, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "./nav-user";
import { Button } from "@/components/ui/button";
import {
  GalleryVerticalEnd,
  Bot,
  LayoutDashboard,
  FileBox,
  BaggageClaim,
  Boxes,
  BookOpen,
  MessageSquareShare,
  Info,
  CheckCheck,
  CheckCircle2,
  FileSearch2,
  BadgeDollarSign,
  Briefcase,
  PackagePlus,
  ArchiveRestore,
  Bell,
  Users,
  UsersRound,
  Archive,
  Building2,
  PackageCheck,
  Truck,
  FileText,
  FileSpreadsheet,
  ShoppingCart,
  FileWarning,
  Undo2,
  Calculator,
  FileSignature,
} from "lucide-react";

// Update the menu data
const data = {
  navAdmin: [
    {
      title: "User Management",
      url: "/users",
      icon: Users,
    },
    {
      title: "Role & Permission",
      url: "/role-management",
      icon: CheckCheck,
    },
    {
      title: "Approval Templates",
      url: "/approval-templates",
      icon: CheckCircle2,
    },
  ],
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
    },
    {
      title: "Signature Manager",
      url: "/signatures",
      icon: FileSignature,
    },
  ],
  navMaster: [
    { title: "Cabang", url: "/cabang", icon: Building2 },
    { title: "Barang", url: "/barang", icon: Boxes },
    { title: "Vendors", url: "/vendors", icon: Briefcase },
    { title: "Customers", url: "/customers", icon: UsersRound },
  ],
  navInventory: [
    { title: "Stock", url: "/stock", icon: Archive },
    { title: "Delivery", url: "/deliveries", icon: Truck },
    { title: "Share Stock", url: "/share-stock", icon: PackagePlus },
    { title: "Job Costing", url: "/job-costing", icon: Calculator },
  ],
  navProcurement: [
    { title: "Material Request", url: "/mr", icon: FileText },
    { title: "Purchase Request", url: "/pr", icon: FileSpreadsheet },
    { title: "Purchase Order", url: "/po", icon: ShoppingCart },
    { title: "Receive Item", url: "/receive", icon: PackageCheck },
  ],
  navStockOut: [
    { title: "Report SPB", url: "/spb/report", icon: FileBox },
    { title: "SPB", url: "/spb", icon: FileWarning },
    { title: "Purchase Order", url: "/spb/po", icon: ShoppingCart },
    { title: "Delivery Order", url: "/spb/do", icon: Truck },
    { title: "Invoice", url: "/spb/invoice", icon: BadgeDollarSign },
    { title: "Return SPB", url: "/return-spb", icon: Undo2 },
  ],
  navSecondary: [
    {
      title: "Dokumentasi",
      url: "/dokumentasi",
      icon: BookOpen,
    },
    {
      title: "Tentang App",
      url: "/tentang-app",
      icon: Info,
    },
  ],
};

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const currentPath = usePathname();
  const supabase = createClient();

  const [user, setUser] = React.useState<any>(null);
  const [profile, setProfile] = React.useState<any>(null);
  type CollapsedGroups = {
    admin: boolean;
    main: boolean;
    master: boolean;
    inventory: boolean;
    procurement: boolean;
    stockOut: boolean;
    help: boolean;
  };

  // Default: all expanded (false)
  const defaultCollapsedGroups: CollapsedGroups = {
    admin: false,
    main: false,
    master: false,
    inventory: false,
    procurement: false,
    stockOut: false,
    help: false,
  };
  const [collapsedGroups, setCollapsedGroups] = React.useState<CollapsedGroups>(
    () => {
      if (typeof window !== "undefined") {
        const saved = window.localStorage.getItem("sidebarCollapsedGroups");
        if (saved) {
          try {
            return { ...defaultCollapsedGroups, ...JSON.parse(saved) };
          } catch {
            // ignore parse error
          }
        }
      }
      return defaultCollapsedGroups;
    },
  );

  // Determine if all groups are collapsed
  const allCollapsed = React.useMemo(
    () => Object.values(collapsedGroups).every(Boolean),
    [collapsedGroups],
  );

  React.useEffect(() => {
    const getUser = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!data.user && !error) {
        redirect("/auth/login");
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
  }, [supabase]);

  const isModerator = profile?.roles?.some((r: any) => r.name === "moderator");
  const isAdmin = profile?.roles?.some((r: any) => r.name === "admin");

  const adminItems = data.navAdmin.filter((item) => {
    if (item.url === "/approval-templates") return isModerator || isAdmin;
    return isModerator;
  });

  const masterItems = data.navMaster.filter((item) => {
    if (item.url === "/cabang") return isModerator;
    return true;
  });

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

  const toggleGroup = React.useCallback((key: keyof typeof collapsedGroups) => {
    setCollapsedGroups((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "sidebarCollapsedGroups",
          JSON.stringify(updated),
        );
      }
      return updated;
    });
  }, []);

  const collapseAll = React.useCallback(() => {
    setCollapsedGroups((prev) => {
      const updated = Object.fromEntries(
        Object.keys(prev).map((k) => [k, true]),
      ) as CollapsedGroups;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "sidebarCollapsedGroups",
          JSON.stringify(updated),
        );
      }
      return updated;
    });
  }, []);

  const expandAll = React.useCallback(() => {
    setCollapsedGroups((prev) => {
      const updated = Object.fromEntries(
        Object.keys(prev).map((k) => [k, false]),
      ) as CollapsedGroups;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "sidebarCollapsedGroups",
          JSON.stringify(updated),
        );
      }
      return updated;
    });
  }, []);
  // Sync localStorage if user reloads or navigates
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "sidebarCollapsedGroups",
        JSON.stringify(collapsedGroups),
      );
    }
  }, [collapsedGroups]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center space-x-2 px-2 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            W
          </div>
          <div className="flex flex-col gap-0.5 leading-none">
            <span className="font-semibold text-lg tracking-tight">
              WMS-GMI
            </span>
            <span className="text-xs text-muted-foreground">
              Internal System
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <div className="px-2 pb-2 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[10px] font-semibold"
            onClick={allCollapsed ? expandAll : collapseAll}
          >
            {allCollapsed ? "Expand All" : "Collapse All"}
          </Button>
        </div>

        {adminItems.length > 0 && (
          <NavMain
            label="Admin"
            items={markActive(adminItems)}
            collapsed={collapsedGroups.admin}
            onToggle={() => toggleGroup("admin")}
          />
        )}
        <NavMain
          items={markActive(data.navMain)}
          collapsed={collapsedGroups.main}
          onToggle={() => toggleGroup("main")}
        />
        <NavMain
          label="Data Master"
          items={markActive(masterItems)}
          collapsed={collapsedGroups.master}
          onToggle={() => toggleGroup("master")}
        />
        <NavMain
          label="Inventory"
          items={markActive(data.navInventory)}
          collapsed={collapsedGroups.inventory}
          onToggle={() => toggleGroup("inventory")}
        />
        <NavMain
          label="Procurement"
          items={markActive(data.navProcurement)}
          collapsed={collapsedGroups.procurement}
          onToggle={() => toggleGroup("procurement")}
        />
        <NavMain
          label="Stock Out"
          items={markActive(data.navStockOut)}
          collapsed={collapsedGroups.stockOut}
          onToggle={() => toggleGroup("stockOut")}
        />
        <NavMain
          label="Bantuan"
          items={markActive(data.navSecondary)}
          collapsed={collapsedGroups.help}
          onToggle={() => toggleGroup("help")}
        />
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
