import { getStatusTone, statusLabels } from "../utils/statusRules";

// Alcune viste (es. Lavori) salvano direttamente l'etichetta italiana invece
// della chiave di stato (es. "Critico" invece di "CRITICAL"): normalizziamo
// qui cosi' il badge riconosce entrambi i formati senza dover toccare i dati.
const labelToKey = Object.fromEntries(Object.entries(statusLabels).map(([key, label]) => [label, key]));

export default function StatusBadge({ status }) {
  const key = statusLabels[status] ? status : labelToKey[status] || status;
  const tone = getStatusTone(key);
  const label = statusLabels[key] || status;
  // "muted" (Da verificare/Concluso) non ha un --color-muted leggibile come
  // testo: quella variabile e' pensata solo come tinta di sfondo chiarissima.
  // Per il testo/pallino usiamo --color-text-muted, un grigio scuro leggibile.
  const colorVar = tone === "muted" ? "text-muted" : tone;

  return (
    <span
      className="inline-flex min-w-24 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-${colorVar}) 13%, white)`,
        color: `var(--color-${colorVar})`
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--color-${colorVar})` }} />
      {label}
    </span>
  );
}
