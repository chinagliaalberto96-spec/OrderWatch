# Pilot Phase 1B - Validation Matrix

This checklist validates the read-only diagnostic handoff from a Data Quality
finding to the existing order detail and operational view. Fixture cases are
synthetic and do not claim to represent customer messages.

| Scenario | Source | Start | Selected finding | Destination | Banner | Focus | Evidence navigation | Explicit limitation | Result |
|---|---|---|---|---|---|---|---|---|---|
| Complete order | Fixture | Data Quality | None | Orders only through normal navigation | No | None | None | No issue is fabricated | PASS |
| Missing evidence | Fixture | Data Quality | `LINE_WITHOUT_EVIDENCE` | Exact order | Yes | Exact line id | None | The line cannot be verified against a source | PASS |
| Quantity conflict | Fixture | Data Quality | `QUANTITY_CONFLICT` | Exact order | Yes | Exact line id | Exact existing refs | No winning quantity is selected | PASS |
| Date conflict | Fixture | Data Quality | `DATE_CONFLICT` | Exact order | Yes | Exact line id | Exact existing refs | No winning date is selected | PASS |
| Unlinked document | Fixture | Data Quality | `DOCUMENT_LINK_UNPROVEN` | Exact order | Yes | Exact document id | Exact existing ref | The link is unconfirmed; the document is not called false | PASS |
| Organization source incomplete | Fixture and live | Data Quality organization section | `SOURCE_INCOMPLETE` | No order destination | No | None | None | Organization facts never create order context | PASS |
| Operational state unexplained | Fixture and live | Data Quality | `OPERATIONAL_STATE_UNEXPLAINED` | Exact order | Yes | Exact ids only when supplied | Exact existing refs | Dates, documents and recent communications require review | PASS |
| Section not evaluated | Fixture and live | Data Quality | `SECTION_NOT_EVALUATED` | Exact order | Yes | Exact ids only when supplied | Exact existing refs | Missing evaluation is not proof of correctness or error | PASS |

## Live Read-only Checks

The smoke test inspected the current Graphic Center contract without writing:

| Check | Current live result | Result |
|---|---|---|
| Contract order uniqueness | 3 unique orders; 0 duplicate order ids | PASS |
| Finding uniqueness | 13 unique findings; 0 duplicate finding ids | PASS |
| Organization source coverage | Incomplete/unavailable source coverage remains visible only as an organization finding | PASS |
| Order `13542272` | `open_findings`; includes `OPERATIONAL_STATE_UNEXPLAINED` and `SECTION_NOT_EVALUATED` | PASS |
| Order `0013545497` | `not_evaluated`; current findings are `SECTION_NOT_EVALUATED` only | PASS |
| References present in live findings | Every affected line id, document id or evidence ref actually present in the current findings resolves against the existing operational-view response | PASS |

The live dataset does not currently provide every fixture category. Missing
live categories are not synthesized; their behavior is covered only by the
explicitly synthetic fixture matrix above.

Exact line, document and evidence highlighting was validated through the
synthetic `LINE_WITHOUT_EVIDENCE`, `QUANTITY_CONFLICT`, `DATE_CONFLICT` and
`DOCUMENT_LINK_UNPROVEN` cases. The current Graphic Center contract does not
contain those finding categories with affected line/document identifiers, so
the live smoke test does not claim to validate their visual highlighting. It
validates only the current organization finding, destination order, banner
semantics and resolution of references that are actually present.
