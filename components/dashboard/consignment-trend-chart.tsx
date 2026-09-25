"use client";

import { CartesianGrid, Line, LineChart, XAxis } from "recharts";
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
  }[];
};

// Pasangan --chart-consignment-1/2 (bukan --chart-1/2 langsung) -- versi
// dark dari --chart-1/2 gagal cek contrast & lightness-band (validasi via
// dataviz skill's validate_palette.js), jadi dituning ulang khusus di
// app/globals.css, hue-nya tetap sama (oranye/teal) demi konsistensi visual.
const chartConfig = {
  so: {
    label: "SO Consignment",
    color: "var(--chart-consignment-1)",
  },
  ik: {
    label: "Item Konsinyasi (IK)",
    color: "var(--chart-consignment-2)",
  },
} satisfies ChartConfig;

// Dua series independen (bukan bagian dari satu total) dibandingkan dari
// waktu ke waktu -> multi-line, bukan multi-area (area fill dicadangkan buat
// satu series; dua area yang overlap saling menutupi satu sama lain).
export function ConsignmentTrendChart({ data }: ConsignmentTrendChartProps) {
  return (
    <ChartContainer config={chartConfig} className="min-h-70 w-full">
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ left: 12, right: 12, top: 10, bottom: 4 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bulan"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="line" className="w-48" />}
        />
        <ChartLegend
          content={({ payload, verticalAlign }) => (
            <ChartLegendContent payload={payload} verticalAlign={verticalAlign} />
          )}
        />

        <Line
          dataKey="so"
          type="monotone"
          stroke="var(--color-so)"
          strokeWidth={2}
          dot={{ r: 4, fill: "var(--color-so)", strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)" }}
        />
        <Line
          dataKey="ik"
          type="monotone"
          stroke="var(--color-ik)"
          strokeWidth={2}
          dot={{ r: 4, fill: "var(--color-ik)", strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--background)" }}
        />
      </LineChart>
    </ChartContainer>
  );
}
