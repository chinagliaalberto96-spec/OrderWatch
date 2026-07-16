import { authorizeApiRequest } from "../lib/_auth.js";
import { ensureActorMembership, ensureContractWriter, requiredText } from "../lib/_contractWatch.js";
import { requireOrganizationModule } from "../lib/_modules.js";
import { orgFilter, supabaseRequest } from "../lib/_supabaseRest.js";

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response);
  if (!user) return;
  if (!(await requireOrganizationModule(response, user.organizationId, "contract_watch"))) return;

  try {
    if (request.method === "GET") {
      const projectId = request.query?.projectId;
      if (!projectId) return response.status(400).json({ error: "Commessa mancante." });
      const rows = await supabaseRequest(
        `contract_billing_items?project_id=eq.${encodeURIComponent(projectId)}&${orgFilter(user.organizationId)}&select=*&order=created_at.desc`
      );
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json({ billingItems: rows || [] });
    }

    if (!ensureContractWriter(user, response) || !ensureActorMembership(user, response)) return;
    if (request.method !== "PUT" || request.body?.action !== "issue") {
      response.setHeader("Allow", "GET, PUT");
      return response.status(405).json({ error: "Method not allowed" });
    }

    const result = await supabaseRequest("rpc/contractwatch_issue_billing_item", {
      method: "POST",
      body: {
        p_organization_id: user.organizationId,
        p_billing_item_id: request.body?.id,
        p_actor_membership_id: user.membershipId,
        p_invoice_reference: requiredText(request.body?.invoiceReference, "Riferimento fattura", 240)
      }
    });
    return response.status(200).json(result);
  } catch (error) {
    response.status(400).json({ error: "Emissione della fattura non riuscita.", detail: error.message });
  }
}
