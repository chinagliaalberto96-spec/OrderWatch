import { getStatusTone, statusLabels } from "../utils/statusRules";

// Alcune viste (es. Lavori) salvano direttamente l'etichetta italiana invece
// della chiave di stato (es. "Critico" invece di "CRITICAL"): normalizziamo
// qui cosi' il badge riconosce entrambi i formati senza dover toccare i dati.
const labelToKey = Object.fromEntries(Object.entries(statusLabels).map(([key, label]) => [label, key]));

export default function StatusBadge({ status }) {
  const key = statusLabels[status] ? status : labelToKey[status] || status;
  const tone = getStatusTone(key);
  const label = statusLabels[key] || status;

  return (
    <span
      className="inline-flex min-w-24 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-${tone}) 13%, white)`,
        color: `var(--color-${tone})`
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--color-${tone})` }} />
      {label}
    </span>
  );
}
