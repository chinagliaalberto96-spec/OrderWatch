import React, { useEffect, useReducer, useRef } from 'react';
import { formatDate } from '../utils/dateUtils';

/* ============================================================
 * Pure state machine — no React, no fetch. Directly testable.
 * ============================================================ */

export const initialOrderOperationalViewState = { status: 'idle', loading: false, error: null, data: null };

export function orderOperationalViewReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return initialOrderOperationalViewState;
    case 'LOAD_START':
      // Clearing `data` here is the fix for stale-order bleed: while a new
      // order is loading, the previous order's payload is never left in state.
      return { status: 'loading', loading: true, error: null, data: null };
    case 'LOAD_SUCCESS':
      return { status: 'loaded', loading: false, error: null, data: action.data };
    case 'LOAD_NOT_FOUND':
      return { status: 'not-found', loading: false, error: null, data: null };
    case 'LOAD_ERROR':
      return { status: 'error', loading: false, error: action.message, data: null };
    default:
      return state;
  }
}

// apiAdapter.js now attaches a structured `status` to thrown errors. The
// message-regex match is kept only as a fallback for callers/mocks that
// don't set it, so a wording change server-side can no longer silently
// reclassify a 404 as a generic error.
export function isNotFoundError(err) {
  if (typeof err?.status === 'number') return err.status === 404;
  return Boolean(err?.message && /404|not found/i.test(err.message));
}

// Real fetch orchestration used by the component's effect. Extracted so it
// can be exercised directly, in plain Node, without mounting a DOM.
//
// `fetchFn` must be the app's shared authenticated request path — the same
// bound `adapter.getOrderOperationalView` used everywhere else (threaded down
// from App.jsx via the `fetchOperationalView` prop) — never a locally
// re-created client. It is called exactly as apiAdapter.js defines it:
// fetchFn(orderId, { signal }).
export async function loadOrderOperationalView({ orderId, fetchFn, signal, dispatch, tokenRef, myToken }) {
  try {
    const data = await fetchFn(orderId, { signal });
    // Stale-response protection: a newer load (or unmount) may have started
    // while this request was in flight.
    if (tokenRef.current !== myToken) return;
    dispatch({ type: 'LOAD_SUCCESS', data });
  } catch (err) {
    if (err?.name === 'AbortError') return; // cancelled by order change/unmount, not a failure
    if (tokenRef.current !== myToken) return;
    if (isNotFoundError(err)) {
      dispatch({ type: 'LOAD_NOT_FOUND' });
    } else {
      dispatch({ type: 'LOAD_ERROR', message: err?.message || 'Errore durante il caricamento' });
    }
  }
}

/* ============================================================
 * Presentational rendering — real component, no internal state.
 * Rendered via react-dom/server in tests, mounted normally at runtime.
 * ============================================================ */

function SafeValue({ value }) {
  if (value === null || value === undefined || value === '') return <span>Non disponibile</span>;
  return <span>{String(value)}</span>;
}

// Implements the required 3-state rule for unresolvedEvidence, ambiguousEvidence,
// activeCommitments and supersededCommitments: unavailable / evaluated-empty / populated.
// Never reads `.status` on the array — availability is a separate boolean field.
function AvailabilityAwareSection({ headingId, title, items, available, renderItem, emptyLabel }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">{title}</h3>
      {available === false ? (
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">Verifica non disponibile</p>
      ) : list.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">{list.map(renderItem)}</ul>
      )}
    </section>
  );
}

function evidenceAnchorId(ref) {
  return `evidence-${ref}`;
}

function ProvenanceRefs({ refs, evidenceReferences }) {
  const list = Array.isArray(refs) ? refs : [];
  if (!list.length) return <span className="text-xs text-[color:var(--color-text-muted)]">Non disponibile</span>;
  return (
    <span className="text-xs">
      {list.map((ref, index) => {
        const resolved = (evidenceReferences || []).some((e) => e.ref === ref);
        return (
          <React.Fragment key={ref}>
            {index > 0 ? ', ' : ''}
            {resolved ? (
              <a href={`#${evidenceAnchorId(ref)}`} className="underline">{ref}</a>
            ) : (
              // A dangling reference is never rendered as if it were valid evidence.
              <span className="text-[color:var(--color-danger)]">{ref} (non risolto)</span>
            )}
          </React.Fragment>
        );
      })}
    </span>
  );
}

function CoverageRow({ label, entry }) {
  if (!entry) {
    return (
      <div className="mt-1">
        <span className="font-medium">{label}:</span> Copertura non disponibile
      </div>
    );
  }
  return (
    <div className="mt-1">
      <span className="font-medium">{label}:</span> {entry.status || 'Non disponibile'}
      {entry.message ? <span className="block text-xs text-[color:var(--color-text-muted)]">{entry.message}</span> : null}
      {entry.limitation ? <span className="block text-xs text-[color:var(--color-text-muted)]">{entry.limitation}</span> : null}
    </div>
  );
}

export function OrderOperationalViewContent({ status, error, data }) {
  if (status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="py-3 px-2 text-sm">
        Caricamento dettagli operativi...
      </div>
    );
  }
  if (status === 'not-found') {
    return (
      <div role="status" className="py-3 px-2 text-sm">
        Vista operativa non disponibile per questo ordine.
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className="py-3 px-2 text-sm text-[color:var(--color-danger)]">
        {error}
      </div>
    );
  }
  if (status !== 'loaded' || !data) return null;

  const d = data;
  const attention = Array.isArray(d.anomaliesAndAttention) ? d.anomaliesAndAttention.slice(0, 5) : [];
  const lines = Array.isArray(d.canonicalMaterialLines) ? d.canonicalMaterialLines : [];
  const evidenceReferences = Array.isArray(d.evidenceReferences) ? d.evidenceReferences : [];
  const safeEvidenceExcerpts = Array.isArray(d.safeEvidenceExcerpts) ? d.safeEvidenceExcerpts : [];

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold">Vista operativa</h2>

      {attention.length > 0 && (
        <section aria-labelledby="ooview-attention">
          <h3 id="ooview-attention" className="text-sm font-semibold">Elementi da verificare</h3>
          <ul className="mt-2 space-y-2 text-sm" aria-label="Elementi da verificare">
            {attention.map((a) => (
              <li key={a.id} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="font-semibold">{a.title || 'Avviso'}</div>
                <div className="text-xs text-[color:var(--color-text-muted)]">{a.severity}</div>
                <div className="mt-1">{a.message}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ooview-situation">
        <h3 id="ooview-situation" className="text-sm font-semibold">Situazione attuale</h3>
        <div className="mt-2 text-sm">
          <div>Livello: <strong><SafeValue value={d.currentObservedSituation?.severity} /></strong></div>
          <div>Aggiornato al: <SafeValue value={d.currentObservedSituation?.asOf ? formatDate(d.currentObservedSituation.asOf) : null} /></div>
        </div>
      </section>

      <section aria-labelledby="ooview-summary">
        <h3 id="ooview-summary" className="text-sm font-semibold">Riepilogo ordine e fornitore</h3>
        <div className="mt-2 text-sm grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Numero ordine</div>
            <div className="font-medium"><SafeValue value={d.orderNumber} /></div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Organizzazione fornitore</div>
            <div className="font-medium"><SafeValue value={d.resolvedSupplierOrganization?.legalName} /></div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Contatto fornitore</div>
            {/* Deliberately never falls back to the organization name: an
                unavailable contact must read as unavailable, not inferred. */}
            <div className="font-medium"><SafeValue value={d.resolvedSupplierContact?.name || null} /></div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Materiale</div>
            <div className="font-medium"><SafeValue value={d.summary?.material} /></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="ooview-lines">
        <h3 id="ooview-lines" className="text-sm font-semibold">Righe operative canoniche</h3>
        {lines.length ? (
          <table className="mt-2 w-full text-sm border-collapse" aria-describedby="ooview-lines">
            <thead>
              <tr>
                <th scope="col" className="text-left text-xs font-semibold border-b p-1" style={{ borderColor: 'var(--color-border)' }}>Descrizione</th>
                <th scope="col" className="text-left text-xs font-semibold border-b p-1" style={{ borderColor: 'var(--color-border)' }}>Quantita</th>
                <th scope="col" className="text-left text-xs font-semibold border-b p-1" style={{ borderColor: 'var(--color-border)' }}>Stato</th>
                <th scope="col" className="text-left text-xs font-semibold border-b p-1" style={{ borderColor: 'var(--color-border)' }}>Provenienza</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.id}>
                  <td className="p-1 border-b" style={{ borderColor: 'var(--color-border)' }}>{ln.description || 'Riga'}</td>
                  <td className="p-1 border-b" style={{ borderColor: 'var(--color-border)' }}>{ln.quantity ?? 'Non disponibile'}</td>
                  <td className="p-1 border-b" style={{ borderColor: 'var(--color-border)' }}>{ln.status || 'Non disponibile'}</td>
                  <td className="p-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <ProvenanceRefs refs={ln.provenanceRefs} evidenceReferences={evidenceReferences} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="mt-2 text-sm text-[color:var(--color-text-muted)]">Sezione non valutata o vuota</div>
        )}
      </section>

      <section aria-labelledby="ooview-evidence">
        <h3 id="ooview-evidence" className="text-sm font-semibold">Evidenza e documenti collegati</h3>
        <div className="mt-2 text-sm space-y-2">
          <ul className="mt-1 space-y-2" aria-label="Riferimenti evidenza">
            {evidenceReferences.map((e) => (
              <li key={e.ref} id={evidenceAnchorId(e.ref)} tabIndex={-1} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="font-semibold">{e.ref}</div>
                <div className="text-xs">{e.kind}</div>
                <div className="text-xs">Email di origine: {e.sourceEmailId || 'Non disponibile'}</div>
                <div className="text-xs">Documento di origine: {e.sourceDocumentId || 'Non disponibile'}</div>
                <div className="text-xs">Estratto: {safeEvidenceExcerpts.find((s) => s.ref === e.ref)?.excerpt || 'Non disponibile'}</div>
              </li>
            ))}
          </ul>

          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Documenti collegati</div>
            <ul className="mt-1 space-y-2" aria-label="Documenti collegati">
              {(d.linkedDocuments || []).map((doc) => (
                <li key={doc.id} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="font-medium">{doc.kind} {doc.number ? `#${doc.number}` : ''}</div>
                  <div className="text-xs text-[color:var(--color-text-muted)]">Ricevuto: {doc.receivedAt ? formatDate(doc.receivedAt) : 'Non disponibile'}</div>
                  <div className="text-xs">Stato: {doc.status || 'Non disponibile'}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <AvailabilityAwareSection
        headingId="ooview-unresolved"
        title="Evidenza non risolta"
        items={d.unresolvedEvidence}
        available={d.unresolvedEvidenceAvailable}
        emptyLabel="Nessuna evidenza non risolta rilevata."
        renderItem={(item, i) => (
          <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
            {item.reason || item.title || JSON.stringify(item)}
          </li>
        )}
      />

      <AvailabilityAwareSection
        headingId="ooview-ambiguous"
        title="Evidenza ambigua"
        items={d.ambiguousEvidence}
        available={d.ambiguousEvidenceAvailable}
        emptyLabel="Nessuna evidenza ambigua rilevata."
        renderItem={(item, i) => (
          <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
            {item.reason || item.title || JSON.stringify(item)}
          </li>
        )}
      />

      <AvailabilityAwareSection
        headingId="ooview-active-commitments"
        title="Impegni attivi"
        items={d.activeCommitments}
        available={d.activeCommitmentsAvailable}
        emptyLabel="Nessun impegno attivo rilevato."
        renderItem={(item, i) => (
          // Read-only: no action, link or control is attached to a commitment.
          <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
            {item.description || item.kind || JSON.stringify(item)}
          </li>
        )}
      />

      <AvailabilityAwareSection
        headingId="ooview-superseded-commitments"
        title="Impegni superati"
        items={d.supersededCommitments}
        available={d.supersededCommitmentsAvailable}
        emptyLabel="Nessun impegno superato rilevato."
        renderItem={(item, i) => (
          <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
            {item.description || item.kind || JSON.stringify(item)}
          </li>
        )}
      />

      <section aria-labelledby="ooview-coverage">
        <h3 id="ooview-coverage" className="text-sm font-semibold">Copertura e sincronizzazione</h3>
        <div className="mt-2 text-sm">
          <CoverageRow label="Email in entrata" entry={d.coverageAndSyncHealth?.inboundEmail} />
          <CoverageRow label="Allegati" entry={d.coverageAndSyncHealth?.attachments} />
          <CoverageRow label="Collegamento operativo" entry={d.coverageAndSyncHealth?.operationalLinking} />
        </div>
      </section>
    </div>
  );
}

/* ============================================================
 * Container: wires the state machine + fetch orchestration to
 * the presentational component. No presentation logic lives here.
 * ============================================================ */

// `fetchOperationalView` is the real prop, threaded from App.jsx's
// authenticated `adapter` through OrdersView -> OrderDetailPanel (the same
// path onUpdateOrder/onDeleteOrder already use). `fetchOverride` exists only
// for tests, so they can inject a fake without touching the production path.
export default function OrderOperationalView({ orderId, fetchOperationalView, fetchOverride }) {
  const fetchFn = fetchOverride || fetchOperationalView;
  const [state, dispatch] = useReducer(orderOperationalViewReducer, initialOrderOperationalViewState);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!orderId) {
      dispatch({ type: 'RESET' });
      return undefined;
    }
    if (typeof fetchFn !== 'function') {
      // Fail loud instead of silently falling back to an unauthenticated
      // client — that fallback is exactly what caused the original 401 bug.
      dispatch({ type: 'LOAD_ERROR', message: 'Vista operativa non disponibile: configurazione mancante.' });
      return undefined;
    }
    const myToken = ++tokenRef.current;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    dispatch({ type: 'LOAD_START' });
    loadOrderOperationalView({ orderId, fetchFn, signal: controller?.signal, dispatch, tokenRef, myToken });
    return () => {
      // Invalidates this load for the staleness check in loadOrderOperationalView
      // (covers both "a new order was selected" and "the component unmounted"),
      // and actually cancels the in-flight request rather than only ignoring it.
      tokenRef.current++;
      controller?.abort();
    };
  }, [orderId, fetchFn]);

  if (!orderId) return null;
  return <OrderOperationalViewContent status={state.status} error={state.error} data={state.data} />;
}
