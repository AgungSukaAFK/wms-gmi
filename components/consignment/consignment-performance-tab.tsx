"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  MessageSquareWarning,
  PackageCheck,
  PackageOpen,
  Timer,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiDeltaTile } from "@/components/dashboard/kpi-delta-tile";
import { ConsignmentTrendChart } from "@/components/dashboard/consignment-trend-chart";
import { ConsignmentLeadTimeChart } from "@/components/dashboard/consignment-lead-time-chart";
import type { ConsignmentPerformanceData } from "@/services/consignment-so-actions";
import { cn, formatDate } from "@/lib/utils";

const num = (n: number) => n.toLocaleString("id-ID");
const pct = (r: number | null) =>
  r === null ? "-" : `${(r * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const days = (n: number | null) =>
  n === null ? "-" : `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })} hari`;

// Warna status (bukan warna series): selalu didampingi ikon + teks.
const TONE = {
  critical: {
    icon: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    ring: "border-l-rose-500",
    text: "text-rose-600 dark:text-rose-400",
  },
  warning: {
    icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ring: "border-l-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  good: {
    icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    ring: "border-l-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
} as const;

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="col-span-12 -mb-1 mt-2 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <h2 className="text-xs font-black uppercase tracking-wide text-foreground">
        {title}
      </h2>
      <p className="text-[10px] font-medium text-muted-foreground">{description}</p>
    </div>
  );
}

function AlertTile({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone: "critical" | "warning";
  href: string;
}) {
  const effective = value > 0 ? tone : "good";
  const t = TONE[effective];
  return (
    <Content
      size="xs"
      className={cn("border-l-4 sm:col-span-6 lg:col-span-3 xl:col-span-3", t.ring)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">
            {label}
          </p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", value > 0 ? t.text : "text-foreground")}>
            {num(value)}
          </p>
          <p className="mt-1 text-[10px] font-medium text-muted-foreground">
            {value > 0 ? (
              detail
            ) : (
              <span className={cn("inline-flex items-center gap-1", t.text)}>
                <CheckCircle2 className="h-3 w-3" /> Aman, tidak ada
              </span>
            )}
          </p>
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md", t.icon)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {value > 0 && (
        <Link
          href={href}
          className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-primary hover:underline"
        >
          Tindak lanjuti <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </Content>
  );
}

function StatBlock({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-muted/30 px-3 py-2", className)}>
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FulfilmentBar({ data }: { data: ConsignmentPerformanceData["fulfilment"] }) {
  const segments = [
    { key: "full", label: "Full terkirim", count: data.items_full, color: "bg-emerald-500" },
    { key: "partial", label: "Partial", count: data.items_partial, color: "bg-amber-400" },
    { key: "belum", label: "Belum dikirim", count: data.items_belum, color: "bg-slate-300 dark:bg-slate-600" },
  ];
  const total = data.items_total;

  return (
    <div>
      <div
        className="flex h-4 w-full gap-0.5 overflow-hidden rounded-sm bg-muted"
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(", ")}
      >
        {total > 0 &&
          segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <div
                key={s.key}
                className={cn("h-full first:rounded-l-sm last:rounded-r-sm", s.color)}
                style={{ width: `${(s.count / total) * 100}%` }}
                title={`${s.label}: ${num(s.count)} item (${pct(s.count / total)})`}
              />
            ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {segments.map((s) => (
          <div key={s.key} className="flex items-start gap-2">
            <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-sm", s.color)} />
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.label}</p>
              <p className="text-sm font-bold tabular-nums text-foreground">
                {num(s.count)}
                <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                  {total > 0 ? pct(s.count / total) : ""}
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RateMeter({ value }: { value: number | null }) {
  const v = value ?? 0;
  const color =
    value === null
      ? "bg-muted-foreground/30"
      : v >= 0.9
        ? "bg-emerald-500"
        : v >= 0.6
          ? "bg-amber-400"
          : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(v, 1) * 100}%` }} />
      </div>
      <span className="w-12 text-right text-xs font-semibold tabular-nums">{pct(value)}</span>
    </div>
  );
}

function DueBadge({ daysToDue }: { daysToDue: number }) {
  const overdue = daysToDue < 0;
  const t = overdue ? TONE.critical : TONE.warning;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold",
        t.icon,
      )}
    >
      {overdue ? <AlertOctagon className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {overdue
        ? `Telat ${Math.abs(daysToDue)} hari`
        : daysToDue === 0
          ? "Jatuh tempo hari ini"
          : `H-${daysToDue}`}
    </span>
  );
}

const thClass = "whitespace-nowrap text-[10px] font-black uppercase text-muted-foreground";

export function ConsignmentPerformanceTab({
  data,
  loading,
}: {
  data: ConsignmentPerformanceData | null;
  loading: boolean;
}) {
  const [trendMode, setTrendMode] = useState<"dokumen" | "qty">("dokumen");

  if (!data) {
    return (
      <Content>
        <div className="flex h-60 items-center justify-center text-xs text-muted-foreground">
          {loading ? "Memuat data performance..." : "Data performance belum tersedia."}
        </div>
      </Content>
    );
  }

  const { kpi, alerts, fulfilment, lead_time, penerimaan } = data;
  const periodLabel = `${data.period_months} bulan terakhir (sejak ${formatDate(data.period_start)})`;

  return (
    <>
      {/* ---------- Kondisi kritis saat ini ---------- */}
      <SectionHeading
        title="Perlu perhatian sekarang"
        description="Kondisi terkini seluruh SO & IK, tidak terpengaruh filter periode"
      />
      <AlertTile
        label="Item SO Lewat Due Date"
        value={alerts.overdue_items}
        detail={`${num(alerts.overdue_so)} SO · sisa ${num(alerts.overdue_qty)} qty belum terkirim`}
        icon={AlertOctagon}
        tone="critical"
        href="#critical-items"
      />
      <AlertTile
        label={`Jatuh Tempo ≤ 7 Hari`}
        value={alerts.due_soon_items}
        detail={`${num(alerts.due_soon_so)} SO · sisa ${num(alerts.due_soon_qty)} qty harus dikirim`}
        icon={CalendarClock}
        tone="warning"
        href="#critical-items"
      />
      <AlertTile
        label="IK Belum Dikonfirmasi"
        value={alerts.ik_pending}
        detail={`${num(alerts.ik_pending_aged)} IK > 7 hari · terlama ${alerts.ik_pending_oldest_days ?? 0} hari`}
        icon={PackageOpen}
        tone="warning"
        href="#pending-ik"
      />
      <AlertTile
        label="Komplain Belum Selesai"
        value={alerts.komplain_open}
        detail={`Selisih ${num(alerts.komplain_open_qty)} qty belum diterima customer`}
        icon={MessageSquareWarning}
        tone="critical"
        href="/so-reguler/consignment/penerimaan"
      />

      {/* ---------- KPI bulan ini ---------- */}
      <SectionHeading title="Bulan ini" description="Dibandingkan dengan bulan lalu" />
      <KpiDeltaTile
        className="lg:col-span-3"
        label="SO Consignment Baru"
        value={kpi.so_this_month}
        previous={kpi.so_last_month}
        icon={FileSpreadsheet}
        iconClassName="bg-primary/10 text-primary"
      />
      <KpiDeltaTile
        className="lg:col-span-3"
        label="IK Dikirim"
        value={kpi.ik_this_month}
        previous={kpi.ik_last_month}
        icon={Truck}
        iconClassName="bg-sky-500/10 text-sky-600"
      />
      <KpiDeltaTile
        className="lg:col-span-3"
        label="Total Qty Dikirim"
        value={kpi.qty_this_month}
        previous={kpi.qty_last_month}
        icon={PackageCheck}
        iconClassName="bg-emerald-500/10 text-emerald-600"
      />
      <KpiDeltaTile
        className="lg:col-span-3"
        label="Rata-rata Lead Time"
        value={kpi.lead_time_this_month}
        previous={kpi.lead_time_last_month}
        suffix="hari"
        decimals={1}
        invert
        icon={Timer}
        iconClassName="bg-violet-500/10 text-violet-600"
      />

      {/* ---------- Performa periode ---------- */}
      <SectionHeading title="Performa periode" description={periodLabel} />
      <Content
        size="md"
        title="Pemenuhan SO"
        description="Status kirim item SO yang dibuat dalam periode"
      >
        <div className="grid grid-cols-3 gap-2">
          <StatBlock
            label="Fill Rate Qty"
            value={pct(fulfilment.fill_rate)}
            hint={`${num(fulfilment.qty_kirim)} / ${num(fulfilment.qty_order)} qty`}
          />
          <StatBlock
            label="On-Time"
            value={pct(fulfilment.on_time_rate)}
            hint={`${num(fulfilment.on_time)} tepat · ${num(fulfilment.late)} telat`}
          />
          <StatBlock
            label="Item SO"
            value={num(fulfilment.items_total)}
            hint="total baris item"
          />
        </div>
        <div className="mt-5">
          <FulfilmentBar data={fulfilment} />
        </div>
        <p className="mt-4 text-[10px] text-muted-foreground">
          On-time = item Full dengan tgl IK terakhir ≤ due date (item tanpa due date tidak dihitung).
        </p>
      </Content>

      <Content
        size="md"
        title="Lead Time SO → Terkirim Penuh"
        description="Hari dari input SO sampai IK terakhir yang membuat item Full"
      >
        <div className="grid grid-cols-3 gap-2">
          <StatBlock label="Rata-rata" value={days(lead_time.avg)} />
          <StatBlock label="Median" value={days(lead_time.median)} />
          <StatBlock label="Sampel" value={`${num(lead_time.samples)} item`} />
        </div>
        <div className="mt-4">
          {lead_time.samples === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
              Belum ada item yang terkirim penuh dalam periode ini.
            </div>
          ) : (
            <ConsignmentLeadTimeChart data={lead_time.buckets} />
          )}
        </div>
      </Content>

      <Content
        className="lg:col-span-8"
        title="Tren Volume"
        description={
          trendMode === "dokumen"
            ? "Jumlah dokumen SO & IK per bulan"
            : "Qty dipesan (SO) vs qty dikirim (IK) per bulan"
        }
        cardAction={
          <div className="flex rounded-md border border-border p-0.5">
            {(["dokumen", "qty"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={trendMode === m ? "secondary" : "ghost"}
                className="h-7 px-3 text-[10px] font-bold uppercase"
                onClick={() => setTrendMode(m)}
              >
                {m === "dokumen" ? "Dokumen" : "Qty"}
              </Button>
            ))}
          </div>
        }
      >
        <ConsignmentTrendChart data={data.trend} mode={trendMode} />
      </Content>

      <Content
        className="lg:col-span-4"
        title="Penerimaan Customer"
        description="Konfirmasi terima IK dalam periode"
      >
        <div className="grid grid-cols-2 gap-2">
          <StatBlock
            label="Acceptance"
            value={pct(penerimaan.acceptance_rate)}
            hint={`${num(penerimaan.qty_terima)} / ${num(penerimaan.qty_kirim)} qty`}
          />
          <StatBlock label="IK Dikonfirmasi" value={num(penerimaan.ik_confirmed)} />
          <StatBlock
            label="Waktu Konfirmasi"
            value={days(penerimaan.avg_days_to_confirm)}
            hint="rata-rata tgl IK → terima"
          />
          <StatBlock
            label="Item Komplain"
            value={num(penerimaan.items_komplain)}
            hint={`${num(penerimaan.komplain_selesai)} sudah selesai`}
          />
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[10px] font-bold uppercase text-muted-foreground">
            <span>Qty diterima</span>
            <span className="tabular-nums">{pct(penerimaan.acceptance_rate)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                (penerimaan.acceptance_rate ?? 1) >= 0.98 ? "bg-emerald-500" : "bg-amber-400",
              )}
              style={{ width: `${(penerimaan.acceptance_rate ?? 0) * 100}%` }}
            />
          </div>
        </div>
      </Content>

      {/* ---------- Daftar tindak lanjut ---------- */}
      <SectionHeading
        title="Daftar tindak lanjut"
        description="Prioritaskan dari yang paling telat"
      />
      <Content
        id="critical-items"
        title="Item SO Kritis"
        description={`Belum terkirim penuh dan lewat due date / jatuh tempo ≤ 7 hari · menampilkan ${data.critical_items.length} dari ${num(data.critical_items_total)} item`}
        cardAction={
          <Link href="/so-reguler/consignment/ik/create">
            <Button size="sm" className="h-8 text-[10px] font-bold uppercase">
              <Truck className="mr-1 h-3.5 w-3.5" /> Buat IK
            </Button>
          </Link>
        }
      >
        {data.critical_items.length === 0 ? (
          <div className={cn("flex h-24 items-center justify-center gap-2 text-xs font-medium", TONE.good.text)}>
            <CheckCircle2 className="h-4 w-4" /> Tidak ada item SO yang telat atau mendekati due date.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={thClass}>Status</TableHead>
                  <TableHead className={thClass}>Due Date</TableHead>
                  <TableHead className={thClass}>No. SO</TableHead>
                  <TableHead className={thClass}>Customer / Site</TableHead>
                  <TableHead className={thClass}>Part</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>Qty SO</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>Terkirim</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>Sisa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.critical_items.map((r) => (
                  <TableRow key={r.item_id}>
                    <TableCell>
                      <DueBadge daysToDue={r.days_to_due} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{formatDate(r.due_date)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-bold">{r.so_no || "-"}</TableCell>
                    <TableCell className="max-w-56">
                      <span className="block truncate text-xs font-semibold">{r.customer_name || "-"}</span>
                      {r.site && (
                        <span className="block truncate text-[10px] text-muted-foreground">{r.site}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56">
                      <span className="block text-xs font-bold">{r.part_number || "-"}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{r.part_name}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {num(r.qty)} <span className="text-[10px] text-muted-foreground">{r.satuan}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{num(r.qty_kirim)}</TableCell>
                    <TableCell className="text-right text-xs font-bold tabular-nums">{num(r.qty_sisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Content>

      <Content
        size="md"
        title="Customer Teratas"
        description="Berdasarkan qty SO dalam periode"
      >
        {data.top_customers.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
            Belum ada SO dalam periode ini.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={thClass}>Customer</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>SO</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>Qty SO</TableHead>
                  <TableHead className={thClass}>Fill Rate</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>Telat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.top_customers.map((c) => (
                  <TableRow key={c.customer_id}>
                    <TableCell className="max-w-48">
                      <span className="block truncate text-xs font-semibold">{c.customer_name}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{num(c.so_count)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{num(c.qty_order)}</TableCell>
                    <TableCell>
                      <RateMeter value={c.fill_rate} />
                    </TableCell>
                    <TableCell className="text-right">
                      {c.overdue_items > 0 ? (
                        <span className={cn("inline-flex items-center gap-1 text-xs font-bold", TONE.critical.text)}>
                          <AlertOctagon className="h-3 w-3" />
                          {num(c.overdue_items)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Content>

      <Content
        id="pending-ik"
        size="md"
        title="IK Menunggu Konfirmasi Penerimaan"
        description={`${num(alerts.ik_pending)} IK belum diinput penerimaannya · urut dari yang terlama`}
        cardAction={
          <Link href="/so-reguler/consignment/penerimaan/create">
            <Button size="sm" variant="outline" className="h-8 text-[10px] font-bold uppercase">
              Input Penerimaan
            </Button>
          </Link>
        }
      >
        {data.pending_iks.length === 0 ? (
          <div className={cn("flex h-24 items-center justify-center gap-2 text-xs font-medium", TONE.good.text)}>
            <CheckCircle2 className="h-4 w-4" /> Semua IK sudah dikonfirmasi.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={thClass}>No. IK</TableHead>
                  <TableHead className={thClass}>Customer / Tujuan</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>Qty</TableHead>
                  <TableHead className={cn(thClass, "text-right")}>Umur</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.pending_iks.map((ik) => (
                  <TableRow key={ik.ik_id}>
                    <TableCell className="whitespace-nowrap">
                      <span className="block text-xs font-bold">{ik.ik_kode}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {formatDate(ik.ik_tanggal)}
                        {ik.so_no ? ` · ${ik.so_no}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48">
                      <span className="block truncate text-xs font-semibold">{ik.customer_name || "-"}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {ik.gudang_tujuan || "-"}
                        {ik.no_awb ? ` · AWB ${ik.no_awb}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{num(ik.total_qty)}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "whitespace-nowrap text-xs font-bold tabular-nums",
                          ik.age_days > 7 ? TONE.warning.text : "text-foreground",
                        )}
                      >
                        {ik.age_days} hari
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Content>
    </>
  );
}
