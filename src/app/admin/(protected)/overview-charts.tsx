"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

export type OverviewSeries = {
  dailyUsage: Array<{ date: string; label: string; count: number }>;
  usageByAction: Array<{ action: string; count: number }>;
  dailyJobs: Array<{ date: string; label: string; succeeded: number; failed: number }>;
};

// Semantic colors aligned with the existing StatusPill palette (emerald/blue/amber/red).
const usageConfig = {
  ask_tutor: { label: "导师问答", color: "hsl(217 91% 60%)" },
  generate_chapter: { label: "生成章节", color: "hsl(160 84% 39%)" },
  revise: { label: "局部改写", color: "hsl(258 90% 66%)" },
  export: { label: "导出", color: "hsl(38 92% 50%)" },
  create_course: { label: "创建课程", color: "hsl(330 81% 60%)" },
} satisfies ChartConfig;

const trendConfig = {
  count: { label: "用量事件", color: "hsl(217 91% 60%)" },
} satisfies ChartConfig;

const jobConfig = {
  succeeded: { label: "成功", color: "hsl(160 84% 39%)" },
  failed: { label: "失败", color: "hsl(0 84% 60%)" },
} satisfies ChartConfig;

export function OverviewCharts({ series }: { series: OverviewSeries }) {
  const usageTotal = series.usageByAction.reduce((total, item) => total + item.count, 0);
  const mix = [...series.usageByAction].sort((a, b) => b.count - a.count);

  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="活跃趋势" subtitle="近 14 天用量事件" className="lg:col-span-2">
          <ChartContainer config={trendConfig} className="h-[160px] w-full">
            <AreaChart data={series.dailyUsage} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={20} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelKey="label" />} />
              <Area
                dataKey="count"
                type="monotone"
                stroke="var(--color-count)"
                fill="var(--color-count)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </ChartCard>

        <ChartCard title="用量构成" subtitle="按动作占比">
          {usageTotal > 0 ? (
            <>
              <ChartContainer config={usageConfig} className="mx-auto aspect-square h-[140px]">
                <PieChart>
                  <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="action" hideLabel />} />
                  <Pie data={mix} dataKey="count" nameKey="action" innerRadius={40} outerRadius={64} strokeWidth={2}>
                    {mix.map((item) => (
                      <Cell key={item.action} fill={`var(--color-${item.action})`} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                {mix.map((item) => (
                  <span key={item.action} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-[2px]" style={{ background: `var(--color-${item.action})` }} />
                    {usageConfig[item.action as keyof typeof usageConfig]?.label ?? item.action}
                    <span className="text-foreground">{Math.round((item.count / usageTotal) * 100)}%</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <EmptyChart text="近 14 天暂无用量记录" />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="任务健康"
        subtitle="近 14 天成功 / 失败"
        legend={
          <div className="flex gap-3 text-xs text-muted-foreground">
            <Legend color="var(--color-succeeded)" label="成功" />
            <Legend color="var(--color-failed)" label="失败" />
          </div>
        }
      >
        <ChartContainer config={jobConfig} className="h-[160px] w-full">
          <BarChart data={series.dailyJobs} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={20} />
            <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
            <Bar dataKey="succeeded" stackId="jobs" fill="var(--color-succeeded)" />
            <Bar dataKey="failed" stackId="jobs" fill="var(--color-failed)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </ChartCard>
    </section>
  );
}

function ChartCard({
  title,
  subtitle,
  legend,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  legend?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-border bg-card p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {legend}
      </div>
      {children}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="flex h-[140px] items-center justify-center text-xs text-muted-foreground">{text}</div>;
}
