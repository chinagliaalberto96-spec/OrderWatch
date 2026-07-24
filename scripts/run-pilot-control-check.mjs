#!/usr/bin/env node
// Read-only Pilot Control Check CLI.
//
//   node scripts/run-pilot-control-check.mjs --organization-id <uuid>
//   node scripts/run-pilot-control-check.mjs --organization-id <uuid> --order-id <uuid>
//   node scripts/run-pilot-control-check.mjs --organization-id <uuid> --limit 10 --output ./pilot-reports --dry-run false
//
// This tool only issues GET requests (via the same supabaseRequest()/
// getOrderOperationalView() the production route uses) and never requires,
// reads for display, or prints mailbox credentials, access tokens, or the
// Supabase service key. It fails closed if --organization-id is missing.
// --dry-run defaults to true: by default nothing is written to disk, only a
// summary is printed. Pass --dry-run false to actually write the JSON/
// Markdown/CSV report files.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  runPilotControlCheck,
  buildMarkdownReport,
  buildCsvReport
} from "./lib/pilotControlCheck.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const organizationId = typeof args["organization-id"] === "string" ? args["organization-id"] : null;
  const orderId = typeof args["order-id"] === "string" ? args["order-id"] : null;
  const limit = args.limit ? Number(args.limit) : 10;
  const outputDir = typeof args.output === "string" ? args.output : "./pilot-reports";
  const dryRun = String(args["dry-run"] ?? true) !== "false";

  if (!organizationId) {
    // Fail closed: no database call is made at all without an explicit
    // tenant. This mirrors orgFilter()'s own guarantee one layer up, so the
    // CLI never even attempts a request that would need it.
    console.error("Error: --organization-id is required. This tool fails closed without an explicit tenant.");
    process.exitCode = 1;
    return;
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    console.error("Error: --limit must be a positive number.");
    process.exitCode = 1;
    return;
  }

  let report;
  try {
    report = await runPilotControlCheck({ organizationId, orderId, limit });
  } catch (error) {
    // Never print the raw error object as-is if it could carry request
    // detail; message text from _supabaseRest.js only ever includes the
    // Supabase response body (never our own request headers/keys), but we
    // still keep this deliberately terse.
    console.error("Pilot control check failed:", error.message || "unknown error");
    process.exitCode = 1;
    return;
  }

  const summary = {
    organizationId: report.organizationId,
    ordersEvaluated: report.pilotCases.length,
    ordersAvailable: report.pilotCases.filter((p) => p.coverage.orderAvailable).length,
    selectionDeficits: report.selectionDeficits.length,
    totalIssues: report.aggregateIssues.reduce((sum, i) => sum + i.count, 0),
    issueCategoryCounts: Object.fromEntries(report.aggregateIssues.map((i) => [i.category, i.count]))
  };
  console.log(JSON.stringify({ mode: dryRun ? "dry-run (no files written)" : "write", summary }, null, 2));

  if (dryRun) {
    console.log(`\nDry run: no files written. Re-run with --dry-run false --output <dir> to write the JSON/Markdown/CSV reports.`);
    return;
  }

  await mkdir(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const base = `pilot-control-check-${stamp}`;
  const jsonPath = path.join(outputDir, `${base}.json`);
  const mdPath = path.join(outputDir, `${base}.md`);
  const csvPath = path.join(outputDir, `${base}.csv`);

  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdPath, buildMarkdownReport(report), "utf8");
  await writeFile(csvPath, buildCsvReport(report.pilotCases), "utf8");

  console.log(`\nWritten:\n- ${jsonPath}\n- ${mdPath}\n- ${csvPath}`);
}

main();
