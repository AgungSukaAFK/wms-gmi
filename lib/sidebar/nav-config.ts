/**
 * lib/sidebar/nav-config.ts
 *
 * Satu sumber daftar menu per hak akses. Sidebar (components/app-sidebar.tsx)
 * memanggil buildNavGroups lalu menambah badge & status aktif; pencarian menu
 * (lib/sidebar/menu-search.ts) memakai hasil yang sama, jadi menu yang dicari
 * selalu sama dengan menu yang boleh dibuka user.
 *
 * Menu baru: tambahkan di sini + kata kuncinya di MENU_KEYWORDS
 * (lib/sidebar/menu-search.ts).
 */

import {
  Archive,
  ArrowLeftRight,
  BadgeDollarSign,
  Bell,
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Factory,
  FileBox,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FileUp,
  FileWarning,
  Gauge,
  Handshake,
  Info,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  PackageCheck,
  PackagePlus,
  PackageSearch,
  ReceiptText,
  Scale,
  ShoppingCart,
  SlidersHorizontal,
  Snowflake,
  Tractor,
  Truck,
  Undo2,
  Users,
  UsersRound,
  Warehouse,
  Wrench,
} from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

export type NavGroup = {
  /** Kunci stabil, dipakai utk state lipat grup di localStorage. */
  key: string;
  label: string;
  items: NavItem[];
  /** false = grup wajib tampil semua (tanpa tombol "Atur"). */
  hideable: boolean;
};

export type NavProfile = {
  roles?: { name: string }[] | null;
} | null;

type VisibleItem = NavItem & { visible?: boolean };

function onlyVisible(items: VisibleItem[]): NavItem[] {
  return items
    .filter((i) => i.visible !== false)
    .map(({ title, url, icon }) => ({ title, url, icon }));
}

export function buildNavGroups(profile: NavProfile): NavGroup[] {
  const hasRole = (name: string) =>
    !!profile?.roles?.some((r) => r?.name === name);
  const isModerator = hasRole("moderator");
  const isAdmin = hasRole("admin");

  const groups: NavGroup[] = [
    {
      key: "admin",
      label: "Admin",
      hideable: true,
      items: onlyVisible([
        { title: "User Management", url: "/users", icon: Users, visible: isModerator },
        // Role & Permission disembunyikan sementara (matrix belum dipakai,
        // lihat role_permissions). Halamannya tetap ada di /role-management.
        {
          title: "Approval Templates",
          url: "/approval-templates",
          icon: CheckCircle2,
          visible: isModerator || isAdmin,
        },
        {
          title: "Trigger Level MR",
          url: "/mr-level-settings",
          icon: SlidersHorizontal,
          visible: isModerator,
        },
        { title: "Import Data Excel", url: "/import", icon: FileUp, visible: isModerator },
      ]),
    },
    {
      key: "main",
      label: "Menu",
      hideable: true,
      items: [
        { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
        { title: "Notifikasi", url: "/notifications", icon: Bell },
        { title: "Signature Manager", url: "/signatures", icon: FileSignature },
      ],
    },
    {
      key: "master",
      label: "Data Master",
      hideable: true,
      items: onlyVisible([
        { title: "Cabang", url: "/cabang", icon: Building2, visible: isModerator },
        { title: "Barang", url: "/barang", icon: Boxes },
        { title: "Vendors", url: "/vendors", icon: Briefcase },
        { title: "Customers", url: "/customers", icon: UsersRound },
        { title: "Unit", url: "/units", icon: Tractor },
      ]),
    },
    {
      key: "inventory",
      label: "Inventory",
      hideable: true,
      items: [
        { title: "Stock", url: "/stock", icon: Archive },
        { title: "Request Stok", url: "/stock-requests", icon: ClipboardList },
        { title: "Delivery", url: "/deliveries", icon: Truck },
        { title: "Item Transfer", url: "/item-transfer", icon: ArrowLeftRight },
        { title: "Share Stock", url: "/share-stock", icon: PackagePlus },
        { title: "Barang dalam Pengiriman", url: "/planning-supply", icon: PackageSearch },
        { title: "Job Costing", url: "/job-costing", icon: Calculator },
      ],
    },
    {
      key: "procurement",
      label: "Procurement",
      hideable: true,
      items: [
        { title: "Material Request", url: "/mr", icon: FileText },
        { title: "Scheduled MR", url: "/mr/scheduled", icon: CalendarRange },
        { title: "Purchase Request", url: "/pr", icon: FileSpreadsheet },
        { title: "Purchase Order", url: "/po", icon: ShoppingCart },
        { title: "PO Non-PR → Job Costing", url: "/po/non-pr", icon: Wrench },
        { title: "Receive Item", url: "/receive", icon: PackageCheck },
        { title: "Working Order", url: "/working-order", icon: Factory },
      ],
    },
    {
      key: "stockOut",
      label: "Stock Out Project",
      hideable: true,
      items: [
        { title: "Report SPB", url: "/spb/report", icon: FileBox },
        { title: "SPB", url: "/spb", icon: FileWarning },
        { title: "Purchase Order", url: "/spb/po", icon: ShoppingCart },
        { title: "Delivery Order", url: "/spb/do", icon: Truck },
        { title: "Invoice", url: "/spb/invoice", icon: BadgeDollarSign },
        { title: "Return SPB", url: "/return-spb", icon: Undo2 },
      ],
    },
    {
      key: "soReguler",
      label: "SO Reguler",
      hideable: true,
      items: [
        { title: "DO Reguler", url: "/so-reguler/do", icon: Truck },
        { title: "SO Reguler", url: "/so-reguler/so", icon: ReceiptText },
      ],
    },
    {
      key: "consignment",
      label: "Consignment",
      hideable: true,
      items: [
        {
          title: "Dashboard Consignment",
          url: "/so-reguler/consignment/dashboard",
          icon: LayoutDashboard,
        },
        { title: "Sales Order", url: "/so-reguler/consignment/so", icon: Handshake },
        { title: "Item Konsinyasi", url: "/so-reguler/consignment/ik", icon: ClipboardList },
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
    },
    // Konsinyasi vendor (supplier titip AC part di gudang GMI). IT & SPB
    // konsinyasi dibuat dari menu Item Transfer / SPB biasa (toggle Konsinyasi).
    {
      key: "vendorConsignment",
      label: "Konsinyasi Vendor",
      hideable: true,
      items: [
        { title: "PR Konsinyasi", url: "/vendor-consignment/pr", icon: FileSpreadsheet },
        { title: "GR Konsinyasi", url: "/vendor-consignment/gr", icon: PackageCheck },
        { title: "Stok Konsinyasi", url: "/vendor-consignment/stock", icon: Warehouse },
        { title: "Rekonsil & BAST", url: "/vendor-consignment/rekonsil", icon: Scale },
      ],
    },
    {
      key: "hmMaintenance",
      label: "HM Maintenance",
      hideable: true,
      items: [
        { title: "Periodic Maintenance", url: "/maintenance", icon: Gauge },
        { title: "Forecasting AC", url: "/maintenance/forecast-ac", icon: Snowflake },
      ],
    },
    {
      key: "help",
      label: "Bantuan",
      hideable: false,
      items: [
        { title: "Update Web", url: "/update-web", icon: Megaphone },
        { title: "Dokumentasi", url: "/dokumentasi", icon: BookOpen },
        { title: "Tentang App", url: "/tentang-app", icon: Info },
      ],
    },
  ];

  return groups.filter((g) => g.items.length > 0);
}
