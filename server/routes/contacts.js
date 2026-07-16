import { authorizeApiRequest } from "../lib/_auth.js";
import { orgFilter, supabaseRequest, withOrg } from "../lib/_supabaseRest.js";

const TYPES = new Set(["supplier", "customer", "both", "unknown"]);

function clean(value) {
  return String(value || "").trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

async function normalizeName(value) {
  const name = clean(value);
  if (!name) throw new Error("Ragione sociale obbligatoria.");
  const normalized = await supabaseRequest("rpc/normalize_contact_name", {
    method: "POST",
    body: { value: name }
  });
  return { name, normalized: clean(normalized) };
}

async function getContact(id, organizationId) {
  const rows = await supabaseRequest(`contacts?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}&select=*&limit=1`);
  if (!rows?.[0]) throw notFound("Contatto non trovato.");
  return rows[0];
}

function mergedType(currentType, proposedType) {
  if (!TYPES.has(proposedType)) return currentType;
  if (["unknown", proposedType].includes(currentType)) return proposedType;
  if (currentType === "both" || proposedType === "unknown") return currentType;
  return "both";
}

async function createContact(body, organizationId) {
  const { name, normalized } = await normalizeName(body.legalName);
  const type = TYPES.has(body.type) ? body.type : "unknown";
  const email = clean(body.email).toLowerCase();
  if (email && !validEmail(email)) throw new Error("Indirizzo email non valido.");

  const rows = await supabaseRequest("contacts", {
    method: "POST",
    body: withOrg({
      legal_name: name,
      normalized_name: normalized,
      type,
      vat_number: clean(body.vatNumber) || null,
      domain: clean(body.domain).toLowerCase() || null,
      verification_status: "verified",
      source: "manual",
      notes: clean(body.notes) || null
    }, organizationId),
    headers: { Prefer: "return=representation" }
  });
  const contact = rows[0];
  await supabaseRequest("contact_aliases", {
    method: "POST",
    body: withOrg({ contact_id: contact.id, alias: name, normalized_alias: normalized, verified: true, source: "manual" }, organizationId)
  });
  if (email) await addEmail({ contactId: contact.id, email, isPrimary: true }, organizationId);
  return contact;
}

async function updateContact(body, organizationId) {
  const current = await getContact(body.id, organizationId);
  const patch = { updated_at: new Date().toISOString() };
  if ("legalName" in body) {
    const { name, normalized } = await normalizeName(body.legalName);
    patch.legal_name = name;
    patch.normalized_name = normalized;
  }
  if ("type" in body) {
    if (!TYPES.has(body.type)) throw new Error("Tipo di contatto non valido.");
    patch.type = body.type;
  }
  if ("vatNumber" in body) patch.vat_number = clean(body.vatNumber) || null;
  if ("domain" in body) patch.domain = clean(body.domain).toLowerCase() || null;
  if ("notes" in body) patch.notes = clean(body.notes) || null;
  if (body.verify === true) patch.verification_status = "verified";

  const rows = await supabaseRequest(`contacts?id=eq.${encodeURIComponent(current.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH", body: patch, headers: { Prefer: "return=representation" }
  });
  return rows[0];
}

async function addEmail(body, organizationId) {
  const email = clean(body.email).toLowerCase();
  if (!validEmail(email)) throw new Error("Indirizzo email non valido.");
  await getContact(body.contactId, organizationId);
  if (body.isPrimary) {
    await supabaseRequest(`contact_emails?contact_id=eq.${encodeURIComponent(body.contactId)}&${orgFilter(organizationId)}`, {
      method: "PATCH", body: { is_primary: false, updated_at: new Date().toISOString() }
    });
  }
  const rows = await supabaseRequest("contact_emails", {
    method: "POST",
    body: withOrg({
      contact_id: body.contactId,
      email,
      normalized_email: email,
      is_primary: Boolean(body.isPrimary),
      verified: true,
      match_enabled: true,
      source: "manual"
    }, organizationId),
    headers: { Prefer: "return=representation" }
  });
  return rows[0];
}

async function addAlias(body, organizationId) {
  await getContact(body.contactId, organizationId);
  const { name, normalized } = await normalizeName(body.alias);
  const rows = await supabaseRequest("contact_aliases", {
    method: "POST",
    body: withOrg({ contact_id: body.contactId, alias: name, normalized_alias: normalized, verified: true, source: "manual" }, organizationId),
    headers: { Prefer: "return=representation" }
  });
  return rows[0];
}

async function deleteChild(table, id, organizationId) {
  const rows = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}`, {
    method: "DELETE", headers: { Prefer: "return=representation" }
  });
  if (!rows?.[0]) throw notFound("Elemento non trovato.");
  return { deleted: true, id };
}

async function mergeContacts(sourceContactId, targetContactId, organizationId, actor) {
  await getContact(sourceContactId, organizationId);
  await getContact(targetContactId, organizationId);
  await supabaseRequest("rpc/merge_contacts", {
    method: "POST",
    body: {
      p_organization_id: organizationId,
      p_source_contact_id: sourceContactId,
      p_target_contact_id: targetContactId,
      p_actor: actor
    }
  });
  return { merged: true, sourceContactId, targetContactId };
}

async function resolveCandidate(body, organizationId, actor, approve) {
  const rows = await supabaseRequest(`contact_candidates?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}&status=eq.pending&select=*&limit=1`);
  const candidate = rows?.[0];
  if (!candidate) throw notFound("Segnalazione non trovata o già gestita.");
  const now = new Date().toISOString();

  if (!approve) {
    await supabaseRequest(`contact_candidates?id=eq.${encodeURIComponent(candidate.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH", body: { status: "rejected", resolved_by: actor, resolved_at: now }
    });
    if (candidate.source_contact_id && candidate.match_method === "new") {
      await supabaseRequest(`contacts?id=eq.${encodeURIComponent(candidate.source_contact_id)}&${orgFilter(organizationId)}&verification_status=eq.pending`, {
        method: "PATCH", body: { verification_status: "rejected", status: "inactive", updated_at: now }
      });
      await supabaseRequest(`contact_emails?contact_id=eq.${encodeURIComponent(candidate.source_contact_id)}&${orgFilter(organizationId)}`, {
        method: "PATCH", body: { verified: false, match_enabled: false, updated_at: now }
      });
    }
    return { rejected: true, id: candidate.id };
  }

  const targetId = body.targetContactId || candidate.matched_contact_id || candidate.source_contact_id;
  if (!targetId) throw new Error("Scegli il contatto da confermare.");
  const target = await getContact(targetId, organizationId);
  const newType = mergedType(target.type, candidate.proposed_type);
  await supabaseRequest(`contacts?id=eq.${encodeURIComponent(target.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: { type: newType, verification_status: "verified", status: "active", updated_at: now }
  });

  if (candidate.proposed_email && validEmail(candidate.proposed_email)) {
    const normalizedEmail = clean(candidate.proposed_email).toLowerCase();
    const emailRows = await supabaseRequest(`contact_emails?normalized_email=eq.${encodeURIComponent(normalizedEmail)}&${orgFilter(organizationId)}&select=*&limit=1`);
    if (emailRows?.[0]) {
      await supabaseRequest(`contact_emails?id=eq.${encodeURIComponent(emailRows[0].id)}&${orgFilter(organizationId)}`, {
        method: "PATCH", body: { contact_id: target.id, verified: true, match_enabled: true, updated_at: now }
      });
    } else {
      await addEmail({ contactId: target.id, email: normalizedEmail }, organizationId);
    }
  }
  if (candidate.proposed_name) {
    const aliasRows = await supabaseRequest(`contact_aliases?contact_id=eq.${encodeURIComponent(target.id)}&normalized_alias=eq.${encodeURIComponent(candidate.normalized_name)}&${orgFilter(organizationId)}&select=id&limit=1`);
    if (!aliasRows?.[0]) await addAlias({ contactId: target.id, alias: candidate.proposed_name }, organizationId);
  }
  if (candidate.source_contact_id && candidate.source_contact_id !== target.id) {
    await mergeContacts(candidate.source_contact_id, target.id, organizationId, actor);
  }
  await supabaseRequest(`contact_candidates?id=eq.${encodeURIComponent(candidate.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: {
      status: candidate.source_contact_id && candidate.source_contact_id !== target.id ? "merged" : "approved",
      resolved_contact_id: target.id,
      resolved_by: actor,
      resolved_at: now
    }
  });
  return { approved: true, contactId: target.id };
}

async function pendingCandidatesForContact(contactId, organizationId) {
  return supabaseRequest(
    `contact_candidates?${orgFilter(organizationId)}&status=eq.pending&or=(source_contact_id.eq.${encodeURIComponent(contactId)},matched_contact_id.eq.${encodeURIComponent(contactId)})&select=*&order=created_at.asc`
  );
}

async function attachCandidateIdentity(candidate, contactId, organizationId) {
  if (candidate.proposed_email && validEmail(candidate.proposed_email)) {
    const email = clean(candidate.proposed_email).toLowerCase();
    const rows = await supabaseRequest(`contact_emails?normalized_email=eq.${encodeURIComponent(email)}&${orgFilter(organizationId)}&select=*&limit=1`);
    if (rows?.[0]) {
      await supabaseRequest(`contact_emails?id=eq.${encodeURIComponent(rows[0].id)}&${orgFilter(organizationId)}`, {
        method: "PATCH",
        body: { contact_id: contactId, verified: true, match_enabled: true, updated_at: new Date().toISOString() }
      });
    } else {
      await addEmail({ contactId, email }, organizationId);
    }
  }

  if (candidate.proposed_name) {
    const { normalized } = await normalizeName(candidate.proposed_name);
    const aliases = await supabaseRequest(`contact_aliases?contact_id=eq.${encodeURIComponent(contactId)}&normalized_alias=eq.${encodeURIComponent(normalized)}&${orgFilter(organizationId)}&select=id&limit=1`);
    if (!aliases?.[0]) await addAlias({ contactId, alias: candidate.proposed_name }, organizationId);
  }
}

// Una conferma umana definisce il ruolo canonico del soggetto. Tutte le
// segnalazioni AI riferite allo stesso contatto vengono risolte insieme:
// l'AI conserva gli indizi, ma non puo' piu' ribaltare questa decisione.
export async function confirmContactRole(body, organizationId, actor) {
  if (!body.contactId) throw new Error("Contatto da confermare mancante.");
  if (!["supplier", "customer", "both"].includes(body.confirmedType)) {
    throw new Error("Scegli se il contatto e' cliente, fornitore o entrambi.");
  }

  const contact = await getContact(body.contactId, organizationId);
  const candidates = await pendingCandidatesForContact(contact.id, organizationId);
  const now = new Date().toISOString();

  await supabaseRequest(`contacts?id=eq.${encodeURIComponent(contact.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: {
      type: body.confirmedType,
      verification_status: "verified",
      status: "active",
      updated_at: now
    }
  });

  for (const candidate of candidates) {
    await attachCandidateIdentity(candidate, contact.id, organizationId);
  }

  await supabaseRequest(`contact_emails?contact_id=eq.${encodeURIComponent(contact.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: { verified: true, match_enabled: true, updated_at: now }
  });

  if (candidates.length) {
    await supabaseRequest(`contact_candidates?id=in.(${candidates.map((candidate) => candidate.id).join(",")})&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: {
        status: "approved",
        resolved_contact_id: contact.id,
        resolved_by: actor,
        resolved_at: now,
        updated_at: now
      }
    });
  }

  return { approved: true, contactId: contact.id, confirmedType: body.confirmedType, resolvedCandidates: candidates.length };
}

export async function rejectContactGroup(body, organizationId, actor) {
  if (!body.contactId) throw new Error("Contatto da rifiutare mancante.");
  const contact = await getContact(body.contactId, organizationId);
  const candidates = await pendingCandidatesForContact(contact.id, organizationId);
  const now = new Date().toISOString();

  if (candidates.length) {
    await supabaseRequest(`contact_candidates?id=in.(${candidates.map((candidate) => candidate.id).join(",")})&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { status: "rejected", resolved_by: actor, resolved_at: now, updated_at: now }
    });
  }

  if (contact.verification_status === "pending") {
    await supabaseRequest(`contacts?id=eq.${encodeURIComponent(contact.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { verification_status: "rejected", status: "inactive", updated_at: now }
    });
    await supabaseRequest(`contact_emails?contact_id=eq.${encodeURIComponent(contact.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { verified: false, match_enabled: false, updated_at: now }
    });
  }

  return { rejected: true, contactId: contact.id, resolvedCandidates: candidates.length };
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin", "Buyer"] });
  if (!user) return;
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const body = request.body || {};
    const actor = user.email || "OrderWatch Admin";
    let result;
    if (body.action === "create") result = { contact: await createContact(body, user.organizationId) };
    else if (body.action === "update") result = { contact: await updateContact(body, user.organizationId) };
    else if (body.action === "add_email") result = { email: await addEmail(body, user.organizationId) };
    else if (body.action === "delete_email") result = await deleteChild("contact_emails", body.id, user.organizationId);
    else if (body.action === "add_alias") result = { alias: await addAlias(body, user.organizationId) };
    else if (body.action === "delete_alias") result = await deleteChild("contact_aliases", body.id, user.organizationId);
    else if (body.action === "confirm_candidate") result = await resolveCandidate(body, user.organizationId, actor, true);
    else if (body.action === "reject_candidate") result = await resolveCandidate(body, user.organizationId, actor, false);
    else if (body.action === "confirm_contact_role") result = await confirmContactRole(body, user.organizationId, actor);
    else if (body.action === "reject_contact_group") result = await rejectContactGroup(body, user.organizationId, actor);
    else if (body.action === "merge") result = await mergeContacts(body.sourceContactId, body.targetContactId, user.organizationId, actor);
    else throw new Error("Azione anagrafica non supportata.");
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(result);
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: "Unable to manage contacts", detail: error.message });
  }
}
