"use client";

// Chart conventions: single series → no legend (the card title names it); thin 2px lines,
// bars ≤ 24px with 4px rounded data-ends; hairline solid grid; tooltip on hover; text stays in text tokens.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompact, formatDate, formatMoney } from "@/lib/format";

export function CollectionBarChart({
  data,
  label,
}: {
  data: { label: string; month: string; collected: number }[];
  label: string;
}) {
  const config = { collected: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatCompact(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent formatter={(value) => <span className="font-medium tabular">{formatMoney(Number(value))}</span>} />}
        />
        <Bar dataKey="collected" fill="var(--color-collected)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  );
}

/** Two series (billed, collected) → legend always shown; 2px gap between adjacent bars. */
export function BilledCollectedChart({
  data,
  labels,
}: {
  data: { label: string; billed: number; collected: number }[];
  labels: { billed: string; collected: string };
}) {
  const config = {
    billed: { label: labels.billed, color: "var(--chart-1)" },
    collected: { label: labels.collected, color: "var(--chart-2)" },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => formatCompact(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={<ChartTooltipContent formatter={(value, name) => (
            <span className="flex w-full justify-between gap-4">
              <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
              <span className="font-medium tabular">{formatMoney(Number(value))}</span>
            </span>
          )} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="billed" fill="var(--color-billed)" radius={[4, 4, 0, 0]} maxBarSize={20} />
        <Bar dataKey="collected" fill="var(--color-collected)" radius={[4, 4, 0, 0]} maxBarSize={20} />
      </BarChart>
    </ChartContainer>
  );
}

export function RateTrendChart({ data, label }: { data: { date: string; rate: number }[]; label: string }) {
  const config = { rate: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  const min = Math.max(0, Math.floor(Math.min(...data.map((d) => d.rate), 100) / 5) * 5 - 5);
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(d: string) => formatDate(d).slice(0, 6)} />
        <YAxis domain={[min, 100]} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}%`} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => (payload?.[0]?.payload?.date ? formatDate(payload[0].payload.date) : "")}
              formatter={(value) => <span className="font-medium tabular">{Number(value).toFixed(1)}%</span>}
            />
          }
        />
        <Area
          dataKey="rate"
          type="monotone"
          stroke="var(--color-rate)"
          strokeWidth={2}
          fill="var(--color-rate)"
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
