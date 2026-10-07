// Periodic Maintenance — Daftar Unit (hm.md §9.3).

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HmUnitSummary } from "@/lib/hm";
import { fetchHmUnits } from "@/services/hm-maintenance-client";
import { useHmAdmin } from "@/components/hm-maintenance/hm-admin-context";
import { useHmSite } from "@/components/hm-maintenance/hm-site-context";
import { HmUnitFormDialog } from "@/components/hm-maintenance/hm-dialogs";
import { HmLoadError, HmPageHeading, HmReloadButton } from "@/components/hm-maintenance/hm-page-heading";
import { SummaryStrip } from "@/components/hm-maintenance/hm-status";
import { HmUnitGrid } from "@/components/hm-maintenance/hm-unit-grid";

export default function MaintenanceUnitListPage() {
  const { isAdmin } = useHmAdmin();
  const { siteId, site, ready, reloadSites } = useHmSite();
  const [units, setUnits] = useState<HmUnitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!ready) return;
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const u = await fetchHmUnits(siteId);
      if (id === requestId.current) setUnits(u);
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [siteId, ready]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () =>
      units.reduce(
        (acc, u) => ({
          parts: acc.parts + u.part_count,
          lewat: acc.lewat + u.lewat_count,
          segera: acc.segera + u.segera_count,
        }),
        { parts: 0, lewat: 0, segera: 0 },
      ),
    [units],
  );

  return (
    <>
      <HmPageHeading
        label="Manajemen Unit"
        title="Armada & HM Terkini"
        subtitle={site ? `Site ${site.nama_cabang}` : "Semua site"}
        description="Setiap unit punya daftar part sendiri dengan interval HM yang berbeda. Klik unit untuk melihat detail part dan riwayat servis."
        actions={
          <>
            <HmReloadButton onClick={load} loading={loading} />
            {isAdmin && (
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" />
                Tambah Unit
              </Button>
            )}
          </>
        }
      />

      <div className="col-span-12">
        <SummaryStrip
          loading={loading}
          stats={[
            { label: "Jumlah Unit", value: units.length },
            { label: "Total Part", value: totals.parts },
            { label: "Part Lewat", value: totals.lewat, status: "lewat" },
            { label: "Part Segera", value: totals.segera, status: "segera" },
          ]}
        />
      </div>

      {failed && <HmLoadError message="Gagal memuat daftar unit dari backend." onRetry={load} />}

      <div className="col-span-12">
        <HmUnitGrid units={units} loading={loading} />
      </div>

      <HmUnitFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        unit={null}
        defaultCabangId={siteId}
        onSaved={() => {
          void reloadSites();
          void load();
        }}
      />
    </>
  );
}
