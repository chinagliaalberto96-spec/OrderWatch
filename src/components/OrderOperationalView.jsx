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
function AvailabilityAwareSection({ headingId, title, items, emptyLabel, renderItem }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">{title}</h3>
      {list.length === 0 ? (
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

// --- Human-facing translation tables -----------------------------------
// These map internal/technical values to buyer-facing Italian labels. Never
// used to guess a relationship or invent data — purely presentational.

const DOC_KIND_LABELS = {
  delivery_note: 'Bolla di consegna',
  invoice: 'Fattura',
  quote: 'Preventivo',
  document: 'Documento'
};

function humanDocKind(kind) {
  if (!kind) return 'Documento';
  return DOC_KIND_LABELS[kind] || kind;
}

const ENTITY_TYPE_LABELS = {
  purchase_order_line: 'Riga ordine',
  quote_line: 'Riga preventivo',
  delivery_note_line: 'Riga bolla',
  project_requirement: 'Fabbisogno lavoro',
  procurement_requirement: 'Fabbisogno acquisto'
};

function humanEntityType(entityType) {
  if (!entityType) return 'Origine interna';
  return ENTITY_TYPE_LABELS[entityType] || entityType;
}

const COVERAGE_STATUS_LABELS = {
  available: 'Disponibile',
  partial: 'Parziale',
  unavailable: 'Non disponibile',
  incomplete: 'Incompleta',
  unwatched: 'Non monitorata',
  quiet: 'Nessun dato recente'
};

function humanCoverageStatus(status) {
  if (!status) return 'Non disponibile';
  return COVERAGE_STATUS_LABELS[status] || status;
}

// The exact allowlisted keys the backend's sanitizeObservedValues() may emit
// (server/routes/order-operational-view.js), in display order.
const OBSERVED_FIELD_ORDER = ['description', 'item_code', 'quantity', 'unit', 'required_date', 'due_date'];
const OBSERVED_FIELD_LABELS = {
  description: 'Descrizione',
  item_code: 'Codice articolo',
  quantity: 'Quantità',
  unit: 'Unità',
  required_date: 'Data richiesta',
  due_date: 'Data prevista'
};

// Parses only the backend-approved safe excerpt shape (a JSON object with a
// fixed allowlist of primitive fields) and renders named fields. Never uses
// dangerouslySetInnerHTML — values always go through JSX's default escaping.
// On any parse failure or empty/unexpected shape, falls back to a plain
// "not available" message instead of ever showing raw JSON.
function SafeExcerptFields({ excerpt }) {
  if (!excerpt || typeof excerpt !== 'string') {
    return <span className="text-xs text-[color:var(--color-text-muted)]">Estratto non disponibile</span>;
  }
  let parsed;
  try {
    parsed = JSON.parse(excerpt);
  } catch {
    return <span className="text-xs text-[color:var(--color-text-muted)]">Estratto non disponibile</span>;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <span className="text-xs text-[color:var(--color-text-muted)]">Estratto non disponibile</span>;
  }
  const fields = OBSERVED_FIELD_ORDER.filter((key) => {
    const v = parsed[key];
    return v !== undefined && v !== null && v !== '' && (typeof v === 'string' || typeof v === 'number');
  });
  if (!fields.length) {
    return <span className="text-xs text-[color:var(--color-text-muted)]">Estratto non disponibile</span>;
  }
  return (
    <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
      {fields.map((key) => (
        <React.Fragment key={key}>
          <dt className="text-[color:var(--color-text-muted)]">{OBSERVED_FIELD_LABELS[key]}</dt>
          <dd>{String(parsed[key])}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// Resolves a compact, human source description for one evidence reference —
// never the raw sourceEmailId/sourceDocumentId UUID. When the reference
// matches a known linked document (same email/document id), that document's
// own kind/number/date is used. Otherwise only the internal entity type is
// shown, and the UUID is replaced by an explicit "internal source" label.
function resolveEvidenceSource(evidenceRef, linkedDocuments) {
  const doc = (linkedDocuments || []).find(
    (d) => (evidenceRef.sourceEmailId && d.sourceEmailId === evidenceRef.sourceEmailId)
      || (evidenceRef.sourceDocumentId && d.sourceDocumentId === evidenceRef.sourceDocumentId)
  );
  if (doc) {
    return { title: doc.number || null, kindLabel: humanDocKind(doc.kind), receivedAt: doc.receivedAt || null, isInternal: false };
  }
  return { title: null, kindLabel: humanEntityType(evidenceRef.entityType), receivedAt: null, isInternal: true };
}

function evidenceGroupKey(evidenceRef) {
  if (evidenceRef.sourceEmailId) return `email:${evidenceRef.sourceEmailId}`;
  if (evidenceRef.sourceDocumentId) return `doc:${evidenceRef.sourceDocumentId}`;
  return `ref:${evidenceRef.ref}`;
}

// Groups citation refs by their underlying source (same email/document) so
// the buyer sees one compact expandable row per real-world source instead of
// one large card per citation.
function buildEvidenceGroups(evidenceReferences, linkedDocuments, safeEvidenceExcerpts) {
  const groups = new Map();
  for (const e of evidenceReferences || []) {
    const key = evidenceGroupKey(e);
    if (!groups.has(key)) {
      groups.set(key, { key, source: resolveEvidenceSource(e, linkedDocuments), items: [] });
    }
    const excerpt = (safeEvidenceExcerpts || []).find((s) => s.ref === e.ref)?.excerpt || null;
    groups.get(key).items.push({ ref: e.ref, sourceLineNumber: e.sourceLineNumber || null, excerpt });
  }
  return Array.from(groups.values());
}

function EvidenceGroupRow({ group }) {
  const refsLabel = group.items.map((it) => it.ref).join(', ');
  const sourceLabel = group.source.title || group.source.kindLabel;
  return (
    <details className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
      <summary className="cursor-pointer text-sm font-medium">
        <span className="font-semibold">{refsLabel}</span>
        {' — '}
        <span>{sourceLabel}</span>
        {group.source.isInternal && !group.source.title ? (
          <span className="text-xs text-[color:var(--color-text-muted)]"> (Fonte interna disponibile)</span>
        ) : null}
        {group.source.receivedAt ? (
          <span className="text-xs text-[color:var(--color-text-muted)]"> · {formatDate(group.source.receivedAt)}</span>
        ) : null}
      </summary>
      <div className="mt-2 space-y-2">
        {group.items.map((it) => (
          <div key={it.ref} id={evidenceAnchorId(it.ref)} tabIndex={-1} className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
            <div className="text-xs font-semibold">
              {it.ref}
              {it.sourceLineNumber ? ` · Riga ${it.sourceLineNumber}` : ''}
            </div>
            <SafeExcerptFields excerpt={it.excerpt} />
          </div>
        ))}
      </div>
    </details>
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
      <span className="font-medium">{label}:</span> {humanCoverageStatus(entry.status)}
      {entry.message ? <span className="block text-xs text-[color:var(--color-text-muted)]">{entry.message}</span> : null}
      {entry.limitation ? <span className="block text-xs text-[color:var(--color-text-muted)]">{entry.limitation}</span> : null}
    </div>
  );
}

// currentObservedSituation.severity is not yet computed by the backend from
// the order's real status/alert level — today it is always the literal
// placeholder { severity: 'ok', label: null, reasonCodes: [] } regardless of
// whether the order is overdue (verified in
// server/routes/order-operational-view.js). Rendering that literally as
// "Livello: ok" would silently contradict the order's own, genuinely
// computed status badge (src/utils/statusRules.js#getOrderStatus, driven by
// daysRemaining). Until the backend marks this field as actually evaluated
// (a non-null label, or a non-empty reasonCodes list), it is presented as
// not yet available rather than as a false "ok" — never invented here.
function operationalLevelDisplay(situation) {
  const label = situation?.label ?? null;
  const reasonCodes = Array.isArray(situation?.reasonCodes) ? situation.reasonCodes : [];
  const isPlaceholder = !label && reasonCodes.length === 0;
  if (isPlaceholder) {
    return { text: 'Livello operativo non ancora calcolato', muted: true };
  }
  return { text: label || situation?.severity || 'Non disponibile', muted: false };
}

// The four "advanced verification" sections share one contract: an array
// plus a separate availability boolean (never `.status` on the array). When
// unavailable, they are grouped into one compact expandable summary instead
// of four large blocks; once genuinely evaluated (available !== false), each
// renders as its own section, populated or truthfully empty.
function AdvancedVerificationSections({ data }) {
  const defs = [
    {
      key: 'unresolved',
      headingId: 'ooview-unresolved',
      title: 'Evidenza non risolta',
      items: data.unresolvedEvidence,
      available: data.unresolvedEvidenceAvailable,
      emptyLabel: 'Nessuna evidenza non risolta rilevata.',
      renderItem: (item, i) => (
        <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
          {item.reason || item.title || 'Elemento non risolto'}
        </li>
      )
    },
    {
      key: 'ambiguous',
      headingId: 'ooview-ambiguous',
      title: 'Evidenza ambigua',
      items: data.ambiguousEvidence,
      available: data.ambiguousEvidenceAvailable,
      emptyLabel: 'Nessuna evidenza ambigua rilevata.',
      renderItem: (item, i) => (
        <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
          {item.reason || item.title || 'Elemento ambiguo'}
        </li>
      )
    },
    {
      key: 'active-commitments',
      headingId: 'ooview-active-commitments',
      title: 'Impegni attivi',
      items: data.activeCommitments,
      available: data.activeCommitmentsAvailable,
      emptyLabel: 'Nessun impegno attivo rilevato.',
      renderItem: (item, i) => (
        // Read-only: no action, link or control is attached to a commitment.
        <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
          {item.description || item.kind || 'Impegno attivo'}
        </li>
      )
    },
    {
      key: 'superseded-commitments',
      headingId: 'ooview-superseded-commitments',
      title: 'Impegni superati',
      items: data.supersededCommitments,
      available: data.supersededCommitmentsAvailable,
      emptyLabel: 'Nessun impegno superato rilevato.',
      renderItem: (item, i) => (
        <li key={item.id || i} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
          {item.description || item.kind || 'Impegno superato'}
        </li>
      )
    }
  ];

  const unavailable = defs.filter((s) => s.available === false);
  const evaluated = defs.filter((s) => s.available !== false);

  return (
    <>
      {unavailable.length > 0 && (
        <details className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
          <summary className="cursor-pointer text-sm font-semibold">Verifiche avanzate non disponibili</summary>
          <ul className="mt-2 space-y-1 text-sm text-[color:var(--color-text-muted)]">
            {unavailable.map((s) => (
              <li key={s.key}>{s.title}: verifica non disponibile</li>
            ))}
          </ul>
        </details>
      )}
      {evaluated.map((s) => (
        <AvailabilityAwareSection
          key={s.key}
          headingId={s.headingId}
          title={s.title}
          items={s.items}
          emptyLabel={s.emptyLabel}
          renderItem={s.renderItem}
        />
      ))}
    </>
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
  const linkedDocuments = Array.isArray(d.linkedDocuments) ? d.linkedDocuments : [];
  const evidenceGroups = buildEvidenceGroups(evidenceReferences, linkedDocuments, safeEvidenceExcerpts);
  const levelInfo = operationalLevelDisplay(d.currentObservedSituation);

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
          <div>
            Livello operativo: <strong className={levelInfo.muted ? 'font-normal text-[color:var(--color-text-muted)]' : ''}>{levelInfo.text}</strong>
          </div>
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
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm border-collapse" aria-describedby="ooview-lines">
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
          </div>
        ) : (
          <div className="mt-2 text-sm text-[color:var(--color-text-muted)]">Sezione non valutata o vuota</div>
        )}
      </section>

      <section aria-labelledby="ooview-evidence">
        <h3 id="ooview-evidence" className="text-sm font-semibold">Evidenza</h3>
        {evidenceGroups.length ? (
          <div className="mt-2 space-y-2">
            {evidenceGroups.map((g) => <EvidenceGroupRow key={g.key} group={g} />)}
          </div>
        ) : (
          <div className="mt-2 text-sm text-[color:var(--color-text-muted)]">Nessuna evidenza disponibile</div>
        )}
      </section>

      <section aria-labelledby="ooview-documents">
        <h3 id="ooview-documents" className="text-sm font-semibold">Documenti collegati</h3>
        {linkedDocuments.length ? (
          <ul className="mt-2 space-y-2 text-sm" aria-label="Documenti collegati">
            {linkedDocuments.map((doc) => (
              <li key={doc.id} className="rounded-md border p-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">{humanDocKind(doc.kind)}</div>
                {/* doc.number is real source content (e.g. an email subject) and is
                    rendered verbatim as plain text — never prefixed with a technical
                    marker like "document #" that could be mistaken for a UI control. */}
                <div className="font-medium">{doc.number || 'Senza riferimento'}</div>
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  {doc.receivedAt ? formatDate(doc.receivedAt) : 'Data non disponibile'}
                  {doc.status ? ` · ${doc.status}` : ''}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-sm text-[color:var(--color-text-muted)]">Nessun documento collegato</div>
        )}
      </section>

      <AdvancedVerificationSections data={d} />

      <section aria-labelledby="ooview-coverage">
        <h3 id="ooview-coverage" className="text-sm font-semibold">Copertura delle fonti dati</h3>
        <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
          Indica quanto sono osservabili le fonti (email, allegati, collegamento operativo) a livello di sistema — non certifica che questo singolo ordine sia completo o corretto.
        </p>
        <div className="mt-2 text-sm">
          <CoverageRow label="Email in entrata" entry={d.coverageAndSyncHealth?.inboundEmail} />
          <CoverageRow label="Email in uscita" entry={d.coverageAndSyncHealth?.outboundEmail} />
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
