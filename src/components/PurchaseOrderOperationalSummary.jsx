import { useEffect, useReducer, useRef } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info } from "lucide-react";
import StatusBadge from "./StatusBadge";
import {
  buildPurchaseOrderOperationalSummary,
  canViewPurchaseOrderQualitySummary,
  extractSingleOrderQualityContract
} from "../utils/purchaseOrderOperationalSummary";

export const initialPurchaseOrderQualityState = Object.freeze({
  status: "idle",
  qualityContract: null,
  error: null
});

export function purchaseOrderQualityReducer(state, action) {
  switch (action.type) {
    case "LOAD_START":
      return { status: "loading", qualityContract: null, error: null };
    case "LOAD_SUCCESS":
      return { status: "loaded", qualityContract: action.qualityContract, error: null };
    case "LOAD_UNAVAILABLE":
      return { status: "unavailable", qualityContract: null, error: null };
    case "LOAD_ERROR":
      return { status: "error", qualityContract: null, error: action.message || null };
    default:
      return state;
  }
}

// Coalesces the development StrictMode double-effect into one HTTP request.
// A real order change still releases and aborts the old request; consumers
// additionally use a monotonically increasing token so a late response can
// never update the newly opened order.
export function createPurchaseOrderQualityRequestCoordinator(fetchQualityContract) {
  const entries = new Map();

  function acquire(orderId) {
    let entry = entries.get(orderId);
    if (!entry) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      entry = {
        controller,
        consumers: 0,
        cleanupTimer: null,
        settled: false,
        promise: Promise.resolve().then(() => fetchQualityContract({
          orderId,
          signal: controller?.signal
        }))
      };
      entry.promise.finally(() => {
        entry.settled = true;
      }).catch(() => {});
      entries.set(orderId, entry);
    }

    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = null;
    }
    entry.consumers += 1;
    let released = false;

    return {
      promise: entry.promise,
      release() {
        if (released) return;
        released = true;
        entry.consumers = Math.max(0, entry.consumers - 1);
        if (entry.consumers > 0) return;
        entry.cleanupTimer = setTimeout(() => {
          if (entry.consumers > 0) return;
          if (!entry.settled) entry.controller?.abort();
          entries.delete(orderId);
        }, 0);
      }
    };
  }

  return { acquire };
}

export async function loadPurchaseOrderQualityContract({
  orderId,
  requestPromise,
  dispatch,
  tokenRef,
  myToken
}) {
  try {
    const contract = await requestPromise;
    if (tokenRef.current !== myToken) return;
    const qualityContract = extractSingleOrderQualityContract(contract, orderId);
    dispatch(qualityContract
      ? { type: "LOAD_SUCCESS", qualityContract }
      : { type: "LOAD_UNAVAILABLE" });
  } catch (error) {
    if (error?.name === "AbortError" || tokenRef.current !== myToken) return;
    dispatch({
      type: "LOAD_ERROR",
      message: "La valutazione qualità non è disponibile per questo ordine."
    });
  }
}

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

          {model.recommendedActions.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                Azioni già indicate dalle segnalazioni
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                {model.recommendedActions.map((action) => <li key={action}>{action}</li>)}
              </ul>
            </div>
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

function AuthorizedPurchaseOrderOperationalSummary({
  orderId,
  businessStatus,
  fetchQualityContract
}) {
  const [state, dispatch] = useReducer(purchaseOrderQualityReducer, initialPurchaseOrderQualityState);
  const tokenRef = useRef(0);
  const coordinatorRef = useRef(null);

  if (!coordinatorRef.current || coordinatorRef.current.fetchFn !== fetchQualityContract) {
    coordinatorRef.current = {
      fetchFn: fetchQualityContract,
      coordinator: createPurchaseOrderQualityRequestCoordinator(fetchQualityContract)
    };
  }

  useEffect(() => {
    const myToken = ++tokenRef.current;
    const lease = coordinatorRef.current.coordinator.acquire(orderId);
    dispatch({ type: "LOAD_START" });
    loadPurchaseOrderQualityContract({
      orderId,
      requestPromise: lease.promise,
      dispatch,
      tokenRef,
      myToken
    });
    return () => {
      tokenRef.current += 1;
      lease.release();
    };
  }, [orderId, fetchQualityContract]);

  return <PurchaseOrderOperationalSummaryContent state={state} businessStatus={businessStatus} />;
}

export default function PurchaseOrderOperationalSummary({
  orderId,
  businessStatus,
  userRole,
  fetchQualityContract
}) {
  if (
    !canViewPurchaseOrderQualitySummary(userRole)
    || typeof fetchQualityContract !== "function"
    || typeof orderId !== "string"
    || !orderId
  ) {
    return null;
  }

  return (
    <AuthorizedPurchaseOrderOperationalSummary
      orderId={orderId}
      businessStatus={businessStatus}
      fetchQualityContract={fetchQualityContract}
    />
  );
}
