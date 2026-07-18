# Altera Brain v1

Altera Brain is the evidence, coverage, and decision layer of OrderWatch. It does
not replace the existing operational tables or create a second source of truth.

## First principle

OrderWatch may state a fact only when the required source is observable and the
evidence is strong enough. A missing event in a partial source is not proof that
the event did not happen.

Examples:

- Safe: "No supplier reply was observed in the connected inboxes."
- Unsafe when outbound coverage is partial: "The buyer never contacted the supplier."
- Safe: "This line is not linked to an order in OrderWatch."
- Unsafe: "No order exists."

## Coverage statuses

| Status | Meaning | Product behavior |
| --- | --- | --- |
| `available` | The source is configured and has enough recent evidence. | Normal assertions are allowed within the observed scope. |
| `partial` | The source exists but history or linkage is incomplete. | Use qualified language and avoid absence claims. |
| `unavailable` | The source is not observable. | Do not infer facts from silence. |
| `stale` | The source exists but has not produced recent evidence. | Warn the user and lower confidence. |

## Current source registry

The `data_source_coverage` view derives coverage from existing production data:

- `inbound_email`: connected mailboxes and observed inbound messages;
- `outbound_email`: sent folders and observed outbound messages;
- `email_attachments`: attachment presence and document extraction outcomes;
- `operational_linking`: canonical lines linked to orders or projects.

The view is tenant-scoped by `organization_id`, uses `security_invoker = true`,
and is accessible only through the server-side service role.

## Assertion matrix

| Assertion | Minimum evidence | Behavior when evidence is partial |
| --- | --- | --- |
| An email was received | `inbound_email` available plus a matching email event | State the observed event normally. |
| No reply was received | Inbound coverage available for the relevant mailbox and time window | Say "no reply observed in the connected inboxes". |
| The buyer sent a reminder | A matching outbound email event | State only that specific observed reminder. |
| The buyer did not send a reminder | Complete outbound coverage for the relevant mailbox and time window | Never assert; say outbound history is incomplete. |
| A document was attached | Attachment metadata or extracted document linked to the email | State the observed attachment; disclose extraction review if needed. |
| No document exists | Complete document coverage for the relevant conversation | Say "no document found in the available sources". |
| An operational line is linked | A canonical line linked to an order or project | State the link normally. |
| No order exists | Complete operational coverage across all source systems | Say only "not linked to an order in OrderWatch". |

## Reliability policy

- `>= 0.85`: strong enough for normal operational wording.
- `0.60 - 0.84`: show a limitation and require cautious wording.
- `< 0.60`: do not automate absence-based decisions.

Reliability is a coverage signal, not a probability that an individual AI
classification is correct. Classification confidence and source coverage must be
evaluated separately.

## Product integration

The dashboard loads coverage through `supabaseServerAdapter.getDataCoverage()`.
Settings shows the real status, observed volume, reliability, and limitations for
each source. The central safe-language policy is applied to the daily report,
notifications, dashboard queue, suggestions, reminders, and historical activity
shown in project and supplier views.

The policy distinguishes database facts from source observations:

- an empty database view is described as "not registered in OrderWatch";
- a missing email event is described as "not observed in the connected sources";
- partial inbound or outbound coverage is disclosed next to the conclusion;
- historical text is normalized before presentation, so legacy phrases such as
  "no reply", "never sent", and "does not exist" cannot bypass the policy.

The daily report also includes a source-coverage section whenever one or more
sources are partial or unavailable. Its company name is resolved from the active
tenant rather than being hardcoded to Graphic Center.

## System health alerts

`system_health_alerts` is a server-only read model for technical anomalies. It is
deliberately separate from the buyer queue and never creates an item in `Oggi`.
The current categories are:

- active mailboxes with a connection error;
- connected mailboxes without a successful check for more than 30 minutes;
- email processing failures in the last 72 hours;
- processing records stuck for more than 30 minutes;
- extraction candidates left in quarantine for more than 24 hours;
- operational linkage below 85% or falling by at least five percentage points.

`data_source_coverage_snapshots` stores one sample per source, tenant, and hour.
The worker refreshes the sample after each mailbox cycle. This makes a real
trend observable while keeping the history bounded to 90 days and avoiding a
second operational source of truth.

Mailbox failures are recorded on the mailbox itself and do not stop the other
mailboxes from being polled. A technical failure is therefore visible without
turning a temporary problem in one account into an outage of the whole tenant.

Settings and Notifications render technical alerts in a dedicated section.
They are not mixed with deadlines, reminders, or other work assigned to buyers.

## Operational evidence

The `operational_evidence` view is the traceability layer used by the product UI.
It does not create a parallel business object or copy source content. It projects
the existing provenance links of canonical lines, invoices, quotes, delivery
notes, buyer actions, and processed emails into one tenant-scoped read model.

Every evidence row contains:

- the operational subject (`subject_type`, `subject_id`);
- the source email or document;
- the observed values that support the assertion;
- the source line when available;
- the direction and date of the email;
- assertion, email, and document confidence signals;
- a final cautious status: `certain`, `probable`, `uncertain`, or `needs_review`.

The dashboard drawer always shows the evidence status. The buyer can open the
source email directly from the assertion. Emails classified as non-operational
do not expose sender or extracted content in this panel.

If no evidence exists, the product says so explicitly instead of manufacturing
a source. Internal drafts are therefore allowed to remain visible as operational
work, but are labelled `Fonte non disponibile` until a real source is connected.

Current Graphic Center snapshot (18 July 2026):

- 501 evidence links;
- 370 distinct operational subjects covered;
- 89 document-backed links;
- zero evidence rows without a source;
- 19 of 20 items in the daily queue have inspectable evidence;
- outbound evidence remains partial (one observed outbound email).

The view uses `security_invoker = true` and is readable only by the server-side
service role. `anon` and `authenticated` have no direct access.

## Next phase

Add learning only from explicit, traceable corrections; never learn from a
hidden or unverified automatic decision.
