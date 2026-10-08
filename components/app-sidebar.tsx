// components/app-sidebar.tsx

"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarGroupLabel,
  SidebarInput,
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "./nav-user";
import { Button } from "@/components/ui/button";
import { useUpdateWebBadge } from "@/hooks/use-update-web-badge";
import { useAuthStore } from "@/stores/auth-store";
import { useNotification } from "@/components/providers/NotificationProvider";
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
  Handshake,
  ArrowLeftRight,
  FileText,
  FileSpreadsheet,
  ShoppingCart,
  FileWarning,
  Undo2,
  Calculator,
  FileSignature,
  PackageSearch,
  ClipboardList,
  SlidersHorizontal,
  Megaphone,
  CalendarRange,
  Warehouse,
  Factory,
  Gauge,
  Snowflake,
  Wrench,
  Search,
  X,
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
    {
      title: "Trigger Level MR",
      url: "/mr-level-settings",
      icon: SlidersHorizontal,
    },
  ],
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
    },
    {
      title: "Notifikasi",
      url: "/notifications",
      icon: Bell,
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
    { title: "Request Stok", url: "/stock-requests", icon: ClipboardList },
    { title: "Delivery", url: "/deliveries", icon: Truck },
    { title: "Item Transfer", url: "/item-transfer", icon: ArrowLeftRight },
    { title: "Share Stock", url: "/share-stock", icon: PackagePlus },
    { title: "Barang dalam Pengiriman", url: "/planning-supply", icon: PackageSearch },
    { title: "Job Costing", url: "/job-costing", icon: Calculator },
  ],
  navProcurement: [
    { title: "Material Request", url: "/mr", icon: FileText },
    { title: "Scheduled MR", url: "/mr/scheduled", icon: CalendarRange },
    { title: "Purchase Request", url: "/pr", icon: FileSpreadsheet },
    { title: "Purchase Order", url: "/po", icon: ShoppingCart },
    { title: "PO Non-PR → Job Costing", url: "/po/non-pr", icon: Wrench },
    { title: "Receive Item", url: "/receive", icon: PackageCheck },
    { title: "Working Order", url: "/working-order", icon: Factory },
  ],
  navStockOut: [
    { title: "Report SPB", url: "/spb/report", icon: FileBox },
    { title: "SPB", url: "/spb", icon: FileWarning },
    { title: "Purchase Order", url: "/spb/po", icon: ShoppingCart },
    { title: "Delivery Order", url: "/spb/do", icon: Truck },
    { title: "Invoice", url: "/spb/invoice", icon: BadgeDollarSign },
    { title: "Return SPB", url: "/return-spb", icon: Undo2 },
  ],
  navSoReguler: [
    { title: "DO Reguler", url: "/so-reguler/do", icon: Truck },
  ],
  navConsignment: [
    {
      title: "Dashboard Consignment",
      url: "/so-reguler/consignment/dashboard",
      icon: LayoutDashboard,
    },
    {
      title: "Sales Order",
      url: "/so-reguler/consignment/so",
      icon: Handshake,
    },
    {
      title: "Item Konsinyasi",
      url: "/so-reguler/consignment/ik",
      icon: ClipboardList,
    },
    {
      title: "Penerimaan Konsinyasi",
      url: "/so-reguler/consignment/penerimaan",
      icon: PackageCheck,
    },
    {
      title: "Stok di Customer",
      url: "/so-reguler/consignment/customer-stock",
      icon: Warehouse,
    },
  ],
  navHmMaintenance: [
    { title: "Periodic Maintenance", url: "/maintenance", icon: Gauge },
    { title: "Forecasting AC", url: "/maintenance/forecast-ac", icon: Snowflake },
  ],
  navSecondary: [
    {
      title: "Update Web",
      url: "/update-web",
      icon: Megaphone,
    },
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
  const router = useRouter();

  const [user, setUser] = React.useState<any>(null);
  const [profile, setProfile] = React.useState<any>(null);
  const { unreadCount } = useNotification();
  type CollapsedGroups = {
    admin: boolean;
    main: boolean;
    master: boolean;
    inventory: boolean;
    procurement: boolean;
    stockOut: boolean;
    soReguler: boolean;
    consignment: boolean;
    hmMaintenance: boolean;
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
    soReguler: false,
    consignment: false,
    hmMaintenance: false,
    help: false,
  };
  const [collapsedGroups, setCollapsedGroups] = React.useState<CollapsedGroups>(
    defaultCollapsedGroups,
  );

  // Load persisted sidebar state from localStorage after mount (client only)
  React.useEffect(() => {
    const saved = window.localStorage.getItem("sidebarCollapsedGroups");
    if (saved) {
      try {
        setCollapsedGroups((prev) => ({ ...prev, ...JSON.parse(saved) }));
      } catch {
        // ignore parse error
      }
    }
  }, []);

  // Determine if all groups are collapsed
  const allCollapsed = React.useMemo(
    () => Object.values(collapsedGroups).every(Boolean),
    [collapsedGroups],
  );

  React.useEffect(() => {
    let isMounted = true;

    const getUser = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (!data.user || error) {
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
    };
  }, [router]);

  const isModerator = profile?.roles?.some((r: any) => r.name === "moderator");
  const isAdmin = profile?.roles?.some((r: any) => r.name === "admin");
  const { isNew: hasNewUpdateWeb } = useUpdateWebBadge(user?.id);

  const adminItems = data.navAdmin.filter((item) => {
    // Halaman Role & Permission disembunyikan sementara (matrix belum dipakai).
    // Untuk mengaktifkan kembali: hapus baris di bawah ini.
    if (item.url === "/role-management") return false;
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
  const [searchQuery, setSearchQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const navGroups = (() => {
    const groups: {
      key: keyof CollapsedGroups;
      label?: string;
      items: React.ComponentProps<typeof NavMain>["items"];
    }[] = [
      { key: "admin", label: "Admin", items: markActive(adminItems) },
      {
        key: "main",
        items: markActive(data.navMain).map((item) =>
          item.url === "/notifications"
            ? { ...item, badge: unreadCount }
            : item,
        ),
      },
      { key: "master", label: "Data Master", items: markActive(masterItems) },
      {
        key: "inventory",
        label: "Inventory",
        items: markActive(data.navInventory),
      },
      {
        key: "procurement",
        label: "Procurement",
        items: markActive(data.navProcurement),
      },
      {
        key: "stockOut",
        label: "Stock Out Project",
        items: markActive(data.navStockOut),
      },
      {
        key: "soReguler",
        label: "SO Reguler",
        items: markActive(data.navSoReguler),
      },
      {
        key: "consignment",
        label: "Consignment",
        items: markActive(data.navConsignment),
      },
      {
        key: "hmMaintenance",
        label: "HM Maintenance",
        items: markActive(data.navHmMaintenance),
      },
      {
        key: "help",
        label: "Bantuan",
        items: markActive(data.navSecondary).map((item) =>
          item.url === "/update-web"
            ? { ...item, dot: hasNewUpdateWeb }
            : item,
        ),
      },
    ];
    return groups.filter((group) => group.items.length > 0);
  })();

  // Saat mencari: cocokkan judul menu atau nama grup, grup kosong disembunyikan,
  // dan semua grup dipaksa terbuka biar hasilnya kelihatan.
  const visibleGroups = (() => {
    if (!isSearching) return navGroups;
    return navGroups
      .map((group) => {
        const groupMatches = (group.label ?? "Menu")
          .toLowerCase()
          .includes(normalizedQuery);
        return {
          ...group,
          items: groupMatches
            ? group.items
            : group.items.filter((item) =>
                item.title.toLowerCase().includes(normalizedQuery),
              ),
        };
      })
      .filter((group) => group.items.length > 0);
  })();

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      return;
    }
    if (e.key === "Enter" && isSearching) {
      const first = visibleGroups[0]?.items[0];
      if (first) {
        e.preventDefault();
        setSearchQuery("");
        router.push(first.url);
      }
    }
  };

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
        <div className="relative group-data-[collapsible=icon]:hidden">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Cari menu..."
            aria-label="Cari menu"
            className="pl-8 pr-8"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
              aria-label="Hapus pencarian"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {!isSearching && (
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
        )}

        {visibleGroups.map((group) => (
          <NavMain
            key={group.key}
            label={group.label}
            items={group.items}
            collapsed={isSearching ? false : collapsedGroups[group.key]}
            onToggle={() => toggleGroup(group.key)}
          />
        ))}

        {isSearching && visibleGroups.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            Menu &quot;{searchQuery.trim()}&quot; tidak ditemukan
          </p>
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
