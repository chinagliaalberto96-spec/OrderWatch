import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell } from "recharts";
import Card from "./Card";

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div
      className="rounded-md border px-3 py-2 text-[13px] shadow-elevated"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)", color: "var(--color-text)" }}
    >
      <span className="font-semibold">{point.name}</span>: {point.value}
    </div>
  );
}

export default function ChartCard({ title, data, insight }) {
  return (
    <Card title={title}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-muted)" }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={`var(--color-${entry.tone || "primary"})`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {insight && (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-accent)" }} />
          {insight}
        </div>
      )}
    </Card>
  );
}
