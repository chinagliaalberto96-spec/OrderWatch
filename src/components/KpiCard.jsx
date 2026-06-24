export default function KpiCard({ label, value, hint, tone = "primary" }) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-soft" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
          {label}
        </div>
        <div className="h-8 w-1 rounded-full" style={{ backgroundColor: `var(--color-${tone})` }} />
      </div>
      <div className="mt-3">
        <div className="text-[36px] font-semibold leading-none" style={{ color: "var(--color-text)" }}>
          {value}
        </div>
        {hint && (
          <div className="mt-2 text-[13px] leading-5" style={{ color: "var(--color-text-muted)" }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
