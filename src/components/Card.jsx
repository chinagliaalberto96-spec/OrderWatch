export default function Card({ title, action, children, className = "" }) {
  return (
    <section
      className={`rounded-lg border bg-white shadow-soft ${className}`}
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-card)" }}
    >
      {(title || action) && (
        <div className="flex min-h-12 items-center justify-between border-b px-5" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--color-text)" }}>
            {title}
          </h2>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
