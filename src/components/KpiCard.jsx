export default function KpiCard({ label, value, hint, tone = "primary", icon: Icon }) {
  return (
    <div
      className="relative overflow-hidden rounded-lg border bg-white p-5 shadow-soft transition hover:shadow-elevated"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.07]"
        style={{ backgroundColor: `var(--color-${tone})` }}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
          {label}
        </div>
        {Icon && (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, var(--color-${tone}) 14%, white)` }}
          >
            <Icon className="h-4 w-4" style={{ color: `var(--color-${tone})` }} />
          </div>
        )}
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
