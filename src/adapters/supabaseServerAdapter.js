import { getWorkflowPolicy } from "../config/workflowModes.js";

function extractEmailAddress(value) {
  const text = String(value || "").trim().toLowerCase();
  const bracketed = text.match(/<([^>]+)>/);
  return (bracketed?.[1] || text).trim();
}

function normalizeConversationSubject(value) {
  let subject = String(value || "").trim().toLowerCase();
  let previous;
  do {
    previous = subject;
    subject = subject
      .replace(/^\s*\[(?:ext|external)\]\s*/i, "")
      .replace(/^\s*(?:re|r|fw|fwd|i|inoltro)\s*:\s*/i, "");
  } while (subject !== previous);
  return subject.replace(/\s+/g, " ").trim();
}

function normalizePartyName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function partyConversationKey(item) {
  const subject = normalizeConversationSubject(item.sourceSubject);
  if (!subject) return null;
  const party = item.contactId || item.customerName || item.supplierName;
  return party ? `${String(party).toLowerCase()}|${subject}` : null;
}

function latestByDate(rows, dateSelector) {
  return [...rows].sort((a, b) => {
    const aTime = new Date(dateSelector(a) || 0).getTime();
    const bTime = new Date(dateSelector(b) || 0).getTime();
    return bTime - aTime;
  })[0];
}

function consolidateQuotesForQueue(quotes = []) {
  const groups = new Map();
  for (const quote of quotes) {
    const subject = normalizeConversationSubject(quote.sourceSubject);
    if (!subject) {
      groups.set(`quote:${quote.id}`, [quote]);
      continue;
    }
    const party = quote.contactId || quote.customerName || quote.supplierName || "unknown";
    const key = [String(party).toLowerCase(), quote.projectCode || "-", quote.quoteType || "-", subject].join("|");
    groups.set(key, [...(groups.get(key) || []), quote]);
  }
  return [...groups.values()].map((rows) => latestByDate(rows, (row) => row.createdAt));
}

function isOperationalBuyerAction(action) {
  const type = String(action.sourceClassificationType || "").toUpperCase();
  return !new Set([
    "NOISE",
    "OTHER",
    "SUPPLIER_INVOICE",
    "SUPPLIER_PAYMENT_REMINDER",
    "CUSTOMER_PAYMENT_REMINDER"
  ]).has(type);
}

function isOperationalArtifactSource(type) {
  return !new Set([
    "NOISE",
    "OTHER",
    "SUPPLIER_INVOICE",
    "SUPPLIER_PAYMENT_REMINDER",
    "CUSTOMER_PAYMENT_REMINDER"
  ]).has(String(type || "").toUpperCase());
}

function consolidateBuyerActionsForQueue(actions = []) {
  const groups = new Map();
  for (const action of actions.filter(isOperationalBuyerAction)) {
    const subject = normalizeConversationSubject(action.sourceSubject);
    if (!subject) {
      groups.set(`action:${action.id}`, [action]);
      continue;
    }
    const party = action.contactId || action.customerName || action.supplierName || "unknown";
    const key = [String(party).toLowerCase(), action.projectCode || "-", action.orderCode || "-", subject].join("|");
    groups.set(key, [...(groups.get(key) || []), action]);
  }
  return [...groups.values()].map((rows) => latestByDate(rows, (row) => row.actionAt || row.createdAt));
}

// Adapter Supabase per il backend prodotto. SOLO SERVER-SIDE: usa la service
// key, che non deve mai arrivare al browser. Airtable resta un fallback tecnico
// server-side, ma il prodotto ufficiale usa questa sorgente.
//
// CANCELLO 2 — isolamento multi-tenant: organizationId arriva SEMPRE dal
// contesto server (api/_auth.js -> requireApiUser), mai da un parametro
// client. request() lo applica automaticamente a ogni SELECT/UPDATE/DELETE
// (WHERE organization_id = ...) e lo impone su ogni INSERT (sovrascrivendo
// qualunque organization_id eventualmente presente nel body), cosi' nessuna
// chiamata su questo adapter puo' leggere o toccare dati di un altro tenant
// anche se un singolo metodo get*/update* se ne dimenticasse.
export function createSupabaseAdapter({ url, serviceKey, organizationId }) {
  function assertCredentials() {
    if (!url || !serviceKey) {
      throw new Error("Supabase url and serviceKey are required.");
    }
    if (!organizationId) {
      throw new Error("Missing organization context for Supabase adapter.");
    }
  }

  function scopePath(path, method) {
    // Il filtro organizzazione si applica alle condizioni WHERE (select/update/
    // delete); su un insert non ha senso in query string, viene messo nel body.
    if (method === "POST") return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}organization_id=eq.${encodeURIComponent(organizationId)}`;
  }

  function scopeBody(method, body) {
    if (!body || (method !== "POST" && method !== "PATCH")) return body;
    if (Array.isArray(body)) return body.map((row) => ({ ...row, organization_id: organizationId }));
    const { organization_id: _ignoredClientValue, ...rest } = body;
    return { ...rest, organization_id: organizationId };
  }

  async function request(path, { method = "GET", body, headers = {} } = {}) {
    assertCredentials();
    const response = await fetch(`${url}/rest/v1/${scopePath(path, method)}`, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...headers
      },
      body: body ? JSON.stringify(scopeBody(method, body)) : undefined
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Supabase request failed: ${response.status} ${path} ${detail.slice(0, 200)}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  const capitalize = (value) =>
    typeof value === "string" && value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value;

  // Gli ordini chiusi non devono passare dalla logica giorni-rimanenti del
  // frontend (getOrderStatus), altrimenti un ordine ricevuto con due date nel
  // passato verrebbe mostrato come Scaduto.
  const CLOSED_ORDER_STATUSES = new Set(["Ricevuto", "Annullato", "OK", "Concluso"]);

  const mappers = {
    orders: (row) => ({
      id: row.id,
      orderCode: row.order_code,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      projectCode: row.project_code,
      material: row.material,
      quantity: row.quantity,
      orderDate: row.order_date,
      dueDate: row.due_date,
      requiredDate: row.required_date,
      daysRemaining: row.days_remaining,
      status: CLOSED_ORDER_STATUSES.has(row.status) ? "CLOSED" : row.status,
      alertLevel: row.alert_level,
      owner: row.owner,
      needsReview: Boolean(row.needs_review),
      notes: row.notes,
      createdAt: row.created_at
    }),
    projects: (row) => ({
      id: row.id,
      projectCode: row.project_code,
      name: row.name,
      description: row.description,
      customer: row.customer,
      customerContactId: row.customer_contact_id,
      owner: row.owner,
      status: row.status,
      contractStatus: row.contract_status,
      contractWatchEnabled: Boolean(row.contract_watch_enabled),
      responsibleMembershipId: row.responsible_membership_id,
      createdByMembershipId: row.created_by_membership_id,
      startDate: row.start_date,
      expectedEndDate: row.expected_end_date,
      archivedAt: row.archived_at,
      dueDate: row.due_date,
      openOrders: row.open_orders_count,
      notes: row.notes,
      createdAt: row.created_at
    }),
    suppliers: (row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      onTimeRate: row.on_time_rate,
      openOrders: row.open_orders_count,
      risk: row.risk_level,
      score: row.score,
      notes: row.notes,
      registryStatus: row.registry_status || "verified",
      mergeStatus: row.merge_status || "active",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }),
    documents: (row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      supplierName: row.supplier_name,
      linkedOrder: row.linked_order_code,
      confidence: row.confidence,
      // La tabella documents non ha una colonna dedicata: usa la stessa
      // soglia del backend (confidence < 0.85 => revisione umana).
      needsHumanReview: row.confidence !== null && Number(row.confidence) < 0.85,
      receivedAt: row.received_at,
      sourceEmailId: row.source_email_id
    }),
    activities: (row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      detail: row.detail,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      actorMembershipId: row.actor_membership_id,
      metadata: row.metadata || {},
      orderCode: row.order_code,
      projectCode: row.project_code,
      supplierName: row.supplier_name,
      date: row.date
    }),
    reminders: (row) => ({
      id: row.id,
      orderCode: row.order_code,
      supplierName: row.supplier_name,
      sentTo: row.supplier_email,
      type: "Sollecito",
      status: row.status,
      subject: row.subject,
      sentAt: row.sent_at,
      body: row.body,
      errorDetail: row.error_detail
    }),
    materialLines: (row) => ({
      id: row.id,
      entityKind: row.entity_kind || "material_line",
      parentId: row.parent_id || null,
      projectId: row.project_id,
      orderId: row.order_id,
      quoteId: row.quote_id || null,
      deliveryNoteId: row.delivery_note_id || null,
      supplierId: row.supplier_id,
      sourceType: row.source_type,
      sourceEmailId: row.source_email_id,
      projectCode: row.project_code,
      orderCode: row.order_code,
      supplierName: row.supplier_name,
      customerName: row.customer_name,
      itemCode: row.item_code,
      description: row.description,
      quantity: row.quantity,
      deliveredQuantity: row.delivered_quantity,
      remainingQuantity: row.remaining_quantity,
      unit: row.unit,
      requiredDate: row.required_date,
      dueDate: row.due_date,
      status: row.status,
      confidence: row.confidence,
      needsReview: Boolean(row.needs_review),
      canonicalKey: row.canonical_key || null,
      identityKey: row.identity_key || null,
      createdAt: row.created_at
    }),
    materialLineRevisions: (row) => ({
      id: row.id,
      materialLineId: row.entity_id || row.material_line_id,
      revisionType: row.entity_type ? "observed" : row.revision_type,
      sourceEmailId: row.source_email_id,
      sourceDocumentId: row.source_document_id,
      previousValues: row.previous_values || {},
      newValues: row.observed_values || row.new_values || {},
      changedFields: row.changed_fields || [],
      summary: row.summary || "Dato osservato nella fonte originale",
      createdAt: row.created_at
    }),
    customerConfirmations: (row) => ({
      id: row.id,
      sourceEmailId: row.source_email_id,
      projectCode: row.project_code,
      orderCode: row.order_code,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      subject: row.subject,
      body: row.body,
      status: row.status,
      approvalRequired: Boolean(row.approval_required),
      preparedAt: row.prepared_at,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      senderMailboxId: row.sender_mailbox_id,
      sentAt: row.sent_at,
      messageId: row.smtp_message_id,
      lastError: row.last_error
    }),
    dailyReports: (row) => ({
      id: row.id,
      reportId: row.report_id,
      reportDate: row.report_date,
      recipientName: row.recipient_name,
      recipientEmail: row.recipient_email,
      criticalOrdersCount: row.critical_orders_count,
      status: row.status,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      sentAt: row.sent_at,
      errorDetail: row.error_detail
    }),
    // Mittente e oggetto restano visibili anche per le email OTHER: servono
    // al buyer per verificare che lo scarto automatico sia corretto (QA).
    processedEmails: (row) => ({
      id: row.id,
      messageId: row.message_id,
      mailbox: row.mailbox,
      from: row.from_address,
      subject: row.subject,
      receivedAt: row.received_at,
      direction: row.direction,
      classification: row.final_classification || row.pre_classification,
      preClassification: row.pre_classification,
      finalClassification: row.final_classification,
      classificationType: row.classification_type,
      classificationOrigin: row.classification_origin,
      contactId: row.contact_id,
      threadId: row.thread_id,
      skippedReason: row.skipped_reason,
      confidence: row.confidence,
      needsReview: Boolean(row.needs_review),
      hasAttachments: Boolean(row.has_attachments),
      attachmentCount: Number(row.attachment_count || 0),
      status: capitalize(row.status),
      linkedProjectCode: row.linked_project_code,
      linkedOrderCode: row.linked_order_code,
      errorDetail: row.error_detail
    }),
    settings: (row) => ({
      id: row.id,
      settingKey: row.key,
      value: row.value,
      type: row.type,
      description: row.description,
      group: row.group,
      status: capitalize(row.status),
      customerVisible: row.customer_visible ? "Yes" : "No"
    }),
    appUsers: (row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      active: Boolean(row.active),
      receivesDailyReport: Boolean(row.receives_daily_report),
      canManageSettings: Boolean(row.can_manage_settings),
      lastLoginAt: row.last_login_at,
      notes: row.notes
    }),
    mailboxes: (row) => ({
      id: row.id,
      mailboxName: row.mailbox_name,
      emailAddress: row.email_address,
      role: row.role,
      provider: row.provider,
      active: Boolean(row.active),
      connectionStatus: row.connection_status,
      mailboxSource: row.mailbox_source,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      lastCheckAt: row.last_check_at,
      connectedAt: row.connected_at,
      lastError: row.last_error,
      hasPassword: Boolean(row.encrypted_password),
      notes: row.notes
    }),
    reportRecipients: (row) => ({
      id: row.id,
      recipientName: row.recipient_name,
      email: row.email,
      role: row.role,
      active: Boolean(row.active),
      dailyReport: Boolean(row.daily_report),
      channel: row.channel,
      notes: row.notes
    }),
    reviewQueue: (row) => ({
      id: row.id,
      entity: row.entity,
      entityId: row.entityId,
      priority: row.priority,
      title: row.title,
      subtitle: row.subtitle,
      reason: row.reason,
      classificationOrigin: row.classificationOrigin,
      classificationType: row.classificationType,
      confidence: row.confidence,
      linkedOrderCode: row.linkedOrderCode,
      linkedProjectCode: row.linkedProjectCode,
      date: row.date
    }),
    quotes: (row) => ({
      id: row.id,
      quoteCode: row.quote_code,
      quoteType: row.quote_type,
      supplierName: row.supplier_name,
      customerName: row.customer_name,
      projectCode: row.project_code,
      quoteDate: row.quote_date,
      validUntil: row.valid_until,
      totalAmount: row.total_amount,
      currency: row.currency,
      status: row.status,
      confidence: row.confidence,
      needsReview: Boolean(row.needs_review),
      sourceEmailId: row.source_email_id,
      contactId: row.contact_id,
      sourceThreadId: row.source_thread_id,
      canonicalKey: row.canonical_key,
      notes: row.notes,
      createdAt: row.created_at
    }),
    deliveryNotes: (row) => ({
      id: row.id,
      ddtNumber: row.ddt_number,
      supplierName: row.supplier_name,
      orderCode: row.order_code,
      projectCode: row.project_code,
      deliveryDate: row.delivery_date,
      receivedDate: row.received_date,
      status: row.status,
      confidence: row.confidence,
      needsReview: Boolean(row.needs_review),
      sourceEmailId: row.source_email_id,
      notes: row.notes,
      createdAt: row.created_at
    }),
    invoices: (row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      invoiceType: row.invoice_type,
      supplierName: row.supplier_name,
      supplierVat: row.supplier_vat,
      customerName: row.customer_name,
      orderCode: row.order_code,
      projectCode: row.project_code,
      invoiceDate: row.invoice_date,
      dueDate: row.due_date,
      totalAmount: row.total_amount,
      currency: row.currency,
      status: row.status,
      confidence: row.confidence,
      needsReview: Boolean(row.needs_review),
      sourceEmailId: row.source_email_id,
      notes: row.notes,
      createdAt: row.created_at
    }),
    buyerActions: (row) => ({
      id: row.id,
      actionType: row.action_type,
      title: row.title,
      detail: row.detail,
      status: row.status,
      supplierName: row.supplier_name,
      orderCode: row.order_code,
      projectCode: row.project_code,
      sourceEmailId: row.source_email_id,
      actionAt: row.action_at,
      createdAt: row.created_at
    }),
    operationalActions: (row) => ({
      id: row.id,
      actionType: row.action_type,
      status: row.status,
      title: row.title,
      detail: row.detail,
      entityType: row.entity_type,
      entityId: row.entity_id,
      projectId: row.project_id,
      dueDate: row.due_date,
      assignedMembershipId: row.assigned_membership_id,
      createdByMembershipId: row.created_by_membership_id,
      completedAt: row.completed_at,
      metadata: row.metadata || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }),
    contractProgressReports: (row) => ({
      id: row.id,
      projectId: row.project_id,
      salNumber: row.sal_number,
      title: row.title,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      progressPercentage: row.progress_percentage,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      rejectionReason: row.rejection_reason,
      externalReference: row.external_reference,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }),
    contractBillingItems: (row) => ({
      id: row.id,
      projectId: row.project_id,
      progressReportId: row.progress_report_id,
      amount: row.amount,
      currency: row.currency,
      targetDate: row.target_date,
      status: row.status,
      issuedAt: row.issued_at,
      invoiceReference: row.invoice_reference,
      actionId: row.action_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  };

  const mapRows = (entityKey, rows) => (rows || []).map(mappers[entityKey]);

  return {
    async getDashboardData() {
      const [
        orders,
        projects,
        suppliers,
        documents,
        activities,
        reminders,
        materialLines,
        materialLineRevisions,
        dailyReports,
        processedEmails,
        settings,
        appUsers,
        mailboxes,
        reportRecipients,
        reviewQueue,
        quotes,
        deliveryNotes,
        invoices,
        buyerActions,
        operationalActions,
        contractProgressReports,
        contractBillingItems,
        customerConfirmations,
        organizationMemberships
      ] =
        await Promise.all([
          this.getOrders(),
          this.getProjects(),
          this.getSuppliers(),
          this.getDocuments(),
          this.getActivities(),
          this.getReminders(),
          this.getMaterialLines(),
          this.getMaterialLineRevisions(),
          this.getDailyReports(),
          this.getProcessedEmails(),
          this.getSettings(),
          this.getAppUsers(),
          this.getMailboxes(),
          this.getReportRecipients(),
          this.getReviewQueue(),
          this.getQuotes(),
          this.getDeliveryNotes(),
          this.getInvoices(),
          this.getBuyerActions(),
          this.getOperationalActions(),
          this.getContractProgressReports(),
          this.getContractBillingItems(),
          this.getCustomerConfirmations(),
          this.getOrganizationMemberships()
        ]);
      const [supplierDispatches, supplierContacts, contacts, contactEmails, contactAliases, contactCandidates] = await Promise.all([
        this.getSupplierDispatches(),
        this.getSupplierContacts(),
        this.getContacts(),
        this.getContactEmails(),
        this.getContactAliases(),
        this.getContactCandidates()
      ]);
      const settingsMap = Object.fromEntries((settings || []).map((s) => [s.settingKey, s.value]));
      const membershipByUser = new Map(
        (organizationMemberships || []).map((membership) => [membership.appUserId, membership])
      );
      const appUsersWithMembership = appUsers.map((appUser) => ({
        ...appUser,
        membershipId: membershipByUser.get(appUser.id)?.id || null
      }));
      const userByMembership = new Map(
        appUsersWithMembership.filter((user) => user.membershipId).map((user) => [user.membershipId, user])
      );
      const enrichedOperationalActions = operationalActions.map((action) => ({
        ...action,
        responsibleName: userByMembership.get(action.assignedMembershipId)?.fullName || null,
        projectCode: projects.find((project) => project.id === action.projectId)?.projectCode || null
      }));
      const emailById = new Map(processedEmails.map((email) => [email.id, email]));
      const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
      const activeContactByName = new Map();
      for (const contact of contacts.filter((item) => item.status === "active")) {
        activeContactByName.set(normalizePartyName(contact.legalName), contact);
      }
      for (const alias of contactAliases) {
        const contact = contactById.get(alias.contactId);
        if (contact?.status === "active") activeContactByName.set(normalizePartyName(alias.alias), contact);
      }
      const resolveContactByName = (name) => activeContactByName.get(normalizePartyName(name)) || null;
      const enrichNamedCounterparty = (entity) => {
        const sourceName = entity.customerName || entity.supplierName;
        const explicitContact = entity.contactId ? contactById.get(entity.contactId) : null;
        const contact = explicitContact?.status === "active" ? explicitContact : resolveContactByName(sourceName);
        if (!contact) return entity;
        const customerSide = Boolean(entity.customerName);
        return {
          ...entity,
          contactId: contact.id,
          counterpartyType: customerSide ? "customer" : "supplier",
          customerName: customerSide ? contact.legalName : entity.customerName,
          supplierName: customerSide ? entity.supplierName : contact.legalName
        };
      };
      const contactIdByEmail = new Map(
        contactEmails
          .filter((entry) => entry.matchEnabled !== false)
          .map((entry) => [String(entry.email || "").trim().toLowerCase(), entry.contactId])
      );
      const contactIdsByThread = new Map();
      for (const email of processedEmails) {
        const contact = email.contactId ? contactById.get(email.contactId) : null;
        if (!email.threadId || contact?.status !== "active") continue;
        const ids = contactIdsByThread.get(email.threadId) || new Set();
        ids.add(email.contactId);
        contactIdsByThread.set(email.threadId, ids);
      }
      const contactIdByThread = new Map(
        [...contactIdsByThread.entries()]
          .filter(([, ids]) => ids.size === 1)
          .map(([threadId, ids]) => [threadId, [...ids][0]])
      );
      const genericDomains = new Set(["gmail.com", "outlook.com", "hotmail.com", "icloud.com", "yahoo.com", "libero.it"]);
      const contactIdsByDomain = new Map();
      for (const entry of contactEmails.filter((item) => item.matchEnabled !== false)) {
        const domain = extractEmailAddress(entry.email).split("@")[1];
        const contact = contactById.get(entry.contactId);
        if (!domain || genericDomains.has(domain) || contact?.status !== "active") continue;
        const ids = contactIdsByDomain.get(domain) || new Set();
        ids.add(entry.contactId);
        contactIdsByDomain.set(domain, ids);
      }
      const contactIdByDomain = new Map(
        [...contactIdsByDomain.entries()]
          .filter(([, ids]) => ids.size === 1)
          .map(([domain, ids]) => [domain, [...ids][0]])
      );
      const enrichedBuyerActions = buyerActions.map((action) => {
        const sourceEmail = emailById.get(action.sourceEmailId);
        const address = extractEmailAddress(sourceEmail?.from);
        const domain = address.split("@")[1];
        // Una singola email storica puo' non avere contact_id anche quando un
        // altro messaggio della stessa conversazione e' gia' stato associato.
        // Ereditiamo il contatto solo se nel thread ne esiste esattamente uno:
        // in presenza di ambiguita' lasciamo l'azione da identificare.
        const contactId = sourceEmail?.contactId ||
          contactIdByThread.get(sourceEmail?.threadId) ||
          contactIdByEmail.get(address) ||
          contactIdByDomain.get(domain) ||
          null;
        const contact = contactById.get(contactId);
        const origin = String(sourceEmail?.classificationOrigin || "").toUpperCase();
        const contactName = contact?.legalName || null;

        return {
          ...action,
          contactId,
          counterpartyType: origin === "CUSTOMER" ? "customer" : origin === "SUPPLIER" ? "supplier" : null,
          customerName: origin === "CUSTOMER" ? contactName : null,
          supplierName: action.supplierName || (origin === "SUPPLIER" ? contactName : null),
          sourceSubject: sourceEmail?.subject || null,
          sourceClassificationOrigin: origin || null,
          sourceClassificationType: sourceEmail?.classificationType || null
        };
      });
      const enrichedQuotes = quotes.map((quote) => {
        const sourceEmail = emailById.get(quote.sourceEmailId);
        const contactId = quote.contactId || sourceEmail?.contactId || null;
        const contact = contactById.get(contactId);
        const isCustomer = quote.quoteType === "customer_quote_request" || sourceEmail?.classificationOrigin === "CUSTOMER";
        const isSupplier = quote.quoteType === "supplier_quote" || sourceEmail?.classificationOrigin === "SUPPLIER";
        return enrichNamedCounterparty({
          ...quote,
          contactId,
          customerName: isCustomer && contact?.legalName ? contact.legalName : quote.customerName,
          supplierName: isSupplier && contact?.legalName ? contact.legalName : quote.supplierName,
          sourceSubject: sourceEmail?.subject || null,
          sourceClassificationType: sourceEmail?.classificationType || null
        });
      });
      const enrichedMaterialLines = materialLines.map(enrichNamedCounterparty);
      const enrichedDeliveryNotes = deliveryNotes.map(enrichNamedCounterparty);
      const traceabilityMode = settingsMap["workflow.traceability_mode"] || "required_link";
      const visibleOrders = traceabilityMode === "supplier_only"
        ? orders.filter((order) => !/^(GCG-AI-|DDT-)/i.test(String(order.orderCode || "")))
        : orders;
      const operationalQueue = buildOperationalQueue({
        materialLines: enrichedMaterialLines,
        quotes: enrichedQuotes,
        deliveryNotes: enrichedDeliveryNotes,
        invoices,
        processedEmails,
        buyerActions: enrichedBuyerActions,
        operationalActions: enrichedOperationalActions,
        customerConfirmations,
        supplierDispatches,
        settingsMap
      });
      const operationalSuggestions = buildOperationalSuggestions({
        materialLines: enrichedMaterialLines,
        deliveryNotes: enrichedDeliveryNotes,
        invoices,
        settingsMap
      });
      return {
        orders: visibleOrders,
        projects,
        suppliers,
        documents,
        activities,
        reminders,
        materialLines,
        materialLineRevisions,
        dailyReports,
        processedEmails,
        settings,
        appUsers: appUsersWithMembership,
        mailboxes,
        reportRecipients,
        quotes: enrichedQuotes,
        deliveryNotes: enrichedDeliveryNotes,
        invoices,
        buyerActions: enrichedBuyerActions,
        operationalActions: enrichedOperationalActions,
        contractProgressReports,
        contractBillingItems,
        customerConfirmations,
        supplierDispatches,
        supplierContacts,
        contacts,
        contactEmails,
        contactAliases,
        contactCandidates,
        reviewQueue,
        reviewSummary: {
          total: reviewQueue.length,
          high: reviewQueue.filter((item) => item.priority === "high").length,
          medium: reviewQueue.filter((item) => item.priority === "medium").length
        },
        operationalQueue,
        operationalSummary: summarizeOperationalQueue(operationalQueue),
        operationalSuggestions
      };
    },
    async getOrders() {
      return mapRows("orders", await request("orders?select=*&order=due_date.asc.nullslast"));
    },
    async getProjects() {
      return mapRows("projects", await request("projects?select=*&order=created_at.desc"));
    },
    async getSuppliers() {
      return mapRows(
        "suppliers",
        await request("suppliers?select=*&merge_status=neq.merged&registry_status=neq.ignored&order=name.asc")
      );
    },
    async getDocuments() {
      return mapRows("documents", await request("documents?select=*&order=received_at.desc&limit=200"));
    },
    async getActivities() {
      return mapRows("activities", await request("activities?select=*&order=date.desc&limit=200"));
    },
    async getReminders() {
      return mapRows("reminders", await request("reminders?select=*&order=created_at.desc&limit=200"));
    },
    async getMaterialLines() {
      return mapRows("materialLines", await request("canonical_operational_lines?select=*&order=created_at.desc&limit=500"));
    },
    async getMaterialLineRevisions() {
      return mapRows("materialLineRevisions", await request("canonical_line_sources?select=*&order=created_at.asc&limit=1000"));
    },
    async getDailyReports() {
      return mapRows("dailyReports", await request("daily_reports?select=*&order=report_date.desc&limit=90"));
    },
    async getProcessedEmails() {
      // Le azioni aperte possono riferirsi a conversazioni meno recenti. Con
      // 200 record la relativa email spariva dal dataset e la controparte non
      // era piu' risolvibile, pur essendo presente in anagrafica.
      return mapRows("processedEmails", await request("processed_emails?select=*&order=received_at.desc&limit=500"));
    },
    async getSettings() {
      return mapRows("settings", await request('settings?select=*&order="group".asc,key.asc'));
    },
    async getAppUsers() {
      return mapRows("appUsers", await request("app_users?select=*&order=full_name.asc"));
    },
    async getMailboxes() {
      return mapRows("mailboxes", await request("mailboxes?select=*&order=mailbox_name.asc"));
    },
    async getReportRecipients() {
      return mapRows("reportRecipients", await request("report_recipients?select=*&order=recipient_name.asc"));
    },
    async getReviewQueue() {
      // La review queue e' una vista logica costruita dal backend prodotto.
      // Qui si legge direttamente solo quando verra' esposta come endpoint API;
      // per ora il fallback server-side resta vuoto.
      return [];
    },
    async getQuotes() {
      return mapRows("quotes", await request("quotes?select=*&order=created_at.desc&limit=200"));
    },
    async getSupplierDispatches() {
      return (await request("supplier_order_dispatches?select=*&order=created_at.desc&limit=200")).map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderCode: row.order_code,
        projectCode: row.project_code,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        supplierEmail: row.supplier_email,
        contactName: row.contact_name,
        senderMailboxId: row.sender_mailbox_id,
        subject: row.subject,
        body: row.body,
        status: row.status,
        lines: Array.isArray(row.line_snapshot) ? row.line_snapshot : [],
        sentAt: row.sent_at,
        promisedDate: row.promised_date,
        reminderCount: row.reminder_count,
        lastReminderAt: row.last_reminder_at
      }));
    },
    async getSupplierContacts() {
      return (await request("supplier_contacts?select=*&order=is_primary.desc&limit=500")).map((row) => ({
        id: row.id,
        supplierId: row.supplier_id,
        name: row.name,
        email: row.email,
        role: row.role,
        isPrimary: Boolean(row.is_primary)
      }));
    },
    async getContacts() {
      return (await request("contacts?select=*&order=legal_name.asc&limit=1000")).map((row) => ({
        id: row.id,
        legalName: row.legal_name,
        normalizedName: row.normalized_name,
        type: row.type,
        vatNumber: row.vat_number,
        domain: row.domain,
        verificationStatus: row.verification_status,
        status: row.status,
        mergedIntoContactId: row.merged_into_contact_id,
        source: row.source,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },
    async getContactEmails() {
      return (await request("contact_emails?select=*&order=is_primary.desc,created_at.asc&limit=2000")).map((row) => ({
        id: row.id,
        contactId: row.contact_id,
        email: row.email,
        isPrimary: Boolean(row.is_primary),
        verified: Boolean(row.verified),
        matchEnabled: Boolean(row.match_enabled),
        source: row.source
      }));
    },
    async getContactAliases() {
      return (await request("contact_aliases?select=*&order=created_at.asc&limit=2000")).map((row) => ({
        id: row.id,
        contactId: row.contact_id,
        alias: row.alias,
        verified: Boolean(row.verified),
        source: row.source
      }));
    },
    async getContactCandidates() {
      return (await request("contact_candidates?select=*&status=eq.pending&order=created_at.desc&limit=500")).map((row) => ({
        id: row.id,
        sourceEmailId: row.source_email_id,
        sourceContactId: row.source_contact_id,
        proposedName: row.proposed_name,
        proposedEmail: row.proposed_email,
        proposedType: row.proposed_type,
        matchedContactId: row.matched_contact_id,
        matchMethod: row.match_method,
        similarity: row.similarity === null ? null : Number(row.similarity),
        status: row.status,
        metadata: row.metadata || {},
        createdAt: row.created_at
      }));
    },
    async getDeliveryNotes() {
      return mapRows("deliveryNotes", await request("delivery_notes?select=*&order=created_at.desc&limit=200"));
    },
    async getInvoices() {
      return mapRows("invoices", await request("invoices?select=*&order=created_at.desc&limit=200"));
    },
    async getBuyerActions() {
      return mapRows("buyerActions", await request("buyer_actions?select=*&order=created_at.desc&limit=200"));
    },
    async getOperationalActions() {
      return mapRows("operationalActions", await request("operational_actions?select=*&order=created_at.desc&limit=200"));
    },
    async getContractProgressReports() {
      return mapRows("contractProgressReports", await request("contract_progress_reports?select=*&order=created_at.desc&limit=500"));
    },
    async getContractBillingItems() {
      return mapRows("contractBillingItems", await request("contract_billing_items?select=*&order=created_at.desc&limit=500"));
    },
    async getCustomerConfirmations() {
      return mapRows("customerConfirmations", await request("customer_confirmations?select=*&order=created_at.desc&limit=200"));
    },
    async getOrganizationMemberships() {
      return (await request("organization_memberships?select=id,app_user_id,role,active&active=eq.true")).map((row) => ({
        id: row.id,
        appUserId: row.app_user_id,
        role: row.role,
        active: Boolean(row.active)
      }));
    },
    async updateSetting(id, fields) {
      const patch = {};
      if ("value" in fields) patch.value = fields.value;
      if ("status" in fields) patch.status = String(fields.status).toLowerCase();
      if ("description" in fields) patch.description = fields.description;

      const rows = await request(`settings?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: patch,
        headers: { Prefer: "return=representation" }
      });

      if (!rows || !rows.length) {
        throw new Error("Setting not found or not updated.");
      }
      return mappers.settings(rows[0]);
    }
  };
}

export function buildOperationalQueue({ materialLines, quotes, deliveryNotes, invoices, processedEmails, buyerActions, operationalActions = [], customerConfirmations, supplierDispatches = [], settingsMap = {} }) {
  const traceabilityMode = settingsMap["workflow.traceability_mode"] || "required_link";
  const workflowPolicy = getWorkflowPolicy(traceabilityMode);
  const confirmationByEmail = new Map((customerConfirmations || []).map((item) => [item.sourceEmailId, item]));
  const customerEmailSeen = new Set();
  const processedEmailById = new Map((processedEmails || []).map((email) => [email.id, email]));
  // Righe gia' coperte da un dispatch ordine fornitore attivo: non riproporle come "da ordinare".
  const linesWithActiveDispatch = new Set(
    (supplierDispatches || [])
      .filter((d) => ["draft", "approved", "sent", "waiting_confirmation"].includes(d.status))
      .flatMap((d) => (d.lines || []).map((l) => l.id))
  );
  const materialItems = materialLines
    // Quote e DDT hanno gia' una propria entita' operativa. Mostrarne anche
    // ogni riga come attivita' separata produrrebbe due verita' per lo stesso
    // fatto (preventivo + righe preventivo, DDT + righe DDT).
    .filter((line) => ["project_requirement", "purchase_order_line"].includes(line.entityKind))
    .filter((line) => isOperationalArtifactSource(processedEmailById.get(line.sourceEmailId)?.classificationType))
    .flatMap((line) => {
      const exposeConfirmation = line.sourceType === "customer_request" && line.sourceEmailId && !customerEmailSeen.has(line.sourceEmailId);
      if (exposeConfirmation) customerEmailSeen.add(line.sourceEmailId);
      return materialLineToOperationalItems(
        line,
        confirmationByEmail.get(line.sourceEmailId),
        exposeConfirmation,
        linesWithActiveDispatch,
        settingsMap["workflow.traceability_mode"] || "required_link"
      );
    });
  const queueQuotes = consolidateQuotesForQueue(quotes.filter((quote) => isOperationalArtifactSource(quote.sourceClassificationType)));
  const quoteConversationKeys = new Set(queueQuotes.map(partyConversationKey).filter(Boolean));
  const queueBuyerActions = consolidateBuyerActionsForQueue(
    buyerActions.filter((action) => action.status !== "done")
  ).filter((action) => {
    const key = partyConversationKey(action);
    // Se la stessa conversazione ha gia' prodotto un preventivo azionabile,
    // la generica buyer_action non deve creare una seconda verita' in Oggi.
    return !key || !quoteConversationKeys.has(key);
  });

  const items = [
    ...materialItems,
    ...queueQuotes.flatMap(quoteToOperationalItems),
    ...deliveryNotes.flatMap((note) => deliveryNoteToOperationalItems(note, traceabilityMode)),
    // Errori/importazioni in corso NON compaiono piu' nella coda "Oggi": sono
    // segnalazioni tecniche di sistema, non attivita' del buyer. Restano
    // visibili e verificabili nella vista Importazioni.
    // Le fatture non entrano nella coda "Oggi": non e' lo scope di OrderWatch
    // (nessuna gestione contabile/pagamenti). Restano nel tab Fatture dedicato.
    ...queueBuyerActions.map(actionToOperationalItem),
    ...operationalActions.filter((action) => action.status === "open").map(sharedActionToOperationalItem),
    // Gating backend: se il modulo ordini fornitore non e' nel piano del
    // cliente, questi item non compaiono affatto in coda.
    ...(workflowPolicy.allowSupplierOrderPreparation && String(settingsMap["modules.supplier_orders"] ?? "true").toLowerCase() !== "false"
      ? (supplierDispatches || []).flatMap((dispatch) => dispatchToOperationalItems(dispatch, settingsMap))
      : [])
  ];

  const visibleItems = workflowPolicy.exceptionsOnly
    // Essenziale: Oggi e' una coda di eccezioni, non l'elenco di tutto cio'
    // che e' aperto. Restano ritardi, criticita', errori e verifiche reali.
    // I preventivi restano nella loro vista anche quando l'estrazione e'
    // incerta: entrano in Oggi soltanto con una scadenza davvero critica.
    ? items.filter((item) => item.status !== "needs_link" && (
      item.kind === "quote"
        ? ["overdue", "due_soon"].includes(item.status)
        : ["urgent", "high"].includes(item.priority)
    ))
    : workflowPolicy.suggestsLinks
      // Assistito: i preventivi semplicemente aperti e i collegamenti
      // facoltativi vivono fuori dalla coda obbligatoria.
      ? items.filter((item) => item.status !== "needs_link" && item.status !== "quote_open")
      : items;

  const displayItems = workflowPolicy.groupSupplierMaterialLines
    ? groupSupplierMaterialItems(visibleItems)
    : visibleItems;

  return displayItems.sort((a, b) => {
    const priorityDelta = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (priorityDelta) return priorityDelta;
    return new Date(b.sortDate || b.date || 0).getTime() - new Date(a.sortDate || a.date || 0).getTime();
  });
}

const OPERATIONAL_PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };

function normalizedSupplierKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|societa|unipersonale)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedOperationalOrderReference(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(ORDINE|ORD|ORDER|PEDIDO|RIFERIMENTO|RIF|REF|NUMERO|NO|N)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!normalized) return "";
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, "") : normalized;
}

function supplierMaterialGroupKey(item) {
  if (item.kind !== "material_line" || !item.supplierName || item.sourceType === "customer_request") return null;
  // L'ID canonico prevale sul nome visuale: alias come MAKITO, Makito Italia
  // e Makito Promotional non devono separare lo stesso ordine dopo la
  // riconciliazione anagrafica.
  const supplier = item.supplierId ? `id:${item.supplierId}` : `name:${normalizedSupplierKey(item.supplierName)}`;
  if (!supplier) return null;
  const orderCode = String(item.orderCode || "").trim();
  const reliableOrderCode = orderCode && !/^(GCG-AI-|DDT-)/i.test(orderCode);
  const normalizedOrder = reliableOrderCode ? normalizedOperationalOrderReference(orderCode) : "";

  // Il riferimento affidabile identifica l'ordine anche attraverso email
  // successive. Senza riferimento, la singola email/documento resta il solo
  // perimetro sicuro: non raggruppiamo mai usando soltanto il fornitore.
  if (normalizedOrder) return `${supplier}|order:${normalizedOrder}`;
  if (item.sourceEmailId) return `${supplier}|email:${item.sourceEmailId}|senza-riferimento`;
  return null;
}

export function groupSupplierMaterialItems(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = supplierMaterialGroupKey(item);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  const emitted = new Set();
  const result = [];
  for (const item of items) {
    const key = supplierMaterialGroupKey(item);
    const lines = key ? groups.get(key) : null;
    if (!lines || lines.length < 2) {
      result.push(item);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);

    const orderedLines = [...lines].sort((a, b) => {
      const dateDelta = new Date(a.dueDate || "9999-12-31").getTime() - new Date(b.dueDate || "9999-12-31").getTime();
      if (dateDelta) return dateDelta;
      return String(a.title || "").localeCompare(String(b.title || ""), "it");
    });
    const datedLines = orderedLines.filter((line) => line.dueDate);
    const dueDate = datedLines[0]?.dueDate || null;
    const dateCount = new Set(datedLines.map((line) => line.dueDate)).size;
    const reviewCount = orderedLines.filter((line) => line.status === "needs_review").length;
    const linkCount = orderedLines.filter((line) => line.status === "needs_link").length;
    const priority = orderedLines.reduce((highest, line) =>
      (OPERATIONAL_PRIORITY_WEIGHT[line.priority] || 0) > (OPERATIONAL_PRIORITY_WEIGHT[highest] || 0) ? line.priority : highest
    , "low");
    const status = reviewCount
      ? "needs_review"
      : linkCount
        ? "needs_link"
        : orderedLines.find((line) => line.status === "overdue")?.status || orderedLines[0].status;
    const confidenceValues = orderedLines.map((line) => Number(line.confidence)).filter(Number.isFinite);
    const orderCode = orderedLines.find((line) => line.orderCode)?.orderCode || null;
    const supplierName = orderedLines[0].supplierName;

    result.push({
      id: `supplier-material-group-${encodeURIComponent(key)}`,
      kind: "supplier_material_group",
      priority,
      status,
      title: orderCode ? `Ordine ${orderCode}` : "Materiali ricevuti dal fornitore",
      subtitle: supplierName,
      detail: [
        `${orderedLines.length} righe materiale`,
        dateCount > 1 ? `${dateCount} date di consegna` : dateCount === 1 ? "Una data di consegna" : "Date da verificare",
        reviewCount ? `${reviewCount} ${reviewCount === 1 ? "riga da verificare" : "righe da verificare"}` : null,
        linkCount ? `${linkCount} ${linkCount === 1 ? "riga da collegare" : "righe da collegare"}` : null
      ].filter(Boolean).join(" · "),
      actionLabel: reviewCount ? "Verifica righe" : linkCount ? "Collega righe" : "Vedi righe",
      dueDate,
      orderCode,
      projectCode: orderedLines.find((line) => line.projectCode)?.projectCode || null,
      supplierName,
      contactId: orderedLines.find((line) => line.contactId)?.contactId || null,
      counterpartyType: "supplier",
      confidence: confidenceValues.length ? Math.min(...confidenceValues) : null,
      date: orderedLines[0].date,
      sortDate: dueDate || orderedLines[0].sortDate,
      lineItems: orderedLines
    });
  }
  return result;
}

export function buildOperationalSuggestions({ materialLines = [], deliveryNotes = [], invoices = [], settingsMap = {} }) {
  if (!getWorkflowPolicy(settingsMap["workflow.traceability_mode"] || "required_link").suggestsLinks) return [];

  const materialSuggestions = materialLines
    .filter((line) => {
      const technicalOrder = /^(GCG-AI-|DDT-)/i.test(String(line.orderCode || ""));
      const unlinked = (!line.orderCode && !line.projectCode) || technicalOrder;
      return unlinked && !line.needsReview && Number(line.confidence || 0) >= 0.85;
    })
    .map((line) => ({
      id: `suggestion-material-${line.id}`,
      kind: "material_line",
      entityId: line.id,
      priority: "low",
      status: "suggested_link",
      title: line.description || "Materiale senza collegamento",
      subtitle: line.supplierName || line.customerName || "",
      detail: "Se utile, puoi collegarlo a una commessa o a un ordine. Non e' obbligatorio.",
      actionLabel: "Collega a lavoro o ordine",
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      customerName: line.customerName,
      sourceEmailId: line.sourceEmailId,
      sourceType: line.sourceType,
      itemCode: line.itemCode,
      quantity: line.quantity,
      unit: line.unit,
      dueDate: line.dueDate || line.requiredDate,
      date: line.createdAt
    }));

  // Le fatture non compaiono neanche come suggerimento facoltativo: non e'
  // lo scope di OrderWatch. Restano nel tab Fatture dedicato.
  const documentSuggestions = [
    ...deliveryNotes.filter((item) => !item.orderCode && !item.projectCode && !item.needsReview).map((item) => ({
      id: `suggestion-ddt-${item.id}`,
      kind: "delivery_note",
      entityId: item.id,
      priority: "low",
      status: "suggested_link",
      title: item.ddtNumber || "DDT senza collegamento",
      subtitle: item.supplierName || "",
      detail: "Collegamento facoltativo a ordine o commessa.",
      actionLabel: "Collega DDT",
      supplierName: item.supplierName,
      sourceEmailId: item.sourceEmailId,
      date: item.createdAt
    }))
  ];

  return [...materialSuggestions, ...documentSuggestions]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 100);
}

function summarizeOperationalQueue(items) {
  const byKind = {};
  const byPriority = {};
  const byStatus = {};

  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }

  return {
    total: items.length,
    urgent: byPriority.urgent || 0,
    high: byPriority.high || 0,
    medium: byPriority.medium || 0,
    low: byPriority.low || 0,
    byKind,
    byPriority,
    byStatus
  };
}

function materialLineToOperationalItems(line, confirmation, exposeConfirmation = false, linesWithActiveDispatch = new Set(), traceabilityMode = "required_link") {
  const dueDate = line.dueDate || line.requiredDate || null;
  const dateState = dueDate ? classifyDateState(dueDate) : null;
  const technicalOrder = /^(GCG-AI-|DDT-)/i.test(String(line.orderCode || ""));
  const unlinked = (!line.orderCode && !line.projectCode) || technicalOrder;
  const linkRequired = getWorkflowPolicy(traceabilityMode).requiresLinks;
  const linkActionable = unlinked && linkRequired;
  // Righe storiche Graphic Center potevano essere marcate "Da verificare"
  // soltanto per l'assenza del codice ordine. In modalita' Essenziale una
  // riga fornitore ad alta confidenza non deve restare nella coda per questo.
  const legacyLinkOnlyReview = !linkRequired && unlinked && Boolean(line.supplierName) && Number(line.confidence || 0) >= 0.85;
  const needsReview = (Boolean(line.needsReview) || line.status === "Da verificare") && !legacyLinkOnlyReview;
  const confirmationPending = exposeConfirmation && confirmation?.status !== "sent" && confirmation?.status !== "cancelled";
  const confirmationFailed = confirmationPending && confirmation?.status === "failed";
  // FASE 2 — la riga puo' diventare un ordine verso il fornitore se ha un
  // fornitore e non e' gia' coperta da un dispatch attivo.
  const canPrepareSupplierOrder = Boolean(line.supplierName) && !linesWithActiveDispatch.has(line.id);

  if (!linkActionable && !needsReview && !dateState?.isActionable && !confirmationPending) return [];

  return [{
    canPrepareSupplierOrder,
    id: `material-line-${line.id}`,
    kind: "material_line",
    entityId: line.id,
    priority: confirmationFailed ? "urgent" : needsReview || linkActionable ? "high" : confirmationPending ? "medium" : dateState.priority,
    status: needsReview ? "needs_review" : linkActionable ? "needs_link" : confirmationFailed ? "confirmation_failed" : confirmationPending ? "confirmation_pending" : dateState.status,
    title: line.description || "Materiale da verificare",
    subtitle: [line.supplierName || line.customerName, line.projectCode || line.orderCode].filter(Boolean).join(" - "),
    detail: [
      line.quantity ? `Quantita': ${line.quantity}${line.unit ? ` ${line.unit}` : ""}` : null,
      linkActionable ? "Da associare a lavoro/ordine" : null,
      needsReview ? "Richiede verifica" : null,
      confirmationPending ? (confirmation ? "Conferma cliente pronta da approvare" : "Conferma ricezione cliente da preparare") : null,
      dateState?.label ? dateState.label.replace(/\.$/, "") : null
    ].filter(Boolean).join(" · "),
    actionLabel: needsReview || linkActionable ? "Associa/verifica" : confirmationPending ? (confirmation ? "Rivedi conferma cliente" : "Prepara conferma cliente") : "Controlla consegna",
    dueDate,
    projectCode: line.projectCode,
    orderCode: line.orderCode,
    supplierId: line.supplierId,
    supplierName: line.supplierName,
    customerName: line.customerName,
    contactId: line.contactId,
    counterpartyType: line.counterpartyType,
    sourceType: line.sourceType,
    sourceEmailId: line.sourceEmailId,
    confirmation: confirmation || null,
    confidence: line.confidence,
    itemCode: line.itemCode,
    quantity: line.quantity,
    unit: line.unit,
    lineStatus: line.status,
    date: line.createdAt,
    sortDate: dueDate || line.createdAt
  }];
}

// FASE 2/5 — item coda per dispatch ordine fornitore:
// - draft/approved -> completa e invia l'ordine;
// - waiting_confirmation oltre i giorni configurati -> prepara sollecito.
function dispatchToOperationalItems(dispatch, settingsMap = {}) {
  const status = dispatch.status;
  if (status === "draft" || status === "approved") {
    return [{
      id: `supplier-order-${dispatch.id}`,
      kind: "supplier_order",
      entityId: dispatch.id,
      dispatchId: dispatch.id,
      priority: "high",
      status: status === "approved" ? "order_approved" : "order_draft",
      title: `Ordine ${dispatch.orderCode} da inviare a ${dispatch.supplierName || "fornitore"}`,
      subtitle: [dispatch.supplierName, dispatch.projectCode].filter(Boolean).join(" · "),
      detail: status === "approved" ? "Ordine approvato: pronto per l'invio al fornitore." : "Bozza ordine pronta: completa destinatario e invia.",
      actionLabel: status === "approved" ? "Invia ordine" : "Completa ordine",
      orderCode: dispatch.orderCode,
      projectCode: dispatch.projectCode,
      supplierName: dispatch.supplierName,
      date: dispatch.sentAt || null,
      sortDate: null
    }];
  }

  if (status === "waiting_confirmation") {
    const days = Number(settingsMap["supplier_reminders.days_after_send"] || 3);
    const maxAttempts = Number(settingsMap["supplier_reminders.max_attempts"] || 2);
    const remindersEnabled = String(settingsMap["supplier_reminders.enabled"] ?? "true").toLowerCase() === "true";
    const sentAt = dispatch.sentAt ? new Date(dispatch.sentAt) : null;
    const overdue = sentAt ? (Date.now() - sentAt.getTime()) / 86400000 >= days : false;
    if (remindersEnabled && overdue && Number(dispatch.reminderCount || 0) < maxAttempts) {
      return [{
        id: `supplier-reminder-${dispatch.id}`,
        kind: "supplier_reminder",
        entityId: dispatch.id,
        dispatchId: dispatch.id,
        priority: "high",
        status: "reminder_due",
        title: `Sollecita ${dispatch.supplierName || "fornitore"} per l'ordine ${dispatch.orderCode}`,
        subtitle: [dispatch.supplierName, dispatch.projectCode].filter(Boolean).join(" · "),
        detail: `Ordine inviato senza conferma da oltre ${days} giorni. Solleciti gia' inviati: ${dispatch.reminderCount || 0}/${maxAttempts}.`,
        actionLabel: "Prepara sollecito",
        orderCode: dispatch.orderCode,
        projectCode: dispatch.projectCode,
        supplierName: dispatch.supplierName,
        date: dispatch.sentAt,
        sortDate: dispatch.sentAt
      }];
    }
  }

  return [];
}

function quoteToOperationalItems(quote) {
  const needsReview = Boolean(quote.needsReview) || quote.status === "to_review";
  const open = !["converted", "discarded", "closed"].includes(String(quote.status || "").toLowerCase());
  if (!needsReview && !open) return [];
  const dateState = quote.validUntil ? classifyDateState(quote.validUntil) : null;

  return [{
    id: `quote-${quote.id}`,
    kind: "quote",
    entityId: quote.id,
    priority: needsReview ? "high" : dateState?.isActionable ? dateState.priority : "medium",
    status: needsReview ? "needs_review" : dateState?.isActionable ? dateState.status : "quote_open",
    title: quote.quoteCode || "Preventivo da gestire",
    subtitle: quote.supplierName || quote.customerName || quote.projectCode || "",
    detail: [
      quote.notes || (quote.quoteType === "supplier_quote" ? "Preventivo fornitore ricevuto." : "Richiesta preventivo cliente."),
      dateState?.label
    ].filter(Boolean).join(" · "),
    actionLabel: quote.quoteType === "supplier_quote" ? "Valuta preventivo" : "Prepara offerta",
    dueDate: quote.validUntil,
    projectCode: quote.projectCode,
    contactId: quote.contactId,
    counterpartyType: quote.customerName ? "customer" : quote.supplierName ? "supplier" : null,
    supplierName: quote.supplierName,
    customerName: quote.customerName,
    quoteType: quote.quoteType,
    sourceEmailId: quote.sourceEmailId,
    confidence: quote.confidence,
    date: quote.createdAt,
    sortDate: quote.validUntil || quote.createdAt
  }];
}

function deliveryNoteToOperationalItems(note, traceabilityMode = "required_link") {
  const needsReview = Boolean(note.needsReview) || note.status === "to_review";
  const unlinked = !note.orderCode && !note.projectCode;
  const linkActionable = unlinked && getWorkflowPolicy(traceabilityMode).requiresLinks;
  if (!needsReview && !linkActionable) return [];

  return [{
    id: `delivery-note-${note.id}`,
    kind: "delivery_note",
    entityId: note.id,
    priority: "high",
    status: needsReview ? "needs_review" : "needs_link",
    title: note.ddtNumber || "DDT da collegare",
    subtitle: note.supplierName || note.orderCode || note.projectCode || "",
    detail: note.notes || "Documento di trasporto non collegato con certezza.",
    actionLabel: "Collega DDT",
    dueDate: note.deliveryDate || note.receivedDate,
    projectCode: note.projectCode,
    orderCode: note.orderCode,
    supplierName: note.supplierName,
    confidence: note.confidence,
    date: note.createdAt,
    sortDate: note.deliveryDate || note.receivedDate || note.createdAt
  }];
}


function actionToOperationalItem(action) {
  return {
    id: `buyer-action-${action.id}`,
    kind: "buyer_action",
    entityId: action.id,
    priority: action.status === "needs_review" ? "high" : "medium",
    status: action.status || "open",
    title: action.title || "Azione buyer",
    subtitle: [action.supplierName, action.projectCode || action.orderCode].filter(Boolean).join(" - "),
    detail: action.detail || action.actionType || "Azione da completare.",
    actionLabel: "Gestisci azione",
    projectCode: action.projectCode,
    orderCode: action.orderCode,
    supplierName: action.supplierName,
    customerName: action.customerName,
    contactId: action.contactId,
    counterpartyType: action.counterpartyType,
    sourceEmailId: action.sourceEmailId,
    date: action.actionAt || action.createdAt,
    sortDate: action.actionAt || action.createdAt
  };
}

function sharedActionToOperationalItem(action) {
  const metadata = action.metadata || {};
  return {
    id: `operational-action-${action.id}`,
    kind: "operational_action",
    entityId: action.id,
    sourceEntityId: action.entityId,
    priority: action.dueDate && classifyDateState(action.dueDate) === "overdue" ? "urgent" : "high",
    status: action.status || "open",
    title: action.title || "Azione operativa",
    subtitle: [action.projectCode, metadata.sal_number].filter(Boolean).join(" · "),
    detail: action.detail || "Azione da completare.",
    actionLabel: action.actionType === "invoice_to_issue" ? "Emetti fattura" : "Gestisci azione",
    projectCode: action.projectCode,
    projectId: action.projectId,
    salNumber: metadata.sal_number || null,
    amount: metadata.amount ?? null,
    currency: metadata.currency || null,
    responsibleName: action.responsibleName || null,
    dueDate: action.dueDate || action.createdAt,
    date: action.createdAt,
    sortDate: action.dueDate || action.createdAt
  };
}

function classifyDateState(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  const days = Math.ceil((date.getTime() - today.getTime()) / 86400000);
  const gg = (n) => `${n} ${n === 1 ? "giorno" : "giorni"}`;
  if (days < 0) return { isActionable: true, priority: "urgent", status: "overdue", label: `Scaduta da ${gg(Math.abs(days))}.` };
  if (days <= 2) return { isActionable: true, priority: "high", status: "due_soon", label: days === 0 ? "Scade oggi." : `Scade tra ${gg(days)}.` };
  if (days <= 7) return { isActionable: true, priority: "medium", status: "this_week", label: `In arrivo tra ${gg(days)}.` };
  return { isActionable: false, priority: "low", status: "scheduled", label: `Programmato tra ${gg(days)}.` };
}

function priorityWeight(priority) {
  return { low: 1, medium: 2, high: 3, urgent: 4 }[priority] || 0;
}
