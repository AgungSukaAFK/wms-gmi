"use client";

// Panel-panel dashboard utama (isi <Content>). Semua angka bisa diklik:
// membuka daftar sumber datanya atau memfilter lokasi.

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  Hourglass,
  PackageCheck,
  Timer,
  Wallet,
} from "lucide-react";
import {
  AGE_BUCKETS,
  DOC_TYPE_LABEL,
  DOC_TYPE_SHORT,
  MR_LEVELS,
  QUEUE_CARDS,
} from "@/components/dashboard/main/config";
import { BulkApprovalDialog } from "@/components/dashboard/main/bulk-approval-dialog";
import { useDashboard } from "@/components/dashboard/main/dashboard-context";
import {
  BarRow,
  compactRupiah,
  Delta,
  EmptyNote,
  LegendDots,
  MetricCell,
  num,
  pct,
  SegmentedBar,
} from "@/components/dashboard/main/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatYmdShort } from "@/lib/dashboard/filters";
import type {
  AgingRow,
  ApproverRow,
  DashboardExecA,
  DashboardExecB,
  DashboardPeriod,
  DashboardQueue,
  LeadTime,
  MyApprovalRow,
  PoValueRow,
  QueueKey,
} from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Approval
// ------------------------------------------------------------------

function ageTone(days: number) {
  if (days > 14) return "text-destructive";
  if (days > 7) return "text-warning";
  return "text-muted-foreground";
}

/** Baris yang tampil; sisanya lewat "Lihat semua". */
const MY_ROWS = 6;

/** Dokumen yang gilirannya di-approve user ini. */
export function MyApprovalsPanel({ rows, total }: { rows: MyApprovalRow[]; total: number }) {
  const { openList, refresh } = useDashboard();
  const [bulkOpen, setBulkOpen] = useState(false);

  if (total === 0) {
    return (
      <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
        <CircleCheck className="h-5 w-5 shrink-0 text-success" />
        Tidak ada dokumen yang menunggu approval Anda.
      </div>
    );
  }

  return (
    <div>
      <ul className="-mx-2 divide-y">
        {rows.slice(0, MY_ROWS).map((row) => {
          const href = row.href.endsWith("=")
            ? `${row.href}${encodeURIComponent(row.kode)}`
            : row.href;
          return (
            <li key={`${row.doc_type}-${row.id}`}>
              <Link
                href={href}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Badge variant="secondary" className="w-14 shrink-0 justify-center font-medium">
                  {DOC_TYPE_SHORT[row.doc_type] ?? row.doc_type}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-semibold">{row.kode}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[row.lokasi, row.tanggal ? formatYmdShort(row.tanggal) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className={cn("shrink-0 text-xs font-medium tabular-nums", ageTone(row.umur_hari))}>
                  {row.umur_hari === 0 ? "Hari ini" : `${num(row.umur_hari)} hari`}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {total > Math.min(rows.length, MY_ROWS) ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-primary"
            onClick={() => openList("approval_pending", { mine: true }, "Menunggu approval Anda")}
          >
            Lihat semua {num(total)} dokumen <ArrowRight />
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBulkOpen(true)}>
          <CheckCheck /> Approve massal
        </Button>
      </div>
      {bulkOpen && <BulkApprovalDialog onOpenChange={setBulkOpen} onDone={refresh} />}
    </div>
  );
}

// Makin tua makin pekat (satu hue), angka tetap teks biasa.
const AGE_CELL = [
  "",
  "bg-destructive/5",
  "bg-destructive/10",
  "bg-destructive/20 font-semibold",
];

/** Jenis dokumen x umur menunggu. Tiap sel membuka daftarnya. */
export function AgingMatrix({ rows }: { rows: AgingRow[] }) {
  const { openList } = useDashboard();
  if (rows.length === 0) return <EmptyNote>Tidak ada dokumen yang menunggu approval.</EmptyNote>;

  const totals = AGE_BUCKETS.map((b) => rows.reduce((sum, r) => sum + r[b.field], 0));

  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-96 border-separate border-spacing-1 text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Dokumen</th>
            {AGE_BUCKETS.map((b) => (
              <th key={b.key} className="px-2 py-1 text-right font-medium whitespace-nowrap">
                {b.label}
              </th>
            ))}
            <th className="px-2 py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.doc_type}>
              <td className="px-2 py-1 font-medium whitespace-nowrap">
                {DOC_TYPE_LABEL[row.doc_type] ?? row.doc_type}
              </td>
              {AGE_BUCKETS.map((b, i) => {
                const value = row[b.field];
                return (
                  <td key={b.key} className="p-0 text-right">
                    {value > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          openList(
                            "approval_pending",
                            { doc: row.doc_type, age: b.key },
                            `${DOC_TYPE_LABEL[row.doc_type] ?? row.doc_type} menunggu approval`,
                          )
                        }
                        title={`${DOC_TYPE_LABEL[row.doc_type]} · ${b.label}: ${num(value)} dokumen`}
                        className={cn(
                          "w-full cursor-pointer rounded-md px-2 py-1 text-right tabular-nums transition-colors hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          AGE_CELL[i],
                        )}
                      >
                        {num(value)}
                      </button>
                    ) : (
                      <span className="block px-2 py-1 text-muted-foreground/50">0</span>
                    )}
                  </td>
                );
              })}
              <td className="p-0 text-right">
                <button
                  type="button"
                  onClick={() =>
                    openList(
                      "approval_pending",
                      { doc: row.doc_type },
                      `${DOC_TYPE_LABEL[row.doc_type] ?? row.doc_type} menunggu approval`,
                    )
                  }
                  className="w-full cursor-pointer rounded-md px-2 py-1 text-right font-semibold tabular-nums transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {num(row.total)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-xs text-muted-foreground">
            <td className="px-2 pt-2 font-medium">Semua</td>
            {totals.map((value, i) => (
              <td key={AGE_BUCKETS[i].key} className="px-2 pt-2 text-right tabular-nums">
                {num(value)}
              </td>
            ))}
            <td className="px-2 pt-2 text-right font-semibold tabular-nums text-foreground">
              {num(rows.reduce((sum, r) => sum + r.total, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Siapa yang paling banyak menahan dokumen. */
export function ApproverPanel({ rows }: { rows: ApproverRow[] }) {
  const { openList } = useDashboard();
  if (rows.length === 0) return <EmptyNote>Tidak ada antrian approval.</EmptyNote>;
  const max = Math.max(...rows.map((r) => r.jumlah));

  return (
    <div>
      {rows.map((row) => (
        <BarRow
          key={row.id ?? "none"}
          label={row.nama}
          valueText={
            <>
              <span className="font-semibold text-foreground">{num(row.jumlah)}</span> dok · terlama{" "}
              <span className={cn("font-medium", ageTone(row.terlama))}>{num(row.terlama)} hari</span>
            </>
          }
          segments={[{ value: row.jumlah, className: "bg-chart-dash-1" }]}
          max={max}
          title={`${row.nama}: ${num(row.jumlah)} dokumen, rata-rata menunggu ${row.rata} hari`}
          onClick={() =>
            openList("approval_pending", { approver: row.id ?? "" }, `Menunggu approval ${row.nama}`)
          }
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Procurement
// ------------------------------------------------------------------

const FLOW: { key: QueueKey; label: string }[] = [
  { key: "mr_open", label: "Approval MR" },
  { key: "mr_need_pr", label: "Buat PR" },
  { key: "pr_open", label: "Approval PR" },
  { key: "pr_need_po", label: "Buat PO" },
  { key: "po_open", label: "Approval PO" },
  { key: "po_not_received", label: "Tunggu barang" },
  { key: "ri_open", label: "Approval RI" },
];

/** Jumlah dokumen yang sedang tertahan di tiap tahap MR -> RI. */
export function StageFlow({ queue }: { queue: DashboardQueue }) {
  const { openList } = useDashboard();
  const max = Math.max(...FLOW.map((s) => queue[s.key] ?? 0), 1);

  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {FLOW.map((stage, i) => {
        const value = queue[stage.key] ?? 0;
        return (
          <li key={stage.key} className="min-w-0">
            <button
              type="button"
              onClick={() => openList(stage.key)}
              title={QUEUE_CARDS[stage.key].label}
              className="group flex h-full w-full cursor-pointer flex-col rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="truncate font-medium">{stage.label}</span>
              </span>
              <span
                className={cn(
                  "mt-1.5 text-xl font-semibold leading-tight",
                  value === 0 && "text-muted-foreground",
                )}
              >
                {num(value)}
              </span>
              <span className="mt-2 block h-1 w-full rounded-full bg-muted/60">
                <span
                  className="block h-full rounded-full bg-chart-dash-1"
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** MR aktif per level progres (urut dari awal ke akhir proses). */
export function PipelinePanel({ pipeline }: { pipeline: DashboardExecA["mr_pipeline"] }) {
  const { openList } = useDashboard();
  const total = MR_LEVELS.reduce((sum, l) => sum + (pipeline[l.key] ?? 0), 0);
  if (total === 0) return <EmptyNote>Tidak ada MR aktif.</EmptyNote>;
  const max = Math.max(...MR_LEVELS.map((l) => pipeline[l.key] ?? 0));

  return (
    <div>
      {MR_LEVELS.map((level) => {
        const value = pipeline[level.key] ?? 0;
        return (
          <BarRow
            key={level.key}
            label={level.label}
            sublabel={level.description}
            valueText={
              <>
                <span className="font-semibold text-foreground">{num(value)}</span> · {pct(value, total)}%
              </>
            }
            segments={[{ value, className: "bg-chart-dash-1" }]}
            max={max}
            title={`${level.label} (${level.description}): ${num(value)} MR`}
            onClick={
              value > 0
                ? () => openList("mr_level", { bucket: level.key }, `MR aktif: ${level.label}`)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

/** Tombol batang -> memfilter seluruh dashboard ke lokasi itu. */
function useLocationFilter() {
  const { setParams, filters } = useDashboard();
  return (cabangId: number | null) => {
    if (!cabangId) return;
    const only = filters.cabangIds.length === 1 && filters.cabangIds[0] === cabangId;
    setParams({ lokasi: only ? null : String(cabangId) });
  };
}

export function MrLocationPanel({ rows }: { rows: DashboardExecB["mr_by_cabang"] }) {
  const filterLocation = useLocationFilter();
  const active = rows.filter((r) => r.aktif > 0).slice(0, 10);
  if (active.length === 0) return <EmptyNote>Tidak ada MR aktif.</EmptyNote>;
  const max = Math.max(...active.map((r) => r.aktif));

  return (
    <div className="space-y-3">
      <LegendDots
        items={[
          { label: "Masih dalam tenggat", className: "bg-chart-dash-1" },
          { label: "Lewat due date", className: "bg-chart-critical" },
        ]}
      />
      <div>
        {active.map((row) => (
          <BarRow
            key={row.cabang_id ?? "none"}
            label={row.nama}
            valueText={
              <>
                <span className="font-semibold text-foreground">{num(row.aktif)}</span> aktif
                {row.overdue > 0 && <> · {num(row.overdue)} lewat</>}
              </>
            }
            segments={[
              { value: row.aktif - row.overdue, className: "bg-chart-dash-1", name: "Masih dalam tenggat" },
              { value: row.overdue, className: "bg-chart-critical", name: "Lewat due date" },
            ]}
            max={max}
            onClick={row.cabang_id ? () => filterLocation(row.cabang_id) : undefined}
          />
        ))}
      </div>
      {rows.filter((r) => r.aktif > 0).length > active.length && (
        <p className="text-xs text-muted-foreground">Menampilkan 10 lokasi dengan MR aktif terbanyak.</p>
      )}
    </div>
  );
}

export function StockLocationPanel({ rows }: { rows: DashboardExecB["stock_by_cabang"] }) {
  const filterLocation = useLocationFilter();
  const shown = rows.slice(0, 10);
  if (shown.length === 0) {
    return <EmptyNote>Belum ada barang yang diatur batas min/max-nya.</EmptyNote>;
  }
  const max = Math.max(...shown.map((r) => r.low + r.normal + r.over));

  return (
    <div className="space-y-3">
      <LegendDots
        items={[
          { label: "Di bawah minimum", className: "bg-chart-critical" },
          { label: "Normal", className: "bg-chart-neutral" },
          { label: "Di atas maksimum", className: "bg-chart-dash-1" },
        ]}
      />
      <div>
        {shown.map((row) => (
          <BarRow
            key={row.cabang_id}
            label={row.nama}
            valueText={
              <>
                <span className="font-semibold text-foreground">{num(row.low)}</span> kurang
                {row.over > 0 && <> · {num(row.over)} lebih</>} · {num(row.low + row.normal + row.over)} barang
              </>
            }
            segments={[
              { value: row.low, className: "bg-chart-critical", name: "Di bawah minimum" },
              { value: row.normal, className: "bg-chart-neutral", name: "Normal" },
              { value: row.over, className: "bg-chart-dash-1", name: "Di atas maksimum" },
            ]}
            max={max}
            onClick={() => filterLocation(row.cabang_id)}
          />
        ))}
      </div>
    </div>
  );
}

export function PoReceivePanel({ data }: { data: DashboardPeriod["po_receive"] }) {
  const { openList } = useDashboard();
  const total = data.pending + data.partial + data.complete;
  if (total === 0) return <EmptyNote>Tidak ada PO pada periode ini.</EmptyNote>;
  return (
    <SegmentedBar
      parts={[
        { key: "complete", label: "Diterima penuh", value: data.complete, className: "bg-chart-dash-3" },
        { key: "partial", label: "Diterima sebagian", value: data.partial, className: "bg-chart-dash-4" },
        { key: "pending", label: "Belum diterima", value: data.pending, className: "bg-chart-neutral" },
      ]}
      onSelect={(key) => openList("po_period", { receive: key }, "PO pada periode ini")}
    />
  );
}

export function MrStatusPanel({ data }: { data: DashboardPeriod["mr_status"] }) {
  const { openList } = useDashboard();
  const total = data.open + data.approved + data.completed + data.rejected;
  if (total === 0) return <EmptyNote>Tidak ada MR pada periode ini.</EmptyNote>;
  return (
    <SegmentedBar
      parts={[
        { key: "completed", label: "Selesai", value: data.completed, className: "bg-chart-dash-3" },
        { key: "approved", label: "Approved, masih berjalan", value: data.approved, className: "bg-chart-dash-1" },
        { key: "open", label: "Menunggu approval", value: data.open, className: "bg-chart-neutral" },
        { key: "rejected", label: "Ditolak", value: data.rejected, className: "bg-chart-critical" },
      ]}
      onSelect={(key) => openList("mr_period", { status: key }, "MR pada periode ini")}
    />
  );
}

/** Peringkat sederhana satu warna; klik = isi filter dashboard. */
export function RankedPanel({
  rows,
  unit,
  emptyText,
  filterKey,
  selected,
}: {
  rows: { nama: string; jumlah: number }[];
  unit: string;
  emptyText: string;
  /** Param URL yang diisi saat baris diklik (kategori / prioritas). */
  filterKey?: "kategori" | "prioritas";
  selected?: string[];
}) {
  const { setParams } = useDashboard();
  if (rows.length === 0) return <EmptyNote>{emptyText}</EmptyNote>;
  const total = rows.reduce((sum, r) => sum + r.jumlah, 0);
  const max = Math.max(...rows.map((r) => r.jumlah));

  return (
    <div>
      {rows.map((row) => {
        const clickable = filterKey && !row.nama.startsWith("Tanpa");
        const isOnly = selected?.length === 1 && selected[0] === row.nama;
        return (
          <BarRow
            key={row.nama}
            label={row.nama}
            valueText={
              <>
                <span className="font-semibold text-foreground">{num(row.jumlah)}</span> {unit} ·{" "}
                {pct(row.jumlah, total)}%
              </>
            }
            segments={[{ value: row.jumlah, className: "bg-chart-dash-1" }]}
            max={max}
            title={clickable ? `Klik untuk memfilter dashboard ke ${row.nama}` : undefined}
            onClick={
              clickable ? () => setParams({ [filterKey]: isOnly ? null : row.nama }) : undefined
            }
          />
        );
      })}
    </div>
  );
}

export function TopVendorsPanel({ rows }: { rows: DashboardExecB["top_vendors"] }) {
  if (rows.length === 0) return <EmptyNote>Tidak ada PO pada periode ini.</EmptyNote>;
  const max = Math.max(...rows.map((r) => r.po));
  return (
    <div>
      {rows.map((row) => (
        <BarRow
          key={row.nama}
          label={row.nama}
          valueText={
            <>
              <span className="font-semibold text-foreground">{num(row.po)}</span> PO · {num(row.item)} item
              {row.nilai !== null && row.nilai > 0 && <> · {compactRupiah(row.nilai)}</>}
            </>
          }
          segments={[{ value: row.po, className: "bg-chart-dash-1" }]}
          max={max}
        />
      ))}
    </div>
  );
}

export function TopPartsPanel({ rows }: { rows: DashboardExecB["top_parts"] }) {
  if (rows.length === 0) return <EmptyNote>Tidak ada permintaan pada periode ini.</EmptyNote>;
  const max = Math.max(...rows.map((r) => r.mr));
  return (
    <div>
      {rows.map((row) => (
        <BarRow
          key={row.part_number}
          label={row.part_number}
          sublabel={row.part_name ?? undefined}
          valueText={
            <>
              <span className="font-semibold text-foreground">{num(row.mr)}</span> MR · {num(row.qty)}{" "}
              {row.satuan ?? ""}
            </>
          }
          segments={[{ value: row.mr, className: "bg-chart-dash-1" }]}
          max={max}
          title={`${row.part_number} ${row.part_name ?? ""}: diminta di ${num(row.mr)} MR, total ${num(row.qty)} ${row.satuan ?? ""}`}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Sel khusus (dipakai di MetricGrid)
// ------------------------------------------------------------------

function leadValue(lt: LeadTime) {
  if (lt.cur === null) return "-";
  return (
    <>
      {lt.cur.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
      <span className="ml-1 text-xs font-medium text-muted-foreground">hari</span>
    </>
  );
}

const LEAD_ITEMS: { key: keyof DashboardExecA["lead_time"]; label: string; note: string }[] = [
  { key: "mr_pr", label: "Lead time MR → PR", note: "PR" },
  { key: "pr_po", label: "Lead time PR → PO", note: "PO" },
  { key: "po_ri", label: "Lead time PO → diterima", note: "RI" },
];

export function LeadTimeCells({ data }: { data: DashboardExecA["lead_time"] }) {
  return (
    <>
      {LEAD_ITEMS.map((item) => {
        const lt = data[item.key];
        return (
          <MetricCell
            key={item.key}
            label={item.label}
            value={leadValue(lt)}
            hint={
              lt.cur === null ? (
                `Belum ada ${item.note} di periode ini`
              ) : (
                <Delta cur={lt.cur} prev={lt.prev} goodWhen="down" suffix=" hr" />
              )
            }
            icon={Timer}
            tone="info"
            active={lt.cur !== null}
          >
            {lt.cur !== null && (
              <span className="block text-[11px] text-muted-foreground">
                Rata-rata dari {num(lt.n)} {item.note}
              </span>
            )}
          </MetricCell>
        );
      })}
    </>
  );
}

export function FulfillmentCell({ data }: { data: DashboardPeriod["mr_fulfillment"] }) {
  const percent = pct(data.qty_received, data.qty_request);
  return (
    <MetricCell
      label="Qty MR sudah diterima"
      value={data.qty_request > 0 ? `${percent}%` : "-"}
      hint={
        data.qty_request > 0
          ? `${num(data.qty_received)} dari ${num(data.qty_request)} qty`
          : "Belum ada MR di periode ini"
      }
      icon={PackageCheck}
      tone="info"
      active={data.qty_request > 0}
    >
      {data.qty_request > 0 && (
        <span className="block h-1.5 w-full rounded-full bg-muted/60">
          <span
            className="block h-full rounded-full bg-chart-dash-3"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </span>
      )}
    </MetricCell>
  );
}

/** Dua sel nilai PO (hanya dikirim server untuk role purchasing). */
export function PoValueCells({ rows }: { rows: PoValueRow[] }) {
  const { openList } = useDashboard();
  const main = rows.find((r) => r.currency === "IDR") ?? rows[0] ?? null;
  const others = rows.filter((r) => r !== main);
  const currency = main?.currency ?? "IDR";
  const cur = main?.cur ?? 0;
  const outstanding = main?.outstanding ?? 0;
  const extra = (pick: (r: PoValueRow) => number) => {
    const list = others.filter((o) => pick(o) > 0);
    if (list.length === 0) return null;
    return list.map((o) => (
      <span key={o.currency} className="block text-[11px] text-muted-foreground">
        + {compactRupiah(pick(o), o.currency)}
      </span>
    ));
  };

  return (
    <>
      <MetricCell
        label="Nilai PO periode ini"
        value={compactRupiah(cur, currency)}
        hint={
          main ? (
            <Delta cur={main.cur} prev={main.prev} format={(n) => compactRupiah(n, currency)} />
          ) : (
            "Belum ada PO di periode ini"
          )
        }
        icon={Wallet}
        tone="info"
        active={cur > 0}
        onClick={() => openList("po_period")}
      >
        {extra((o) => o.cur)}
      </MetricCell>
      <MetricCell
        label="Nilai PO belum diterima"
        value={compactRupiah(outstanding, currency)}
        hint="Sisa qty PO approved"
        icon={Hourglass}
        tone="warning"
        active={outstanding > 0}
        onClick={() => openList("po_not_received")}
      >
        {extra((o) => o.outstanding)}
      </MetricCell>
    </>
  );
}

