import { useState } from "react";
import { formatDate } from "../utils/dateUtils";
import {
  PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT,
  buildPurchaseOrderOperationalSuggestions
} from "../utils/purchaseOrderOperationalSuggestions";

const PRIORITY_COLORS = Object.freeze({
  OPERATIONAL_PRIORITY: "var(--color-danger)",
  TO_REVIEW: "var(--color-warning)",
  TO_MONITOR: "var(--color-primary)"
});

export function PurchaseOrderOperationalSuggestionsContent({
  actions,
  expanded = false,
  onToggle = () => {}
}) {
  const list = Array.isArray(actions) ? actions : [];
  const visibleActions = expanded
    ? list
    : list.slice(0, PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT);
  const remainingCount = Math.max(0, list.length - PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT);

  return (
    <section aria-labelledby="purchase-order-suggestions-title">
      <h3 id="purchase-order-suggestions-title" className="text-sm font-semibold">Azioni suggerite</h3>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Nessuna azione suggerita per questo ordine.
        </p>
      ) : (
        <>
          <ul
            className="mt-2 divide-y border-y text-sm"
            style={{ borderColor: "var(--color-border)" }}
            aria-label="Azioni operative suggerite"
          >
            {visibleActions.map((action) => {
              const priorityColor = PRIORITY_COLORS[action.priorityCode] || "var(--color-text-muted)";
              return (
                <li key={action.internalKey} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{action.title}</div>
                      <p className="mt-1 leading-5 text-[color:var(--color-text-muted)]">{action.reason}</p>
                    </div>
                    <span
                      className="shrink-0 text-xs font-semibold"
                      style={{ color: priorityColor }}
                    >
                      {action.priorityLabel}
                    </span>
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
            })}
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
      )}
    </section>
  );
}
export default function PurchaseOrderOperationalSuggestions({
  data,
  businessStatus,
  referenceDate
}) {
  const [expanded, setExpanded] = useState(false);
  const actions = buildPurchaseOrderOperationalSuggestions({
    data,
    businessStatus,
    referenceDate
  });

  return (
    <PurchaseOrderOperationalSuggestionsContent
      actions={actions}
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
    />
  );
}
