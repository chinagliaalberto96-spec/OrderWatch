-- Separate product identity from its occurrence in a document. This preserves
-- legitimate repeated lines and blocks ambiguous later updates.
alter table public.purchase_order_lines
  add column if not exists identity_key text;

alter table public.delivery_note_lines
  add column if not exists identity_key text;

alter table public.project_requirements
  add column if not exists identity_key text;

alter table public.quote_lines
  add column if not exists identity_key text;

create index if not exists idx_purchase_order_lines_identity
  on public.purchase_order_lines (organization_id, order_id, identity_key)
  where identity_key is not null;

create index if not exists idx_delivery_note_lines_identity
  on public.delivery_note_lines (organization_id, delivery_note_id, identity_key)
  where identity_key is not null;

create index if not exists idx_project_requirements_identity
  on public.project_requirements (organization_id, project_id, identity_key)
  where identity_key is not null;

create index if not exists idx_quote_lines_identity
  on public.quote_lines (organization_id, quote_id, identity_key)
  where identity_key is not null;

alter table public.extraction_candidates
  drop constraint if exists extraction_candidates_candidate_type_check;

alter table public.extraction_candidates
  add constraint extraction_candidates_candidate_type_check check (
    candidate_type in (
      'supplier_order',
      'customer_order',
      'customer_change',
      'line_ambiguity',
      'unknown'
    )
  );
