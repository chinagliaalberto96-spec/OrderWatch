import { useEffect, useReducer, useRef } from "react";
import { ClipboardList, Link2, FileWarning, SplitSquareHorizontal, ListChecks } from "lucide-react";
import Card from "../components/Card";
import KpiCard from "../components/KpiCard";
import DataTable from "../components/DataTable";
import EmptyState from "../components/EmptyState";

// Pilot Data Quality dashboard — read-only visualization of the stable
// dataQualityContract produced by scripts/lib/dataQualityContract.mjs,
// served live by server/routes/pilot-quality-contract.js.
//
// This view exists to answer one question only: "how complete, traceable
// and internally consistent are OrderWatch's own observations for this
// sample of orders?" It must never be read as, and never renders anything
// resembling:
//   - an extraction accuracy or AI confidence percentage;
//   - a supplier performance/quality score;
//   - a verdict on whether an order itself is "correct".
// Every number here is a direct, already-computed structural count or ratio
// from the contract — nothing is computed or inferred in this component
// beyond dividing an already-supplied {covered,total} pair into a percentage
// for display (the exact same null-safe rule the contract itself uses: a
// zero/undetermined denominator renders as "Non disponibile", never 0%).

/* ============================================================
 * Pure state machine — no React, no fetch. Directly testable.
 * Mirrors src/components/OrderOperationalView.jsx's own pattern.
 * ============================================================ */

export const initialPilotQualityContractState = { status: "idle", loading: false, error: null, errorStatus: null, contract: null };

export function pilotQualityContractReducer(state, action) {
  switch (action.type) {
    case "RESET":
      return initialPilotQualityContractState;
    case "LOAD_START":
      return { status: "loading", loading: true, error: null, errorStatus: null, contract: null };
    case "LOAD_SUCCESS":
      return { status: "loaded", loading: false, error: null, errorStatus: null, contract: action.contract };
    case "LOAD_ERROR":
      return { status: "error", loading: false, error: action.message, errorStatus: action.status ?? null, contract: null };
    default:
      return state;
  }
}

// Real fetch orchestration, extracted so it is directly testable in plain
// Node without mounting a DOM — same shape as loadOrderOperationalView().
// `fetchFn` must be the app's shared authenticated request path
// (adapter.getPilotQualityContract, threaded down from App.jsx), never a
// locally re-created client.
export async function loadPilotQualityContract({ fetchFn, signal, dispatch, tokenRef, myToken }) {
  try {
    const contract = await fetchFn({ signal });
    if (tokenRef.current !== myToken) return; // stale: a newer load or unmount happened
    dispatch({ type: "LOAD_SUCCESS", contract });
  } catch (err) {
    if (err?.name === "AbortError") return; // cancelled by unmount, not a failure
    if (tokenRef.current !== myToken) return;
    dispatch({
      type: "LOAD_ERROR",
      message: err?.message || "Errore durante il caricamento",
      status: typeof err?.status === "number" ? err.status : null
    });
  }
}

/* ============================================================
 * Presentational rendering — real component, no internal state,
 * no fetching. Consumes only whatever `contract` it is given.
 * ============================================================ */

const SEVERITY_META = {
  critical: { label: "Critico", color: "var(--color-danger)" },
  warning: { label: "Attenzione", color: "var(--color-warning)" },
  info: { label: "Informativo", color: "var(--color-text-muted)" }
};

const DIMENSION_LABELS = {
  availability: "Disponibilità dati",
  traceability: "Tracciabilità evidenza",
  linking: "Collegamento documenti",
  missingOrAmbiguous: "Dato mancante o ambiguo"
};

// Fixed, documented labels for the contract's own dataQualityStatus enum
// (scripts/lib/dataQualityContract.mjs#ORDER_STATUS) — deliberately separate
// from src/utils/statusRules.js's order-business-status vocabulary
// ("Scaduto"/"Confermato"/...), which this must never be confused with.
const ORDER_STATUS_META = {
  unavailable: { label: "Non disponibile", color: "var(--color-text-muted)" },
  not_evaluated: { label: "Da verificare", color: "var(--color-text-muted)" },
  incomplete_evidence: { label: "Evidenza incompleta", color: "var(--color-warning)" },
  open_findings: { label: "Segnalazioni aperte", color: "var(--color-warning)" },
  complete: { label: "Dati completi", color: "var(--color-success)" }
};

function formatTimestamp(value) {
  if (!value) return "Non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Non disponibile";
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

// Same null-safe convention as ratio() in scripts/lib/pilotControlCheck.mjs,
// duplicated locally (not imported) so this browser-side view never pulls in
// the CLI/server-adjacent module graph.
function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  if (!Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

function formatRatio(r) {
  if (r === null || r === undefined) return "Non disponibile";
  return `${Math.round(r * 100)}%`;
}

function SeverityBadge({ severity }) {
  const meta = SEVERITY_META[severity] || { label: severity, color: "var(--color-text-muted)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, white)`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

function OrderDataQualityStatusBadge({ status }) {
  const meta = ORDER_STATUS_META[status] || { label: "Non disponibile", color: "var(--color-text-muted)" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, white)`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

const ORDER_COLUMNS = [
  { key: "orderCode", label: "Ordine" },
  { key: "supplierName", label: "Fornitore" },
  { key: "evidenceCoverage", label: "Copertura evidenza" },
  { key: "findingCount", label: "Segnalazioni" },
  { key: "status", label: "Stato dati" }
];

// Support/admin investigation handoff: per-order findings carry a real
// orderId (see scripts/lib/dataQualityContract.mjs#buildFindings) that can
// be handed to App.jsx's existing navigation flow to open the same order in
// OrderOperationalView. organizationFindings have no orderId at all — they
// describe an org-wide fact, not one order — so they never render this
// action. `onOpenOrder` is optional so this component still renders
// correctly wherever it's used without navigation wired up (e.g. tests).
//
// `affectedLines` and `affectedDocuments` are structured summaries produced
// by dataQualityContract.mjs: lines contain id/description/itemCode and
// documents contain id/kind/number. Their stable ids are carried unchanged
// through the existing order drilldown so OrderOperationalView can focus only
// exact matches in the already-loaded response, without another query.
//
// Extracted as a pure function (not inlined in the onClick) so the exact
// payload a click produces is directly testable without simulating a real
// DOM click event (this codebase's UI tests render via
// react-dom/server#renderToStaticMarkup, which never executes handlers).
// Returns null when no navigation is possible: a missing orderId (e.g. an
// organizationFinding-shaped object, which has none) or no onOpenOrder wired.
export function buildOpenOrderInvocation(finding, onOpenOrder) {
  if (!onOpenOrder || !finding?.orderId) return null;
  return [
    finding.orderId,
    {
      findingId: finding.findingId,
      type: finding.type,
      dimension: finding.dimension,
      severity: finding.severity,
      orderId: finding.orderId,
      orderCode: finding.orderCode || null,
      affectedLines: finding.affectedLines || [],
      affectedDocuments: finding.affectedDocuments || [],
      evidenceRefs: finding.evidenceRefs || [],
      description: finding.description || null
    }
  ];
}

function OpenOrderAction({ finding, onOpenOrder }) {
  const invocation = buildOpenOrderInvocation(finding, onOpenOrder);
  if (!invocation) return null;
  const [orderId, context] = invocation;
  return (
    <button
      type="button"
      onClick={() => onOpenOrder(orderId, context)}
      className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
      style={{ color: "var(--color-primary)" }}
    >
      Apri ordine
    </button>
  );
}

export function PilotDataQualityViewContent({ contract, organizationName, onOpenOrder }) {
  if (!contract) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>
          Qualità dei dati OrderWatch (pilota)
        </h1>
        <EmptyState
          title="Nessuna valutazione disponibile"
          description="Questa vista mostra solo l'output reale del controllo di qualità dati. Esegui il Pilot Control Check per popolarla."
        />
      </div>
    );
  }

  // organizationFindings (org-wide facts, e.g. a source not currently
  // watched) are deliberately kept separate from per-order findings and
  // from the orders summary table — never merged into either, per the
  // contract's own v2.2.0 rule that an organization-wide fact must never be
  // presented as if it were about one specific order.
  const organizationFindings = Array.isArray(contract.organizationFindings) ? contract.organizationFindings : [];
  const findings = Array.isArray(contract.findings) ? contract.findings : [];
  const orders = Array.isArray(contract.orders) ? contract.orders : [];

  return (
    <div className="space-y-6">
      {/* A) Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>
          Qualità dei dati OrderWatch (pilota)
        </h1>
        <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--color-text-muted)" }}>
          Misura quanto le osservazioni di OrderWatch sono complete, tracciabili e internamente coerenti per il
          campione di ordini analizzato. Non misura l'accuratezza dell'estrazione, non è un punteggio di
          affidabilità del fornitore e non è un giudizio sulla correttezza dell'ordine.
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="font-medium" style={{ color: "var(--color-text-muted)" }}>Organizzazione:</dt>
            <dd style={{ color: "var(--color-text)" }}>{organizationName || contract.organizationId || "Non disponibile"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium" style={{ color: "var(--color-text-muted)" }}>Valutato il:</dt>
            <dd style={{ color: "var(--color-text)" }}>{formatTimestamp(contract.generatedAt)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium" style={{ color: "var(--color-text-muted)" }}>Ordini analizzati:</dt>
            <dd style={{ color: "var(--color-text)" }}>{contract.summary?.totalOrders ?? "Non disponibile"}</dd>
          </div>
        </dl>
      </div>

      {/* B) KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Ordini valutati" value={contract.summary?.totalOrders ?? "Non disponibile"} hint="Campione analizzato in questa esecuzione" icon={ClipboardList} tone="primary" />
        <KpiCard
          label="Copertura evidenza"
          value={formatRatio(contract.qualityIndicators?.evidenceCoverage)}
          hint={`${contract.summary?.linkedEvidence ?? 0} righe con evidenza su ${contract.qualityIndicators?.missingEvidence?.evaluatedLines ?? 0} valutate`}
          icon={Link2}
          tone="success"
        />
        <KpiCard
          label="Evidenza mancante"
          value={contract.qualityIndicators?.missingEvidence?.count ?? "Non disponibile"}
          hint={`su ${contract.qualityIndicators?.missingEvidence?.evaluatedLines ?? 0} righe valutate`}
          icon={FileWarning}
          tone="warning"
        />
        <KpiCard
          label="Evidenza ambigua"
          value={contract.qualityIndicators?.ambiguousEvidence?.count ?? "Non disponibile"}
          hint={`su ${contract.qualityIndicators?.ambiguousEvidence?.evaluatedLines ?? 0} righe valutate`}
          icon={SplitSquareHorizontal}
          tone="warning"
        />
        <KpiCard
          label="Segnalazioni aperte"
          value={findings.length}
          hint="Richiedono verifica manuale — nessuna azione automatica"
          icon={ListChecks}
          tone="accent"
        />
      </div>

      {/* C) Orders table — built entirely from contract.orders (real data) */}
      <Card title="Ordini valutati">
        {orders.length ? (
          <DataTable
            columns={ORDER_COLUMNS}
            rows={orders.map((o) => ({ id: o.orderId, ...o }))}
            renderCell={(row, key) => {
              if (key === "evidenceCoverage") return formatRatio(ratio(row.evidenceCoverage?.coveredLines, row.evidenceCoverage?.totalLines));
              if (key === "status") return <OrderDataQualityStatusBadge status={row.dataQualityStatus} />;
              return row[key] ?? "Non disponibile";
            }}
          />
        ) : (
          <EmptyState title="Nessun ordine valutato" description="Questo campione non contiene ordini da mostrare." />
        )}
      </Card>

      {/* D) Findings panel — per-order findings only; organization-wide
          findings are shown in their own section below, never mixed in. */}
      <Card title="Segnalazioni di qualità dati per ordine" action={<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{findings.length} totali</span>}>
        {findings.length ? (
          <ul className="space-y-3">
            {findings.map((finding) => (
              <li key={finding.findingId} className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                      {finding.type}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {DIMENSION_LABELS[finding.dimension] || finding.dimension}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                      {finding.orderCode || "Ordine non disponibile"} · {finding.supplierName || "Fornitore non disponibile"}
                    </span>
                    <OpenOrderAction finding={finding} onOpenOrder={onOpenOrder} />
                  </div>
                </div>
                <p className="mt-2 text-sm" style={{ color: "var(--color-text)" }}>{finding.description}</p>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  <span>Righe interessate: {finding.affectedLines?.length ? finding.affectedLines.length : "nessuna"}</span>
                  <span>Documenti interessati: {finding.affectedDocuments?.length ? finding.affectedDocuments.length : "nessuno"}</span>
                  <span>Riferimenti evidenza: {finding.evidenceRefs?.length ? finding.evidenceRefs.join(", ") : "nessuno"}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nessuna segnalazione" description="Nessun problema strutturale rilevato in questo campione." />
        )}
      </Card>

      {/* Organization-wide findings — a separate section on purpose: these
          describe a source-coverage fact for the whole organization, not
          any specific order, and must never be attributed to one. */}
      <Card
        title="Segnalazioni a livello di organizzazione"
        action={<span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{organizationFindings.length} totali</span>}
      >
        {organizationFindings.length ? (
          <>
            <p className="mb-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Riguardano una fonte dati dell'intera organizzazione (es. una casella email non collegata), non un ordine specifico.
            </p>
            <ul className="space-y-3">
              {organizationFindings.map((finding) => (
                <li key={finding.findingId} className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                      {finding.type}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {DIMENSION_LABELS[finding.dimension] || finding.dimension}
                    </span>
                    {finding.sourceKey && (
                      <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>· {finding.sourceKey}</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm" style={{ color: "var(--color-text)" }}>{finding.description}</p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState title="Nessuna segnalazione a livello di organizzazione" description="Nessuna fonte dati dell'organizzazione risulta non disponibile o incompleta." />
        )}
      </Card>
    </div>
  );
}

/* ============================================================
 * Container: wires the state machine + fetch orchestration to
 * the presentational component. No presentation logic lives here.
 * ============================================================ */

// `fetchContract` is the real prop, threaded from App.jsx's authenticated
// `adapter.getPilotQualityContract` (the same path every other protected
// call uses). There is no mock/default here and no fallback to one on
// error: a failed load renders an explicit error state, never fabricated
// data. `organizationName` is separate from the contract on purpose (the
// contract only carries organizationId; the display name comes from the
// authenticated session, already loaded by App.jsx).
export default function PilotDataQualityView({ fetchContract, organizationName, onOpenOrder }) {
  const [state, dispatch] = useReducer(pilotQualityContractReducer, initialPilotQualityContractState);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (typeof fetchContract !== "function") {
      // Fail loud instead of silently falling back to mock data — that
      // fallback is exactly what this integration pass removes.
      dispatch({ type: "LOAD_ERROR", message: "Vista qualità dati non disponibile: configurazione mancante.", status: null });
      return undefined;
    }
    const myToken = ++tokenRef.current;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    dispatch({ type: "LOAD_START" });
    loadPilotQualityContract({ fetchFn: (opts) => fetchContract(opts), signal: controller?.signal, dispatch, tokenRef, myToken });
    return () => {
      tokenRef.current++;
      controller?.abort();
    };
  }, [fetchContract]);

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div role="status" aria-live="polite" className="py-3 px-2 text-sm">
        Caricamento valutazione qualità dati...
      </div>
    );
  }

  if (state.status === "error") {
    let message = state.error || "Impossibile caricare la valutazione qualità dati.";
    if (state.errorStatus === 401) message = "Sessione scaduta o non valida. Accedi di nuovo per vedere questa pagina.";
    else if (state.errorStatus === 403) message = "Non hai i permessi necessari per visualizzare la qualità dei dati.";
    return (
      <div role="alert" className="py-3 px-2 text-sm" style={{ color: "var(--color-danger)" }}>
        {message}
      </div>
    );
  }

  return <PilotDataQualityViewContent contract={state.contract} organizationName={organizationName} onOpenOrder={onOpenOrder} />;
}
