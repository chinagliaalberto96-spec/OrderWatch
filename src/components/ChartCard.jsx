import Card from "./Card";

export default function ChartCard({ title, data, insight, onInsightClick }) {
  const maxValue = Math.max(...data.map((item) => item.value), 1);

  return (
    <Card title={title}>
      <div className="grid h-52 grid-cols-5 items-end gap-3 border-b px-1 pb-7" style={{ borderColor: "var(--color-border)" }}>
        {data.map((entry) => {
          const height = `${Math.max((entry.value / maxValue) * 100, entry.value ? 12 : 2)}%`;
          return (
            <div key={entry.name} className="relative flex h-full min-w-0 flex-col items-center justify-end gap-2">
              <div
                className="w-full max-w-12 rounded-t-md"
                title={`${entry.name}: ${entry.value}`}
                style={{
                  height,
                  backgroundColor: `var(--color-${entry.tone || "primary"})`
                }}
              />
              <div className="absolute -bottom-7 max-w-full truncate text-center text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                {entry.name}
              </div>
              <div className="text-xs font-semibold">{entry.value}</div>
            </div>
          );
        })}
      </div>
      {insight &&
        (onInsightClick ? (
          <button
            type="button"
            onClick={onInsightClick}
            className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] transition hover:shadow-soft"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)", color: "var(--color-text)" }}
            title="Apri l'ordine prioritario"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-accent)" }} />
            {insight}
          </button>
        ) : (
          <div
            className="mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)", color: "var(--color-text-muted)" }}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-accent)" }} />
            {insight}
          </div>
        ))}
    </Card>
  );
}
