// Forecasting AC (modul HM Maintenance) — digitalisasi "Forcasting AC.xlsx":
// perkiraan servis AC per bulan (unit kena PMS besar), part & biaya per
// section, kebutuhan part vs stok WMS. Proyeksi di lib/hm-ac.ts.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { HmUnit } from "@/lib/hm";
import {
  addPeriods,
  toPeriodKey,
  type HmAcExtraItem,
  type HmAcPackage,
  type HmAcSchedule,
  type HmAcUnitRow,
  type HmAcUnitSetting,
} from "@/lib/hm-ac";
import { fetchHmCabangOptions, type HmCabangOption } from "@/services/hm-maintenance-client";
import {
  fetchAcExtras,
  fetchAcPackages,
  fetchAcSchedules,
  fetchAcSettings,
  fetchAcUnits,
} from "@/services/hm-ac-client";
import { useHmAdmin } from "@/components/hm-maintenance/hm-admin-context";
import { useHmSite } from "@/components/hm-maintenance/hm-site-context";
import { HmLoadError, HmPageHeading, HmReloadButton } from "@/components/hm-maintenance/hm-page-heading";
import { AcForecastTab, AcPackagesTab, AcUnitSettingsTab } from "@/components/hm-maintenance/hm-ac-tabs";

export default function ForecastAcPage() {
  const { isAdmin } = useHmAdmin();
  const { siteId, site, ready } = useHmSite();
  const [tab, setTab] = useState("forecast");
  const [periodKey, setPeriodKey] = useState(() => toPeriodKey(new Date()));
  const [units, setUnits] = useState<HmUnit[]>([]);
  const [settings, setSettings] = useState<HmAcUnitSetting[]>([]);
  const [packages, setPackages] = useState<HmAcPackage[]>([]);
  const [cabangs, setCabangs] = useState<HmCabangOption[]>([]);
  const [extrasByPeriod, setExtrasByPeriod] = useState<Record<string, HmAcExtraItem[]>>({});
  const [schedulesByPeriod, setSchedulesByPeriod] = useState<Record<string, HmAcSchedule[]>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!ready) return;
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const periods = [0, 1, 2].map((n) => addPeriods(periodKey, n));
      const [u, s, p, c, extras, schedules] = await Promise.all([
        fetchAcUnits(siteId),
        fetchAcSettings(),
        fetchAcPackages(),
        fetchHmCabangOptions().catch(() => [] as HmCabangOption[]),
        fetchAcExtras(periods),
        fetchAcSchedules(periods),
      ]);
      if (id !== requestId.current) return;
      setUnits(u);
      setSettings(s);
      setPackages(p);
      setCabangs(c);
      const byPeriod = <T extends { period: string }>(list: T[]) =>
        Object.fromEntries(periods.map((key) => [key, list.filter((x) => x.period.startsWith(key))]));
      setExtrasByPeriod(byPeriod(extras));
      setSchedulesByPeriod(byPeriod(schedules));
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [periodKey, siteId, ready]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pengaturan AC unit di site terpilih saja; tab Paket Part tetap pakai
  // semua pengaturan (paket berlaku lintas site).
  const siteSettings = useMemo(() => {
    const ids = new Set(units.map((u) => u.id));
    return settings.filter((s) => ids.has(s.unit_id));
  }, [units, settings]);

  const rows: HmAcUnitRow[] = useMemo(() => {
    const byUnit = new Map(siteSettings.map((s) => [s.unit_id, s]));
    return units.map((u) => ({ ...u, ac: byUnit.get(u.id) ?? null }));
  }, [units, siteSettings]);

  return (
    <>
      <HmPageHeading
        label="HM Maintenance"
        title="Forecasting AC"
        subtitle={site ? `Site ${site.nama_cabang}` : "Semua site"}
        description="Perkiraan servis AC unit per bulan beserta part dan biaya. Unit jatuh tempo tiap interval servis AC (default 2000 HM, setara PMS 2000/4000/8000)."
        actions={<HmReloadButton onClick={load} loading={loading} />}
      />

      {failed && (
        <HmLoadError message="Gagal memuat data Forecasting AC. Periksa koneksi lalu coba lagi." onRetry={load} />
      )}

      <Tabs value={tab} onValueChange={setTab} className="col-span-12">
        <TabsList>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
          <TabsTrigger value="units">Pengaturan Unit</TabsTrigger>
          <TabsTrigger value="packages">Paket Part</TabsTrigger>
        </TabsList>
        <TabsContent value="forecast" className="mt-4">
          <AcForecastTab
            loading={loading}
            isAdmin={isAdmin}
            periodKey={periodKey}
            onPeriodChange={setPeriodKey}
            units={units}
            settings={siteSettings}
            packages={packages}
            siteName={site?.nama_cabang ?? null}
            extrasByPeriod={extrasByPeriod}
            schedulesByPeriod={schedulesByPeriod}
            cabangs={cabangs}
            onChanged={load}
          />
        </TabsContent>
        <TabsContent value="units" className="mt-4">
          <AcUnitSettingsTab loading={loading} isAdmin={isAdmin} rows={rows} packages={packages} onChanged={load} />
        </TabsContent>
        <TabsContent value="packages" className="mt-4">
          <AcPackagesTab
            loading={loading}
            isAdmin={isAdmin}
            packages={packages}
            settings={settings}
            onChanged={load}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
