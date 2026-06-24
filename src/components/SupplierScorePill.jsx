export default function SupplierScorePill({ score }) {
  // Fornitori senza ancora uno storico misurato (pilota appena avviato) mostrano
  // "N/D" invece di un punteggio inventato: non avendo dati su ritardi storici per
  // i fornitori di Graphic Center, evitiamo di mostrare un numero non verificato.
  if (score === null || score === undefined) {
    return (
      <span
        className="inline-flex min-w-14 justify-center rounded-full px-2 py-1 text-xs font-semibold"
        style={{
          backgroundColor: "var(--color-muted)",
          color: "var(--color-text-muted)"
        }}
      >
        N/D
      </span>
    );
  }

  const tone = score >= 80 ? "success" : score >= 65 ? "warning" : "danger";

  return (
    <span
      className="inline-flex min-w-14 justify-center rounded-full px-2 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-${tone}) 12%, white)`,
        color: `var(--color-${tone})`
      }}
    >
      {score}/100
    </span>
  );
}
