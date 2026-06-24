import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Cell } from "recharts";
import Card from "./Card";

const fallbackColors = {
  danger: "#DC2626",
  critical: "#C85B24",
  warning: "#F59E0B",
  success: "#16A34A",
  muted: "#6B7280",
  primary: "#17213C"
};

export default function ChartCard({ title, data, insight }) {
  return (
    <Card title={title}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
            <Tooltip />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={fallbackColors[entry.tone] || fallbackColors.primary} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {insight && (
        <div className="mt-3 rounded-md border px-3 py-2 text-[13px]" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}>
          {insight}
        </div>
      )}
    </Card>
  );
}
