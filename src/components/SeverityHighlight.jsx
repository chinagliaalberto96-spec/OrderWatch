// Stesso linguaggio visivo del componente Highlight di AlteraView: da usare
// ovunque serva dare peso immediato a un dato senza dover leggere il testo.
const SEVERITY_COLORS = {
  critical: ["#FFF1F0", "var(--color-danger)"],
  warning: ["#FFF8E8", "#9A6700"],
  success: ["#ECF8F1", "var(--color-success)"],
  info: ["var(--color-muted)", "var(--color-text)"]
};

export default function SeverityHighlight({ label, value, severity = "info" }) {
  const [backgroundColor, color] = SEVERITY_COLORS[severity] || SEVERITY_COLORS.info;
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor, color }}>
      <div className="text-[11px] font-semibold uppercase">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
