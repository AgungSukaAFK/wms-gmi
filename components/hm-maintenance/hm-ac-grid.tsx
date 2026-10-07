// Grid Forecasting AC ala "Forcasting AC.xlsx" (PA Forecast & Monthly
// Planning PM Schedule): satu blok per unit — SMU, jam downtime per tanggal
// 01–31, unscheduled, Est. Total Down Time, %PA vs target, Repair Option,
// lalu Remarks (part AC) + biaya sebagai sub-baris, subtotal, dan total per
// section. Sel bisa diisi langsung seperti spreadsheet (panah/Enter pindah).

"use client";

import { Fragment, memo, useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ClipboardCheck, MoreHorizontal, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, formatHm, parseHmInput, type HmUnit } from "@/lib/hm";
import {
  AC_SECTION_LABEL,
  AC_SECTIONS,
  daysInPeriod,
  estDowntime,
  formatPercent,
  formatQty,
  formatRupiah,
  parseNumberInput,
  partLabel,
  periodStart,
  physicalAvailability,
  type AcMonthRow,
  type AcScheduleDraft,
  type HmAcSection,
} from "@/lib/hm-ac";

const MONTH_SHORT = new Intl.DateTimeFormat("id-ID", { month: "short" });
const WEEKDAY_SHORT = new Intl.DateTimeFormat("id-ID", { weekday: "narrow" });
const fmtHours = (v: number) => (v ? v.toLocaleString("id-ID", { maximumFractionDigits: 1 }) : "");

// Lebar kolom kiri (sticky) & border sel ala spreadsheet.
const CELL = "border-b border-r border-border/70";
const STICKY_UNIT = "sticky left-0 z-10 bg-card shadow-[1px_0_0_var(--border)]";

// ---------- Navigasi keyboard ----------
// Tiap input punya data-ac-r (urutan unit) & data-ac-c (urutan kolom input).

function focusCell(r: number, c: number) {
  const el = document.querySelector<HTMLInputElement>(`input[data-ac-r="${r}"][data-ac-c="${c}"]`);
  if (el) {
    el.focus();
    el.select();
  }
}

function handleNavKey(e: KeyboardEvent<HTMLInputElement>, numeric: boolean) {
  const r = Number(e.currentTarget.dataset.acR);
  const c = Number(e.currentTarget.dataset.acC);
  if (e.key === "ArrowDown" || e.key === "Enter") {
    e.preventDefault();
    focusCell(r + 1, c);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    focusCell(r - 1, c);
  } else if (numeric && e.key === "ArrowRight") {
    e.preventDefault();
    focusCell(r, c + 1);
  } else if (numeric && e.key === "ArrowLeft") {
    e.preventDefault();
    focusCell(r, c - 1);
  }
}

const INPUT_BASE =
  "h-8 w-full bg-transparent px-1 text-center font-mono text-xs tabular-nums outline-none transition-colors " +
  "hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-inset focus:ring-primary";

function IntCell({
  value,
  onChange,
  r,
  c,
  max,
  className,
}: {
  value: number | null;
  onChange: (v: number) => void;
  r: number;
  c: number;
  max?: number;
  className?: string;
}) {
  return (
    <input
      data-ac-r={r}
      data-ac-c={c}
      inputMode="numeric"
      value={value ? String(value) : ""}
      onChange={(e) => {
        const n = parseHmInput(e.target.value) ?? 0;
        onChange(max !== undefined ? Math.min(max, n) : n);
      }}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => handleNavKey(e, true)}
      className={cn(INPUT_BASE, className)}
    />
  );
}

/** Input desimal (target %PA): teks lokal selama diedit, di-commit saat blur. */
function DecimalCell({
  value,
  onChange,
  r,
  c,
}: {
  value: number;
  onChange: (v: number) => void;
  r: number;
  c: number;
}) {
  const shown = String(value).replace(".", ",");
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      data-ac-r={r}
      data-ac-c={c}
      inputMode="decimal"
      value={text ?? shown}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => {
        setText(shown);
        e.target.select();
      }}
      onBlur={() => {
        const n = text === null ? null : parseNumberInput(text);
        if (n !== null && n <= 100 && n !== value) onChange(n);
        setText(null);
      }}
      onKeyDown={(e) => handleNavKey(e, true)}
      className={INPUT_BASE}
    />
  );
}

// ---------- Blok satu unit ----------

type UnitBlockProps = {
  row: AcMonthRow;
  draft: AcScheduleDraft;
  dirty: boolean;
  rowIndex: number;
  periodKey: string;
  sundays: boolean[];
  todayIdx: number;
  isAdmin: boolean;
  onEdit: (unitId: number, draft: AcScheduleDraft) => void;
  onAddPart: (unit: HmUnit) => void;
  onService: (unit: HmUnit) => void;
  onSetting: (unitId: number) => void;
  onReset: (row: AcMonthRow) => void;
  onDeleteExtra: (extraId: number) => void;
};

const UnitBlock = memo(function UnitBlock({
  row,
  draft,
  dirty,
  rowIndex,
  periodKey,
  sundays,
  todayIdx,
  isAdmin,
  onEdit,
  onAddPart,
  onService,
  onSetting,
  onReset,
  onDeleteExtra,
}: UnitBlockProps) {
  const days = draft.day_hours.length;
  const lines = row.lines.length > 0 ? row.lines : [null];
  const span = lines.length + 1; // + baris subtotal
  const dt = estDowntime(draft);
  const pa = physicalAvailability(dt, periodKey);
  const belowTarget = pa < draft.target_pa;
  const overdue = row.dues.some((d) => d.overdue);
  const set = (patch: Partial<AcScheduleDraft>) => onEdit(row.unit.id, { ...draft, ...patch });

  const rs = { rowSpan: span };
  const firstRowBorder = "border-t-2 border-t-border";

  return (
    <>
      <tr className="group/unit">
        {/* Unit */}
        <td {...rs} className={cn(CELL, STICKY_UNIT, firstRowBorder, "min-w-40 max-w-40 px-2 py-1.5 align-top")}>
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <Link
                href={`/maintenance/unit/${row.unit.id}`}
                className="block truncate text-sm font-semibold hover:underline"
              >
                {row.unit.code}
              </Link>
              <div className="truncate text-[11px] text-muted-foreground">{row.unit.name}</div>
            </div>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="-mr-1 h-6 w-6 shrink-0" aria-label="Aksi unit">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => onAddPart(row.unit)}>
                    <Plus className="h-4 w-4" />
                    Tambah part mayor
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onService(row.unit)}>
                    <ClipboardCheck className="h-4 w-4" />
                    Catat servis AC selesai
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onSetting(row.unit.id)}>
                    <Settings2 className="h-4 w-4" />
                    Pengaturan AC unit
                  </DropdownMenuItem>
                  {(row.saved || dirty) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onReset(row)} className="text-destructive">
                        <RotateCcw className="h-4 w-4" />
                        {row.saved ? "Hapus isian bulan ini" : "Batalkan perubahan"}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {overdue && (
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                Lewat
              </span>
            )}
            {dirty ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Belum disimpan
              </span>
            ) : (
              !row.saved && (
                <span className="rounded border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  Usulan
                </span>
              )
            )}
          </div>
          {row.dues.map((d) => (
            <div key={d.dueHm} className="mt-1 text-[10px] leading-tight text-muted-foreground">
              Jatuh tempo {formatHm(d.dueHm)}
              <br />± {formatDate(d.date)}
            </div>
          ))}
        </td>

        {/* Model */}
        <td {...rs} className={cn(CELL, firstRowBorder, "min-w-28 max-w-32 px-2 py-1.5 align-top")}>
          <div className="text-xs font-medium">{row.unit.model}</div>
          {row.packageName && <div className="mt-0.5 text-[10px] text-muted-foreground">{row.packageName}</div>}
        </td>

        {/* SMU */}
        <td {...rs} className={cn(CELL, firstRowBorder, "w-16 min-w-16 p-0 align-top")}>
          {isAdmin ? (
            <IntCell value={draft.smu_hm} onChange={(v) => set({ smu_hm: v })} r={rowIndex} c={0} />
          ) : (
            <div className="px-1 py-2 text-center font-mono text-xs">{draft.smu_hm?.toLocaleString("id-ID") ?? "—"}</div>
          )}
        </td>

        {/* Tanggal 01–31 */}
        {draft.day_hours.map((h, d) => (
          <td
            key={d}
            {...rs}
            className={cn(
              CELL,
              firstRowBorder,
              "w-8 min-w-8 p-0 align-middle",
              h > 0
                ? "bg-amber-200/80 font-semibold text-amber-950 dark:bg-amber-500/30 dark:text-amber-100"
                : sundays[d] && "bg-muted/50",
              d === todayIdx && h <= 0 && "bg-primary/[0.06]",
            )}
          >
            {isAdmin ? (
              <IntCell
                value={h}
                max={24}
                r={rowIndex}
                c={d + 1}
                onChange={(v) => {
                  const next = [...draft.day_hours];
                  next[d] = v;
                  set({ day_hours: next });
                }}
              />
            ) : (
              <div className="py-2 text-center font-mono text-xs">{fmtHours(h)}</div>
            )}
          </td>
        ))}

        {/* Unscheduled */}
        <td {...rs} className={cn(CELL, firstRowBorder, "w-14 min-w-14 p-0 align-middle text-muted-foreground")}>
          {isAdmin ? (
            <IntCell
              value={draft.unscheduled_hours}
              r={rowIndex}
              c={days + 1}
              onChange={(v) => set({ unscheduled_hours: v })}
            />
          ) : (
            <div className="py-2 text-center font-mono text-xs">{fmtHours(draft.unscheduled_hours)}</div>
          )}
        </td>

        {/* Est. total downtime & %PA (hitungan) */}
        <td {...rs} className={cn(CELL, firstRowBorder, "w-16 min-w-16 px-1 text-center align-middle font-mono text-xs font-semibold")}>
          {fmtHours(dt) || "0"}
        </td>
        <td
          {...rs}
          className={cn(
            CELL,
            firstRowBorder,
            "w-16 min-w-16 px-1 text-center align-middle font-mono text-xs font-semibold",
            belowTarget ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {formatPercent(pa)}
        </td>
        <td {...rs} className={cn(CELL, firstRowBorder, "w-16 min-w-16 p-0 align-middle text-muted-foreground")}>
          {isAdmin ? (
            <DecimalCell value={draft.target_pa} onChange={(v) => set({ target_pa: v })} r={rowIndex} c={days + 2} />
          ) : (
            <div className="py-2 text-center font-mono text-xs">{formatPercent(draft.target_pa)}</div>
          )}
        </td>

        {/* Repair option */}
        <td {...rs} className={cn(CELL, firstRowBorder, "min-w-40 p-0 align-top")}>
          {isAdmin ? (
            <input
              data-ac-r={rowIndex}
              data-ac-c={days + 3}
              value={draft.repair_option}
              placeholder="Isi repair option…"
              onChange={(e) => set({ repair_option: e.target.value })}
              onKeyDown={(e) => handleNavKey(e, false)}
              className={cn(INPUT_BASE, "text-left font-sans text-xs font-medium placeholder:font-normal placeholder:text-muted-foreground/60")}
            />
          ) : (
            <div className="px-2 py-2 text-xs font-medium">{draft.repair_option || "—"}</div>
          )}
        </td>

        <RemarkCells line={lines[0]} isAdmin={isAdmin} onDeleteExtra={onDeleteExtra} first />
      </tr>

      {lines.slice(1).map((l, i) => (
        <tr key={l?.key ?? i}>
          <RemarkCells line={l} isAdmin={isAdmin} onDeleteExtra={onDeleteExtra} />
        </tr>
      ))}

      {/* Subtotal unit */}
      <tr>
        <td className={cn(CELL, "min-w-52 px-2 py-1")}>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => onAddPart(row.unit)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-70 hover:opacity-100"
            >
              <Plus className="h-3 w-3" />
              Part mayor
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">Subtotal</span>
          )}
        </td>
        <td className={cn(CELL, "bg-muted/40 px-2 py-1 text-right font-mono text-xs font-bold tabular-nums")}>
          {formatRupiah(row.total)}
        </td>
      </tr>
    </>
  );
});

function RemarkCells({
  line,
  isAdmin,
  onDeleteExtra,
  first,
}: {
  line: AcMonthRow["lines"][number] | null;
  isAdmin: boolean;
  onDeleteExtra: (id: number) => void;
  first?: boolean;
}) {
  const border = first && "border-t-2 border-t-border";
  if (!line) {
    return (
      <>
        <td className={cn(CELL, border, "min-w-52 px-2 py-1 text-[11px] italic text-muted-foreground")}>
          Belum ada paket part
        </td>
        <td className={cn(CELL, border, "min-w-28 px-2 py-1")} />
      </>
    );
  }
  return (
    <>
      <td className={cn(CELL, border, "min-w-60 px-2 py-1 text-xs")}>
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate" title={partLabel(line)}>
            <span
              className={cn(
                "font-mono font-semibold",
                line.extraId && "text-primary",
                !line.part_number && "font-sans font-normal italic text-muted-foreground",
              )}
            >
              {line.part_number ?? "Belum link PN"}
            </span>
            {line.qty !== 1 && <span className="text-muted-foreground"> ×{formatQty(line.qty)}</span>}
            <span className="text-muted-foreground"> · {line.name}</span>
          </span>
          {isAdmin && line.extraId && (
            <button
              type="button"
              aria-label="Hapus part tambahan"
              onClick={() => onDeleteExtra(line.extraId!)}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
      <td className={cn(CELL, border, "min-w-28 px-2 py-1 text-right font-mono text-xs tabular-nums")}>
        {formatRupiah(line.qty * line.unit_price)}
      </td>
    </>
  );
}

// ---------- Baris total ----------

function TotalRow({
  label,
  rows,
  drafts,
  periodKey,
  days,
  costLabel,
  tone,
}: {
  label: string;
  rows: AcMonthRow[];
  drafts: (row: AcMonthRow) => AcScheduleDraft;
  periodKey: string;
  days: number;
  costLabel: string;
  tone: "section" | "grand";
}) {
  const ds = rows.map(drafts);
  const dts = ds.map(estDowntime);
  const avgPa = dts.reduce((s, dt) => s + physicalAvailability(dt, periodKey), 0) / Math.max(1, dts.length);
  const avgTarget = ds.reduce((s, d) => s + d.target_pa, 0) / Math.max(1, ds.length);
  const bg = tone === "grand" ? "bg-primary/10" : "bg-muted/60";
  const cls = cn(CELL, bg, "px-1 py-1.5 text-center font-mono text-xs font-semibold tabular-nums");

  return (
    <tr>
      <td colSpan={3} className={cn(CELL, bg, "sticky left-0 z-10 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide")}>
        {label}
      </td>
      {Array.from({ length: days }).map((_, d) => {
        const sum = ds.reduce((s, x) => s + (x.day_hours[d] || 0), 0);
        return (
          <td key={d} className={cls}>
            {fmtHours(sum)}
          </td>
        );
      })}
      <td className={cls}>{fmtHours(ds.reduce((s, d) => s + d.unscheduled_hours, 0))}</td>
      <td className={cls}>{fmtHours(dts.reduce((s, v) => s + v, 0)) || "0"}</td>
      <td className={cn(cls, avgPa < avgTarget ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>
        {rows.length ? formatPercent(avgPa) : "—"}
      </td>
      <td className={cls}>{rows.length ? formatPercent(avgTarget) : "—"}</td>
      <td className={cn(CELL, bg)} />
      <td className={cn(CELL, bg, "px-2 py-1.5 text-right text-[11px] font-bold uppercase tracking-wide")}>{costLabel}</td>
      <td className={cn(CELL, bg, "px-2 py-1.5 text-right font-mono text-xs font-bold tabular-nums")}>
        {formatRupiah(rows.reduce((s, r) => s + r.total, 0))}
      </td>
    </tr>
  );
}

// ---------- Grid ----------

export function AcForecastGrid({
  periodKey,
  rows,
  edits,
  dirtyIds,
  isAdmin,
  onEdit,
  onAddPart,
  onService,
  onSetting,
  onReset,
  onDeleteExtra,
}: {
  periodKey: string;
  rows: AcMonthRow[];
  edits: Record<number, AcScheduleDraft>;
  dirtyIds: Set<number>;
  isAdmin: boolean;
  onEdit: (unitId: number, draft: AcScheduleDraft) => void;
  onAddPart: (unit: HmUnit) => void;
  onService: (unit: HmUnit) => void;
  onSetting: (unitId: number) => void;
  onReset: (row: AcMonthRow) => void;
  onDeleteExtra: (extraId: number) => void;
}) {
  const days = daysInPeriod(periodKey);
  const start = periodStart(periodKey);
  const monthLabel = MONTH_SHORT.format(start).toUpperCase();

  const dayMeta = useMemo(
    () =>
      Array.from({ length: days }, (_, d) => {
        const date = new Date(start.getFullYear(), start.getMonth(), d + 1);
        return { weekday: WEEKDAY_SHORT.format(date), sunday: date.getDay() === 0 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periodKey, days],
  );
  const sundays = useMemo(() => dayMeta.map((d) => d.sunday), [dayMeta]);
  const now = new Date();
  const todayIdx =
    now.getFullYear() === start.getFullYear() && now.getMonth() === start.getMonth() ? now.getDate() - 1 : -1;

  const draftOf = (row: AcMonthRow) => edits[row.unit.id] ?? row.schedule;
  const totalCols = 3 + days + 7;

  const th = "sticky top-0 z-20 border-b border-r border-border/70 bg-muted px-1 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground";

  let rowIndex = 0;
  const sections = AC_SECTIONS.map((s) => [s, rows.filter((r) => r.section === s)] as [HmAcSection, AcMonthRow[]]).filter(
    ([, list]) => list.length > 0,
  );

  return (
    <div className="max-h-[75vh] overflow-auto rounded-lg border bg-card">
      <table className="w-max min-w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={cn(th, "left-0 z-30 text-left")}>Unit No</th>
            <th className={cn(th, "text-left")}>Model</th>
            <th className={th}>
              SMU
              <div className="font-normal normal-case">{monthLabel}</div>
            </th>
            {dayMeta.map((d, i) => (
              <th
                key={i}
                className={cn(
                  th,
                  "w-8 min-w-8 px-0 text-center",
                  d.sunday && "text-destructive/80",
                  i === todayIdx && "bg-primary text-primary-foreground",
                )}
              >
                {String(i + 1).padStart(2, "0")}
                <div className="font-normal normal-case opacity-70">{d.weekday}</div>
              </th>
            ))}
            <th className={cn(th, "text-center")} title="Estimasi unscheduled maintenance (jam)">
              Unsch.
            </th>
            <th className={cn(th, "text-center leading-tight")}>
              Est. DT
              <div className="font-normal normal-case">(jam)</div>
            </th>
            <th className={cn(th, "text-center leading-tight")}>
              % PA
              <div className="font-normal normal-case">Forecast</div>
            </th>
            <th className={cn(th, "text-center")}>Target</th>
            <th className={cn(th, "text-left")}>Repair Option / Backlog</th>
            <th className={cn(th, "text-left")}>Remarks (Part Number · Part AC)</th>
            <th className={cn(th, "text-right")}>Biaya</th>
          </tr>
        </thead>
        <tbody>
          {sections.map(([section, list]) => (
            <Fragment key={section}>
              <tr>
                <td colSpan={totalCols} className="border-b border-border/70 bg-primary/5 p-0">
                  <span className="sticky left-0 inline-block px-3 py-2 text-xs font-bold uppercase tracking-widest text-primary">
                    Forecast AC {AC_SECTION_LABEL[section]}
                    <span className="ml-2 font-medium normal-case tracking-normal text-muted-foreground">
                      {list.length} unit
                    </span>
                  </span>
                </td>
              </tr>
              {list.map((row) => {
                const idx = rowIndex++;
                return (
                  <UnitBlock
                    key={row.unit.id}
                    row={row}
                    draft={draftOf(row)}
                    dirty={dirtyIds.has(row.unit.id)}
                    rowIndex={idx}
                    periodKey={periodKey}
                    sundays={sundays}
                    todayIdx={todayIdx}
                    isAdmin={isAdmin}
                    onEdit={onEdit}
                    onAddPart={onAddPart}
                    onService={onService}
                    onSetting={onSetting}
                    onReset={onReset}
                    onDeleteExtra={onDeleteExtra}
                  />
                );
              })}
              <TotalRow
                label={`Total ${AC_SECTION_LABEL[section]}`}
                rows={list}
                drafts={draftOf}
                periodKey={periodKey}
                days={days}
                costLabel="Total biaya"
                tone="section"
              />
            </Fragment>
          ))}
          {sections.length > 0 && (
            <TotalRow
              label="Total Est. Down Time / Average Achievement"
              rows={rows}
              drafts={draftOf}
              periodKey={periodKey}
              days={days}
              costLabel="Grand total"
              tone="grand"
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
