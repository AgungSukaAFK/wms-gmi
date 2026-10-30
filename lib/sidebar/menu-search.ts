"use client";

/**
 * lib/sidebar/menu-search.ts
 *
 * Pencarian menu sidebar yang "pintar": selain cocok ke judul menu, juga
 * cocok ke singkatan (mis. "mr" -> Material Request, "po" -> Purchase
 * Order), sinonim/kata kunci Bahasa Indonesia & Inggris (mis. "persetujuan"
 * -> semua menu approval), nama grup (mis. "spb" -> semua menu Stock Out Project),
 * dan tahan typo ringan (mis. "aproval").
 *
 * Query disimpan di localStorage supaya tidak kereset saat pindah halaman /
 * reload - baru hilang kalau user sendiri yang menghapus (tombol clear / Esc).
 */

import { useCallback, useSyncExternalStore } from "react";

/** Kata kunci tambahan per URL menu (di luar judulnya sendiri). */
const MENU_KEYWORDS: Record<string, string[]> = {
  "/users": ["user", "pengguna", "akun", "karyawan", "role", "hak akses", "aktivasi"],
  "/approval-templates": ["approval", "persetujuan", "alur approval", "workflow", "template", "ttd"],
  "/mr-level-settings": ["mr", "level", "trigger", "prioritas", "min max"],
  "/import": ["import", "upload", "excel", "xls", "template", "migrasi data"],
  "/dashboard": ["beranda", "home", "ringkasan", "statistik", "overview", "utama"],
  "/notifications": ["notif", "pemberitahuan", "inbox", "pesan", "alert"],
  "/signatures": ["ttd", "tanda tangan", "signature", "paraf"],
  "/cabang": ["gudang", "lokasi", "site", "branch", "warehouse"],
  "/barang": ["item", "produk", "material", "katalog", "part", "part number", "pn", "sparepart"],
  "/vendors": ["vendor", "supplier", "pemasok", "rekanan"],
  "/customers": ["customer", "pelanggan", "klien", "site customer"],
  "/stock": ["stok", "soh", "persediaan", "inventory", "gudang", "min max", "kartu stok"],
  "/stock-requests": ["request stok", "atur min max", "permintaan stok", "setting stok"],
  "/deliveries": ["delivery", "pengiriman", "kirim", "surat jalan", "ekspedisi", "kurir"],
  "/item-transfer": ["it", "transfer", "mutasi", "pindah gudang", "antar gudang"],
  "/share-stock": ["ss", "share", "alokasi", "bagi stok", "antar cabang"],
  "/planning-supply": ["in transit", "intransit", "pengiriman", "planning", "supply", "otw"],
  "/job-costing": ["jc", "biaya", "costing", "proyek", "finish part"],
  "/mr": ["mr", "material request", "permintaan material", "pengajuan", "request"],
  "/mr/scheduled": ["mr", "terjadwal", "3 bulan", "scheduled", "rutin"],
  "/pr": ["pr", "purchase request", "permintaan pembelian"],
  "/po": ["po", "purchase order", "pembelian", "pesanan", "beli", "purchasing"],
  "/po/non-pr": ["po", "non pr", "job costing", "jc"],
  "/receive": ["ri", "receive", "penerimaan", "terima barang", "gr", "barang masuk"],
  "/working-order": ["wo", "produksi", "rakit", "assembly", "formula"],
  "/spb/report": ["spb", "laporan", "report", "rekap", "payment"],
  "/spb": ["spb", "stock out", "pengeluaran barang", "proyek"],
  "/spb/po": ["spb", "po", "purchase order customer"],
  "/spb/do": ["spb", "do", "delivery order", "surat jalan"],
  "/spb/invoice": ["spb", "invoice", "faktur", "tagihan"],
  "/return-spb": ["spb", "retur", "return", "pengembalian"],
  "/so-reguler/do": ["do", "delivery order", "surat jalan", "reguler"],
  "/so-reguler/so": ["so", "sales order", "penjualan", "reguler"],
  "/so-reguler/consignment/dashboard": ["konsinyasi", "consignment", "performance"],
  "/so-reguler/consignment/so": ["so", "konsinyasi", "consignment", "sales order"],
  "/so-reguler/consignment/ik": ["ik", "konsinyasi", "invoice konsinyasi", "instruksi kerja"],
  "/so-reguler/consignment/penerimaan": ["konsinyasi", "penerimaan", "konfirmasi", "komplain"],
  "/so-reguler/consignment/customer-stock": ["konsinyasi", "stok customer", "customer stock"],
  "/vendor-consignment/pr": ["konsinyasi vendor", "titipan", "pr"],
  "/vendor-consignment/gr": ["konsinyasi vendor", "titipan", "gr", "goods receipt"],
  "/vendor-consignment/stock": ["konsinyasi vendor", "titipan", "stok"],
  "/vendor-consignment/rekonsil": ["konsinyasi vendor", "rekonsiliasi", "bast", "berita acara"],
  "/maintenance": ["hm", "pms", "service", "servis", "unit", "perawatan", "hour meter"],
  "/maintenance/forecast-ac": ["ac", "forecast", "forcasting", "part ac", "pms"],
  "/update-web": ["changelog", "rilis", "release", "versi", "pengumuman", "berita", "whats new"],
  "/dokumentasi": ["docs", "panduan", "bantuan", "help", "manual", "tutorial", "cara"],
  "/tentang-app": ["about", "info", "versi", "aplikasi"],
};

/** Kata kunci per grup sidebar - berlaku utk semua menu di grup itu. */
const GROUP_KEYWORDS: Record<string, string[]> = {
  Admin: ["admin", "management", "kelola", "pengaturan"],
  "Data Master": ["master", "master data"],
  "Stock Out Project": ["spb", "stock out", "proyek"],
  Consignment: ["konsinyasi", "consignment"],
  "Konsinyasi Vendor": ["konsinyasi", "vendor", "titipan"],
  "HM Maintenance": ["hm", "maintenance", "perawatan"],
};

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Material Request" -> "mr", "Approval & Validation" -> "av". */
function acronym(normalized: string): string {
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("");
}

/** Jarak edit maksimal 1 (cukup utk typo ringan: kurang/lebih/salah 1 huruf). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

type Index = { title: string; titleWords: string[]; acr: string; keywords: string[]; keywordWords: string[] };

function buildIndex(
  title: string,
  url: string,
  groupLabel?: string,
  extraKeywords?: string[],
): Index {
  const t = normalizeSearch(title);
  const keywords = [
    ...(MENU_KEYWORDS[url] ?? []),
    ...((groupLabel && GROUP_KEYWORDS[groupLabel]) || []),
    ...(extraKeywords ?? []),
  ].map(normalizeSearch);
  return {
    title: t,
    titleWords: t.split(" ").filter(Boolean),
    acr: acronym(t),
    keywords,
    keywordWords: keywords.flatMap((k) => k.split(" ")),
  };
}

function scoreToken(token: string, idx: Index): number {
  if (idx.title === token) return 100;
  if (idx.acr === token) return 95;
  if (idx.title.startsWith(token)) return 90;
  if (idx.titleWords.some((w) => w === token)) return 85;
  if (idx.keywords.some((k) => k === token)) return 80;
  if (idx.titleWords.some((w) => w.startsWith(token))) return 75;
  if (token.length >= 2 && idx.acr.startsWith(token)) return 65;
  if (idx.keywordWords.some((w) => w.startsWith(token))) return 60;
  if (token.length >= 3 && idx.title.includes(token)) return 50;
  if (token.length >= 3 && idx.keywords.some((k) => k.includes(token))) return 40;
  if (
    token.length >= 5 &&
    [...idx.titleWords, ...idx.keywordWords].some(
      (w) => w.length >= 5 && withinOneEdit(token, w),
    )
  )
    return 30;
  if (token.length >= 3 && isSubsequence(token, idx.title.replace(/ /g, "")))
    return 15;
  return 0;
}

/**
 * Skor relevansi satu menu terhadap query (0 = tidak cocok). Semua kata di
 * query harus cocok ke sesuatu; frasa utuh yang cocok ke judul/kata kunci
 * dapat skor lebih tinggi. `item.keywords` = kata kunci tambahan di luar
 * MENU_KEYWORDS (mis. aksi cepat di global search top bar).
 */
export function scoreMenuItem(
  query: string,
  item: { title: string; url: string; keywords?: string[] },
  groupLabel?: string,
): number {
  const q = normalizeSearch(query);
  if (!q) return 0;
  const idx = buildIndex(item.title, item.url, groupLabel, item.keywords);

  let phrase = 0;
  if (q.includes(" ")) {
    if (idx.title.startsWith(q)) phrase = 120;
    else if (idx.title.includes(q)) phrase = 110;
    else if (idx.keywords.some((k) => k === q)) phrase = 105;
    else if (idx.keywords.some((k) => k.includes(q))) phrase = 70;
  }

  let total = 0;
  for (const token of q.split(" ")) {
    const s = scoreToken(token, idx);
    if (s === 0) return phrase;
    total += s;
  }
  return Math.max(phrase, total / q.split(" ").length);
}

/** Saring & urutkan menu berdasarkan query (paling relevan di atas). */
export function searchMenuItems<T extends { title: string; url: string }>(
  items: T[],
  query: string,
  groupLabel?: string,
): T[] {
  return items
    .map((item, i) => ({ item, i, score: scoreMenuItem(query, item, groupLabel) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.item);
}

const STORAGE_KEY = "wms:sidebar-search";

const queryListeners = new Set<() => void>();

function readStoredQuery(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return ""; // localStorage diblokir
  }
}

function subscribeQuery(listener: () => void) {
  queryListeners.add(listener);
  return () => {
    queryListeners.delete(listener);
  };
}

/**
 * Query pencarian sidebar yang persisten (localStorage). Saat SSR selalu
 * kosong (snapshot server) supaya tidak mismatch hidrasi.
 */
export function useSidebarSearch() {
  const query = useSyncExternalStore(subscribeQuery, readStoredQuery, () => "");

  const setQuery = useCallback((value: string) => {
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // abaikan
    }
    queryListeners.forEach((l) => l());
  }, []);

  return { query, setQuery };
}
