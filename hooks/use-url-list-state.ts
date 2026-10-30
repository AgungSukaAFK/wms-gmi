"use client";

// State filter/sort/page halaman list yang disimpan di query string URL
// (taste-ui: "semua yang bisa di-share ada di URL"), jadi link bisa dikirim
// ke orang lain dan tombol Back browser bekerja.
//
// - Setter yang dipanggil beruntun dalam satu event (mis. setStatus lalu
//   setPage(1)) digabung jadi satu router.push - kalau push satu-satu, push
//   kedua dibangun dari URL lama (useSearchParams baru berubah setelah
//   navigasi selesai) dan menimpa yang pertama.
// - Nilai kosong ("" / [] / null) menghapus param dari URL.
// - `list()` mengembalikan array yang sama selama nilainya tidak berubah,
//   aman dipakai sebagai dependency useEffect.
// - Kotak pencarian pakai hooks/use-url-search-input.ts (debounce + Back).

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type UrlParamValue = string | number | string[] | null | undefined;

export function useUrlListState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL terakhir yang di-push (lihat catatan di atas).
  const latestRef = useRef(searchParams.toString());
  useEffect(() => {
    latestRef.current = searchParams.toString();
  }, [searchParams]);

  const pendingRef = useRef<Record<string, UrlParamValue> | null>(null);
  const listCache = useRef(new Map<string, { raw: string; value: string[] }>());

  const get = useCallback(
    (key: string, fallback = "") => searchParams.get(key) ?? fallback,
    [searchParams],
  );

  const getNumber = (key: string, fallback: number) => {
    const n = Number(searchParams.get(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const list = (key: string): string[] => {
    const raw = searchParams.get(key) ?? "";
    const cached = listCache.current.get(key);
    if (cached && cached.raw === raw) return cached.value;
    const value = raw ? raw.split(",").filter(Boolean) : [];
    listCache.current.set(key, { raw, value });
    return value;
  };

  const flush = useCallback(() => {
    const updates = pendingRef.current;
    pendingRef.current = null;
    if (!updates) return;
    const params = new URLSearchParams(latestRef.current);
    for (const [key, value] of Object.entries(updates)) {
      const str = Array.isArray(value)
        ? value.join(",")
        : value == null
          ? ""
          : String(value);
      if (str) params.set(key, str);
      else params.delete(key);
    }
    const next = params.toString();
    if (next === latestRef.current) return;
    latestRef.current = next;
    router.push(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router]);

  /** Ubah beberapa param sekaligus. `resetPage` = kembali ke halaman 1. */
  const set = useCallback(
    (updates: Record<string, UrlParamValue>, { resetPage = false } = {}) => {
      const first = pendingRef.current === null;
      pendingRef.current = {
        ...pendingRef.current,
        ...updates,
        ...(resetPage ? { page: null } : {}),
      };
      if (first) queueMicrotask(flush);
    },
    [flush],
  );

  /** Hapus semua param (filter, sort, page, limit). */
  const reset = useCallback(() => {
    pendingRef.current = null;
    if (!latestRef.current) return;
    latestRef.current = "";
    router.push(pathname, { scroll: false });
  }, [pathname, router]);

  return { get, getNumber, list, set, reset };
}
