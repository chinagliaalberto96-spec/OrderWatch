# Phase 2B.1 — "Cronologia osservata dell'ordine" (final functional specification)

Status: **approved specification, not implemented**. No code, test, endpoint, adapter, or other
documentation file has been touched to produce this document. This file finalizes and supersedes
the read-only Phase 2B analysis performed earlier in this workstream, incorporating the corrections
and product decisions approved afterward. Where this document and that earlier analysis differ,
**this document is authoritative**.

This is a specification for implementation, not implemented code. Every rule below is meant to be
directly translatable into deterministic logic with no new backend query, no new extraction, and
no new inference beyond what is stated.

---

## 1. Scope and phase split

Phase 2B.1 concerns exclusively supplier **purchase orders** — the `orders` /
`OrdersView` / `OrderDetailPanel` / `OrderOperationalView` entity already implemented in
Phases 1, 1B and 2A. It does not concern customer sales orders, in any form, at any point.

### 1.1 Phase 2B.1 — implementable now

A single new read-only section, titled exactly:

> **"Cronologia osservata dell'ordine"**

containing only:

- evidence-backed documents observed by OrderWatch (`DOCUMENT_OBSERVED`, §5);
- an exact observation timestamp or document date per event, with an explicit date-kind (§6);
- exact evidence navigation, reusing the existing evidence-anchor mechanism (§8);
- exact, non-ambiguous line associations, using a corrected identity rule (§4);
- purchase-order commitments, shown in a structurally separate block (§9);
- evidence-backed observations that have a real linked document and a real evidence reference but
  no verifiable date, shown in a third, separate block (§7).

### 1.2 Phase 2B.2 — explicitly deferred, not implemented, not inferred

The following event categories are **out of scope for Phase 2B.1** and must not be implemented,
approximated, or inferred by any means (including text parsing of `linkedDocuments[].number`):

- `ORDER_ISSUED`
- `SUPPLIER_CONFIRMATION_RECEIVED`
- `DELIVERY_NOTE_RECEIVED`
- `INVOICE_RECEIVED`
- `DELIVERY_COMPLETED`
- `ORDER_CLOSED`
- commitment-change history (superseded/updated commitments)

Each requires either structured extraction that does not exist today (`delivery_notes`/`invoices`
currently have zero live rows for any Graphic Center order; `documents.document_type` is always
empty in practice, so no linked document carries a structured kind beyond the literal fallback
`'document'`) or historical state data that the system does not retain (no state-transition log
exists anywhere for order/line status, and `activeCommitments`/`supersededCommitments` are
hardcoded to `[]` server-side — "feature disabled in first read-only version," per the endpoint's
own comment). Building Phase 2B.2 requires either a data/extraction change or new historical
persistence — neither is part of this specification.

---

## 2. Semantic model (unchanged, restated for completeness)

| Concept | Where it lives | Timeline treatment |
|---|---|---|
| Evidence | `evidenceReferences[]`, `linkedDocuments[]`, `safeEvidenceExcerpts[]` | Never shown alone; always the provenance of an event or a commitment (when a genuine ref supports it) |
| Event | A `linkedDocuments[]` row with a resolved date and evidence ref | The chronological list itself |
| State | `getOrderStatus()`, Phase 2A's `dataQualityStatus`/situation | Never reconstructed inside the timeline; stays exclusively in Phase 2A's section |
| Commitment | `orders.due_date`/`required_date`, line `dueDate`/`requiredDate` | A separate, non-chronological block; never marked complete |
| Data-quality finding | `contract.findings[]` | Never becomes a timeline event; stays exclusively in Phase 1B's flow |

---

## 3. Real data inventory (final, condensed)

Verified directly against `server/routes/order-operational-view.js` and live output for all three
Graphic Center orders. Full field-by-field detail from the prior analysis stands; this table is the
authoritative summary for implementation.

| Field | Source | Live today? | Usable for Phase 2B.1? |
|---|---|---|---|
| `linkedDocuments[].id` | `delivery_notes`/`invoices`/`documents` row id | Yes | Yes — internal identity only, never displayed |
| `linkedDocuments[].kind` | `document_type` (always falls back to `'document'` live) | Yes, always `'document'` in live data | Yes — drives date-kind selection (§6) |
| `linkedDocuments[].number` | `ddt_number`/`invoice_number`/`documents.name` | Yes | Yes — displayed as safe source text only, **never parsed or classified** (§Approved Decision 2) |
| `linkedDocuments[].receivedAt` | `delivery_date` / `invoice_date` / `received_at` — three different columns, same JSON key | Yes; only the `documents.received_at` path is exercised live today | Yes — this is the event date, tagged by `kind` |
| `linkedDocuments[].sourceEmailId` | `source_email_id` column, present on all three source tables | Yes | Yes — used for identity/grouping (§4), never displayed |
| `linkedDocuments[].sourceDocumentId` | `source_document_id` column | **Structurally always `null` for `kind:'document'`** — the endpoint's own `documents?...&select=` query never selects this column, since it does not exist on the `documents` table (confirmed by direct code inspection, not merely by comment). Present on `delivery_notes`/`invoices` (0 live rows) as a *derivation* pointer ("this row was extracted from raw document X"), **not the row's own identity** | Yes, but only as an input to the confirmed-relationship check in §4.0 — **never assumed equal to `linkedDocument.id`** |
| `evidenceReferences[].entityId` | For `kind:'line_source'`: `canonical_line_sources.entity_id`, confirmed by the endpoint's own query to equal a `canonicalMaterialLines[].id` (i.e. a *line* identity). Absent (`null`) for document-kind refs | Yes | Yes — this is how a `line_source` evidence ref identifies *which line* it is about; it is never a document identity |
| `evidenceReferences[].sourceDocumentId` | For `kind:'line_source'`: `canonical_line_sources.source_document_id`. Its foreign-key target table is **not stated anywhere in the endpoint code** | Sometimes populated (1 of 3 live orders, on one line) | Yes, but only once its target is confirmed against the live schema (§4.0) — **the specification does not assume `evidenceReference.sourceDocumentId === linkedDocument.id` as a general rule** |
| `evidenceReferences[]` (general) | Server-assembled (`assignRefs()`) | Yes | Yes — the exact evidence ref every event/commitment must carry |
| `canonicalMaterialLines[].provenanceRefs` | Per-line evidence refs | Yes | Yes — used only for the line-association step (§4), gated by the confirmed-relationship check (§4.0) |
| `canonicalMaterialLines[].dueDate`/`requiredDate` | Per-line commitment dates | Yes, inconsistently populated (see §9 live coverage) | Yes — Commitment block |
| `orders.due_date`/`required_date` (via `summary`) | Order-level commitment dates | Yes, on 1 of 3 live orders | Yes — Commitment block |
| `safeEvidenceExcerpts[].excerpt.due_date`/`required_date` | Per-evidence observed content | Sometimes populated | **No** — explicitly excluded (§Approved Decision 3) |
| `anomaliesAndAttention[]` | `system_health_alerts` | Empty on all 3 live orders; no date field exists on this array at all | **No** — explicitly excluded (§7) |
| `activeCommitments`/`supersededCommitments` | Hardcoded `[]` | Never populated | Not usable; not part of this specification |
| `canonicalMaterialLines[].confidence`, extraction confidence anywhere | — | Populated | **Never displayed** (no confidence scores, any phase) |

---

## 4. Event identity and grouping (corrected)

**Each row in `linkedDocuments[]` is one distinct event, keyed by its own `id`. Documents are never
merged into one event because they share a `sourceEmailId`.** One email may legitimately produce
several distinct linked-document rows (e.g. a confirmation and, separately, a print/delivery
attachment sent in the same message) — Phase 2B.1 must render each as its own timeline entry.

### 4.0 Mandatory first implementation step — confirm the exact relationships, do not assume them

Before any line-association logic is written, the implementation must inspect and document, against
the live server contract itself (not against this specification's prose), the exact relationship
between:

- `evidenceReference.entityId` — for `kind:'line_source'`, confirmed by direct inspection of
  `server/routes/order-operational-view.js` (the `canonical_line_sources` query is filtered by
  `entity_id=in.(lineIds)`) to equal a `canonicalMaterialLines[].id`. This is a **line** identity. It
  is `null` for document-kind evidence references.
- `evidenceReference.sourceDocumentId` — for `kind:'line_source'`, sourced from
  `canonical_line_sources.source_document_id`. **Its foreign-key target table is not stated anywhere
  in the endpoint code.** It was observed, in the one live case where it is populated (order
  `228751`, evidence ref `E1`), to equal a `linkedDocuments[].id` whose `kind` is `'document'` — but
  this is one observed instance, not a confirmed schema guarantee.
- `evidenceReference.sourceEmailId` (any `kind`) — traces to `canonical_line_sources.source_email_id`
  or `linkedDocuments[].sourceEmailId` depending on `kind`, both ultimately the ingested email's id.
- `linkedDocument.id` — the delivery_note/invoice/document row's own primary key.
- `linkedDocument.sourceDocumentId` — **not the document's own identity.** For every `kind:'document'`
  row it is unconditionally `null`: the endpoint's own `documents?...&select=...` query
  (`order-operational-view.js:176`) never selects a `source_document_id` column, because that column
  does not exist on the `documents` table (confirmed by the query itself, not merely by comment).
  For `delivery_note`/`invoice` rows (0 live rows today, but a real, selected column) this field is a
  **derivation pointer** — "this row was itself extracted from raw document X" — conceptually
  distinct from the row's own identity.
- `linkedDocument.sourceEmailId` — the row's own `source_email_id` column, present on all three
  source tables.

**This specification does not assume `evidenceReference.sourceDocumentId === linkedDocument.id` as a
general rule.** Where it appears to hold (order `228751`), it is because a `line_source` evidence
entry's `source_document_id` and a `'document'`-kind linked document's `id` both plausibly reference
the same underlying `documents` row — but this must be re-confirmed against the live schema/FK
definitions at implementation time, not inferred from the two fields sharing a name. A field named
`sourceDocumentId` on two different objects is not, by itself, proof they reference the same table.

### 4.1 Line-association rule (uses only confirmed exact relationships)

A canonical line may be associated with a `DOCUMENT_OBSERVED` event **only** through a relationship
confirmed per §4.0:

1. **Exact `sourceDocumentId` match, only once its target is confirmed.** If a line's provenance ref
   carries a `sourceDocumentId` confirmed (per §4.0) to reference the same row as one
   `linkedDocuments[].id`, associate the line with that document only.
2. **Exact `sourceEmailId` match, only when no confirmed document-level relationship exists for that
   evidence ref, and only when exactly one `linkedDocuments[]` row shares that `sourceEmailId`.**
   Associate the line with that one document.
3. **Ambiguous case — do not associate.** If step 2 would match **more than one** `linkedDocuments[]`
   row sharing the same `sourceEmailId`, the line is **not** assigned to any of them. The event(s)
   still render — without a "riga coinvolta" annotation — rather than guessing.
4. Never use `description`, `itemCode`, `number`, free text, or array position for this association,
   at any step. Never infer equality between two fields from shared naming alone.

### 4.2 One document, multiple exact evidence references

A single `linkedDocuments[]` row may legitimately have more than one confirmed exact evidence
reference resolve to it — its own native evidence reference (always present, built directly from the
document row itself) plus, where §4.0 confirms it, one or more `line_source` references.

- All confirmed exact references are kept, **deduplicated by ref id**.
- Exactly **one** `DOCUMENT_OBSERVED` event is created for that document — never one event per ref.
- No evidence reference is ever chosen as semantically "correct" over another; multiple refs
  resolving to the same document are multiple proofs of one observation, not competing values.
- A **deterministic primary reference** is used only to drive the event's "apri evidenza" anchor
  action: the document's own native evidence reference (the one built directly from the
  `linkedDocuments[]` row — always exactly one per document) is always primary. This is a display
  choice for the main action, not a claim that the other refs are less valid.
- Every other confirmed exact reference for that same document is retained and reachable in the
  event's expandable detail (§8) — never silently dropped.

**Implementation note — do not reuse `evidenceGroupKey()`/`buildEvidenceGroups()` as-is.** I
re-verified the existing helper in `src/components/OrderOperationalView.jsx:227-231`:

```js
function evidenceGroupKey(evidenceRef) {
  if (evidenceRef.sourceEmailId) return `email:${evidenceRef.sourceEmailId}`;
  if (evidenceRef.sourceDocumentId) return `doc:${evidenceRef.sourceDocumentId}`;
  return `ref:${evidenceRef.ref}`;
}
```

This checks `sourceEmailId` **before** `sourceDocumentId` — the exact opposite precedence Phase
2B.1 requires, and it does not perform the §4.0 confirmation step at all. It exists to group
*evidence citations* for the existing evidence panel, a different and still-valid purpose that must
not change. Phase 2B.1's line-association step needs its own confirmed, document-id-first
resolution function; it must not silently inherit this helper's precedence or its assumptions.

**Live-data note:** across all three Graphic Center orders, no two `linkedDocuments[]` rows
currently share a `sourceEmailId`, so the divergence between the old and new precedence produces the
same practical result today. The one live cross-reference this specification relies on (order
`228751`'s `E1.sourceDocumentId` against a `'document'`-kind `linkedDocuments[].id`) is exactly the
case §4.0 requires be confirmed against the schema before implementation — it is an observation from
one order, not a settled contractual fact.

---

## 5. Event decision table — Phase 2B.1 (final)

| Property | Rule |
|---|---|
| Event code | `DOCUMENT_OBSERVED` |
| Fixed Italian label | "Documento osservato" |
| Required source | One `linkedDocuments[]` row |
| Required date | `linkedDocuments[].receivedAt`, tagged by `kind` (§6) |
| Required evidence reference | The document's own native `evidenceReferences[]` entry (always primary, §4.2) plus any additional `line_source` references whose relationship to this document has been confirmed per §4.0 — never assumed from field-name similarity alone |
| Level | Order-level by construction; line association is optional, exact-only, and gated by §4.0/§4.1 |
| Missing evidence | Never rendered (structurally shouldn't happen; guarded defensively) |
| Missing/unparseable date | Moves to "Eventi senza data verificabile" (§7); never dropped, never given an invented date |
| Multiple sources disagree | Not applicable to a single event — each `linkedDocuments[]` row is independent; no cross-document reconciliation happens here. Multiple *confirmed* evidence refs resolving to the *same* document are not a disagreement — they are deduplicated and retained together per §4.2, never resolved to one "winning" ref |
| Live or fixture-only | **Live** on all three real orders (2, 5, and 2 events respectively) |

No other event code exists in Phase 2B.1. The six deferred categories (§1.2) have no decision-table
row here — they are not implemented, not approximated, and not partially inferred from `number` text
or any other unstructured signal.

---

## 6. Date precision model (final)

The single `receivedAt` JSON field carries genuinely different semantics depending on `kind`. The
display rule is chosen by `kind`, never by inspecting the raw timestamp value:

| `kind` | Underlying column | Precision | Display rule | Live today? |
|---|---|---|---|---|
| `'document'` (the only kind ever observed live) | `documents.received_at` | Real timestamp (date **and** time) | **"Osservato da OrderWatch il [date] alle [time]"** — always show both date and time | Yes, 100% of live cases |
| `'delivery_note'` | `delivery_notes.delivery_date` | Date-only (business/document date) | Show the date only; never invent a time | Not yet — 0 live rows |
| `'invoice'` | `invoices.invoice_date` | Date-only (business/document date) | Show the date only; never invent a time | Not yet — 0 live rows |

This is a hard rule, not a fallback: a date-only value is never given an invented `00:00` or "questa
mattina" framing, and a genuine timestamp is never silently truncated to a bare date when the source
column actually carries time precision.

Commitment dates (`dueDate`/`requiredDate`, any level) are **always date-only** and are **never**
part of this chronology, even once their date has passed — an overdue commitment stays in the
Commitment block (§9), it does not migrate into the observed-events list as a "missed delivery."

---

## 7. Undated observations — "Eventi senza data verificabile" (final)

This section may contain **only** an observation that:

- corresponds to a real `linkedDocuments[]` row (i.e. a genuine document OrderWatch has on file for
  this order);
- resolves to an exact, existing `evidenceReferences[]` entry;
- has a `receivedAt` that is missing or fails to parse as a valid date.

**`anomaliesAndAttention[]` entries must never appear here.** They are explicitly excluded: that
array carries no date field at all (never has, structurally), and its entries carry no evidence
reference either — they fail both of this section's own admission requirements. They remain
entirely outside Phase 2B.1's timeline, in either section.

No date is ever fabricated to move an item out of this section and into the chronological list.

---

## 8. Provenance rules (unchanged, restated)

Every visible entry — in either the chronological list or the undated section — shows only:

- a safe source label (document `kind`, mapped through the existing label table, never the raw
  `sourceEmailId`/`sourceDocumentId`/row `id`);
- `linkedDocuments[].number` as literal display text (Approved Decision 2 — see below);
- the resolved date/time or the explicit "data non verificabile" wording;
- the associated line's description, only when §4's exact identity rule resolved one;
- an action to open the exact evidence, reusing the existing `#evidence-${ref}` anchor mechanism —
  no new link target, no new navigation code path. When a document resolves more than one confirmed
  exact evidence reference (§4.2), this main action always anchors to the document's own native
  reference (the deterministic primary); every other confirmed reference for the same document is
  listed in the event's expandable detail, each independently reachable via its own existing
  `#evidence-${ref}` anchor — never merged into one link, never hidden.

A stale, absent, or ambiguous evidence reference produces no entry and no link — never a fallback
by description, document number, or position. Any internal id used to resolve identity or ordering
(§4.0, §11) is used only as an internal key — it is never rendered as visible text, regardless of
how confident the resolution is.

---

## 9. Commitments block (final)

Shown in a block that is structurally and visually separate from both the chronological list and
the undated section — never interleaved, never chronologically sorted alongside observed events.

| Rule | Detail |
|---|---|
| Levels shown | Both **order-level** (`summary.dueDate`, `summary.requiredDate`) and **line-level** (`canonicalMaterialLines[].dueDate`, `.requiredDate`) — **Approved Decision 1** |
| Level labeling | Each commitment explicitly states whether it is order-level or line-level (and which line); the two are never merged or presented as one fact |
| Authority | Neither level is treated as authoritative over the other. If an order-level date is absent but a line-level date exists (confirmed live on order `0013545497`), the line-level commitment is still shown — absence of one is never inferred to mean absence of the other |
| Evidence link | Shown **only** when an exact, existing evidence reference genuinely supports that specific commitment value. Today's contract does not attach an evidence ref to `orders.due_date`/`required_date` or line `dueDate`/`requiredDate` at all — so in practice, no live commitment currently carries a linkable evidence reference, and none must be fabricated to give it one |
| Completion claims | Never made. A commitment is a promised/expected date, not a record of what happened |
| Overdue framing | An overdue commitment is never reinterpreted as a "missed delivery" event or moved into the observed chronology. Its lateness is Phase 2A's concern (`URGENZA_OPERATIVA_*`), already handled there — Phase 2B.1 does not duplicate or restate it |
| Excluded source | `safeEvidenceExcerpts[].excerpt.due_date`/`required_date` — **Approved Decision 3.** These are per-source *observed* values that can disagree with the canonical commitment and are Phase 1B `DATE_CONFLICT` territory; Phase 2B.1 never surfaces them as commitments or events |

---

## 10. Approved decisions — final record

1. **Line-level commitments shown even when the order-level one is absent**, both levels kept
   explicitly separate, neither treated as authoritative. (§9)
2. **`linkedDocuments[].number` is safe display text only — never parsed or used to classify a
   document.** A `number` value containing "Bolla" (or any other word) must never cause the system
   to create or imply a `DELIVERY_NOTE_RECEIVED`-type event; `kind` alone (from the structured
   database column) determines category, never the free-text label.
3. **`safeEvidenceExcerpts[].excerpt.due_date`/`required_date` are excluded** from both commitments
   and events — they remain exclusively Phase 1B `DATE_CONFLICT` material.
4. **Maximum 5 observed events shown initially**, with a deterministic "+N altri eventi" expansion
   (same discipline as Phase 2A's finding cap) — the newest-first ordering already defined, not an
   arbitrary/unstable subset.
5. **Section title fixed as "Cronologia osservata dell'ordine".**

---

## 11. Sorting and deduplication (final)

- Primary sort: resolved event date, descending (most recent first).
- Deduplication of **events**: none needed beyond what `assignRefs()` already guarantees
  server-side (no duplicate evidence refs are ever assigned); each `linkedDocuments[]` row is already
  a distinct DB row, so no additional de-duplication step exists for the event list itself.
- Deduplication of **evidence references attached to one event**: per §4.2, when multiple confirmed
  exact refs resolve to the same document, they are deduplicated by ref id and retained together —
  never collapsed to a single "winning" reference.
- **Stable tiebreaker for two events sharing the exact same resolved date/time**, in this order:
  1. A stable **internal document identity** (`linkedDocuments[].id`) — used purely as a sort key,
     **never rendered as visible text**, regardless of the format chosen.
  2. The evidence ref's own deterministic suffix order (`E1 < E2 < …`, already fixed by the server's
     query order), applied only if two events could otherwise still tie (they should not, since
     `linkedDocuments[].id` is already unique per row).
  3. `sourceLineNumber`, when present, as a final fallback.
- Quantity/date conflicts across sources are never resolved here; that remains Phase 1B's
  responsibility, unchanged.

---

## 12. Role visibility (confirmed, unchanged)

`server/routes/order-operational-view.js` authorizes `["Owner", "IT", "Admin", "Buyer", "ReadOnly"]`
— all five roles already read this exact endpoint. Since Phase 2B.1 is built entirely from fields
already present in that response, **no permission expansion, no new endpoint, and no new query are
required.** The timeline is visible to whichever role can already open `OrderDetailPanel` for that
order. This is unlike Phase 2A, where a genuine access conflict existed (a Buyer-visible view versus
an Owner/IT/Admin-only diagnostic endpoint); no equivalent conflict exists here, and none needs to be
raised for approval.

---

## 13. Compact UI information architecture

- **Heading**: "Cronologia osservata dell'ordine" — deliberately distinct from Phase 2A's "Sintesi
  operativa dell'ordine di acquisto" and from `OrderOperationalView`'s own pre-existing "Situazione
  attuale" heading, to avoid the naming collision flagged during the Phase 2A review.
- **Chronological list**: up to 5 `DOCUMENT_OBSERVED` entries, newest first, each showing its date
  (per §6), safe source label, optional line association, and an evidence-open action; a
  deterministic "+N altri eventi" affordance reveals the rest, never all of them by default.
- **Commitment block**: separate, always visible when at least one commitment exists at either
  level; never merged into the chronological list.
- **Undated block**: separate, shown only when a qualifying item (§7) exists; empty on all three
  live Graphic Center orders today, but the section must exist structurally.
- **Evidence navigation**: reuses the existing `#evidence-${ref}` anchors — no new mechanism.

Not a redesign of `OrderDetailPanel`: this is one additional section, positioned in the existing
information flow (below Phase 2A's summary, alongside — not replacing — the existing evidence panel
inside `OrderOperationalView`), not a restructuring of the panel itself.

---

## 14. States

- **Empty**: zero linked documents and zero commitments → explicit "Nessun evento osservato per
  questo ordine," never a blank section.
- **Unavailable**: Phase 2B.1 introduces no new fetch (§12) — it is a view over the same
  `getOrderOperationalView` response already loaded for the panel. If that fetch itself fails, the
  timeline shares the same already-existing error/not-found treatment `OrderOperationalView` uses
  today; it does not need its own independent failure state.
- **Partial**: documents exist but no line resolves an exact association (§4) → events still render,
  simply without a "riga coinvolta" annotation.
- **Undated**: per §7, its own section, never merged into the chronology, never given a fabricated
  date.

---

## 15. Acceptance criteria (corrected, final)

Every event in the **main chronological list** must have all five of:
1. At least one exact, existing evidence reference (`evidenceReferences[]` entry), with a
   deterministic primary reference chosen per §4.2 whenever more than one confirmed reference
   resolves to the same document.
2. A valid, parseable date or timestamp (`linkedDocuments[].receivedAt`).
3. An explicit date-kind (§6) determining whether time precision is shown.
4. Deterministic source identity (§4.1) — never a fuzzy or positional match, and never an equality
   assumed from two fields sharing a name without the §4.0 confirmation step.
5. Any line association present on the event resolved only through a relationship confirmed per
   §4.0 — an event with no confirmed relationship for any of its lines is still valid and still
   rendered, simply without a "riga coinvolta" annotation.

Every item in the **undated section** must have both of:
1. An exact, existing evidence reference tied to a real `linkedDocuments[]` row.
2. No valid date, paired with explicit wording that the date cannot be verified (never silent, never
   implying "no date" means "nothing happened").

**No item without exact evidence may appear in either section.** `anomaliesAndAttention[]` entries
never qualify for the undated section (§7) and never appear anywhere in Phase 2B.1.

Additional criteria carried from the underlying design:
6. `SECTION_NOT_EVALUATED`-equivalent findings, Phase 2A situation/badges, and Phase 1B findings
   never appear inside this timeline.
7. Commitments never carry a completion claim and never migrate into the chronological list, even
   once overdue.
8. No new endpoint, query, or role-policy change exists anywhere in this specification.
9. The 5-event initial cap and its expansion behave deterministically (§10.4), not as an unbounded
   or arbitrary subset.
10. No raw UUID, internal id, or unsupported evidence link is ever rendered as visible text — this
    includes the internal `linkedDocuments[].id` used purely as a sort key (§11), which must never
    leak into displayed copy.
11. `linkedDocuments[].number` is never parsed to infer a document category (§10.2).
12. No two `linkedDocuments[]` rows are ever merged into one event on the basis of a shared
    `sourceEmailId`, and no cross-object field equality (e.g. two fields both named
    `sourceDocumentId`) is ever assumed without the explicit §4.0 confirmation step having been
    performed against the live contract.

---

## 16. Open limitations (final)

1. **`delivery_notes`/`invoices` have zero live rows across all three Graphic Center orders today.**
   Every observed event currently renders through the generic `documents`/`received_at` (ingestion
   timestamp) path — Phase 2B.1 cannot today produce a single event carrying a genuine
   document-stated business date; that capability exists in the code path (§6) but is unexercised by
   current data.
2. **Line-to-document association is exact-or-absent by design** (§4) — a real, plausible order
   could see most or all of its lines left without a "riga coinvolta" annotation if their only
   evidence is an email shared by multiple documents. This is the correct, honest behavior, not a
   defect, but it means the feature's practical usefulness for line-level traceability depends on
   how often that ambiguity actually arises as more orders are observed.
3. **No commitment currently carries a linkable evidence reference** — the contract does not attach
   one to `orders.due_date`/`required_date` or line-level equivalents. The Commitment block will
   show dates without an "open evidence" action until/unless a future contract change adds one; this
   specification does not invent one to fill that gap.
4. **The undated section is untested against real ambiguous data** — no live order currently
   produces an unparseable `receivedAt`, so this section's behavior is specified but not yet
   exercised by any real Graphic Center case.
5. **Phase 2B.2's six deferred event types remain fully unavailable** until a structured
   `document_type` classification or a real `delivery_notes`/`invoices` population exists for these
   suppliers, or a state-transition history is introduced — none of which this specification
   proposes building.

---

## 17. Documentation correction (recorded, not fixed here)

`docs/product/ORDER_OPERATIONAL_VIEW_CONTRACT.md` (§3.10–3.11, "activeCommitments /
supersededCommitments") currently states that `consolidateCommitments()` "already exists, pure
function, `lib/outbound-operational-facts.js`," and is merely unwired from a live path. This claim
is **false as of this review**: I verified directly (`grep -rn "consolidateCommitments"` across
`src/`, `scripts/`, and `server/`) that neither that function nor that file exists anywhere in the
current repository. Phase 2B.1 does not rely on this claim in any way — the Commitment block (§9) is
sourced entirely from the already-live `orders.due_date`/`required_date` and line-level equivalents,
never from `activeCommitments`/`consolidateCommitments()`. This correction is recorded here as an
explicit known documentation issue, per instruction; `ORDER_OPERATIONAL_VIEW_CONTRACT.md` itself has
not been modified as part of this task.

---

## 18. Non-goals and forbidden inferences (final)

- No AI judgment, no confidence score, at any point — extraction `confidence` is never displayed.
- No supplier-fault language, ever.
- No claim that a promised delivery occurred, ever — an overdue commitment stays a commitment.
- No inferred state-change date, ever — `getOrderStatus()`'s current output is never used to
  fabricate a prior event.
- No "recent/new" framing without genuine historical comparison — none exists, so none is claimed.
- No predictions, no ETAs, no confidence intervals.
- No customer-sales-order content, in any form.
- No new backend endpoint, database query, or extraction/matching logic. Phase 2B.1 is strictly a
  presentation layer composing fields already returned by `getOrderOperationalView()`.
- No parsing of `linkedDocuments[].number` to infer document type or event category.
- No use of `safeEvidenceExcerpts[].excerpt.due_date`/`required_date` as a commitment or event.
- No grouping of distinct `linkedDocuments[]` rows into one event merely because they share a
  `sourceEmailId`.
