"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type ConsignmentLeadTimeChartProps = {
  data: { label: string; count: number }[];
};

const chartConfig = {
  count: { label: "Item SO", color: "var(--chart-consignment-2)" },
} satisfies ChartConfig;

// Distribusi lead time (histogram, satu series) -> satu warna, label nilai
// di atas tiap bar karena jumlah bucket sedikit.
export function ConsignmentLeadTimeChart({ data }: ConsignmentLeadTimeChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-56 w-full">
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ left: 4, right: 4, top: 20, bottom: 0 }}
        barCategoryGap={6}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={10}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={<ChartTooltipContent className="w-40" />}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]}>
          <LabelList
            dataKey="count"
            position="top"
            offset={6}
            className="fill-foreground"
            fontSize={11}
            fontWeight={600}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
