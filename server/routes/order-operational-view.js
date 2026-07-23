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
  const lines = await reqDb(
    `canonical_operational_lines?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,entity_kind,description,item_code,quantity,delivered_quantity,remaining_quantity,unit,required_date,due_date,status,confidence,needs_review,canonical_key,line_number,updated_at&order=line_number.asc`
  );

  // 4) canonicalLineSources for evidence excerpts
  const lineIds = (lines || []).map((r) => r.id).filter(Boolean);
  let canonicalLineSources = [];
  if (lineIds.length) {
    canonicalLineSources = await reqDb(
      `canonical_line_sources?entity_id=in.(${lineIds.map((id) => encodeURIComponent(id)).join(',')})&${filter}&select=entity_type,entity_id,source_email_id,source_document_id,source_line_number,observed_values`
    );
  }

  // 5) linkedDocuments: delivery_notes, invoices, quotes, documents
  const [deliveryNotes, invoices, quotes, documents] = await Promise.all([
    reqDb(`delivery_notes?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,ddt_number as number,status,delivery_date as receivedAt,confidence,needs_review,source_email_id,source_document_id,updated_at`),
    reqDb(`invoices?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,invoice_number as number,status,invoice_date as receivedAt,confidence,needs_review,source_email_id,source_document_id,updated_at`),
    reqDb(`quotes?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,quote_code as number,status,updated_at as receivedAt,confidence,needs_review,source_email_id,source_document_id,updated_at`),
    reqDb(`documents?order_id=eq.${encodeURIComponent(orderId)}&${filter}&select=id,doc_type as kind,doc_number as number,status,created_at as receivedAt,confidence,needs_review,source_email_id,source_document_id,updated_at`)
  ]);

  const linkedDocuments = [
    ...(deliveryNotes || []).map((r) => ({ id: r.id, kind: 'delivery_note', number: r.number || null, status: r.status || null, receivedAt: r.receivedAt || null, updatedAt: r.updated_at || null, confidence: r.confidence || null, needsReview: Boolean(r.needs_review), sourceEmailId: r.source_email_id || null, sourceDocumentId: r.source_document_id || null })),
    ...(invoices || []).map((r) => ({ id: r.id, kind: 'invoice', number: r.number || null, status: r.status || null, receivedAt: r.receivedAt || null, updatedAt: r.updated_at || null, confidence: r.confidence || null, needsReview: Boolean(r.needs_review), sourceEmailId: r.source_email_id || null, sourceDocumentId: r.source_document_id || null })),
    ...(quotes || []).map((r) => ({ id: r.id, kind: 'quote', number: r.number || null, status: r.status || null, receivedAt: r.receivedAt || null, updatedAt: r.updated_at || null, confidence: r.confidence || null, needsReview: Boolean(r.needs_review), sourceEmailId: r.source_email_id || null, sourceDocumentId: r.source_document_id || null })),
    ...(documents || []).map((r) => ({ id: r.id, kind: r.kind || 'document', number: r.number || null, status: r.status || null, receivedAt: r.receivedAt || null, updatedAt: r.updated_at || null, confidence: r.confidence || null, needsReview: Boolean(r.needs_review), sourceEmailId: r.source_email_id || null, sourceDocumentId: r.source_document_id || null }))
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
  const healthRows = await reqDb(`system_health_alerts?${filter}&select=id,alert_key,severity,title,message,target_view,metadata`);
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
        anomaliesAndAttention.push({ id: r.id, alertKey: r.alert_key, severity: r.severity, title: r.title, message: r.message, targetView: r.target_view });
        continue;
      }
      if (metaOrderCode && metaOrderCode.toLowerCase() === String(order.order_code || '').toLowerCase()) {
        anomaliesAndAttention.push({ id: r.id, alertKey: r.alert_key, severity: r.severity, title: r.title, message: r.message, targetView: r.target_view });
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
    const safe = sanitizeSecurityError(error);
    response.status(error.statusCode || 500).json({ error: "Unable to build order operational view", detail: safe });
  }
}
