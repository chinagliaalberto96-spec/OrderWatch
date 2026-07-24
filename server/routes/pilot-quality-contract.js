// Pilot Data Quality Contract — read-only, tenant-scoped, authenticated route.
//
// This is the first production wiring of scripts/lib/pilotControlCheck.mjs /
// scripts/lib/dataQualityContract.mjs. It does not reimplement or reshape
// their output: it calls runPilotControlCheck() to get real pilotCases for
// the caller's own organization, then buildDataQualityContract() on those
// pilotCases, and returns that contract object verbatim as the response
// body. Every read-only, tenant-scoped, null-safe, no-scoring guarantee
// documented in those two modules therefore applies unchanged here.
//
// Access is intentionally narrower than most routes: Owner/IT/Admin only
// (no Buyer/ReadOnly) — this is a support/admin investigation tool, not a
// buyer-facing feature. Enforced server-side via authorizeApiRequest's
// `roles` option — the same mechanism every other route already uses, not a
// parallel authorization check.

import { authorizeApiRequest } from "../lib/_auth.js";
import { sanitizeSecurityError } from "../lib/_securityRedaction.js";
import { toSafeErrorResponse } from "./order-operational-view.js";
import { runPilotControlCheck } from "../../scripts/lib/pilotControlCheck.mjs";
import { buildDataQualityContract } from "../../scripts/lib/dataQualityContract.mjs";

// Conservative defaults for a live HTTP round-trip: each evaluated order
// costs several sequential Supabase queries (see getOrderOperationalView()),
// so a large `limit` risks a slow response/serverless timeout. The CLI
// (scripts/run-pilot-control-check.mjs) defaults to 10 for an offline report;
// this endpoint defaults lower and caps the maximum an operator can request.
export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 20;

function parseLimit(rawLimit) {
  const n = Number(rawLimit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

// Core, testable function — accepts organizationId explicitly (never reads
// request/response) so it can be exercised directly with a mocked reqDb,
// exactly like getOrderOperationalView()/runPilotControlCheck() already are.
// No new detection/aggregation logic lives here: this is composition only.
export async function getPilotQualityContract({ organizationId, orderId, limit, reqDb } = {}) {
  const report = await runPilotControlCheck({ organizationId, orderId, limit, reqDb });
  return buildDataQualityContract({ organizationId, generatedAt: report.generatedAt, pilotCases: report.pilotCases });
}

export default async function handler(request, response) {
  // organizationId comes ONLY from the authenticated session below — never
  // from request.query/body. authorizeApiRequest itself fails closed (401
  // with no session, 403 for a role outside ["Owner","IT","Admin"]).
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin"] });
  if (!user) return;

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // orderId is an optional filter, not a tenant selector: it is always
    // evaluated against user.organizationId, so a cross-tenant order id
    // resolves to "not available" inside the contract, never to another
    // organization's data (the same guarantee getOrderOperationalView()
    // already provides and this route does not re-implement).
    const orderId = String(request.query?.orderId || "").trim() || null;
    const limit = parseLimit(request.query?.limit);

    const contract = await getPilotQualityContract({ organizationId: user.organizationId, orderId, limit });
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(contract);
  } catch (error) {
    // sanitizeSecurityError only redacts credential-like patterns and is
    // used only for the server-side log line; the response itself is built
    // by the same toSafeErrorResponse() order-operational-view.js already
    // uses, so raw Supabase/SQL detail never reaches the client here either.
    console.error("[pilot-quality-contract]", sanitizeSecurityError(error));
    const { status, body } = toSafeErrorResponse(error);
    response.status(status).json(body);
  }
}
