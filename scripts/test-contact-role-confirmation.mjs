import { randomUUID } from "node:crypto";
import { confirmContactRole } from "../api/contacts.js";
import { supabaseRequest, withOrg } from "../api/_supabaseRest.js";

function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
}

const suffix = randomUUID().slice(0, 8);
const organizations = await supabaseRequest("organizations?slug=eq.nova-vision&select=id&limit=1");
const organizationId = organizations?.[0]?.id;
if (!organizationId) throw new Error("Tenant di test Nova Vision non trovato.");

let contactId = null;
try {
  const contactRows = await supabaseRequest("contacts", {
    method: "POST",
    body: withOrg({
      legal_name: `Contatto Ruolo Test ${suffix}`,
      normalized_name: `contatto ruolo test ${suffix}`,
      type: "customer",
      verification_status: "pending",
      status: "active",
      source: "ai"
    }, organizationId),
    headers: { Prefer: "return=representation" }
  });
  contactId = contactRows[0].id;
  const email = `ruolo-${suffix}@example.test`;

  await supabaseRequest("contact_emails", {
    method: "POST",
    body: withOrg({
      contact_id: contactId,
      email,
      normalized_email: email,
      verified: false,
      match_enabled: false,
      source: "ai"
    }, organizationId)
  });

  await supabaseRequest("contact_candidates", {
    method: "POST",
    body: [
      withOrg({ source_contact_id: contactId, matched_contact_id: null, proposed_name: `Contatto Ruolo Test ${suffix}`, normalized_name: `contatto ruolo test ${suffix}`, proposed_email: null, normalized_email: null, proposed_type: "customer", match_method: "new", status: "pending" }, organizationId),
      withOrg({ source_contact_id: null, matched_contact_id: contactId, proposed_name: `Contatto Ruolo Test ${suffix}`, normalized_name: `contatto ruolo test ${suffix}`, proposed_email: email, normalized_email: email, proposed_type: "supplier", match_method: "exact_email", status: "pending" }, organizationId)
    ]
  });

  const result = await confirmContactRole({ contactId, confirmedType: "both" }, organizationId, "test-orderwatch");
  check(result.resolvedCandidates === 2, "le segnalazioni discordanti vengono risolte insieme");

  const verifiedContacts = await supabaseRequest(`contacts?id=eq.${contactId}&organization_id=eq.${organizationId}&select=type,verification_status`);
  check(verifiedContacts?.[0]?.type === "both", "la scelta umana diventa il ruolo definitivo");
  check(verifiedContacts?.[0]?.verification_status === "verified", "il contatto diventa verificato");

  const verifiedEmails = await supabaseRequest(`contact_emails?contact_id=eq.${contactId}&organization_id=eq.${organizationId}&select=verified,match_enabled`);
  check(verifiedEmails?.every((item) => item.verified && item.match_enabled), "tutte le email associate diventano memoria affidabile");

  const resolvedCandidates = await supabaseRequest(`contact_candidates?or=(source_contact_id.eq.${contactId},matched_contact_id.eq.${contactId})&organization_id=eq.${organizationId}&select=status,resolved_contact_id`);
  check(resolvedCandidates?.every((item) => item.status === "approved" && item.resolved_contact_id === contactId), "nessuna segnalazione duplicata resta in attesa");

  console.log("Conferma ruolo contatto: tutti i controlli sono passati.");
} finally {
  if (contactId) {
    await supabaseRequest(`contact_candidates?or=(source_contact_id.eq.${contactId},matched_contact_id.eq.${contactId})&organization_id=eq.${organizationId}`, { method: "DELETE" });
    await supabaseRequest(`contacts?id=eq.${contactId}&organization_id=eq.${organizationId}`, { method: "DELETE" });
  }
}
