"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const COLORS = {
  primary: "hsl(246 62% 52%)", success: "hsl(152 55% 38%)", danger: "hsl(0 68% 52%)", warning: "hsl(32 90% 50%)",
  slate: "hsl(220 14% 70%)", teal: "hsl(190 70% 40%)",
};
const AXIS = { fontSize: 12, fill: "hsl(222 12% 42%)" };

export function NoData({ label = "No data for the current filters" }: { label?: string }) {
  return <div className="flex h-full min-h-[160px] items-center justify-center text-[13px] text-muted-foreground">{label}</div>;
}

export function StatusDonut({ data }: { data: { label: string; count: number }[] }) {
  const total = data.reduce((a, b) => a + b.count, 0);
  if (!total) return <NoData />;
  const colors = [COLORS.success, COLORS.danger];
  return (
    <div className="flex items-center gap-4" data-testid="chart-status">
      <div className="h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer><PieChart><Pie data={data} dataKey="count" nameKey="label" innerRadius={52} outerRadius={80} paddingAngle={2} strokeWidth={0}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
      </div>
      <ul className="space-y-2 text-[13px]">{data.map((d, i) => (
        <li key={d.label} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: colors[i % colors.length] }} />{d.label}
          <span className="tabular ml-1 font-medium">{d.count.toLocaleString()}</span><span className="text-muted-foreground">({((d.count / total) * 100).toFixed(1)}%)</span></li>))}</ul>
    </div>
  );
}

export function HBar({ data, color = COLORS.primary, testId }: { data: { label: string; count: number }[]; color?: string; testId: string }) {
  if (!data.length || data.every((d) => d.count === 0)) return <NoData />;
  return (
    <div data-testid={testId}>
      <div style={{ height: Math.max(150, data.length * 42) }}>
        <ResponsiveContainer><BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke="hsl(220 16% 92%)" />
          <XAxis type="number" tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={AXIS} width={130} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "hsl(220 18% 96%)" }} />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} barSize={18} /></BarChart></ResponsiveContainer>
      </div>
      <ul className="sr-only">{data.map((d) => <li key={d.label}>{d.label}: {d.count}</li>)}</ul>
    </div>
  );
}

export function Timeline({ data }: { data: { date: string; sent: number; opens: number; clicks: number; bounced: number }[] }) {
  if (!data.length) return <NoData />;
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="h-[240px]" data-testid="chart-timeline">
      <ResponsiveContainer><LineChart data={data} margin={{ left: 0, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} stroke="hsl(220 16% 92%)" />
        <XAxis dataKey="date" tickFormatter={fmt} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} width={36} />
        <Tooltip labelFormatter={(l) => fmt(String(l))} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Line type="linear" dataKey="sent" name="Sent" stroke={COLORS.slate} strokeWidth={2} dot={{ r: 3 }} />
        <Line type="linear" dataKey="bounced" name="Bounced" stroke={COLORS.danger} strokeWidth={2} dot={{ r: 3 }} />
        <Line type="linear" dataKey="opens" name="Opens" stroke={COLORS.primary} strokeWidth={2} dot={{ r: 3 }} />
        <Line type="linear" dataKey="clicks" name="Clicks" stroke={COLORS.success} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart></ResponsiveContainer>
    </div>
  );
}

export function EngagementBars({ delivered, opens, clicks }: { delivered: number; opens: number; clicks: number }) {
  if (!delivered) return <NoData label="No delivered emails" />;
  const data = [{ label: "Delivered", count: delivered }, { label: "Opened", count: opens }, { label: "Clicked", count: clicks }];
  const cols = [COLORS.slate, COLORS.primary, COLORS.success];
  return (
    <div className="h-[200px]" data-testid="chart-engagement">
      <ResponsiveContainer><BarChart data={data} margin={{ top: 8, right: 8 }}>
        <CartesianGrid vertical={false} stroke="hsl(220 16% 92%)" />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} /><YAxis tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} width={36} />
        <Tooltip cursor={{ fill: "hsl(220 18% 96%)" }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={44}>{data.map((_, i) => <Cell key={i} fill={cols[i]} />)}</Bar></BarChart></ResponsiveContainer>
    </div>
  );
}
