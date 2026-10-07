// Forecasting AC (modul HM Maintenance): tipe, proyeksi jatuh tempo servis
// AC per bulan, kebutuhan part & biaya, dan export Excel. Pola diambil dari
// "Forcasting AC.xlsx": unit kena servis AC tiap PMS besar (default tiap
// 2000 HM), part = paket dasar per model + part mayor tambahan per bulan.

import type ExcelJS from "exceljs";
import type { Workbook, Worksheet } from "exceljs";
import { HmUnit } from "@/lib/hm";

export type HmAcSection = "track" | "wheel" | "support";

export const AC_SECTIONS: HmAcSection[] = ["track", "wheel", "support"];

export const AC_SECTION_LABEL: Record<HmAcSection, string> = {
  track: "Section Track",
  wheel: "Section Wheel",
  support: "Section Support",
};

export type HmAcPackageItem = {
  id: number;
  package_id: number;
  barang_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  barang?: HmAcBarangRef | null;
};

export type HmAcBarangRef = { part_number: string; part_name: string; part_satuan: string };

export type HmAcPackage = {
  id: number;
  name: string;
  note: string;
  items: HmAcPackageItem[];
};

export type HmAcUnitSetting = {
  unit_id: number;
  section: HmAcSection;
  package_id: number | null;
  interval_hm: number;
  last_service_hm: number;
  daily_hm: number;
  is_active: boolean;
};

export type HmAcExtraItem = {
  id: number;
  unit_id: number;
  /** "YYYY-MM-01" */
  period: string;
  barang_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  note: string;
  barang?: HmAcBarangRef | null;
};

/** Baris unit di halaman pengaturan: unit HM + setting AC (null = belum diatur). */
export type HmAcUnitRow = HmUnit & { ac: HmAcUnitSetting | null };

export type AcForecastLine = {
  key: string;
  barang_id: number | null;
  /** Part number master barang; null = belum di-link. */
  part_number: string | null;
  name: string;
  qty: number;
  unit_price: number;
  /** Part mayor tambahan (bukan paket dasar). */
  extraId: number | null;
};

export type AcForecastEntry = {
  unit: HmUnit;
  setting: HmAcUnitSetting;
  packageName: string | null;
  /** null = unit masuk forecast cuma karena punya part tambahan bulan itu. */
  dueHm: number | null;
  dueDate: Date | null;
  overdue: boolean;
  pmsLabel: string;
  lines: AcForecastLine[];
  total: number;
};

// ---------- Periode ----------

/** "YYYY-MM" dari Date (waktu lokal). */
export function toPeriodKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function periodStart(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function periodEnd(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0, 23, 59, 59, 999);
}

/** Nilai kolom DATE di DB untuk bulan tsb. */
export const periodDbValue = (key: string) => `${key}-01`;

export function addPeriods(key: string, n: number): string {
  const d = periodStart(key);
  return toPeriodKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

const PERIOD_FORMAT = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
export const formatPeriod = (key: string) => PERIOD_FORMAT.format(periodStart(key));

// ---------- Proyeksi ----------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Label PMS dari HM jatuh tempo, mengikuti penamaan di Excel: HM dibulatkan
 * ke kelipatan 250 lalu diambil kelipatan PMS terbesar (8000/4000/2000);
 * kalau HM tidak pas kelipatan, pakai interval servis AC unit (mis. PMS 2000).
 */
export function pmsLabel(dueHm: number, intervalHm: number): string {
  const rounded = Math.round(dueHm / 250) * 250;
  for (const step of [8000, 4000, 2000]) {
    if (rounded > 0 && rounded % step === 0) return `PMS ${step}`;
  }
  return `PMS ${intervalHm}`;
}

/**
 * Semua jatuh tempo servis AC unit di dalam bulan `key`. Jatuh tempo
 * pertama = HM servis terakhir + interval; kalau sudah terlewati dianggap
 * dikerjakan hari ini (overdue, masuk bulan berjalan) lalu siklus berikutnya
 * dihitung dari HM sekarang. Tanggal = hari ini + sisa HM / HM per hari.
 */
export function projectDueDates(
  currentHm: number,
  setting: Pick<HmAcUnitSetting, "interval_hm" | "last_service_hm" | "daily_hm">,
  key: string,
  today: Date,
): { dueHm: number; date: Date; overdue: boolean }[] {
  const start = periodStart(key);
  const end = periodEnd(key);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const interval = Math.max(1, setting.interval_hm);
  const daily = Math.max(0.1, setting.daily_hm);

  const out: { dueHm: number; date: Date; overdue: boolean }[] = [];
  let due = setting.last_service_hm + interval;
  let overdue = false;
  if (due <= currentHm) {
    overdue = true;
    due = currentHm;
  }

  for (let i = 0; i < 100; i++) {
    const days = Math.ceil((due - currentHm) / daily);
    const date = new Date(base.getTime() + days * DAY_MS);
    if (date > end) break;
    if (date >= start) out.push({ dueHm: due, date, overdue: overdue && i === 0 });
    due += interval;
  }
  return out;
}

export function buildForecast({
  units,
  settings,
  packages,
  extras,
  periodKey,
  today = new Date(),
}: {
  units: HmUnit[];
  settings: HmAcUnitSetting[];
  packages: HmAcPackage[];
  /** Part tambahan khusus bulan `periodKey`. */
  extras: HmAcExtraItem[];
  periodKey: string;
  today?: Date;
}): AcForecastEntry[] {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  const extrasByUnit = new Map<number, HmAcExtraItem[]>();
  for (const e of extras) {
    extrasByUnit.set(e.unit_id, [...(extrasByUnit.get(e.unit_id) ?? []), e]);
  }

  const entries: AcForecastEntry[] = [];
  for (const s of settings) {
    const unit = unitById.get(s.unit_id);
    if (!unit) continue;
    const pkg = s.package_id ? pkgById.get(s.package_id) : undefined;
    const dues = s.is_active ? projectDueDates(unit.current_hm, s, periodKey, today) : [];
    const unitExtras = extrasByUnit.get(unit.id) ?? [];
    if (dues.length === 0 && unitExtras.length === 0) continue;

    const extraLines: AcForecastLine[] = unitExtras.map((e) => ({
      key: `x${e.id}`,
      barang_id: e.barang_id,
      part_number: e.barang?.part_number ?? null,
      name: e.name,
      qty: Number(e.qty),
      unit_price: Number(e.unit_price),
      extraId: e.id,
    }));

    // Satu entry per jatuh tempo; part tambahan ditempel di entry pertama.
    const occurrences = dues.length > 0 ? dues : [null];
    occurrences.forEach((due, idx) => {
      const lines: AcForecastLine[] = [
        ...(due && pkg
          ? pkg.items.map((it) => ({
              key: `p${it.id}`,
              barang_id: it.barang_id,
              part_number: it.barang?.part_number ?? null,
              name: it.name,
              qty: Number(it.qty),
              unit_price: Number(it.unit_price),
              extraId: null,
            }))
          : []),
        ...(idx === 0 ? extraLines : []),
      ];
      entries.push({
        unit,
        setting: s,
        packageName: pkg?.name ?? null,
        dueHm: due?.dueHm ?? null,
        dueDate: due?.date ?? null,
        overdue: due?.overdue ?? false,
        pmsLabel: due ? pmsLabel(due.dueHm, s.interval_hm) : "Part tambahan",
        lines,
        total: lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0),
      });
    });
  }

  return entries.sort(
    (a, b) =>
      AC_SECTIONS.indexOf(a.setting.section) - AC_SECTIONS.indexOf(b.setting.section) ||
      (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) ||
      a.unit.code.localeCompare(b.unit.code),
  );
}

// ---------- Jadwal bulanan (grid ala Excel) ----------

export type HmAcSchedule = {
  unit_id: number;
  /** "YYYY-MM-01" */
  period: string;
  day_hours: number[];
  smu_hm: number | null;
  repair_option: string;
  target_pa: number;
  unscheduled_hours: number;
  note: string;
};

/** Isian satu baris unit di grid (tersimpan atau usulan otomatis). */
export type AcScheduleDraft = Omit<HmAcSchedule, "unit_id" | "period">;

export const DEFAULT_TARGET_PA: Record<HmAcSection, number> = { track: 92, wheel: 92, support: 93.1 };
/** Estimasi unscheduled maintenance per unit per hari (Excel: +1 jam/hari). */
export const UNSCHEDULED_PER_DAY = 1;

export function daysInPeriod(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Usulan jam downtime servis AC sesuai pola Excel (PMS 2000 ±12 jam, dst). */
export function pmsDowntimeHours(label: string): number {
  if (label.includes("8000")) return 24;
  if (label.includes("4000") || label.includes("6000")) return 16;
  return 12;
}

export function estDowntime(d: Pick<AcScheduleDraft, "day_hours" | "unscheduled_hours">): number {
  return d.day_hours.reduce((s, h) => s + (Number(h) || 0), 0) + (Number(d.unscheduled_hours) || 0);
}

/** %PA = (jam kalender − downtime) / jam kalender × 100. */
export function physicalAvailability(downtime: number, periodKey: string): number {
  const hours = daysInPeriod(periodKey) * 24;
  return Math.max(0, ((hours - downtime) / hours) * 100);
}

export const formatPercent = (v: number) =>
  `${v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export type AcDue = { dueHm: number; date: Date; overdue: boolean; label: string };

export type AcMonthRow = {
  unit: HmUnit;
  section: HmAcSection;
  packageName: string | null;
  dues: AcDue[];
  lines: AcForecastLine[];
  total: number;
  /** Isian tersimpan di DB, atau usulan dari proyeksi kalau belum ada. */
  schedule: AcScheduleDraft;
  saved: boolean;
};

function normalizeDays(hours: number[], days: number): number[] {
  return Array.from({ length: days }, (_, i) => Number(hours[i]) || 0);
}

/**
 * Baris grid bulan `periodKey`: unit yang jatuh tempo servis AC bulan itu,
 * + unit yang punya jadwal tersimpan / part tambahan / ditambah manual.
 * Satu baris per unit (kalau jatuh tempo 2x sebulan, part paket dihitung 2x).
 */
export function buildMonthRows({
  units,
  settings,
  packages,
  extras,
  schedules,
  periodKey,
  manualUnitIds = [],
  today = new Date(),
}: {
  units: HmUnit[];
  settings: HmAcUnitSetting[];
  packages: HmAcPackage[];
  extras: HmAcExtraItem[];
  schedules: HmAcSchedule[];
  periodKey: string;
  manualUnitIds?: number[];
  today?: Date;
}): AcMonthRow[] {
  const days = daysInPeriod(periodKey);
  const settingByUnit = new Map(settings.map((s) => [s.unit_id, s]));
  const scheduleByUnit = new Map(schedules.map((s) => [s.unit_id, s]));
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  const entries = buildForecast({ units, settings, packages, extras, periodKey, today });

  const unitIds = new Set<number>([
    ...entries.map((e) => e.unit.id),
    ...schedules.map((s) => s.unit_id),
    ...manualUnitIds,
  ]);

  const rows: AcMonthRow[] = [];
  for (const unitId of unitIds) {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) continue;
    const setting = settingByUnit.get(unitId) ?? null;
    const section = setting?.section ?? "track";
    const pkg = setting?.package_id ? pkgById.get(setting.package_id) : undefined;
    const own = entries.filter((e) => e.unit.id === unitId);
    const dues: AcDue[] = own
      .filter((e) => e.dueHm !== null && e.dueDate !== null)
      .map((e) => ({ dueHm: e.dueHm!, date: e.dueDate!, overdue: e.overdue, label: e.pmsLabel }));

    // Gabung line antar jatuh tempo (qty dijumlah per part).
    const lineMap = new Map<string, AcForecastLine>();
    for (const e of own) {
      for (const l of e.lines) {
        const prev = lineMap.get(l.key);
        lineMap.set(l.key, prev ? { ...prev, qty: prev.qty + l.qty } : { ...l });
      }
    }
    // Unit masuk manual / jadwal tersimpan tanpa jatuh tempo: paket tetap
    // dihitung sekali (servis AC memang direncanakan bulan ini).
    if (dues.length === 0 && pkg) {
      for (const it of pkg.items) {
        if (!lineMap.has(`p${it.id}`)) {
          lineMap.set(`p${it.id}`, {
            key: `p${it.id}`,
            barang_id: it.barang_id,
            part_number: it.barang?.part_number ?? null,
            name: it.name,
            qty: Number(it.qty),
            unit_price: Number(it.unit_price),
            extraId: null,
          });
        }
      }
    }
    const lines = [...lineMap.values()].sort((a, b) => Number(!!a.extraId) - Number(!!b.extraId));

    const saved = scheduleByUnit.get(unitId);
    let schedule: AcScheduleDraft;
    if (saved) {
      schedule = {
        day_hours: normalizeDays(saved.day_hours, days),
        smu_hm: saved.smu_hm,
        repair_option: saved.repair_option,
        target_pa: Number(saved.target_pa),
        unscheduled_hours: Number(saved.unscheduled_hours),
        note: saved.note,
      };
    } else {
      const hours = Array.from({ length: days }, () => 0);
      for (const d of dues) hours[d.date.getDate() - 1] += pmsDowntimeHours(d.label);
      schedule = {
        day_hours: hours,
        smu_hm: unit.current_hm,
        repair_option: [...new Set(dues.map((d) => d.label))].join(" & "),
        target_pa: DEFAULT_TARGET_PA[section],
        unscheduled_hours: days * UNSCHEDULED_PER_DAY,
        note: "",
      };
    }

    rows.push({
      unit,
      section,
      packageName: pkg?.name ?? null,
      dues,
      lines,
      total: lines.reduce((s, l) => s + l.qty * l.unit_price, 0),
      schedule,
      saved: !!saved,
    });
  }

  return rows.sort(
    (a, b) =>
      AC_SECTIONS.indexOf(a.section) - AC_SECTIONS.indexOf(b.section) ||
      a.unit.code.localeCompare(b.unit.code, "id", { numeric: true }),
  );
}

// ---------- Kebutuhan part ----------

export type AcPartRequirement = {
  key: string;
  barang_id: number | null;
  part_number: string | null;
  name: string;
  cabang_id: number | null;
  qty: number;
  cost: number;
  unitCodes: string[];
};

/** Agregasi kebutuhan part per (barang/nama, gudang unit). */
export function aggregateRequirements(
  entries: { unit: HmUnit; lines: AcForecastLine[] }[],
): AcPartRequirement[] {
  const map = new Map<string, AcPartRequirement>();
  for (const e of entries) {
    for (const l of e.lines) {
      const partKey = l.barang_id ? `b${l.barang_id}` : `n${l.name.trim().toLowerCase()}`;
      const key = `${partKey}|${e.unit.cabang_id ?? "-"}`;
      const row = map.get(key) ?? {
        key,
        barang_id: l.barang_id,
        part_number: l.part_number,
        name: l.name,
        cabang_id: e.unit.cabang_id,
        qty: 0,
        cost: 0,
        unitCodes: [],
      };
      row.qty += l.qty;
      row.cost += l.qty * l.unit_price;
      if (!row.unitCodes.includes(e.unit.code)) row.unitCodes.push(e.unit.code);
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
}

/** Label part utk teks polos (Excel): "PN — Nama", atau nama saja kalau belum di-link. */
export function partLabel(p: { part_number: string | null; name: string }): string {
  return p.part_number ? `${p.part_number} — ${p.name}` : p.name;
}

// ---------- Format ----------

const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
export const formatRupiah = (v: number) => RUPIAH.format(Math.round(v));
export const formatQty = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** "Rp 1.250.000" / "1.250,5" -> angka; kosong/invalid -> null. */
export function parseNumberInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---------- Export Excel (layout mengikuti Forcasting AC.xlsx) ----------

const HEADER_FILL = "FF1F2937";
const SECTION_FILL = "FFDBEAFE";
const TOTAL_FILL = "FFF3F4F6";
const MARK_FILL = "FFFDE68A";
const SUNDAY_FILL = "FFF3F4F6";
const BORDER_COLOR = "FFD1D5DB";
const RP_FMT = '"Rp" #,##0';
const QTY_FMT = "#,##0.##";
const PCT_FMT = "0.0%";

const thinBorder = {
  top: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  left: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  bottom: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  right: { style: "thin" as const, color: { argb: BORDER_COLOR } },
};

function fillRow(ws: Worksheet, rowNo: number, cols: number, argb: string, bold = true) {
  for (let c = 1; c <= cols; c++) {
    const cell = ws.getCell(rowNo, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    if (bold) cell.font = { bold: true };
  }
}

export async function buildAcForecastWorkbook({
  periodKey,
  siteName,
  rows,
  requirements,
  cabangName,
  stockOf,
}: {
  periodKey: string;
  /** null = semua site. */
  siteName: string | null;
  rows: AcMonthRow[];
  requirements: AcPartRequirement[];
  cabangName: (id: number | null) => string;
  stockOf: (r: AcPartRequirement) => number | null;
}): Promise<Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const days = daysInPeriod(periodKey);
  const start = periodStart(periodKey);
  const monthShort = new Intl.DateTimeFormat("id-ID", { month: "short" }).format(start).toUpperCase();

  // Kolom: Unit, Lokasi, Model, SMU, hari 1..N, Unsch, Est DT, %PA, Target,
  // Repair Option, Remarks, Biaya.
  const C_DAY = 5;
  const C_UNSCH = C_DAY + days;
  const C_DT = C_UNSCH + 1;
  const C_PA = C_DT + 1;
  const C_TARGET = C_PA + 1;
  const C_REPAIR = C_TARGET + 1;
  const C_REMARK = C_REPAIR + 1;
  const C_COST = C_REMARK + 1;
  const NCOL = C_COST;

  const ws = wb.addWorksheet("Forecast AC", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 10;
  for (let d = 0; d < days; d++) ws.getColumn(C_DAY + d).width = 4.5;
  ws.getColumn(C_UNSCH).width = 7;
  ws.getColumn(C_DT).width = 9;
  ws.getColumn(C_PA).width = 8;
  ws.getColumn(C_TARGET).width = 8;
  ws.getColumn(C_REPAIR).width = 26;
  ws.getColumn(C_REMARK).width = 42;
  ws.getColumn(C_COST).width = 15;

  ws.mergeCells(1, 1, 1, NCOL);
  ws.getCell(1, 1).value = "PA FORECAST & MONTHLY PLANNING PM SCHEDULE — FORECAST AC";
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, NCOL);
  ws.getCell(2, 1).value = `Site ${siteName ?? "Semua Site"} · Periode ${formatPeriod(periodKey)} · ${days * 24} jam kalender`;
  ws.getCell(2, 1).font = { color: { argb: "FF6B7280" } };

  // Header 2 baris: judul kolom + nama bulan di bawah tanggal.
  const header = ws.getRow(4);
  const sub = ws.getRow(5);
  const headers: [number, string][] = [
    [1, "UNIT NO"],
    [2, "LOKASI"],
    [3, "MODEL"],
    [4, `SMU ${monthShort}`],
    [C_UNSCH, "UNSCH."],
    [C_DT, "EST. TOTAL DOWN TIME (hrs)"],
    [C_PA, "% PA"],
    [C_TARGET, "TARGET"],
    [C_REPAIR, "REPAIR OPTION REQUIRED / BACKLOG"],
    [C_REMARK, "REMARKS (PART NUMBER — PART)"],
    [C_COST, "BIAYA"],
  ];
  for (const [c, label] of headers) {
    header.getCell(c).value = label;
    ws.mergeCells(4, c, 5, c);
  }
  for (let d = 0; d < days; d++) {
    header.getCell(C_DAY + d).value = String(d + 1).padStart(2, "0");
    sub.getCell(C_DAY + d).value = monthShort;
  }
  for (const r of [4, 5]) {
    for (let c = 1; c <= NCOL; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: r === 5 ? 8 : 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = thinBorder;
    }
  }
  header.height = 30;

  let r = 6;
  const allRowsForSummary: AcMonthRow[] = [];
  for (const section of AC_SECTIONS) {
    const list = rows.filter((x) => x.section === section);
    if (list.length === 0) continue;
    ws.mergeCells(r, 1, r, NCOL);
    ws.getCell(r, 1).value = `FORECAST AC ${AC_SECTION_LABEL[section].toUpperCase()}`;
    fillRow(ws, r, NCOL, SECTION_FILL);
    r++;

    let sectionCost = 0;
    for (const row of list) {
      allRowsForSummary.push(row);
      const lines = row.lines.length > 0 ? row.lines : [null];
      const first = r;
      const last = r + lines.length; // + baris subtotal
      const dt = estDowntime(row.schedule);

      const put = (c: number, v: ExcelJS.CellValue) => {
        ws.getCell(first, c).value = v;
        if (last > first) ws.mergeCells(first, c, last, c);
        ws.getCell(first, c).alignment = { vertical: "top", horizontal: c >= C_DAY ? "center" : "left", wrapText: true };
      };
      put(1, row.unit.code);
      put(2, row.unit.name);
      put(3, row.unit.model);
      put(4, row.schedule.smu_hm);
      row.schedule.day_hours.forEach((h, d) => {
        put(C_DAY + d, h);
        const cell = ws.getCell(first, C_DAY + d);
        if (h > 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARK_FILL } };
          cell.font = { bold: true };
        } else if (new Date(start.getFullYear(), start.getMonth(), d + 1).getDay() === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUNDAY_FILL } };
        }
      });
      put(C_UNSCH, row.schedule.unscheduled_hours);
      put(C_DT, dt);
      put(C_PA, physicalAvailability(dt, periodKey) / 100);
      put(C_TARGET, row.schedule.target_pa / 100);
      put(C_REPAIR, row.schedule.repair_option);

      lines.forEach((l, i) => {
        if (!l) return;
        ws.getCell(first + i, C_REMARK).value =
          partLabel(l) + (l.qty !== 1 ? ` ×${formatQty(l.qty)}` : "") + (l.extraId ? " *" : "");
        ws.getCell(first + i, C_COST).value = l.qty * l.unit_price;
      });
      ws.getCell(last, C_REMARK).value = "Subtotal";
      ws.getCell(last, C_COST).value = row.total;
      ws.getCell(last, C_REMARK).font = { bold: true };
      ws.getCell(last, C_COST).font = { bold: true };
      for (let rr = first; rr <= last; rr++) for (let c = 1; c <= NCOL; c++) ws.getCell(rr, c).border = thinBorder;
      sectionCost += row.total;
      r = last + 1;
    }

    ws.mergeCells(r, 1, r, C_REMARK);
    ws.getCell(r, 1).value = `TOTAL BIAYA MAINTENANCE AC ${AC_SECTION_LABEL[section].toUpperCase()}`;
    ws.getCell(r, C_COST).value = sectionCost;
    fillRow(ws, r, NCOL, TOTAL_FILL);
    r += 2;
  }

  // Ringkasan seperti baris "TOTAL EST. DOWN TIME / AVERAGE ACHIEVEMENT".
  if (allRowsForSummary.length > 0) {
    const dts = allRowsForSummary.map((x) => estDowntime(x.schedule));
    const avgPa = dts.reduce((s, dt) => s + physicalAvailability(dt, periodKey), 0) / dts.length;
    const avgTarget = allRowsForSummary.reduce((s, x) => s + x.schedule.target_pa, 0) / allRowsForSummary.length;
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = "TOTAL EST. DOWN TIME / AVERAGE ACHIEVEMENT";
    for (let d = 0; d < days; d++) {
      const sum = allRowsForSummary.reduce((s, x) => s + (x.schedule.day_hours[d] || 0), 0);
      ws.getCell(r, C_DAY + d).value = sum || null;
    }
    ws.getCell(r, C_DT).value = dts.reduce((s, v) => s + v, 0);
    ws.getCell(r, C_PA).value = avgPa / 100;
    ws.getCell(r, C_TARGET).value = avgTarget / 100;
    ws.getCell(r, C_REMARK).value = "GRAND TOTAL";
    ws.getCell(r, C_COST).value = allRowsForSummary.reduce((s, x) => s + x.total, 0);
    fillRow(ws, r, NCOL, TOTAL_FILL);
    r += 4;

    // Blok tanda tangan.
    const sign: [number, string, string][] = [
      [1, "PREPARED BY", "PLANNER PLANT"],
      [C_DAY + Math.floor(days / 3), "CHECK BY", "SECT. HEAD PLANT"],
      [C_REPAIR, "APPROVED BY", "DEPT HEAD PLANT"],
    ];
    for (const [c, top, bottom] of sign) {
      ws.getCell(r, c).value = top;
      ws.getCell(r, c).font = { bold: true };
      ws.getCell(r + 4, c).value = bottom;
      ws.getCell(r + 4, c).font = { bold: true };
    }
  }

  for (let d = 0; d < days; d++) ws.getColumn(C_DAY + d).numFmt = "0";
  ws.getColumn(4).numFmt = "#,##0";
  ws.getColumn(C_DT).numFmt = "#,##0";
  ws.getColumn(C_PA).numFmt = PCT_FMT;
  ws.getColumn(C_TARGET).numFmt = PCT_FMT;
  ws.getColumn(C_COST).numFmt = RP_FMT;

  // Sheet 2: kebutuhan part.
  const ws2 = wb.addWorksheet("Kebutuhan Part", { views: [{ state: "frozen", ySplit: 3 }] });
  const cols2 = [
    { header: "Part Number", width: 20 },
    { header: "Deskripsi", width: 30 },
    { header: "Gudang", width: 22 },
    { header: "Qty Butuh", width: 11 },
    { header: "Stok", width: 10 },
    { header: "Kurang", width: 10 },
    { header: "Est. Biaya", width: 16 },
    { header: "Unit", width: 40 },
  ];
  ws2.columns = cols2.map((c) => ({ width: c.width }));
  ws2.mergeCells(1, 1, 1, cols2.length);
  ws2.getCell(1, 1).value = `KEBUTUHAN PART AC — ${formatPeriod(periodKey).toUpperCase()}`;
  ws2.getCell(1, 1).font = { bold: true, size: 14 };
  ws2.getRow(3).values = cols2.map((c) => c.header);
  ws2.getRow(3).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  requirements.forEach((q, i) => {
    const stock = stockOf(q);
    const row = ws2.getRow(4 + i);
    row.values = [
      q.part_number ?? "—",
      q.name,
      cabangName(q.cabang_id),
      q.qty,
      stock ?? "—",
      stock === null ? "—" : Math.max(0, q.qty - stock),
      q.cost,
      q.unitCodes.join(", "),
    ];
    row.eachCell({ includeEmpty: true }, (c) => (c.border = thinBorder));
  });
  if (requirements.length > 0) {
    ws2.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + requirements.length, column: cols2.length } };
  }
  ws2.getColumn(4).numFmt = QTY_FMT;
  ws2.getColumn(5).numFmt = QTY_FMT;
  ws2.getColumn(6).numFmt = QTY_FMT;
  ws2.getColumn(7).numFmt = RP_FMT;

  return wb;
}
