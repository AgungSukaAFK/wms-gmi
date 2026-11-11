"use client";

// Tren jumlah dokumen (MR, PR, PO, RI) dari tanggal dokumen. Server mengirim
// hitungan harian (hanya tanggal yang ada datanya); pengelompokan harian /
// mingguan / bulanan dilakukan di sini supaya ganti tampilan tidak perlu
// request ulang.
//
// Warna = --chart-dash-1..4 dengan urutan tetap per seri (tidak berubah saat
// seri disembunyikan). Kuning/hijau kontrasnya rendah di tema terang, jadi
// legend selalu menampilkan total dan ada tampilan tabel.

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartLine, Table2 } from "lucide-react";
import { EmptyNote, num } from "@/components/dashboard/main/primitives";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDays, diffDays, formatYmdShort } from "@/lib/dashboard/filters";
import type { TrendPoint } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

const SERIES = [
  { key: "mr", label: "Material Request", short: "MR", color: "var(--chart-dash-1)", swatch: "bg-chart-dash-1" },
  { key: "pr", label: "Purchase Request", short: "PR", color: "var(--chart-dash-2)", swatch: "bg-chart-dash-2" },
  { key: "po", label: "Purchase Order", short: "PO", color: "var(--chart-dash-3)", swatch: "bg-chart-dash-3" },
  { key: "ri", label: "Receive Item", short: "RI", color: "var(--chart-dash-4)", swatch: "bg-chart-dash-4" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];
type Granularity = "hari" | "minggu" | "bulan";
type Bucket = { key: string; label: string; mr: number; pr: number; po: number; ri: number };

const chartConfig = Object.fromEntries(
  SERIES.map((s) => [s.key, { label: s.label, color: s.color }]),
) satisfies ChartConfig;

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Senin dari minggu tanggal ini. */
function weekStart(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Minggu
  return addDays(ymd, -((dow + 6) % 7));
}

function bucketKey(ymd: string, g: Granularity) {
  if (g === "hari") return ymd;
  if (g === "minggu") return weekStart(ymd);
  return ymd.slice(0, 7);
}

function bucketLabel(key: string, g: Granularity) {
  if (g === "bulan") {
    const [y, m] = key.split("-");
    return `${BULAN[Number(m) - 1]} ${y.slice(2)}`;
  }
  return formatYmdShort(key, false);
}

function buildBuckets(points: TrendPoint[], from: string, to: string, g: Granularity): Bucket[] {
  const map = new Map<string, Bucket>();
  // Isi semua bucket di rentang (termasuk yang kosong) supaya sumbu waktu rata.
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const key = bucketKey(day, g);
    if (!map.has(key)) map.set(key, { key, label: bucketLabel(key, g), mr: 0, pr: 0, po: 0, ri: 0 });
  }
  for (const p of points) {
    if (p.d < from || p.d > to) continue;
    const bucket = map.get(bucketKey(p.d, g));
    if (!bucket) continue;
    bucket.mr += p.mr;
    bucket.pr += p.pr;
    bucket.po += p.po;
    bucket.ri += p.ri;
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function TrendChart({
  points,
  from,
  to,
}: {
  points: TrendPoint[];
  from: string;
  to: string;
}) {
  const span = diffDays(to, from) + 1;
  const autoGranularity: Granularity = span <= 45 ? "hari" : span <= 200 ? "minggu" : "bulan";
  const [chosen, setChosen] = useState<Granularity | null>(null);
  // Pilihan user dipakai selama masih masuk akal untuk rentangnya (harian
  // untuk setahun = 365 titik, tidak terbaca).
  const granularity: Granularity =
    chosen && !(chosen === "hari" && span > 120) ? chosen : autoGranularity;
  const [hidden, setHidden] = useState<SeriesKey[]>([]);
  const [view, setView] = useState<"chart" | "table">("chart");

  const buckets = useMemo(
    () => buildBuckets(points, from, to, granularity),
    [points, from, to, granularity],
  );
  const totals = useMemo(
    () =>
      Object.fromEntries(
        SERIES.map((s) => [s.key, buckets.reduce((sum, b) => sum + b[s.key], 0)]),
      ) as Record<SeriesKey, number>,
    [buckets],
  );
  const grandTotal = SERIES.reduce((sum, s) => sum + totals[s.key], 0);
  const visible = SERIES.filter((s) => !hidden.includes(s.key));

  const toggle = (key: SeriesKey) =>
    setHidden((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // Minimal satu seri tetap tampil.
      return prev.length >= SERIES.length - 1 ? prev : [...prev, key];
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={granularity} onValueChange={(v) => setChosen(v as Granularity)}>
          <TabsList className="h-8">
            <TabsTrigger value="hari" disabled={span > 120} className="px-2.5 text-xs">
              Harian
            </TabsTrigger>
            <TabsTrigger value="minggu" className="px-2.5 text-xs">
              Mingguan
            </TabsTrigger>
            <TabsTrigger value="bulan" className="px-2.5 text-xs">
              Bulanan
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}
        >
          {view === "chart" ? <Table2 /> : <ChartLine />}
          {view === "chart" ? "Lihat tabel" : "Lihat grafik"}
        </Button>
      </div>

      {/* Legend = tombol tampil/sembunyi seri, sekaligus total tiap seri. */}
      <ul className="flex flex-wrap gap-1.5">
        {SERIES.map((s) => {
          const off = hidden.includes(s.key);
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => toggle(s.key)}
                aria-pressed={!off}
                title={off ? `Tampilkan ${s.label}` : `Sembunyikan ${s.label}`}
                className={cn(
                  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  off && "opacity-50",
                )}
              >
                <span className={cn("h-0.5 w-3 rounded-full", s.swatch)} />
                <span className="text-muted-foreground">{s.short}</span>
                <span className="font-semibold tabular-nums">{num(totals[s.key])}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {grandTotal === 0 ? (
        <EmptyNote>Tidak ada dokumen pada rentang ini.</EmptyNote>
      ) : view === "chart" ? (
        <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
          <LineChart accessibilityLayer data={buckets} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
              tickFormatter={(v: number) => v.toLocaleString("id-ID")}
            />
            <ChartTooltip
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={<ChartTooltipContent indicator="line" className="w-48" />}
            />
            {visible.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                type="monotone"
                stroke={`var(--color-${s.key})`}
                strokeWidth={2}
                strokeLinecap="round"
                dot={
                  buckets.length <= 16
                    ? { r: 3, fill: `var(--color-${s.key})`, strokeWidth: 0 }
                    : false
                }
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      ) : (
        <div className="max-h-64 overflow-auto rounded-md border">
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 bg-muted">
              <TableRow>
                <TableHead className="h-9">
                  {granularity === "hari" ? "Tanggal" : granularity === "minggu" ? "Minggu mulai" : "Bulan"}
                </TableHead>
                {SERIES.map((s) => (
                  <TableHead key={s.key} className="h-9 text-right">
                    {s.short}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b) => (
                <TableRow key={b.key}>
                  <TableCell className="py-1.5 text-sm">{b.label}</TableCell>
                  {SERIES.map((s) => (
                    <TableCell key={s.key} className="py-1.5 text-right text-sm tabular-nums">
                      {num(b[s.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="sticky bottom-0 bg-muted">
              <TableRow>
                <TableCell className="py-1.5 text-sm">Total</TableCell>
                {SERIES.map((s) => (
                  <TableCell key={s.key} className="py-1.5 text-right text-sm tabular-nums">
                    {num(totals[s.key])}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
