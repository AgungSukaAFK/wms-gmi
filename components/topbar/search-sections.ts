// Penyusun daftar hasil global search (./topbar-search.tsx) - fungsi murni
// (tanpa state) supaya hasil yang sama bisa dihitung ulang saat Enter
// ditekan sebelum hasil server datang.
//
// Query kosong: Menunggu approval Anda -> Terakhir dibuka -> Pencarian
// terakhir -> Aksi cepat.
// Ada query: Paling cocok (kode/part number persis) -> grup data & menu/aksi.
// Query yang mirip kode (ada angka atau "/") menaruh dokumen di atas menu;
// selain itu menu & aksi duluan, lalu barang, lalu dokumen.
//
// Jenis data baru: tambahkan di RPC global_search + KIND_META + DATA_GROUPS.

import {
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  ClipboardCheck,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  History,
  LogOut,
  type LucideIcon,
  PackagePlus,
  ReceiptText,
  ShoppingCart,
  SquareUserRound,
} from "lucide-react";
import { scoreMenuItem } from "@/lib/sidebar/menu-search";
import type { NavGroup, NavProfile } from "@/lib/sidebar/nav-config";
import { canCreateMR } from "@/lib/mr-permissions";
import { STATUS_LABEL } from "@/lib/constants/status";
import {
  type GlobalSearchKind,
  type GlobalSearchRow,
  normalizeQuery,
  PENDING_LIMIT,
  type PendingRow,
  type RecentDoc,
  SEARCH_PER_GROUP,
} from "./use-global-search";

export type SearchAction = { type: "logout" };

export type SearchItem = {
  key: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  /** Teks kecil di kanan (nama grup menu). */
  hint?: string | null;
  href?: string;
  action?: SearchAction;
  /** Riwayat pencarian: isi ulang kotak search (tidak pindah halaman). */
  fillQuery?: string;
  /** Disimpan ke "Terakhir dibuka" saat dibuka. */
  recent?: RecentDoc;
  /** Tautan "Lihat semua" - tampil lebih redup. */
  more?: boolean;
};

export type SearchSection = {
  id: string;
  label: string;
  items: SearchItem[];
  /** Grup riwayat: tampilkan tombol "Hapus". */
  clearable?: boolean;
};

const KIND_META: Record<
  GlobalSearchKind,
  { label: string; icon: LucideIcon; href: (row: { id: string; title: string }) => string }
> = {
  mr: { label: "Material Request", icon: FileText, href: (r) => `/mr/${r.id}` },
  pr: { label: "Purchase Request", icon: FileSpreadsheet, href: (r) => `/pr/${r.id}` },
  po: { label: "Purchase Order", icon: ShoppingCart, href: (r) => `/po/${r.id}` },
  it: { label: "Item Transfer", icon: ArrowLeftRight, href: (r) => `/item-transfer/${r.id}` },
  so: { label: "SO Reguler", icon: ReceiptText, href: (r) => `/so-reguler/so/${r.id}` },
  // Halaman Barang mencari dari ?q= (barang/BarangClient.tsx).
  barang: {
    label: "Barang",
    icon: Boxes,
    href: (r) => `/barang?q=${encodeURIComponent(r.title)}`,
  },
};

// `listHref` = halaman list yang membaca ?search= / ?q= (untuk "Lihat semua").
const DATA_GROUPS: {
  id: GlobalSearchKind;
  label: string;
  listHref?: (q: string) => string;
}[] = [
  { id: "mr", label: "Material Request", listHref: (q) => `/mr?search=${encodeURIComponent(q)}` },
  { id: "pr", label: "Purchase Request", listHref: (q) => `/pr?search=${encodeURIComponent(q)}` },
  { id: "po", label: "Purchase Order", listHref: (q) => `/po?search=${encodeURIComponent(q)}` },
  { id: "it", label: "Item Transfer" },
  { id: "so", label: "SO Reguler" },
  { id: "barang", label: "Barang", listHref: (q) => `/barang?q=${encodeURIComponent(q)}` },
];

type QuickAction = {
  id: string;
  title: string;
  icon: LucideIcon;
  keywords: string[];
  href?: string;
  action?: SearchAction;
  /** Ditampilkan juga saat query masih kosong. */
  featured?: boolean;
  visible?: (profile: NavProfile) => boolean;
};

const hasRole = (profile: NavProfile, ...names: string[]) =>
  !!profile?.roles?.some((r) => names.includes(r.name));

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "buat-mr",
    title: "Buat Material Request",
    icon: FilePlus2,
    href: "/mr/create",
    keywords: ["buat mr", "mr baru", "tambah mr", "ajukan mr", "new mr", "create", "baru"],
    featured: true,
    // Sama dengan tombol "Buat MR Baru" (mr/page.tsx).
    visible: (p) => canCreateMR(p?.roles),
  },
  {
    id: "buat-pr",
    title: "Buat Purchase Request",
    icon: FileSpreadsheet,
    href: "/pr/create",
    keywords: ["buat pr", "pr baru", "tambah pr", "new pr", "create", "baru"],
    // Tombol "Buat PR Baru" (pr/page.tsx) tampil untuk semua user.
    featured: true,
  },
  {
    id: "buat-po",
    title: "Buat Purchase Order",
    icon: PackagePlus,
    href: "/po/create",
    keywords: ["buat po", "po baru", "tambah po", "new po", "create", "baru"],
    featured: true,
    // Sama dengan tombol "Buat PO Baru" (po/page.tsx).
    visible: (p) => hasRole(p, "admin", "purchasing"),
  },
  {
    id: "profil",
    title: "Profil Saya",
    icon: SquareUserRound,
    href: "/profile",
    keywords: ["profil", "profile", "akun saya", "ukuran font", "tanda tangan"],
  },
  {
    id: "logout",
    title: "Keluar (Logout)",
    icon: LogOut,
    action: { type: "logout" },
    keywords: ["logout", "log out", "sign out", "keluar", "keluar akun"],
  },
];

function actionToItem(a: QuickAction): SearchItem {
  return { key: `action:${a.id}`, icon: a.icon, title: a.title, href: a.href, action: a.action };
}

const statusLabel = (status: string | null) =>
  status ? (STATUS_LABEL[status.toLowerCase()] ?? status) : null;

function rowToItem(row: GlobalSearchRow): SearchItem {
  const meta = KIND_META[row.kind];
  const href = meta.href(row);
  return {
    key: `${row.kind}:${row.id}`,
    icon: meta.icon,
    title: row.title,
    subtitle: row.subtitle || null,
    status: statusLabel(row.status),
    href,
    recent: { kind: row.kind, id: row.id, title: row.title, subtitle: row.subtitle || null, href },
  };
}

function pendingToItem(row: PendingRow): SearchItem {
  return {
    key: `pending:${row.document_type}:${row.document_id}`,
    icon: ClipboardCheck,
    title: row.document_number,
    subtitle: [row.document_type, row.step_level].filter(Boolean).join(" · ") || null,
    href: row.document_url,
  };
}

function recentToItem(doc: RecentDoc): SearchItem {
  const meta = KIND_META[doc.kind];
  return {
    key: `recent:${doc.kind}:${doc.id}`,
    icon: meta?.icon ?? History,
    title: doc.title,
    subtitle: doc.subtitle,
    href: doc.href,
    recent: doc,
  };
}

// Skor scoreMenuItem: 15 = cuma cocok sebagai subsequence. Di sidebar itu
// membantu, tapi di sini menyodok ke atas hasil data yang jauh lebih relevan
// - menu/aksi wajib cocok lebih kuat (salah ketik 1 huruf masih lolos, 30).
const MIN_LOCAL_SCORE = 20;

function searchMenus(navGroups: NavGroup[], q: string, limit: number) {
  const seen = new Set<string>();
  return navGroups
    .flatMap((g) =>
      g.items.map((item) => ({ item, group: g.label, score: scoreMenuItem(q, item, g.label) })),
    )
    .filter((r) => r.score >= MIN_LOCAL_SCORE)
    .sort((a, b) => b.score - a.score)
    .filter((r) => !seen.has(r.item.url) && !!seen.add(r.item.url))
    .slice(0, limit)
    .map(
      ({ item, group }): SearchItem => ({
        key: `menu:${item.url}`,
        icon: item.icon,
        title: item.title,
        hint: group,
        href: item.url,
      }),
    );
}

function visibleActions(profile: NavProfile) {
  return QUICK_ACTIONS.filter((a) => !a.visible || a.visible(profile));
}

function searchActions(profile: NavProfile, q: string, limit: number) {
  return visibleActions(profile)
    .map((a) => ({
      a,
      score: scoreMenuItem(q, { title: a.title, url: `action:${a.id}`, keywords: a.keywords }),
    }))
    .filter((r) => r.score >= MIN_LOCAL_SCORE)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((r) => actionToItem(r.a));
}

export function looksLikeCode(q: string) {
  return /\d/.test(q) || q.includes("/");
}

export type BuildSectionsInput = {
  query: string;
  navGroups: NavGroup[];
  profile: NavProfile;
  rows: GlobalSearchRow[];
  pending: PendingRow[];
  history: { docs: RecentDoc[]; queries: string[] };
};

export function buildSections(input: BuildSectionsInput): SearchSection[] {
  const { navGroups, profile, rows, pending, history } = input;
  const q = normalizeQuery(input.query);

  if (!q) {
    const sections: SearchSection[] = [];
    if (pending.length > 0) {
      const items = pending.slice(0, PENDING_LIMIT).map(pendingToItem);
      const more = pending.length - PENDING_LIMIT;
      if (more > 0) {
        // Tab default halaman Notifikasi = "Menunggu Persetujuan".
        items.push({
          key: "more:pending",
          icon: ArrowRight,
          title: `Lihat ${more} approval lainnya`,
          href: "/notifications",
          more: true,
        });
      }
      sections.push({ id: "pending", label: "Menunggu approval Anda", items });
    }
    if (history.docs.length > 0) {
      sections.push({
        id: "recent-docs",
        label: "Terakhir dibuka",
        items: history.docs.map(recentToItem),
        clearable: true,
      });
    }
    if (history.queries.length > 0) {
      sections.push({
        id: "recent-queries",
        label: "Pencarian terakhir",
        items: history.queries.map((text) => ({
          key: `query:${text}`,
          icon: History,
          title: text,
          fillQuery: text,
        })),
        clearable: history.docs.length === 0,
      });
    }
    const featured = visibleActions(profile).filter((a) => a.featured);
    if (featured.length > 0) {
      sections.push({ id: "actions", label: "Aksi cepat", items: featured.map(actionToItem) });
    }
    return sections;
  }

  const exact = rows.filter((r) => r.exact);
  const exactSection: SearchSection[] =
    exact.length > 0 ? [{ id: "exact", label: "Paling cocok", items: exact.map(rowToItem) }] : [];

  const dataSections = DATA_GROUPS.map((g): SearchSection => {
    const groupRows = rows.filter((r) => r.kind === g.id);
    const items = groupRows.filter((r) => !r.exact).map(rowToItem);
    // Hasil penuh = kemungkinan masih ada lagi -> tawarkan halaman list.
    if (g.listHref && groupRows.length >= SEARCH_PER_GROUP) {
      items.push({
        key: `more:${g.id}`,
        icon: ArrowRight,
        title: `Lihat semua hasil ${g.label}`,
        href: g.listHref(q),
        more: true,
      });
    }
    return { id: g.id, label: g.label, items };
  });

  const menuSection: SearchSection = { id: "menu", label: "Menu", items: searchMenus(navGroups, q, 5) };
  const actionSection: SearchSection = {
    id: "actions",
    label: "Aksi",
    items: searchActions(profile, q, 3),
  };

  const byId = (id: string) => dataSections.find((s) => s.id === id)!;
  const ordered = looksLikeCode(q)
    ? [...dataSections, menuSection, actionSection]
    : [
        menuSection,
        actionSection,
        byId("barang"),
        byId("mr"),
        byId("pr"),
        byId("po"),
        byId("it"),
        byId("so"),
      ];

  return [...exactSection, ...ordered].filter((s) => s.items.length > 0);
}
