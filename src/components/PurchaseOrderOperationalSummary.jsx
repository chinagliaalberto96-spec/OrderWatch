import { AlertTriangle, CheckCircle2, ClipboardCheck, Info } from "lucide-react";
import StatusBadge from "./StatusBadge";
import {
  buildPurchaseOrderOperationalSummary,
  canViewPurchaseOrderQualitySummary
} from "../utils/purchaseOrderOperationalSummary";

export {
  createPurchaseOrderQualityRequestCoordinator,
  initialPurchaseOrderQualityState,
  loadPurchaseOrderQualityContract,
  purchaseOrderQualityReducer
} from "../hooks/usePurchaseOrderQualityContract";

function formatGeneratedAt(value) {
  if (!value) return "Non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non disponibile";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

const QUALITY_TONES = Object.freeze({
  unavailable: "var(--color-text-muted)",
  not_evaluated: "var(--color-text-muted)",
  incomplete_evidence: "var(--color-warning)",
  open_findings: "var(--color-warning)",
  complete: "var(--color-success)"
});

const FINDING_TONES = Object.freeze({
  critical: "var(--color-danger)",
  warning: "var(--color-warning)",
  info: "var(--color-text-muted)"
});

export function PurchaseOrderOperationalSummaryContent({
  state,
  businessStatus
}) {
  if (state.status === "loading" || state.status === "idle") {
    return (
      <section aria-label="Sintesi operativa dell'ordine di acquisto" className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="text-sm font-semibold">Sintesi operativa dell'ordine di acquisto</h2>
        <p role="status" className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Caricamento valutazione qualità...
        </p>
      </section>
    );
  }

  const obtainable = state.status === "loaded" && Boolean(state.qualityContract);
  const model = buildPurchaseOrderOperationalSummary({
    businessStatus,
    qualityContract: state.qualityContract,
    qualityEvaluationObtainable: obtainable
  });

  return (
    <section
      aria-label="Sintesi operativa dell'ordine di acquisto"
      className="rounded-md border p-3"
      style={{ borderColor: "var(--color-border)", backgroundColor: "color-mix(in srgb, var(--color-primary) 2%, white)" }}
    >
      <div className="flex items-start gap-2">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--color-primary)" }} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Sintesi operativa dell'ordine di acquisto</h2>
          <p className="mt-1 text-sm font-semibold">{model.situationLabel}</p>
          <p className="mt-1 text-xs leading-5" style={{ color: "var(--color-text-muted)" }}>
            {model.situationCopy}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={businessStatus} />
        <span
          className="inline-flex min-h-7 items-center rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            color: QUALITY_TONES[model.dataQualityStatus] || QUALITY_TONES.unavailable,
            backgroundColor: `color-mix(in srgb, ${QUALITY_TONES[model.dataQualityStatus] || QUALITY_TONES.unavailable} 10%, white)`
          }}
        >
          Qualità dati: {model.dataQualityLabel}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--color-border)" }}>
          <dt className="font-semibold" style={{ color: "var(--color-text-muted)" }}>Copertura evidenze</dt>
          <dd className="mt-1">{model.evidenceCoverage}</dd>
        </div>
        <div className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--color-border)" }}>
          <dt className="font-semibold" style={{ color: "var(--color-text-muted)" }}>Valutazione generata</dt>
          <dd className="mt-1">{formatGeneratedAt(model.generatedAt)}</dd>
        </div>
      </dl>

      <details className="mt-3 border-t pt-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
        <summary className="cursor-pointer text-xs font-semibold">Apri dettaglio sintetico</summary>
        <div className="mt-3 space-y-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
              Cosa verificare
            </h3>
            {model.findings.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {model.findings.map((finding) => (
                  <li key={finding.key} className="flex gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: FINDING_TONES[finding.severity] || FINDING_TONES.info }} />
                    <span>
                      <span className="font-semibold">{finding.label}</span>
                      {finding.description && <span style={{ color: "var(--color-text-muted)" }}> · {finding.description}</span>}
                    </span>
                  </li>
                ))}
                {model.remainingFindingCount > 0 && (
                  <li className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
                    +{model.remainingFindingCount} altre
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-2 flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Nessuna segnalazione specifica dell'ordine tra le sezioni valutate.
              </p>
            )}
          </div>

          {model.sectionNotEvaluatedCount > 0 && (
            <p className="flex items-start gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {model.sectionNotEvaluatedCount} {model.sectionNotEvaluatedCount === 1 ? "sezione non valutata" : "sezioni non valutate"} con le fonti disponibili.
            </p>
          )}

          {model.organizationFindingCount > 0 && (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {model.organizationFindingCount} {model.organizationFindingCount === 1 ? "segnalazione riguarda" : "segnalazioni riguardano"} l'organizzazione nel suo complesso e non questo ordine specifico.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

export default function PurchaseOrderOperationalSummary({
  businessStatus,
  userRole,
  qualityState
}) {
  if (
    !canViewPurchaseOrderQualitySummary(userRole)
    || !qualityState
  ) {
    return null;
  }

  return <PurchaseOrderOperationalSummaryContent state={qualityState} businessStatus={businessStatus} />;
}
