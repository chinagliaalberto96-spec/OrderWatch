import { useMemo, useState } from "react";
import { formatDate } from "../utils/dateUtils";
import { canViewPurchaseOrderQualitySummary } from "../utils/purchaseOrderOperationalSummary";
import {
  PURCHASE_ORDER_DIAGNOSTIC_INITIAL_LIMIT,
  buildPurchaseOrderDiagnosticSuggestions
} from "../utils/purchaseOrderDiagnosticSuggestions";
import {
  PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT,
  buildPurchaseOrderOperationalSuggestions
} from "../utils/purchaseOrderOperationalSuggestions";

const PRIORITY_COLORS = Object.freeze({
  OPERATIONAL_PRIORITY: "var(--color-danger)",
  TO_REVIEW: "var(--color-warning)",
  TO_MONITOR: "var(--color-primary)"
});

function Priority({ code, label }) {
  return (
    <span
      className="shrink-0 text-xs font-semibold"
      style={{ color: PRIORITY_COLORS[code] || "var(--color-text-muted)" }}
    >
      {label}
    </span>
  );
}

function OperationalAction({ action }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{action.title}</div>
          <p className="mt-1 leading-5 text-[color:var(--color-text-muted)]">{action.reason}</p>
        </div>
        <Priority code={action.priorityCode} label={action.priorityLabel} />
      </div>
      {action.targetLevel === "line" && (
        <div className="mt-2 text-xs">
          <div className="font-semibold">{action.lineDescription}</div>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[color:var(--color-text-muted)]">
            {action.commitmentDetails.map((detail) => (
              <div key={detail.field} className="flex gap-1">
                <dt>{detail.label}:</dt>
                <dd>{formatDate(detail.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}

function LineDetails({ lines }) {
  if (!lines.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {lines.map((line) => (
        <li key={line.id}>
          <span className="font-semibold">{line.description || "Riga ordine"}</span>
          {line.itemCode ? <span className="text-[color:var(--color-text-muted)]"> · {line.itemCode}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function DocumentDetails({ documents }) {
  if (!documents.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {documents.map((document) => (
        <li key={document.id}>
          <span className="font-semibold">{document.kind || "Documento"}</span>
          {document.number ? <span className="text-[color:var(--color-text-muted)]"> · {document.number}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function DiagnosticNavigation({ action, onNavigateTarget }) {
  const target = action.primaryNavigationTarget;
  if (!target || target.type === "order") return null;
  if (target.type === "evidence") {
    return (
      <a
        href={`#evidence-${target.ref}`}
        className="mt-2 inline-flex text-xs font-semibold underline underline-offset-2"
        style={{ color: "var(--color-primary)" }}
      >
        Vai all'evidenza
      </a>
    );
  }
  return (
    <button
      type="button"
      className="mt-2 text-xs font-semibold underline underline-offset-2"
      style={{ color: "var(--color-primary)" }}
      onClick={() => onNavigateTarget(target)}
    >
      {target.type === "line" ? "Vai alla riga" : "Vai al documento"}
    </button>
  );
}

function DiagnosticAction({ action, onNavigateTarget }) {
  const primaryEvidenceRef = action.primaryNavigationTarget?.type === "evidence"
    ? action.primaryNavigationTarget.ref
    : null;
  const supportingEvidenceRefs = action.resolvedEvidenceRefs.filter(
    (ref) => ref !== primaryEvidenceRef
  );

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{action.title}</div>
          <p className="mt-1 leading-5 text-[color:var(--color-text-muted)]">{action.reason}</p>
        </div>
        <Priority code={action.priorityCode} label={action.priorityLabel} />
      </div>
      <LineDetails lines={action.affectedLines} />
      <DocumentDetails documents={action.affectedDocuments} />
      {supportingEvidenceRefs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {supportingEvidenceRefs.map((ref, index) => (
            <a key={ref} href={`#evidence-${ref}`} className="underline underline-offset-2">
              {supportingEvidenceRefs.length === 1
                ? "Evidenza aggiuntiva"
                : `Evidenza aggiuntiva ${index + 1}`}
            </a>
          ))}
        </div>
      )}
      {action.unavailableEvidenceNote && (
        <p className="mt-2 text-xs text-[color:var(--color-text-muted)]">
          {action.unavailableEvidenceNote}
        </p>
      )}
      <DiagnosticNavigation action={action} onNavigateTarget={onNavigateTarget} />
    </li>
  );
}

function ActionGroup({
  title,
  actions,
  expanded,
  onToggle,
  initialLimit,
  ariaLabel,
  renderAction
}) {
  const visibleActions = expanded ? actions : actions.slice(0, initialLimit);
  const remainingCount = Math.max(0, actions.length - initialLimit);

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">
        {title}
      </h4>
      {actions.length > 0 ? (
        <>
          <ul
            className="mt-2 divide-y border-y text-sm"
            style={{ borderColor: "var(--color-border)" }}
            aria-label={ariaLabel}
          >
            {visibleActions.map(renderAction)}
          </ul>
          {remainingCount > 0 && (
            <button
              type="button"
              className="mt-2 text-sm font-semibold"
              style={{ color: "var(--color-primary)" }}
              onClick={onToggle}
            >
              {expanded ? "Mostra meno" : `+${remainingCount} altre azioni`}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

export function PurchaseOrderOperationalSuggestionsContent({
  actions,
  operationalActions = actions || [],
  diagnosticActions = [],
  diagnosticState = "hidden",
  showDiagnostic = false,
  expanded,
  operationalExpanded = false,
  diagnosticExpanded = false,
  onToggle,
  onToggleOperational = () => {},
  onToggleDiagnostic = () => {},
  onNavigateDiagnosticTarget = () => {}
}) {
  const operational = Array.isArray(operationalActions) ? operationalActions : [];
  const diagnostic = Array.isArray(diagnosticActions) ? diagnosticActions : [];
  const effectiveOperationalExpanded = typeof expanded === "boolean"
    ? expanded
    : operationalExpanded;
  const effectiveOperationalToggle = typeof onToggle === "function"
    ? onToggle
    : onToggleOperational;
  const diagnosticLoading = showDiagnostic && ["idle", "loading"].includes(diagnosticState);
  const hasVisibleDiagnosticState = showDiagnostic && (
    diagnosticLoading
    || diagnostic.length > 0
    || ["loaded", "unavailable", "error"].includes(diagnosticState)
  );
  const overallEmpty = operational.length === 0
    && diagnostic.length === 0
    && !diagnosticLoading;

  return (
    <section aria-labelledby="purchase-order-suggestions-title">
      <h3 id="purchase-order-suggestions-title" className="text-sm font-semibold">Azioni suggerite</h3>
      <div className="mt-3 space-y-4">
        {operational.length > 0 && (
          <ActionGroup
            title="Operative"
            actions={operational}
            expanded={effectiveOperationalExpanded}
            onToggle={effectiveOperationalToggle}
            initialLimit={PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT}
            ariaLabel="Azioni operative suggerite"
            renderAction={(action) => <OperationalAction key={action.internalKey} action={action} />}
          />
        )}

        {hasVisibleDiagnosticState && (
          <div>
            <ActionGroup
              title="Qualità dati"
              actions={diagnostic}
              expanded={diagnosticExpanded}
              onToggle={onToggleDiagnostic}
              initialLimit={PURCHASE_ORDER_DIAGNOSTIC_INITIAL_LIMIT}
              ariaLabel="Azioni qualità dati suggerite"
              renderAction={(action) => (
                <DiagnosticAction
                  key={action.internalKey}
                  action={action}
                  onNavigateTarget={onNavigateDiagnosticTarget}
                />
              )}
            />
            {diagnosticLoading && (
              <p role="status" className="mt-2 text-sm text-[color:var(--color-text-muted)]">
                Caricamento valutazione qualità...
              </p>
            )}
            {diagnosticState === "loaded" && diagnostic.length === 0 && (
              <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
                Nessuna segnalazione di qualità dati per questo ordine.
              </p>
            )}
            {["unavailable", "error"].includes(diagnosticState) && (
              <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
                La valutazione qualità non è disponibile per questo ordine.
              </p>
            )}
          </div>
        )}

        {overallEmpty && (
          <p className="text-sm text-[color:var(--color-text-muted)]">
            Nessuna azione suggerita per questo ordine.
          </p>
        )}
      </div>
    </section>
  );
}

export default function PurchaseOrderOperationalSuggestions({
  data,
  businessStatus,
  referenceDate,
  qualityState,
  userRole,
  onNavigateDiagnosticTarget
}) {
  const [operationalExpanded, setOperationalExpanded] = useState(false);
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const operationalActions = useMemo(() => buildPurchaseOrderOperationalSuggestions({
    data,
    businessStatus,
    referenceDate
  }), [data, businessStatus, referenceDate]);
  const showDiagnostic = canViewPurchaseOrderQualitySummary(userRole);
  const diagnosticActions = useMemo(() => (
    showDiagnostic
      ? buildPurchaseOrderDiagnosticSuggestions({ qualityState, operationalData: data })
      : []
  ), [showDiagnostic, qualityState, data]);

  return (
    <PurchaseOrderOperationalSuggestionsContent
      operationalActions={operationalActions}
      diagnosticActions={diagnosticActions}
      diagnosticState={showDiagnostic ? qualityState?.status || "unavailable" : "hidden"}
      showDiagnostic={showDiagnostic}
      operationalExpanded={operationalExpanded}
      diagnosticExpanded={diagnosticExpanded}
      onToggleOperational={() => setOperationalExpanded((current) => !current)}
      onToggleDiagnostic={() => setDiagnosticExpanded((current) => !current)}
      onNavigateDiagnosticTarget={onNavigateDiagnosticTarget}
    />
  );
}
