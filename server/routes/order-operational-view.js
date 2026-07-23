import { authorizeApiRequest } from "../lib/_auth.js";
import { orgFilter, supabaseRequest } from "../lib/_supabaseRest.js";
import { sanitizeSecurityError } from "../lib/_securityRedaction.js";

// Deterministic ref assignment helper (E1, E2...)
function assignRefs(rows) {
  const refs = new Map();
  const list = [];
  let idx = 1;
  for (const r of rows) {
    const key = [
      r.kind || r.type || 'X',
      r.id || '',
      r.entityId || '',
      r.sourceEmailId || '',
      r.sourceDocumentId || '',
      r.sourceLineNumber || ''
    ].join(':');
    if (refs.has(key)) continue;
    const ref = `E${idx++}`;
    refs.set(key, { ref, row: r });
    list.push({ ref, ...r });
  }
  return { list, registry: refs };
}

const OBSERVED_VALUE_ALLOWLIST = new Set([
  'description',
  'item_code',
  'quantity',
  'unit',
  'due_date',
  'required_date'
]);

function sanitizeScalar(value) {
  if (typeof value === 'string') return value.slice(0, 180);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

// Sanitize observed_values excerpts: allowlisted primitive top-level fields only.
function sanitizeObservedValues(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const k of Array.from(OBSERVED_VALUE_ALLOWLIST).sort()) {
    const sanitized = sanitizeScalar(obj[k]);
    if (sanitized !== undefined) out[k] = sanitized;
  }
  try {
    return Object.keys(out).length ? JSON.stringify(out) : null;
  } catch {
    return null;
  }
}

function maxIsoTimestamp(values) {
  let max = null;
  for (const value of values) {
    if (!value) continue;
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) continue;
    if (max === null || ts > max) max = ts;
  }
  return max === null ? null : new Date(max).toISOString();
}

// Main assembler — accepts supabaseRequest override for testing
export async function getOrderOperationalView(organizationId, orderId, { supabaseRequestOverride } = {}) {
  const reqDb = supabaseRequestOverride || supabaseRequest;
  const filter = orgFilter(organizationId);

  // 1) Load order (tenant-isolated)
  const orders = await reqDb(
    `orders?id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,order_code,supplier_id,supplier_contact_id,supplier_name,project_code,material,quantity,status,alert_level,order_date,due_date,required_date,days_remaining,notes,updated_at&limit=1`
  );
  const order = (orders && orders[0]) || null;
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  // 2) Resolved supplier organization (3-tier fallback)
  let resolvedSupplierOrganization = null;
  try {
    if (order.supplier_contact_id) {
      const rows = await reqDb(`contacts?id=eq.${encodeURIComponent(order.supplier_contact_id)}&${filter}&select=id,legal_name,verification_status&limit=1`);
      if (rows?.[0]) {
        resolvedSupplierOrganization = {
          contactId: rows[0].id,
          legalName: rows[0].legal_name || order.supplier_name || null,
          verificationStatus: rows[0].verification_status || null,
          matchMethod: 'contact_registry'
        };
      }
    }
    if (!resolvedSupplierOrganization && order.supplier_id) {
      const rows = await reqDb(`suppliers?id=eq.${encodeURIComponent(order.supplier_id)}&${filter}&select=id,name&limit=1`);
      if (rows?.[0]) {
        resolvedSupplierOrganization = {
          contactId: rows[0].id,
          legalName: rows[0].name || order.supplier_name || null,
          verificationStatus: null,
          matchMethod: 'legacy_supplier_row'
        };
      }
    }
  } catch {
    // silence lookup errors, leave null
    resolvedSupplierOrganization = null;
  }
  if (!resolvedSupplierOrganization) {
    // fallback to flat name if present
    resolvedSupplierOrganization = order.supplier_name ? { contactId: null, legalName: order.supplier_name, verificationStatus: null, matchMethod: 'flat_name' } : null;
  }

  // 3) canonicalMaterialLines
  // `canonical_operational_lines` (view, verified live against
  // information_schema.columns) has no `line_number` column — that column
  // only exists on the underlying per-kind tables (e.g. purchase_order_lines)
  // that feed it, and is not projected through the view. Line-position
  // ordering for a single source document lives on canonical_line_sources as
  // source_line_number instead (see step 4) — it does not belong here.
  // Ordering is by created_at with id as a deterministic tiebreaker, using
  // only columns the view actually exposes.
  const lines = await reqDb(
    `canonical_operational_lines?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,entity_kind,description,item_code,quantity,delivered_quantity,remaining_quantity,unit,required_date,due_date,status,confidence,needs_review,canonical_key,updated_at&order=created_at.asc,id.asc`
  );

  // 4) canonicalLineSources for evidence excerpts
  const lineIds = (lines || []).map((r) => r.id).filter(Boolean);
  let canonicalLineSources = [];
  if (lineIds.length) {
    canonicalLineSources = await reqDb(
      `canonical_line_sources?entity_id=in.(${lineIds.map((id) => encodeURIComponent(id)).join(',')})&${filter}&select=entity_type,entity_id,source_email_id,source_document_id,source_line_number,observed_values`
    );
  }

  // 5) linkedDocuments: delivery_notes, invoices, documents
  //
  // PostgREST select= does not support SQL "column as alias" syntax — it
  // treats the whole string (e.g. "ddt_number as number") as one literal
  // column name and 400s with PostgreSQL 42703 (undefined column). Every
  // query below selects only real, tracked columns (verified live against
  // information_schema.columns for each table) and renaming to the
  // contracted response field names happens explicitly in the .map() below,
  // never in the PostgREST URL.
  //
  // Note: delivery_notes has no "ddt_date" column (delivery_date/received_date
  // exist instead) and documents has no "doc_type"/"doc_number"/"status"
  // columns at all (document_type/name exist; documents is a raw ingested
  // record with no workflow status). documents also has no "source_document_id"
  // (that linkage exists only on the specialized tables that point back to a
  // documents row, not on documents itself) and no "updated_at" (only
  // "created_at" — documents is an immutable ingested record). All verified
  // live, not assumed.
  //
  // quotes is intentionally NOT queried here: quotes has no order_id (or any
  // other column) that identifies a specific order — verified live against
  // information_schema.columns and information_schema foreign keys, quotes
  // only carries project_id/project_code, which is shared by every order in
  // the same project and would misrepresent organization/project-wide quotes
  // as documents belonging to this one order. The only place the codebase
  // links a quote to an order (server/routes/supplier-orders.js#markQuoteConverted)
  // writes a free-text note onto quotes.notes ("Convertito manualmente dal
  // buyer nell'ordine ..."), not a queryable foreign key, and canonical_operational_lines
  // confirms no row ever carries both order_id and quote_id at once (quote_line
  // rows: 0/34 have order_id; purchase_order_line rows: 0/5 have quote_id) —
  // so there is no deterministic per-order quote relationship to query. Quotes
  // are omitted from linkedDocuments until a real order_id-bearing relationship
  // exists, per the contract's "mark unavailable or omit" rule for unproven links.
  const [deliveryNotes, invoices, documents] = await Promise.all([
    reqDb(`delivery_notes?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,ddt_number,status,delivery_date,confidence,needs_review,source_email_id,source_document_id,updated_at`),
    reqDb(`invoices?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,invoice_number,status,invoice_date,confidence,needs_review,source_email_id,source_document_id,updated_at`),
    reqDb(`documents?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,document_type,name,received_at,confidence,needs_review,source_email_id,created_at`)
  ]);

  const linkedDocuments = [
    ...(deliveryNotes || []).map((r) => ({ id: r.id, kind: 'delivery_note', number: r.ddt_number || null, status: r.status || null, receivedAt: r.delivery_date || null, updatedAt: r.updated_at || null, confidence: r.confidence || null, needsReview: Boolean(r.needs_review), sourceEmailId: r.source_email_id || null, sourceDocumentId: r.source_document_id || null })),
    ...(invoices || []).map((r) => ({ id: r.id, kind: 'invoice', number: r.invoice_number || null, status: r.status || null, receivedAt: r.invoice_date || null, updatedAt: r.updated_at || null, confidence: r.confidence || null, needsReview: Boolean(r.needs_review), sourceEmailId: r.source_email_id || null, sourceDocumentId: r.source_document_id || null })),
    ...(documents || []).map((r) => ({ id: r.id, kind: r.document_type || 'document', number: r.name || null, status: r.status || null, receivedAt: r.received_at || null, updatedAt: r.updated_at || null, confidence: r.confidence || null, needsReview: Boolean(r.needs_review), sourceEmailId: r.source_email_id || null, sourceDocumentId: r.source_document_id || null }))
  ];

  // 6) coverageAndSyncHealth (org-wide)
  const coverageRows = await reqDb(`data_source_coverage?${filter}&select=source_key,label,status,reliability,message,limitation`);
  const coverageAndSyncHealth = {
    inboundEmail: coverageRows?.find((r) => r.source_key === 'inbound_email') || null,
    outboundEmail: coverageRows?.find((r) => r.source_key === 'outbound_email') || null,
    attachments: coverageRows?.find((r) => r.source_key === 'email_attachments') || null,
    operationalLinking: coverageRows?.find((r) => r.source_key === 'operational_linking') || null
  };

  // 7) anomalies & system health: include alerts that reference this order id or supplier
  //
  // system_health_alerts (view, verified live against information_schema.columns)
  // has no "id" column — its natural key is "alert_key" (e.g. "mailbox-error:<uuid>",
  // "extraction-errors-72h"), used here as the output identifier instead.
  // Verified live against the view's own SQL definition: none of its 6 current
  // alert kinds embed an order-specific identifier — mailbox alerts set
  // entity_id to the mailbox id (not an order), and the extraction/data-quality
  // alerts leave entity_id NULL with no orderId/orderCode key in metadata. The
  // metadata match below is therefore expected to legitimately find nothing
  // today; that is a correct, non-crashing "no order-linked alerts" outcome,
  // not a bug — it only requires proof (an exact id/code match) before ever
  // attaching an alert to this specific order, and none currently qualifies.
  const healthRows = await reqDb(`system_health_alerts?${filter}&select=alert_key,severity,title,message,target_view,metadata`);
  const anomaliesAndAttention = [];
  for (const r of (healthRows || [])) {
    try {
      if (!r.metadata) continue;
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
      if (!meta) continue;
      const metaOrderId = String(meta.orderId || meta.order_id || '').trim();
      const metaOrderCode = String(meta.orderCode || meta.order_code || '').trim();
      // require non-empty identifiers and exact match
      if (metaOrderId && metaOrderId.toLowerCase() === String(orderId).toLowerCase()) {
        anomaliesAndAttention.push({ id: r.alert_key, alertKey: r.alert_key, severity: r.severity, title: r.title, message: r.message, targetView: r.target_view });
        continue;
      }
      if (metaOrderCode && metaOrderCode.toLowerCase() === String(order.order_code || '').toLowerCase()) {
        anomaliesAndAttention.push({ id: r.alert_key, alertKey: r.alert_key, severity: r.severity, title: r.title, message: r.message, targetView: r.target_view });
        continue;
      }
    } catch {
      continue;
    }
  }

  // 8) evidenceReferences (collect from canonicalLineSources and linkedDocuments)
  const evidencePool = [];
  for (const src of canonicalLineSources || []) {
    if (src.source_email_id || src.source_document_id) {
      evidencePool.push({
        kind: 'line_source',
        id: null,
        entityType: src.entity_type || null,
        entityId: src.entity_id || null,
        sourceEmailId: src.source_email_id || null,
        sourceDocumentId: src.source_document_id || null,
        sourceLineNumber: src.source_line_number || null,
        observed_values: src.observed_values
      });
    }
  }
  for (const doc of linkedDocuments || []) {
    if (doc.sourceEmailId || doc.sourceDocumentId) evidencePool.push({ kind: doc.kind, id: doc.id || null, sourceEmailId: doc.sourceEmailId || null, sourceDocumentId: doc.sourceDocumentId || null });
  }

  const { list: evidenceReferencesList, registry } = assignRefs(evidencePool.map((e) => ({
    kind: e.kind,
    id: e.id || null,
    entityType: e.entityType || null,
    entityId: e.entityId || null,
    sourceEmailId: e.sourceEmailId || null,
    sourceDocumentId: e.sourceDocumentId || null,
    sourceLineNumber: e.sourceLineNumber || null
  })));

  // build quick lookup from source ids to refs
  const evidenceLookup = new Map();
  for (const v of registry.values()) {
    const row = v.row || {};
    if (row.entityId && row.sourceEmailId) evidenceLookup.set(`line-email:${row.entityId}:${row.sourceEmailId}:${row.sourceLineNumber || ''}`, v.ref);
    if (row.entityId && row.sourceDocumentId) evidenceLookup.set(`line-doc:${row.entityId}:${row.sourceDocumentId}:${row.sourceLineNumber || ''}`, v.ref);
    if (row.sourceEmailId) evidenceLookup.set(`email:${row.sourceEmailId}`, v.ref);
    if (row.sourceDocumentId) evidenceLookup.set(`doc:${row.sourceDocumentId}`, v.ref);
    if (row.id) evidenceLookup.set(`id:${row.id}`, v.ref);
  }

  // 9) safeEvidenceExcerpts — reuse observed_values where available but apply allowlist and size limits
  const safeEvidenceExcerpts = [];
  for (const val of registry.values()) {
    // find matching canonicalLineSources observed_values
    const found = (canonicalLineSources || []).find((s) => (
      String(s.entity_id || '') === String(val.row.entityId || '') &&
      String(s.source_line_number || '') === String(val.row.sourceLineNumber || '') &&
      (s.source_email_id === val.row.sourceEmailId || s.source_document_id === val.row.sourceDocumentId)
    ));
    if (found && found.observed_values) {
      const sanitized = sanitizeObservedValues(found.observed_values);
      safeEvidenceExcerpts.push({ ref: val.ref, excerpt: sanitized });
    } else {
      safeEvidenceExcerpts.push({ ref: val.ref, excerpt: null });
    }
  }

  // 10) commitments: feature disabled in first read-only version
  const activeCommitments = [];
  const supersededCommitments = [];

  // 11) canonical lines mapping to contract shape
  const canonicalMaterialLines = (lines || []).map((r) => ({
    id: r.id,
    entityKind: r.entity_kind,
    description: r.description,
    itemCode: r.item_code || null,
    quantity: r.quantity || null,
    deliveredQuantity: r.delivered_quantity || 0,
    remainingQuantity: r.remaining_quantity || null,
    unit: r.unit || null,
    requiredDate: r.required_date || null,
    dueDate: r.due_date || null,
    status: r.status || null,
    confidence: r.confidence || null,
    needsReview: Boolean(r.needs_review),
    canonicalKey: r.canonical_key || null,
    // provenance refs: map canonical_line_sources for this line to evidence refs
    provenanceRefs: (() => {
      try {
        const matches = (canonicalLineSources || []).filter((s) => String(s.entity_id) === String(r.id));
        const refs = new Set();
        for (const m of matches) {
          if (m.source_email_id) {
            const ref = evidenceLookup.get(`line-email:${r.id}:${m.source_email_id}:${m.source_line_number || ''}`) || evidenceLookup.get(`email:${m.source_email_id}`);
            if (ref) refs.add(ref);
          }
          if (m.source_document_id) {
            const ref = evidenceLookup.get(`line-doc:${r.id}:${m.source_document_id}:${m.source_line_number || ''}`) || evidenceLookup.get(`doc:${m.source_document_id}`);
            if (ref) refs.add(ref);
          }
        }
        return Array.from(refs);
      } catch {
        return [];
      }
    })()
  }));

  // 12) linkedDocuments normalized
  const linkedDocsNormalized = linkedDocuments.map((d) => ({ id: d.id, kind: d.kind, number: d.number, status: d.status, receivedAt: d.receivedAt, confidence: d.confidence, needsReview: d.needsReview, sourceEmailId: d.sourceEmailId, sourceDocumentId: d.sourceDocumentId }));

  const response = {
    tenantId: organizationId,
    orderId: order.id,
    orderNumber: order.order_code || null,
    summary: {
      orderNumber: order.order_code || null,
      supplierOrganizationName: order.supplier_name || null,
      supplierId: order.supplier_id || null,
      projectCode: order.project_code || null,
      material: order.material || null,
      quantity: order.quantity || null,
      status: order.status || null,
      alertLevel: order.alert_level || null,
      orderDate: order.order_date || null,
      dueDate: order.due_date || null,
      requiredDate: order.required_date || null,
      daysRemaining: order.days_remaining ?? null
    },

    currentObservedSituation: {
      label: null,
      severity: 'ok',
      reasonCodes: [],
      asOf: maxIsoTimestamp([
        order.updated_at,
        ...(lines || []).map((r) => r.updated_at),
        ...linkedDocuments.map((d) => d.updatedAt || d.receivedAt)
      ])
    },
    resolvedSupplierOrganization,
    resolvedSupplierContact: null, // unavailable in pilot per contract
    canonicalMaterialLines,
    linkedDocuments: linkedDocsNormalized,
    activeCommitments,
    supersededCommitments,
    activeCommitmentsAvailable: false,
    supersededCommitmentsAvailable: false,
    unresolvedEvidence: [],
    ambiguousEvidence: [],
    unresolvedEvidenceAvailable: false,
    ambiguousEvidenceAvailable: false,
    anomaliesAndAttention: anomaliesAndAttention || [],
    coverageAndSyncHealth,
    confidence: null,
    reasonCodes: [],
    evidenceReferences: evidenceReferencesList,
    safeEvidenceExcerpts,
    proposedActions: []
  };

  return response;
}

// Maps any error thrown by getOrderOperationalView to a safe HTTP response
// (status + body). Only the one already-classified, already-safe case
// (statusCode 404, "Order not found") is passed through as-is; every other
// error — a raw Supabase/PostgREST failure, a schema mismatch, a network
// error — becomes a generic Italian message with no table/column/SQL detail,
// while still preserving a genuine 4xx status code if one was set. Extracted
// as a pure function so it is directly testable without a real HTTP request.
export function toSafeErrorResponse(error) {
  if (error?.statusCode === 404) {
    return { status: 404, body: { error: "Order not found" } };
  }
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : 500;
  return { status, body: { error: "Impossibile caricare la vista operativa" } };
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin", "Buyer", "ReadOnly"] });
  if (!user) return;
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const orderId = String(request.query?.orderId || request.query?.id || request.params?.orderId || "").trim();
    if (!orderId) {
      response.status(400).json({ error: "Missing order id" });
      return;
    }
    const result = await getOrderOperationalView(user.organizationId, orderId);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(result);
  } catch (error) {
    // sanitizeSecurityError only redacts credential-like patterns, not
    // schema/SQL detail, so it is used only for the server-side log line —
    // never as response content. The response itself is built by
    // toSafeErrorResponse, which never repeats table/column/SQL text.
    console.error("[order-operational-view]", sanitizeSecurityError(error));
    const { status, body } = toSafeErrorResponse(error);
    response.status(status).json(body);
  }
}
