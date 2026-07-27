export const OBSERVED_TIMELINE_INITIAL_LIMIT = 5;

const SUPPORTED_DATE_KINDS = new Set(['document', 'delivery_note', 'invoice']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asStableString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function evidenceSuffix(ref) {
  const match = /^E(\d+)$/.exec(asStableString(ref));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sourceLineNumber(ref) {
  const value = Number(ref?.sourceLineNumber);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareEvidenceRefs(a, b) {
  return evidenceSuffix(a?.ref) - evidenceSuffix(b?.ref)
    || sourceLineNumber(a) - sourceLineNumber(b)
    || asStableString(a?.ref).localeCompare(asStableString(b?.ref));
}

function uniqueEvidenceRefs(refs) {
  const byRef = new Map();
  for (const evidence of refs) {
    const ref = asStableString(evidence?.ref);
    if (ref && !byRef.has(ref)) byRef.set(ref, evidence);
  }
  return Array.from(byRef.values()).sort(compareEvidenceRefs);
}

function exactLineEvidenceRefs(line, evidenceByRef) {
  return asArray(line?.provenanceRefs)
    .map((ref) => evidenceByRef.get(asStableString(ref)))
    .filter((evidence) => (
      evidence?.kind === 'line_source'
      && asStableString(evidence.entityId) === asStableString(line?.id)
    ));
}

function buildLineAssociations(lines, documents, evidenceByRef) {
  const byDocumentId = new Map(documents.map((document) => [asStableString(document.id), []]));
  const documentsByEmail = new Map();

  for (const document of documents) {
    const emailId = asStableString(document.sourceEmailId);
    if (!emailId) continue;
    const rows = documentsByEmail.get(emailId) || [];
    rows.push(document);
    documentsByEmail.set(emailId, rows);
  }

  for (const line of lines) {
    for (const evidence of exactLineEvidenceRefs(line, evidenceByRef)) {
      const sourceDocumentId = asStableString(evidence.sourceDocumentId);
      const directDocument = sourceDocumentId
        ? documents.find((document) => (
          document.kind === 'document'
          && asStableString(document.id) === sourceDocumentId
        ))
        : null;

      if (directDocument) {
        byDocumentId.get(asStableString(directDocument.id))?.push({ line, evidence });
        continue;
      }

      const sourceEmailId = asStableString(evidence.sourceEmailId);
      const emailDocuments = sourceEmailId ? documentsByEmail.get(sourceEmailId) || [] : [];
      if (emailDocuments.length === 1) {
        byDocumentId.get(asStableString(emailDocuments[0].id))?.push({ line, evidence });
      }
    }
  }

  return byDocumentId;
}

function nativeDocumentEvidenceRefs(document, evidenceReferences) {
  return uniqueEvidenceRefs(evidenceReferences
    .filter((evidence) => (
      evidence?.kind === document?.kind
      && asStableString(evidence.id) === asStableString(document?.id)
    )));
}

function buildAssociatedLines(associations) {
  const byLineId = new Map();
  for (const association of associations) {
    const lineId = asStableString(association?.line?.id);
    if (!lineId) continue;
    const current = byLineId.get(lineId) || {
      id: lineId,
      description: association.line.description || 'Riga ordine',
      evidenceReferences: []
    };
    current.evidenceReferences.push(association.evidence);
    byLineId.set(lineId, current);
  }

  return Array.from(byLineId.values())
    .map((line) => ({
      ...line,
      evidenceReferences: uniqueEvidenceRefs(line.evidenceReferences)
    }))
    .sort((a, b) => (
      asStableString(a.description).localeCompare(asStableString(b.description))
      || asStableString(a.id).localeCompare(asStableString(b.id))
    ));
}

function eventSortKey(event) {
  return [
    asStableString(event.documentId),
    String(evidenceSuffix(event.primaryEvidenceRef)).padStart(12, '0'),
    String(event.sourceLineNumber ?? Number.MAX_SAFE_INTEGER).padStart(12, '0')
  ].join(':');
}

function compareObservedEvents(a, b) {
  return b.timestamp - a.timestamp || eventSortKey(a).localeCompare(eventSortKey(b));
}

function compareUndatedEvents(a, b) {
  return eventSortKey(a).localeCompare(eventSortKey(b));
}

function buildCommitments(data) {
  const commitments = [];
  const addCommitment = ({ level, field, value, lineId = null, lineDescription = null }) => {
    if (parseDate(value) === null) return;
    commitments.push({
      key: [level, lineId || 'order', field, value].join(':'),
      level,
      field,
      value,
      lineDescription
    });
  };

  addCommitment({ level: 'order', field: 'dueDate', value: data?.summary?.dueDate });
  addCommitment({ level: 'order', field: 'requiredDate', value: data?.summary?.requiredDate });

  for (const line of asArray(data?.canonicalMaterialLines)) {
    addCommitment({
      level: 'line',
      lineId: asStableString(line.id),
      lineDescription: line.description || 'Riga ordine',
      field: 'dueDate',
      value: line.dueDate
    });
    addCommitment({
      level: 'line',
      lineId: asStableString(line.id),
      lineDescription: line.description || 'Riga ordine',
      field: 'requiredDate',
      value: line.requiredDate
    });
  }

  return commitments;
}

/**
 * Builds Phase 2B.1 exclusively from the already-loaded operational view.
 *
 * Identity rules are intentionally fail-closed:
 * - native document evidence is matched by exact kind + row id;
 * - line evidence identifies a line by exact entityId;
 * - sourceDocumentId links directly only to a raw `documents.id`;
 * - sourceEmailId is used only when exactly one linked document shares it.
 */
export function buildObservedPurchaseOrderTimeline(data) {
  const evidenceReferences = asArray(data?.evidenceReferences);
  const evidenceByRef = new Map(
    evidenceReferences
      .filter((evidence) => asStableString(evidence?.ref))
      .map((evidence) => [asStableString(evidence.ref), evidence])
  );
  const documents = asArray(data?.linkedDocuments)
    .filter((document) => asStableString(document?.id) && SUPPORTED_DATE_KINDS.has(document?.kind));
  const lines = asArray(data?.canonicalMaterialLines);
  const lineAssociations = buildLineAssociations(lines, documents, evidenceByRef);

  const observedEvents = [];
  const undatedEvents = [];

  for (const document of documents) {
    const nativeEvidenceRefs = nativeDocumentEvidenceRefs(document, evidenceReferences);
    const primaryEvidence = nativeEvidenceRefs[0] || null;
    if (!primaryEvidence) continue;

    const associations = lineAssociations.get(asStableString(document.id)) || [];
    const associatedLines = buildAssociatedLines(associations);
    const allEvidence = uniqueEvidenceRefs([
      ...nativeEvidenceRefs,
      ...associations.map((association) => association.evidence)
    ]);
    const secondaryEvidenceRefs = allEvidence
      .map((evidence) => evidence.ref)
      .filter((ref) => ref !== primaryEvidence.ref);
    const minimumSourceLineNumber = allEvidence.reduce((minimum, evidence) => (
      Math.min(minimum, sourceLineNumber(evidence))
    ), Number.MAX_SAFE_INTEGER);

    const event = {
      eventCode: 'DOCUMENT_OBSERVED',
      documentId: asStableString(document.id),
      documentKind: document.kind,
      documentNumber: document.number === null || document.number === undefined
        ? null
        : String(document.number),
      receivedAt: document.receivedAt || null,
      dateKind: document.kind === 'document' ? 'timestamp' : 'date',
      primaryEvidenceRef: primaryEvidence.ref,
      secondaryEvidenceRefs,
      associatedLines,
      sourceLineNumber: Number.isFinite(minimumSourceLineNumber)
        ? minimumSourceLineNumber
        : null
    };
    const timestamp = parseDate(document.receivedAt);

    if (timestamp === null) {
      undatedEvents.push(event);
    } else {
      observedEvents.push({ ...event, timestamp });
    }
  }

  observedEvents.sort(compareObservedEvents);
  undatedEvents.sort(compareUndatedEvents);
  const commitments = buildCommitments(data);

  return {
    observedEvents,
    undatedEvents,
    commitments,
    initialEventLimit: OBSERVED_TIMELINE_INITIAL_LIMIT,
    hasContent: observedEvents.length > 0
      || undatedEvents.length > 0
      || commitments.length > 0
  };
}
