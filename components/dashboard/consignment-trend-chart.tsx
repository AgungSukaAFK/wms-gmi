"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type ConsignmentTrendChartProps = {
  data: {
    bulan: string;
    so: number;
    ik: number;
    qty_so: number;
    qty_ik: number;
  }[];
  /** "dokumen" = jumlah SO vs IK, "qty" = qty dipesan vs qty dikirim. */
  mode?: "dokumen" | "qty";
};

// Pasangan --chart-consignment-1/2 (bukan --chart-1/2 langsung) -- versi
// dark dari --chart-1/2 gagal cek contrast & lightness-band (validasi via
// dataviz skill's validate_palette.js), jadi dituning ulang khusus di
// app/globals.css, hue-nya tetap sama (oranye/teal) demi konsistensi visual.
const chartConfig = {
  so: { label: "SO Consignment", color: "var(--chart-consignment-1)" },
  ik: { label: "Invoice Konsinyasi (IK)", color: "var(--chart-consignment-2)" },
  qty_so: { label: "Qty Dipesan (SO)", color: "var(--chart-consignment-1)" },
  qty_ik: { label: "Qty Dikirim (IK)", color: "var(--chart-consignment-2)" },
} satisfies ChartConfig;

// Dua series independen (bukan bagian dari satu total) dibandingkan dari
// waktu ke waktu -> multi-line, bukan multi-area (area fill dicadangkan buat
// satu series; dua area yang overlap saling menutupi satu sama lain).
// Mode dokumen & qty sengaja dipisah (toggle), bukan satu chart dua sumbu.
export function ConsignmentTrendChart({
  data,
  mode = "dokumen",
}: ConsignmentTrendChartProps) {
  const keys = mode === "qty" ? (["qty_so", "qty_ik"] as const) : (["so", "ik"] as const);

  return (
    <ChartContainer config={chartConfig} className="h-72 w-full">
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ left: 0, right: 12, top: 10, bottom: 4 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bulan"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          allowDecimals={false}
          tickFormatter={(v: number) => v.toLocaleString("id-ID")}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={<ChartTooltipContent indicator="line" className="w-52" />}
        />
        <ChartLegend
          content={({ payload, verticalAlign }) => (
            <ChartLegendContent payload={payload} verticalAlign={verticalAlign} />
          )}
        />

        {keys.map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={{ r: 4, fill: `var(--color-${key})`, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)" }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
