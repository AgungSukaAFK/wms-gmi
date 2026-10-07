// Isi tab halaman Forecasting AC: Forecast bulanan, Pengaturan Unit, Paket
// Part. Data dimuat di page.tsx; proyeksi dihitung di lib/hm-ac.ts.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  Snowflake,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Content } from "@/components/content";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHm, formatRemaining, type HmUnit } from "@/lib/hm";
import {
  AC_SECTION_LABEL,
  addPeriods,
  aggregateRequirements,
  buildAcForecastWorkbook,
  buildMonthRows,
  daysInPeriod,
  estDowntime,
  formatPercent,
  formatPeriod,
  formatQty,
  formatRupiah,
  physicalAvailability,
  toPeriodKey,
  type AcMonthRow,
  type AcPartRequirement,
  type AcScheduleDraft,
  type HmAcExtraItem,
  type HmAcPackage,
  type HmAcSchedule,
  type HmAcUnitRow,
  type HmAcUnitSetting,
} from "@/lib/hm-ac";
import { downloadWorkbook } from "@/lib/item-transfer-export";
import type { HmCabangOption } from "@/services/hm-maintenance-client";
import {
  deleteAcExtra,
  deleteAcPackage,
  deleteAcSchedule,
  deleteAcSetting,
  fetchAcStock,
  saveAcSchedules,
} from "@/services/hm-ac-client";
import {
  AcExtraDialog,
  AcPackageDialog,
  AcServiceDialog,
  AcUnitSettingDialog,
} from "@/components/hm-maintenance/hm-ac-dialogs";
import { errorMessage, HmDeleteDialog } from "@/components/hm-maintenance/hm-dialogs";
import { AcForecastGrid } from "@/components/hm-maintenance/hm-ac-grid";

function omitKey<T>(obj: Record<number, T>, key: number): Record<number, T> {
  const next = { ...obj };
  delete next[key];
  return next;
}

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";
const STICKY_HEAD = "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card";

function EmptyRow({ colSpan, title, children }: { colSpan: number; title: string; children?: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center">
        <Snowflake className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <div className="font-semibold">{title}</div>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
      </TableCell>
    </TableRow>
  );
}

function LoadingRows({ colSpan }: { colSpan: number }) {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell colSpan={colSpan}>
            <Skeleton className="h-5 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ============================================================
// Tab Forecast (grid ala Excel)
// ============================================================

function StatCard({
  label,
  value,
  hint,
  tone,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
  loading?: boolean;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-24" />
      ) : (
        <div
          className={cn(
            "mt-0.5 font-mono text-xl font-bold tabular-nums",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "bad" && "text-destructive",
          )}
        >
          {value}
        </div>
      )}
      {hint && !loading && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function AcForecastTab({
  loading,
  isAdmin,
  periodKey,
  onPeriodChange,
  units,
  settings,
  packages,
  extrasByPeriod,
  schedulesByPeriod,
  cabangs,
  siteName,
  onChanged,
}: {
  loading: boolean;
  isAdmin: boolean;
  periodKey: string;
  onPeriodChange: (key: string) => void;
  units: HmUnit[];
  settings: HmAcUnitSetting[];
  packages: HmAcPackage[];
  /** Data per bulan: bulan terpilih + 2 bulan berikutnya. */
  extrasByPeriod: Record<string, HmAcExtraItem[]>;
  schedulesByPeriod: Record<string, HmAcSchedule[]>;
  cabangs: HmCabangOption[];
  /** Site terpilih (null = semua site), ikut judul & nama file export. */
  siteName: string | null;
  onChanged: () => Promise<void>;
}) {
  const [stock, setStock] = useState<{ part_id: number; cabang_id: number; qty: number }[]>([]);
  const [edits, setEdits] = useState<Record<number, AcScheduleDraft>>({});
  const [manualIds, setManualIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [extraUnit, setExtraUnit] = useState<HmUnit | null>(null);
  const [serviceUnit, setServiceUnit] = useState<HmUnit | null>(null);
  const [settingRow, setSettingRow] = useState<HmAcUnitRow | null>(null);
  const [deleteExtraId, setDeleteExtraId] = useState<number | null>(null);
  const [resetRow, setResetRow] = useState<AcMonthRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showParts, setShowParts] = useState(false);

  const periods = useMemo(() => [0, 1, 2].map((n) => addPeriods(periodKey, n)), [periodKey]);

  const monthRows = useMemo(
    () =>
      Object.fromEntries(
        periods.map((key) => [
          key,
          buildMonthRows({
            units,
            settings,
            packages,
            extras: extrasByPeriod[key] ?? [],
            schedules: schedulesByPeriod[key] ?? [],
            periodKey: key,
            manualUnitIds: key === periodKey ? manualIds : [],
          }),
        ]),
      ) as Record<string, AcMonthRow[]>,
    [periods, periodKey, units, settings, packages, extrasByPeriod, schedulesByPeriod, manualIds],
  );
  const rows = useMemo(() => monthRows[periodKey] ?? [], [monthRows, periodKey]);
  const requirements = useMemo(() => aggregateRequirements(rows), [rows]);

  const dirtyIds = useMemo(() => {
    const saved = new Set(rows.filter((r) => r.saved).map((r) => r.unit.id));
    return new Set([...Object.keys(edits).map(Number), ...manualIds.filter((id) => !saved.has(id))]);
  }, [edits, manualIds, rows]);

  // Unit yang sudah diatur tapi belum ada di grid bulan ini.
  const addableUnits = useMemo(() => {
    const inGrid = new Set(rows.map((r) => r.unit.id));
    const configured = new Set(settings.map((s) => s.unit_id));
    return units.filter((u) => configured.has(u.id) && !inGrid.has(u.id));
  }, [rows, settings, units]);

  const barangKey = useMemo(
    () =>
      [...new Set(requirements.map((r) => r.barang_id).filter((id): id is number => id !== null))]
        .sort((a, b) => a - b)
        .join(","),
    [requirements],
  );

  useEffect(() => {
    const ids = barangKey ? barangKey.split(",").map(Number) : [];
    let cancelled = false;
    fetchAcStock(ids)
      .then((s) => !cancelled && setStock(s))
      .catch(() => !cancelled && setStock([]));
    return () => {
      cancelled = true;
    };
  }, [barangKey]);

  const cabangName = (id: number | null) =>
    id === null ? "Semua gudang" : (cabangs.find((c) => c.id === id)?.nama_cabang ?? `Gudang #${id}`);

  // Sama dengan stock_on_hand modul HM: stok di gudang unit, atau total
  // semua gudang kalau unit belum punya gudang.
  const stockOf = (r: AcPartRequirement): number | null => {
    if (r.barang_id === null) return null;
    return stock
      .filter((s) => s.part_id === r.barang_id && (r.cabang_id === null || s.cabang_id === r.cabang_id))
      .reduce((sum, s) => sum + Number(s.qty), 0);
  };
  const shortCount = requirements.filter((r) => {
    const s = stockOf(r);
    return s !== null && s < r.qty;
  }).length;

  // ---------- Ringkasan ----------
  const draftOf = (row: AcMonthRow) => edits[row.unit.id] ?? row.schedule;
  const totalCost = rows.reduce((s, r) => s + r.total, 0);
  const downtimes = rows.map((r) => estDowntime(draftOf(r)));
  const avgPa = rows.length
    ? downtimes.reduce((s, dt) => s + physicalAvailability(dt, periodKey), 0) / rows.length
    : 0;
  const avgTarget = rows.length ? rows.reduce((s, r) => s + draftOf(r).target_pa, 0) / rows.length : 0;
  const overdueCount = rows.filter((r) => r.dues.some((d) => d.overdue)).length;
  const unconfigured = units.length - settings.length;

  // ---------- Aksi ----------
  const discardEdits = () => {
    setEdits({});
    setManualIds([]);
  };

  const changePeriod = (key: string) => {
    if (key === periodKey) return;
    if (dirtyIds.size > 0 && !window.confirm("Ada isian yang belum disimpan. Pindah bulan dan buang perubahan?")) {
      return;
    }
    discardEdits();
    onPeriodChange(key);
  };

  const handleEdit = useCallback((unitId: number, draft: AcScheduleDraft) => {
    setEdits((prev) => ({ ...prev, [unitId]: draft }));
  }, []);
  const handleAddPart = useCallback((unit: HmUnit) => setExtraUnit(unit), []);
  const handleService = useCallback((unit: HmUnit) => setServiceUnit(unit), []);
  const handleDeleteExtra = useCallback((id: number) => setDeleteExtraId(id), []);
  const handleSetting = useCallback(
    (unitId: number) => {
      const unit = units.find((u) => u.id === unitId);
      if (unit) setSettingRow({ ...unit, ac: settings.find((s) => s.unit_id === unitId) ?? null });
    },
    [units, settings],
  );
  const handleReset = useCallback((row: AcMonthRow) => {
    if (row.saved) {
      setResetRow(row);
      return;
    }
    setEdits((prev) => omitKey(prev, row.unit.id));
    setManualIds((prev) => prev.filter((id) => id !== row.unit.id));
  }, []);

  async function handleSave() {
    const payload = rows
      .filter((r) => dirtyIds.has(r.unit.id))
      .map((r) => ({ unitId: r.unit.id, draft: draftOf(r) }));
    setSaving(true);
    try {
      await saveAcSchedules(periodKey, payload);
      await onChanged();
      discardEdits();
      toast.success(`Jadwal ${payload.length} unit disimpan`);
    } catch (e) {
      toast.error("Gagal menyimpan jadwal", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const exportRows = rows.map((r) => ({ ...r, schedule: draftOf(r) }));
      const wb = await buildAcForecastWorkbook({
        periodKey,
        siteName,
        rows: exportRows,
        requirements,
        cabangName,
        stockOf,
      });
      const siteSlug = siteName ? `-${siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
      await downloadWorkbook(wb, `forecast-ac${siteSlug}-${periodKey}.xlsx`);
    } catch (e) {
      toast.error("Gagal export Excel", { description: errorMessage(e) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Toolbar */}
      <div className="col-span-12 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Bulan sebelumnya"
            onClick={() => changePeriod(addPeriods(periodKey, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-36 text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Periode</div>
            <div className="text-sm font-semibold capitalize">{formatPeriod(periodKey)}</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Bulan berikutnya"
            onClick={() => changePeriod(addPeriods(periodKey, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => changePeriod(toPeriodKey(new Date()))}>
            Bulan ini
          </Button>
        </div>

        {isAdmin && addableUnits.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => {
              const id = Number(v);
              setManualIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
            }}
          >
            <SelectTrigger size="sm" className="w-48">
              <Plus className="h-4 w-4" />
              <SelectValue placeholder="Tambah unit" />
            </SelectTrigger>
            <SelectContent>
              {addableUnits.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.code} — {u.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirtyIds.size > 0 && (
            <>
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {dirtyIds.size} unit belum disimpan
              </span>
              <Button variant="ghost" size="sm" onClick={discardEdits} disabled={saving}>
                Batalkan
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? "Menyimpan…" : "Simpan"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || exporting}>
            <FileSpreadsheet className="h-4 w-4" />
            {exporting ? "Menyiapkan…" : "Export Excel"}
          </Button>
        </div>
      </div>

      {/* Ringkasan bulan terpilih */}
      <div className="col-span-12 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        <StatCard
          loading={loading}
          label="Unit Servis AC"
          value={String(rows.length)}
          hint={overdueCount > 0 ? `${overdueCount} lewat jatuh tempo` : "semua sesuai jadwal"}
          tone={overdueCount > 0 ? "bad" : undefined}
        />
        <StatCard loading={loading} label="Total Biaya" value={formatRupiah(totalCost)} hint="paket + part mayor" />
        <StatCard
          loading={loading}
          label="Est. Down Time"
          value={`${downtimes.reduce((s, v) => s + v, 0).toLocaleString("id-ID")} jam`}
          hint={`${daysInPeriod(periodKey) * 24} jam kalender per unit`}
        />
        <StatCard
          loading={loading}
          label="Rata-rata % PA"
          value={rows.length ? formatPercent(avgPa) : "—"}
          hint={rows.length ? `target ${formatPercent(avgTarget)}` : undefined}
          tone={rows.length ? (avgPa < avgTarget ? "bad" : "good") : undefined}
        />
      </div>

      {/* Grid */}
      <div className="col-span-12 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-200 dark:bg-amber-500/40" /> Jam downtime PMS / servis AC
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-muted" /> Minggu
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded border border-dashed px-1 text-[10px]">Usulan</span> diisi otomatis dari
            proyeksi HM, belum disimpan
          </span>
          {isAdmin && <span>Klik sel lalu ketik jam · panah / Enter untuk pindah sel</span>}
        </div>

        {loading ? (
          <Skeleton className="h-96 w-full" />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border bg-card py-12 text-center">
            <Snowflake className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <div className="font-semibold">Tidak ada servis AC di {formatPeriod(periodKey)}</div>
            <div className="text-sm text-muted-foreground">
              {settings.length === 0
                ? "Atur unit di tab Pengaturan Unit terlebih dahulu."
                : "Belum ada unit yang jatuh tempo bulan ini. Unit bisa ditambah manual lewat tombol Tambah unit."}
            </div>
          </div>
        ) : (
          <AcForecastGrid
            periodKey={periodKey}
            rows={rows}
            edits={edits}
            dirtyIds={dirtyIds}
            isAdmin={isAdmin}
            onEdit={handleEdit}
            onAddPart={handleAddPart}
            onService={handleService}
            onSetting={handleSetting}
            onReset={handleReset}
            onDeleteExtra={handleDeleteExtra}
          />
        )}

        {!loading && unconfigured > 0 && (
          <p className="text-xs text-muted-foreground">
            {unconfigured} unit HM belum diatur untuk Forecasting AC dan tidak ikut dihitung.
          </p>
        )}
      </div>

      {/* Proyeksi 3 bulan */}
      <div className="col-span-12 lg:col-span-5">
        <div className="mb-2 text-sm font-semibold">Proyeksi 3 Bulan</div>
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {periods.map((key) => {
            const list = monthRows[key] ?? [];
            const cost = list.reduce((s, r) => s + r.total, 0);
            const max = Math.max(1, ...periods.map((k) => (monthRows[k] ?? []).reduce((s, r) => s + r.total, 0)));
            return (
              <button
                key={key}
                type="button"
                onClick={() => changePeriod(key)}
                className={cn(
                  "block w-full px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  key === periodKey && "bg-primary/5",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("text-sm font-medium capitalize", key === periodKey && "text-primary")}>
                    {formatPeriod(key)}
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {loading ? "…" : formatRupiah(cost)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(cost / max) * 100}%` }} />
                  </div>
                  <span className="w-16 text-right text-xs text-muted-foreground">{list.length} unit</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Kebutuhan part */}
      <div className="col-span-12 lg:col-span-7">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            Kebutuhan Part
            {shortCount > 0 && (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">
                {shortCount} kurang stok
              </span>
            )}
          </div>
          {requirements.length > 6 && (
            <Button variant="ghost" size="sm" onClick={() => setShowParts((v) => !v)}>
              {showParts ? "Ringkas" : `Lihat semua (${requirements.length})`}
            </Button>
          )}
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Part Number</TableHead>
                <TableHead>Gudang</TableHead>
                <TableHead className="text-right">Butuh</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead className="text-right">Biaya</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && requirements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    Tidak ada kebutuhan part bulan ini.
                  </TableCell>
                </TableRow>
              )}
              {(showParts ? requirements : requirements.slice(0, 6)).map((r) => {
                const s = stockOf(r);
                const short = s !== null && s < r.qty;
                return (
                  <TableRow key={r.key}>
                    <TableCell>
                      {r.part_number ? (
                        <div className="font-mono text-sm font-semibold">{r.part_number}</div>
                      ) : (
                        <div className="text-xs italic text-muted-foreground">Belum link PN</div>
                      )}
                      <div className="max-w-64 truncate text-xs text-muted-foreground" title={r.name}>
                        {r.name}
                      </div>
                      <div className="max-w-64 truncate text-xs text-muted-foreground" title={r.unitCodes.join(", ")}>
                        Unit: {r.unitCodes.join(", ")}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{cabangName(r.cabang_id)}</TableCell>
                    <TableCell className={NUM}>{formatQty(r.qty)}</TableCell>
                    <TableCell className={cn(NUM, short && "font-semibold text-destructive")}>
                      {s === null ? (
                        <span className="text-xs text-muted-foreground" title="Part belum di-link ke master barang">
                          —
                        </span>
                      ) : (
                        formatQty(s)
                      )}
                    </TableCell>
                    <TableCell className={NUM}>{formatRupiah(r.cost)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <AcExtraDialog
        open={extraUnit !== null}
        onOpenChange={(o) => !o && setExtraUnit(null)}
        unit={extraUnit}
        periodKey={periodKey}
        onSaved={onChanged}
      />
      <AcServiceDialog
        open={serviceUnit !== null}
        onOpenChange={(o) => !o && setServiceUnit(null)}
        unit={serviceUnit}
        onSaved={onChanged}
      />
      <AcUnitSettingDialog
        open={settingRow !== null}
        onOpenChange={(o) => !o && setSettingRow(null)}
        row={settingRow}
        packages={packages}
        onSaved={onChanged}
      />
      <HmDeleteDialog
        open={deleteExtraId !== null}
        onOpenChange={(o) => !o && setDeleteExtraId(null)}
        title="Hapus part tambahan?"
        description="Part mayor ini dihapus dari forecast bulan ini."
        confirmLabel="Hapus"
        onConfirm={async () => {
          if (deleteExtraId === null) return;
          try {
            await deleteAcExtra(deleteExtraId);
            toast.success("Part tambahan dihapus");
            await onChanged();
          } catch (e) {
            toast.error("Gagal menghapus part", { description: errorMessage(e) });
            throw e;
          }
        }}
      />
      <HmDeleteDialog
        open={resetRow !== null}
        onOpenChange={(o) => !o && setResetRow(null)}
        title={`Hapus isian ${resetRow?.unit.code ?? ""} bulan ini?`}
        description="Jam downtime, SMU, target, dan repair option yang tersimpan dihapus. Baris kembali ke usulan otomatis (atau hilang kalau unit tidak jatuh tempo bulan ini)."
        confirmLabel="Hapus Isian"
        onConfirm={async () => {
          if (!resetRow) return;
          try {
            await deleteAcSchedule(resetRow.unit.id, periodKey);
            setEdits((prev) => omitKey(prev, resetRow.unit.id));
            setManualIds((prev) => prev.filter((id) => id !== resetRow.unit.id));
            toast.success("Isian dihapus");
            await onChanged();
          } catch (e) {
            toast.error("Gagal menghapus isian", { description: errorMessage(e) });
            throw e;
          }
        }}
      />
    </div>
  );
}

// ============================================================
// Tab Pengaturan Unit
// ============================================================

export function AcUnitSettingsTab({
  loading,
  isAdmin,
  rows,
  packages,
  onChanged,
}: {
  loading: boolean;
  isAdmin: boolean;
  rows: HmAcUnitRow[];
  packages: HmAcPackage[];
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [editRow, setEditRow] = useState<HmAcUnitRow | null>(null);
  const [serviceUnit, setServiceUnit] = useState<HmUnit | null>(null);
  const [removeRow, setRemoveRow] = useState<HmAcUnitRow | null>(null);

  const pkgName = (id: number | null) => packages.find((p) => p.id === id)?.name ?? "—";
  const term = search.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => !term || r.code.toLowerCase().includes(term) || r.model.toLowerCase().includes(term),
  );
  const cols = isAdmin ? 10 : 9;

  return (
    <Content
      title="Pengaturan Unit"
      description={`${rows.filter((r) => r.ac).length} dari ${rows.length} unit masuk Forecasting AC`}
      cardAction={
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="Cari kode / model unit"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      }
    >
      <div className="rounded-lg border">
        <Table containerClassName="max-h-[70vh] overflow-y-auto">
          <TableHeader className={STICKY_HEAD}>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead>Section</TableHead>
              <TableHead>Paket Part</TableHead>
              <TableHead className="text-right">HM Sekarang</TableHead>
              <TableHead className="text-right">Interval</TableHead>
              <TableHead className="text-right">Servis AC Terakhir</TableHead>
              <TableHead className="text-right">Jatuh Tempo</TableHead>
              <TableHead className="text-right">Sisa HM</TableHead>
              <TableHead className="text-right">HM/Hari</TableHead>
              {isAdmin && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <LoadingRows colSpan={cols} />}
            {!loading && rows.length === 0 && (
              <EmptyRow colSpan={cols} title="Belum ada unit">
                Tambahkan unit di menu Periodic Maintenance → Unit terlebih dahulu.
              </EmptyRow>
            )}
            {!loading &&
              filtered.map((r) => {
                const ac = r.ac;
                const due = ac ? ac.last_service_hm + ac.interval_hm : null;
                const remaining = due === null ? null : due - r.current_hm;
                return (
                  <TableRow key={r.id} className={cn(!ac && "text-muted-foreground", ac && !ac.is_active && "opacity-60")}>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-semibold text-foreground">{r.code}</div>
                      <div className="text-xs">{r.model}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {ac ? (
                        <>
                          {AC_SECTION_LABEL[ac.section]}
                          {!ac.is_active && <div className="text-xs">Nonaktif</div>}
                        </>
                      ) : (
                        <span className="text-xs">Belum diatur</span>
                      )}
                    </TableCell>
                    <TableCell>{ac ? pkgName(ac.package_id) : "—"}</TableCell>
                    <TableCell className={NUM}>{formatHm(r.current_hm)}</TableCell>
                    <TableCell className={NUM}>{ac ? formatHm(ac.interval_hm) : "—"}</TableCell>
                    <TableCell className={NUM}>{ac ? formatHm(ac.last_service_hm) : "—"}</TableCell>
                    <TableCell className={NUM}>{due === null ? "—" : formatHm(due)}</TableCell>
                    <TableCell
                      className={cn(NUM, "font-semibold", remaining !== null && remaining <= 0 && "text-destructive")}
                    >
                      {remaining === null ? "—" : formatRemaining(remaining)}
                    </TableCell>
                    <TableCell className={NUM}>{ac ? formatQty(ac.daily_hm) : "—"}</TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap">
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title="Atur AC unit"
                            aria-label="Atur AC unit"
                            onClick={() => setEditRow(r)}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                          {ac && (
                            <>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                title="Catat servis AC selesai"
                                aria-label="Catat servis AC selesai"
                                onClick={() => setServiceUnit(r)}
                              >
                                <ClipboardCheck className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Keluarkan dari forecast"
                                aria-label="Keluarkan dari forecast"
                                onClick={() => setRemoveRow(r)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      <AcUnitSettingDialog
        open={editRow !== null}
        onOpenChange={(o) => !o && setEditRow(null)}
        row={editRow}
        packages={packages}
        onSaved={onChanged}
      />
      <AcServiceDialog
        open={serviceUnit !== null}
        onOpenChange={(o) => !o && setServiceUnit(null)}
        unit={serviceUnit}
        onSaved={onChanged}
      />
      <HmDeleteDialog
        open={removeRow !== null}
        onOpenChange={(o) => !o && setRemoveRow(null)}
        title={`Keluarkan ${removeRow?.code ?? ""} dari Forecasting AC?`}
        description="Pengaturan AC unit ini dihapus. Part tambahan yang sudah diinput per bulan tetap tersimpan."
        confirmLabel="Keluarkan"
        onConfirm={async () => {
          if (!removeRow) return;
          try {
            await deleteAcSetting(removeRow.id);
            toast.success("Unit dikeluarkan dari forecast");
            onChanged();
          } catch (e) {
            toast.error("Gagal mengeluarkan unit", { description: errorMessage(e) });
            throw e;
          }
        }}
      />
    </Content>
  );
}

// ============================================================
// Tab Paket Part
// ============================================================

export function AcPackagesTab({
  loading,
  isAdmin,
  packages,
  settings,
  onChanged,
}: {
  loading: boolean;
  isAdmin: boolean;
  packages: HmAcPackage[];
  settings: HmAcUnitSetting[];
  onChanged: () => void;
}) {
  const [editPkg, setEditPkg] = useState<HmAcPackage | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deletePkg, setDeletePkg] = useState<HmAcPackage | null>(null);

  const usage = (id: number) => settings.filter((s) => s.package_id === id).length;

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Paket part dasar per model unit. Biaya forecast tiap servis AC = total paket + part mayor tambahan bulan itu.
        </p>
        {isAdmin && (
          <Button
            size="sm"
            onClick={() => {
              setEditPkg(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Tambah Paket
          </Button>
        )}
      </div>

      {loading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="col-span-12 lg:col-span-6 xl:col-span-4">
            <Skeleton className="h-48 w-full" />
          </div>
        ))}

      {!loading && packages.length === 0 && (
        <div className="col-span-12 rounded-lg border bg-card py-10 text-center">
          <Snowflake className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <div className="font-semibold">Belum ada paket part AC</div>
          <div className="text-sm text-muted-foreground">
            Contoh dari Excel: D155A-6 (expansi valve, thermostat, dryer, v-belt B38, oli ND08).
          </div>
        </div>
      )}

      {!loading &&
        packages.map((p) => {
          const pkgTotal = p.items.reduce((s, it) => s + it.qty * it.unit_price, 0);
          return (
            <Content
              key={p.id}
              size="xs"
              className="sm:col-span-12 lg:col-span-6 xl:col-span-4"
              title={p.name}
              description={`${p.note ? `${p.note} · ` : ""}${usage(p.id)} unit`}
              cardAction={
                isAdmin && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Ubah paket"
                      onClick={() => {
                        setEditPkg(p);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Hapus paket" onClick={() => setDeletePkg(p)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              }
            >
              <ul className="divide-y text-sm">
                {p.items.map((it) => (
                  <li key={it.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      {it.barang ? (
                        <span className="font-mono font-semibold">{it.barang.part_number}</span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">Belum link PN</span>
                      )}
                      {it.qty !== 1 && <span className="text-muted-foreground"> ×{formatQty(it.qty)}</span>}
                      <span className="block text-xs text-muted-foreground">{it.name}</span>
                    </span>
                    <span className="font-mono tabular-nums">{formatRupiah(it.qty * it.unit_price)}</span>
                  </li>
                ))}
                <li className="flex justify-between py-1.5 font-semibold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{formatRupiah(pkgTotal)}</span>
                </li>
              </ul>
            </Content>
          );
        })}

      <AcPackageDialog open={formOpen} onOpenChange={setFormOpen} pkg={editPkg} onSaved={onChanged} />
      <HmDeleteDialog
        open={deletePkg !== null}
        onOpenChange={(o) => !o && setDeletePkg(null)}
        title={`Hapus paket ${deletePkg?.name ?? ""}?`}
        description={
          deletePkg && usage(deletePkg.id) > 0
            ? `Paket dipakai ${usage(deletePkg.id)} unit; unit tersebut jadi tanpa paket.`
            : "Paket beserta daftar part-nya dihapus."
        }
        confirmLabel="Hapus Paket"
        onConfirm={async () => {
          if (!deletePkg) return;
          try {
            await deleteAcPackage(deletePkg.id);
            toast.success("Paket dihapus");
            onChanged();
          } catch (e) {
            toast.error("Gagal menghapus paket", { description: errorMessage(e) });
            throw e;
          }
        }}
      />
    </div>
  );
}
