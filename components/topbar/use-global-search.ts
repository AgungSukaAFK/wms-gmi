"use client";

// Data global search di top bar (./topbar-search.tsx): hasil RPC
// `global_search` (supabase/migrations/20261030100000_global_search.sql),
// antrian approval (`get_pending_approvals_for_user`) plus riwayat pencarian
// per akun.
//
// Supaya ringan buat Supabase:
// - 1 RPC per query (bukan query per tabel), maks. SEARCH_PER_GROUP baris per
//   jenis, cuma kolom ringan.
// - Baru dikirim setelah berhenti mengetik SEARCH_DEBOUNCE_MS & minimal
//   SEARCH_MIN_CHARS huruf (di bawah itu cuma cari menu/aksi, lokal).
// - Hasil disimpan sebentar (SEARCH_CACHE_TTL_MS) - hapus satu huruf lalu
//   ketik lagi tidak memicu request baru. Request yang sudah basi dibatalkan.
// - Antrian approval cuma diambil saat search dibuka, maks. 1x per
//   PENDING_TTL_MS.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

export const SEARCH_MIN_CHARS = 3;
export const SEARCH_PER_GROUP = 5;
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_MAX = 40;
export const PENDING_LIMIT = 5;
const PENDING_TTL_MS = 60_000;

export type GlobalSearchKind = "mr" | "pr" | "po" | "it" | "so" | "barang";

export type GlobalSearchRow = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  created_at: string | null;
  exact: boolean;
};

/** Baris dari get_pending_approvals_for_user. */
export type PendingRow = {
  document_type: string;
  document_id: number;
  document_number: string;
  document_url: string;
  status_col: string | null;
  created_at: string | null;
  step_level: string | null;
};

export type SearchStatus = "idle" | "loading" | "done" | "error";

const NO_ROWS: GlobalSearchRow[] = [];

export function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

// Cache dibagi semua instance (inline desktop & dialog mobile), dikunci per
// akun supaya ganti akun di tab yang sama tidak kebagian hasil akun lain.
const searchCache = new Map<string, { at: number; rows: GlobalSearchRow[] }>();

function readCache(key: string) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return hit.rows;
}

function writeCache(key: string, rows: GlobalSearchRow[]) {
  searchCache.delete(key);
  searchCache.set(key, { at: Date.now(), rows });
  while (searchCache.size > SEARCH_CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value!);
  }
}

/**
 * Hasil `global_search` untuk `query`. Selama hasil query baru dimuat, hasil
 * query sebelumnya tetap ditampilkan (status "loading") supaya daftar tidak
 * berkedip tiap ketikan. `flush()` = cari sekarang tanpa menunggu debounce
 * (dipakai saat Enter).
 */
export function useGlobalSearch(query: string, userId: string | null) {
  const q = normalizeQuery(query);
  const enabled = !!userId && q.length >= SEARCH_MIN_CHARS;
  const key = `${userId}:${q.toLowerCase()}`;

  // Hasil terakhir yang selesai dimuat (bisa milik query sebelumnya).
  const [result, setResult] = useState<{
    key: string;
    rows: GlobalSearchRow[];
    status: "done" | "error";
  } | null>(null);
  const inflight = useRef<{
    key: string;
    promise: Promise<GlobalSearchRow[]>;
    controller: AbortController;
  } | null>(null);

  const fetchRows = useCallback(
    (key: string, q: string): Promise<GlobalSearchRow[]> => {
      const cached = readCache(key);
      if (cached) return Promise.resolve(cached);
      if (inflight.current?.key === key) return inflight.current.promise;

      inflight.current?.controller.abort();
      const controller = new AbortController();
      const promise = (async () => {
        const { data, error } = await createClient()
          .rpc("global_search", { p_query: q, p_limit: SEARCH_PER_GROUP })
          .abortSignal(controller.signal);
        // Dibatalkan karena query sudah berganti: jangan dianggap gagal.
        if (controller.signal.aborted)
          throw new DOMException("Pencarian dibatalkan", "AbortError");
        if (error) throw error;
        const rows = (data ?? []) as GlobalSearchRow[];
        writeCache(key, rows);
        return rows;
      })().finally(() => {
        if (inflight.current?.key === key) inflight.current = null;
      });
      inflight.current = { key, promise, controller };
      return promise;
    },
    [],
  );

  const load = useCallback(
    (key: string, q: string) =>
      fetchRows(key, q).then(
        (rows) => {
          setResult({ key, rows, status: "done" });
          return rows;
        },
        (error) => {
          // Request dibatalkan karena query sudah berganti - abaikan.
          if (error?.name === "AbortError") throw error;
          setResult({ key, rows: [], status: "error" });
          throw error;
        },
      ),
    [fetchRows],
  );

  const cached = enabled ? readCache(key) : null;

  useEffect(() => {
    if (!enabled || readCache(key)) return;
    const timer = window.setTimeout(
      () => load(key, q).catch(() => {}),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
    // `q` sudah terwakili `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, load]);

  // Cari sekarang (Enter / "Coba lagi") tanpa menunggu debounce.
  const flush = useCallback((): Promise<GlobalSearchRow[]> => {
    if (!enabled) return Promise.resolve(NO_ROWS);
    if (result?.key === key && result.status === "error") setResult(null);
    return load(key, q);
  }, [enabled, load, key, q, result]);

  if (!enabled) return { rows: NO_ROWS, status: "idle" as SearchStatus, flush };
  if (cached) return { rows: cached, status: "done" as SearchStatus, flush };
  if (result?.key === key)
    return { rows: result.rows, status: result.status as SearchStatus, flush };
  // Hasil query baru belum datang: tampilkan hasil query sebelumnya.
  return { rows: result?.rows ?? NO_ROWS, status: "loading" as SearchStatus, flush };
}

const pendingCache = new Map<string, { at: number; rows: PendingRow[] }>();
const NO_PENDING: PendingRow[] = [];

/** Dokumen yang menunggu approval user ini - diambil saat `active`. */
export function usePendingApprovals(userId: string | null, active: boolean) {
  const [loaded, setLoaded] = useState<{ userId: string; rows: PendingRow[] } | null>(
    null,
  );

  useEffect(() => {
    if (!userId || !active) return;
    const hit = pendingCache.get(userId);
    if (hit && Date.now() - hit.at < PENDING_TTL_MS) return;

    let cancelled = false;
    createClient()
      .rpc("get_pending_approvals_for_user", { user_uuid: userId })
      .then(({ data, error }) => {
        if (error || cancelled) return;
        const rows = (data ?? []) as PendingRow[];
        pendingCache.set(userId, { at: Date.now(), rows });
        setLoaded({ userId, rows });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, active]);

  if (!userId) return NO_PENDING;
  if (loaded?.userId === userId) return loaded.rows;
  return pendingCache.get(userId)?.rows ?? NO_PENDING;
}

// ---------------------------------------------------------------------------
// Riwayat (per akun, per device): dokumen yang terakhir dibuka lewat search &
// query yang menghasilkan sesuatu yang dibuka.

export type RecentDoc = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

type SearchHistory = { docs: RecentDoc[]; queries: string[] };

const HISTORY_MAX_DOCS = 5;
const HISTORY_MAX_QUERIES = 4;
const EMPTY_HISTORY: SearchHistory = { docs: [], queries: [] };

const historyKey = (userId: string) => `wms:global-search-history:${userId}`;
const historyListeners = new Set<() => void>();
// Snapshot useSyncExternalStore harus objek yang sama selama isinya sama.
let historySnapshot: { raw: string | null; value: SearchHistory } = {
  raw: null,
  value: EMPTY_HISTORY,
};

function readHistory(userId: string | null): SearchHistory {
  if (!userId) return EMPTY_HISTORY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(historyKey(userId));
  } catch {
    return EMPTY_HISTORY;
  }
  if (raw === historySnapshot.raw) return historySnapshot.value;
  let value = EMPTY_HISTORY;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    value = {
      docs: Array.isArray(parsed?.docs) ? parsed.docs : [],
      queries: Array.isArray(parsed?.queries) ? parsed.queries : [],
    };
  } catch {
    // isi rusak - anggap kosong
  }
  historySnapshot = { raw, value };
  return value;
}

function subscribeHistory(listener: () => void) {
  historyListeners.add(listener);
  return () => {
    historyListeners.delete(listener);
  };
}

export function useSearchHistory(userId: string | null) {
  // Saat SSR selalu kosong supaya tidak mismatch hidrasi.
  const history = useSyncExternalStore(
    subscribeHistory,
    () => readHistory(userId),
    () => EMPTY_HISTORY,
  );

  const update = useCallback(
    (fn: (prev: SearchHistory) => SearchHistory) => {
      if (!userId) return;
      try {
        localStorage.setItem(
          historyKey(userId),
          JSON.stringify(fn(readHistory(userId))),
        );
      } catch {
        // abaikan (localStorage penuh / diblokir)
      }
      historyListeners.forEach((l) => l());
    },
    [userId],
  );

  const addDoc = useCallback(
    (doc: RecentDoc) =>
      update((prev) => ({
        ...prev,
        docs: [
          doc,
          ...prev.docs.filter((d) => !(d.kind === doc.kind && d.id === doc.id)),
        ].slice(0, HISTORY_MAX_DOCS),
      })),
    [update],
  );

  const addQuery = useCallback(
    (query: string) => {
      const q = normalizeQuery(query);
      if (q.length < 2) return;
      update((prev) => ({
        ...prev,
        queries: [
          q,
          ...prev.queries.filter((x) => x.toLowerCase() !== q.toLowerCase()),
        ].slice(0, HISTORY_MAX_QUERIES),
      }));
    },
    [update],
  );

  const clear = useCallback(() => update(() => EMPTY_HISTORY), [update]);

  return { history, addDoc, addQuery, clear };
}
