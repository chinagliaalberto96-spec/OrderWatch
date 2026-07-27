import {
  OBSERVED_TIMELINE_INITIAL_LIMIT,
  buildObservedPurchaseOrderTimeline
} from '../utils/observedPurchaseOrderTimeline';

const DOCUMENT_KIND_LABELS = {
  document: 'Documento',
  delivery_note: 'Bolla di consegna',
  invoice: 'Fattura'
};

const DATE_FORMATTER = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Rome'
});

const TIME_FORMATTER = new Intl.DateTimeFormat('it-IT', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Europe/Rome'
});

function evidenceAnchorId(ref) {
  return `evidence-${ref}`;
}

function formatDateOnly(value) {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? DATE_FORMATTER.format(parsed) : 'Data non verificabile';
}

function observedDateText(event) {
  if (event.dateKind === 'timestamp') {
    const parsed = new Date(event.receivedAt);
    return `Osservato da OrderWatch il ${DATE_FORMATTER.format(parsed)} alle ${TIME_FORMATTER.format(parsed)}`;
  }
  return `Data del documento: ${formatDateOnly(event.receivedAt)}`;
}

function kindLabel(kind) {
  return DOCUMENT_KIND_LABELS[kind] || 'Documento';
}

function EvidenceLinks({ event }) {
  if (!event.secondaryEvidenceRefs.length) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-medium text-[color:var(--color-text-muted)]">
        Altre evidenze ({event.secondaryEvidenceRefs.length})
      </summary>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {event.secondaryEvidenceRefs.map((ref, index) => (
          <a key={ref} href={`#${evidenceAnchorId(ref)}`} className="underline underline-offset-2">
            Evidenza {index + 2}
          </a>
        ))}
      </div>
    </details>
  );
}

function ObservedEvent({ event, undated = false }) {
  return (
    <li className="border-l-2 pl-3" style={{ borderColor: 'var(--color-primary)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">
            Documento osservato · {kindLabel(event.documentKind)}
          </div>
          <div className="break-words text-sm font-medium">
            {event.documentNumber || 'Senza riferimento'}
          </div>
        </div>
        <a
          href={`#${evidenceAnchorId(event.primaryEvidenceRef)}`}
          className="shrink-0 text-xs font-semibold underline underline-offset-2"
          style={{ color: 'var(--color-primary)' }}
        >
          Apri evidenza
        </a>
      </div>
      <div className="mt-1 text-xs text-[color:var(--color-text-muted)]">
        {undated ? 'Data non verificabile' : observedDateText(event)}
      </div>
      {event.associatedLines.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="font-semibold">Righe associate: </span>
          {event.associatedLines.map((line) => line.description).join(' · ')}
        </div>
      )}
      <EvidenceLinks event={event} />
    </li>
  );
}

function CommitmentRow({ commitment }) {
  const isDueDate = commitment.field === 'dueDate';
  const label = isDueDate ? 'Data prevista' : 'Data richiesta';
  return (
    <li className="flex items-start justify-between gap-4 border-t py-2 first:border-t-0" style={{ borderColor: 'var(--color-border)' }}>
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {commitment.level === 'order' ? 'Livello ordine' : 'Livello riga'}
        </div>
        <div className="break-words text-sm">
          {commitment.level === 'order' ? label : `${commitment.lineDescription} · ${label}`}
        </div>
      </div>
      <time className="shrink-0 text-sm font-semibold" dateTime={commitment.value}>
        {formatDateOnly(commitment.value)}
      </time>
    </li>
  );
}

export default function ObservedPurchaseOrderTimeline({ data }) {
  const model = buildObservedPurchaseOrderTimeline(data);
  const visibleEvents = model.observedEvents.slice(0, OBSERVED_TIMELINE_INITIAL_LIMIT);
  const hiddenEvents = model.observedEvents.slice(OBSERVED_TIMELINE_INITIAL_LIMIT);

  return (
    <section aria-labelledby="purchase-order-observed-timeline">
      <h3 id="purchase-order-observed-timeline" className="text-sm font-semibold">
        Cronologia osservata dell&apos;ordine
      </h3>

      {!model.hasContent ? (
        <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">
          Nessun evento osservato per questo ordine.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {visibleEvents.length > 0 && (
            <ol className="space-y-3" aria-label="Eventi osservati">
              {visibleEvents.map((event) => (
                <ObservedEvent key={event.documentId} event={event} />
              ))}
            </ol>
          )}

          {hiddenEvents.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                +{hiddenEvents.length} altri eventi
              </summary>
              <ol className="mt-3 space-y-3" aria-label="Altri eventi osservati">
                {hiddenEvents.map((event) => (
                  <ObservedEvent key={event.documentId} event={event} />
                ))}
              </ol>
            </details>
          )}

          {model.undatedEvents.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">
                Eventi senza data verificabile
              </h4>
              <ul className="mt-2 space-y-3">
                {model.undatedEvents.map((event) => (
                  <ObservedEvent key={event.documentId} event={event} undated />
                ))}
              </ul>
            </div>
          )}

          {model.commitments.length > 0 && (
            <div className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">
                Date attese e richieste
              </h4>
              <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
                Sono impegni registrati, non eventi già avvenuti.
              </p>
              <ul className="mt-2">
                {model.commitments.map((commitment) => (
                  <CommitmentRow key={commitment.key} commitment={commitment} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
