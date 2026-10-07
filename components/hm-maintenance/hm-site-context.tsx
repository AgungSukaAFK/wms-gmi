// Site aktif modul HM Maintenance. Site = gudang/cabang unit
// (hm_units.cabang_id), dipilih sekali di header layout lalu dipakai semua
// halaman (Jadwal, Unit, Forecasting AC) supaya daftar unitnya sama persis.
// Pilihan disimpan di localStorage per browser.

"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchHmSites, type HmCabangOption } from "@/services/hm-maintenance-client";

const STORAGE_KEY = "hm-maintenance-site";
/** Nilai "semua site" di select & storage. */
export const ALL_SITES = "all";

type HmSiteState = {
  /** null = semua site. */
  siteId: number | null;
  site: HmCabangOption | null;
  sites: HmCabangOption[];
  /** false selama daftar site & pilihan tersimpan belum dibaca. */
  ready: boolean;
  setSiteId: (id: number | null) => void;
  reloadSites: () => Promise<void>;
};

const HmSiteContext = createContext<HmSiteState>({
  siteId: null,
  site: null,
  sites: [],
  ready: false,
  setSiteId: () => {},
  reloadSites: async () => {},
});

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // abaikan: storage diblokir
  }
}

export function HmSiteProvider({ children }: { children: ReactNode }) {
  const [sites, setSites] = useState<HmCabangOption[]>([]);
  const [siteId, setSiteIdState] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const reloadSites = useCallback(async () => {
    setSites(await fetchHmSites().catch(() => [] as HmCabangOption[]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchHmSites()
      .catch(() => [] as HmCabangOption[])
      .then((list) => {
        if (cancelled) return;
        setSites(list);
        const stored = readStored();
        if (stored === ALL_SITES) {
          setSiteIdState(null);
        } else if (stored && list.some((s) => String(s.id) === stored)) {
          setSiteIdState(Number(stored));
        } else {
          // Default: site pertama yang punya unit (semua site kalau belum ada).
          setSiteIdState(list[0]?.id ?? null);
        }
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSiteId = useCallback((id: number | null) => {
    setSiteIdState(id);
    writeStored(id === null ? ALL_SITES : String(id));
  }, []);

  const value = useMemo(
    () => ({
      siteId,
      site: sites.find((s) => s.id === siteId) ?? null,
      sites,
      ready,
      setSiteId,
      reloadSites,
    }),
    [siteId, sites, ready, setSiteId, reloadSites],
  );

  return <HmSiteContext.Provider value={value}>{children}</HmSiteContext.Provider>;
}

export function useHmSite() {
  return useContext(HmSiteContext);
}
