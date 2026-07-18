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
each source. Future alerts and reports must consult the assertion matrix before
using language such as "never sent", "no reply", or "does not exist".

## Next phase

1. Add evidence records that connect each operational claim to its source email,
   document, canonical line, or buyer action.
2. Add a central safe-language policy used by the daily report and notifications.
3. Add health alerts for stale mailboxes, extraction failures, and deteriorating
   linkage coverage.
4. Add learning only from explicit, traceable corrections; never learn from a
   hidden or unverified automatic decision.
