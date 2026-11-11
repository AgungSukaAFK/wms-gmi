"use client";

// State bersama dashboard utama:
// - Filter disimpan di URL. Perubahan filter = navigasi (server merender ulang
//   dengan satu RPC); selama menunggu, tampilan lama ditahan dan diredupkan
//   (`pending`), bukan diganti skeleton.
// - Drill-down (daftar di balik kartu) juga di URL (?detail=...&dargs=...)
//   lewat history.pushState: bisa dibagikan, tombol Back menutup dialog, dan
//   tidak memicu render ulang server.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardFilters } from "@/lib/dashboard/filters";
import type {
  DashboardExecAPart,
  DashboardExecBPart,
  DashboardPeriodPart,
  ListArgs,
  ListKind,
  ListScope,
  PartResult,
} from "@/lib/dashboard/types";
import { LIST_DEFS } from "@/components/dashboard/main/config";

type ParamValue = string | string[] | number[] | null | undefined;

export type OpenList = { kind: ListKind; args: ListArgs; title?: string };

/**
 * Bagian dashboard yang dimuat menyusul (dibaca dengan use() di dalam
 * <Suspense>). exec_a/exec_b null untuk user non-atasan.
 */
export type DashboardParts = {
  period: Promise<PartResult<DashboardPeriodPart>>;
  execA: Promise<PartResult<DashboardExecAPart>> | null;
  execB: Promise<PartResult<DashboardExecBPart>> | null;
};

type DashboardContextValue = {
  filters: DashboardFilters;
  /** Filter final untuk RPC daftar (lokasi sudah termasuk default hak akses). */
  scope: ListScope;
  canValue: boolean;
  parts: DashboardParts;
  /** Berubah tiap filter berubah: key Suspense supaya skeleton tampil lagi. */
  dataKey: string;
  pending: boolean;
  setParams: (updates: Record<string, ParamValue>) => void;
  resetFilters: () => void;
  refresh: () => void;
  openList: (kind: ListKind, args?: ListArgs, title?: string) => void;
  closeList: () => void;
  detail: OpenList | null;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard harus di dalam <DashboardProvider>");
  return ctx;
}

const FILTER_KEYS = ["periode", "dari", "sampai", "lokasi", "kategori", "prioritas"];
const DETAIL_KEYS = ["detail", "dargs", "dtitle"];

function parseArgs(raw: string | null): ListArgs {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ListArgs = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" || typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function DashboardProvider({
  filters,
  scope,
  canValue,
  parts,
  children,
}: {
  filters: DashboardFilters;
  scope: ListScope;
  canValue: boolean;
  parts: DashboardParts;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // URL terakhir yang dituju: useSearchParams baru berubah setelah navigasi
  // selesai, jadi perubahan beruntun harus dibangun dari sini.
  const latestRef = useRef(searchParams.toString());
  useEffect(() => {
    latestRef.current = searchParams.toString();
  }, [searchParams]);

  // true = dialog dibuka lewat pushState di sesi ini, jadi menutupnya cukup
  // history.back() (entri riwayatnya milik kita).
  const pushedDetailRef = useRef(false);

  const navigate = useCallback(
    (params: URLSearchParams) => {
      const next = params.toString();
      if (next === latestRef.current) return;
      latestRef.current = next;
      pushedDetailRef.current = false;
      startTransition(() => {
        router.push(next ? `${pathname}?${next}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  const setParams = useCallback(
    (updates: Record<string, ParamValue>) => {
      const params = new URLSearchParams(latestRef.current);
      for (const key of DETAIL_KEYS) params.delete(key);
      for (const [key, value] of Object.entries(updates)) {
        const str = Array.isArray(value) ? value.join(",") : (value ?? "");
        if (str) params.set(key, str);
        else params.delete(key);
      }
      navigate(params);
    },
    [navigate],
  );

  const resetFilters = useCallback(() => {
    const params = new URLSearchParams(latestRef.current);
    for (const key of [...FILTER_KEYS, ...DETAIL_KEYS]) params.delete(key);
    navigate(params);
  }, [navigate]);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const openList = useCallback(
    (kind: ListKind, args: ListArgs = {}, title?: string) => {
      const params = new URLSearchParams(latestRef.current);
      const wasOpen = params.has("detail");
      params.set("detail", kind);
      if (Object.keys(args).length > 0) params.set("dargs", JSON.stringify(args));
      else params.delete("dargs");
      if (title) params.set("dtitle", title);
      else params.delete("dtitle");
      const next = params.toString();
      latestRef.current = next;
      const url = `${pathname}?${next}`;
      if (wasOpen) window.history.replaceState(null, "", url);
      else {
        window.history.pushState(null, "", url);
        pushedDetailRef.current = true;
      }
    },
    [pathname],
  );

  const closeList = useCallback(() => {
    if (pushedDetailRef.current) {
      pushedDetailRef.current = false;
      window.history.back();
      return;
    }
    // Dialog dibuka dari link langsung: buang param-nya tanpa entri baru.
    const params = new URLSearchParams(latestRef.current);
    for (const key of DETAIL_KEYS) params.delete(key);
    const next = params.toString();
    latestRef.current = next;
    window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
  }, [pathname]);

  const detailKind = searchParams.get("detail");
  const detailArgs = searchParams.get("dargs");
  const detailTitle = searchParams.get("dtitle");
  const detail = useMemo<OpenList | null>(() => {
    if (!detailKind || !(detailKind in LIST_DEFS)) return null;
    return {
      kind: detailKind as ListKind,
      args: parseArgs(detailArgs),
      title: detailTitle || undefined,
    };
  }, [detailKind, detailArgs, detailTitle]);

  const dataKey = useMemo(() => JSON.stringify(scope), [scope]);

  const value = useMemo<DashboardContextValue>(
    () => ({
      filters,
      scope,
      canValue,
      parts,
      dataKey,
      pending,
      setParams,
      resetFilters,
      refresh,
      openList,
      closeList,
      detail,
    }),
    [filters, scope, canValue, parts, dataKey, pending, setParams, resetFilters, refresh, openList, closeList, detail],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
