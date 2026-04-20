"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type DocumentTrendChartProps = {
  data: {
    bulan: string;
    mr: number;
    pr: number;
    po: number;
  }[];
};

const chartConfig = {
  mr: {
    label: "Material Request",
    color: "var(--chart-1)",
  },
  pr: {
    label: "Purchase Request",
    color: "var(--chart-2)",
  },
  po: {
    label: "Purchase Order",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export function DocumentTrendChart({ data }: DocumentTrendChartProps) {
  return (
    <ChartContainer config={chartConfig} className="min-h-70 w-full">
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ left: 12, right: 12, top: 10, bottom: 4 }}
      >
        <defs>
          <linearGradient id="fillMr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-mr)" stopOpacity={0.45} />
            <stop offset="95%" stopColor="var(--color-mr)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="fillPr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-pr)" stopOpacity={0.45} />
            <stop offset="95%" stopColor="var(--color-pr)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="fillPo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-po)" stopOpacity={0.45} />
            <stop offset="95%" stopColor="var(--color-po)" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bulan"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => String(value).slice(0, 3)}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent indicator="line" className="w-44" />}
        />

        <Area
          dataKey="mr"
          type="monotone"
          fill="url(#fillMr)"
          fillOpacity={1}
          stroke="var(--color-mr)"
          strokeWidth={2}
        />
        <Area
          dataKey="pr"
          type="monotone"
          fill="url(#fillPr)"
          fillOpacity={1}
          stroke="var(--color-pr)"
          strokeWidth={2}
        />
        <Area
          dataKey="po"
          type="monotone"
          fill="url(#fillPo)"
          fillOpacity={1}
          stroke="var(--color-po)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
