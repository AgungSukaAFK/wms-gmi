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
  PackageSearch,
  BadgeDollarSign,
  Briefcase,
  PackagePlus,
  ArchiveRestore,
  Bell,
  Users,
  UsersRound,
  Archive,
  PackageCheck,
  Truck,
  Handshake,
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
    { title: "Barang", url: "/barang", icon: Boxes },
    { title: "Vendors", url: "/vendors", icon: Briefcase },
    { title: "Customers", url: "/customers", icon: UsersRound },
  ],
  navInventory: [
    { title: "Stock", url: "/stock", icon: Archive },
    { title: "Receive", url: "/receive", icon: PackageCheck },
    { title: "Delivery", url: "/deliveries", icon: Truck },
    { title: "Peminjaman", url: "/peminjaman", icon: Handshake },
  ],
  navProcurement: [
    { title: "Material Request", url: "/mr", icon: FileText },
    { title: "Purchase Request", url: "/pr", icon: FileSpreadsheet },
    { title: "Purchase Order", url: "/po", icon: ShoppingCart },
  ],
  navFinance: [
    { title: "SPB", url: "/spb", icon: FileWarning },
    { title: "Return SPB", url: "/return-spb", icon: Undo2 },
    { title: "Job Costing", url: "/job-costing", icon: Calculator },
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
          .select(`
            *,
            roles:user_roles(
              roles(id, name, label, color)
            )
          `)
          .eq("id", data.user.id)
          .single();

        if (profileWithRoles) {
          // Transform the nested join into a flat roles array
          const flattenedProfile = {
            ...profileWithRoles,
            roles: (profileWithRoles.roles as any[]).map(r => r.roles)
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

  const markActive = React.useCallback(
    (items: any[]) =>
      items.map((item) => ({
        ...item,
        isActive:
          currentPath === item.url ||
          (item.url !== "/dashboard" && currentPath.startsWith(item.url)),
      })),
    [currentPath],
  );

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center space-x-2 px-2 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            W
          </div>
          <div className="flex flex-col gap-0.5 leading-none">
            <span className="font-semibold text-lg tracking-tight">WMS-GMI</span>
            <span className="text-xs text-muted-foreground">Internal System</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {adminItems.length > 0 && (
          <NavMain label="Admin" items={markActive(adminItems)} />
        )}
        <NavMain items={markActive(data.navMain)} />
        <NavMain label="Data Master" items={markActive(data.navMaster)} />
        <NavMain label="Inventory" items={markActive(data.navInventory)} />
        <NavMain label="Procurement" items={markActive(data.navProcurement)} />
        <NavMain label="Finance" items={markActive(data.navFinance)} />
        <NavMain label="Bantuan" items={markActive(data.navSecondary)} />
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
