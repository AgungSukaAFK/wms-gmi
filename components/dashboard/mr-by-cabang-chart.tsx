"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

type MrByCabangChartProps = {
  data: {
    cabang: string;
    count: number;
  }[];
};

const chartConfig = {
  count: {
    label: "Material Request",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

export function MrByCabangChart({ data }: MrByCabangChartProps) {
  return (
    <ChartContainer config={chartConfig} className="min-h-70 w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="cabang"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) => {
            const text = String(value);
            return text.length > 12 ? `${text.slice(0, 12)}...` : text;
          }}
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent className="w-44" />}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={8} />
      </BarChart>
    </ChartContainer>
  );
}
