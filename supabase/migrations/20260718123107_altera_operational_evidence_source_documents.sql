-- Altera Brain v1.1: evidence layer.
--
-- Questa vista non duplica email, documenti o righe operative. Espone una
-- lettura uniforme delle provenienze gia' registrate dal backend e permette
-- alla UI di spiegare ogni conclusione con le relative fonti.

create or replace view public.operational_evidence
with (security_invoker = true)
as
with evidence_links as (
  select
    cls.id::text as evidence_id,
    cls.organization_id,
    cls.entity_type as subject_type,
    cls.entity_id as subject_id,
    cls.source_email_id,
    cls.source_document_id,
    cls.source_line_number,
    coalesce(cls.observed_values, '{}'::jsonb) as observed_values,
    line.confidence as assertion_confidence,
    coalesce(line.needs_review, false) as assertion_needs_review,
    cls.created_at as linked_at
  from public.canonical_line_sources cls
  left join public.canonical_operational_lines line
    on line.organization_id = cls.organization_id
   and line.entity_kind = cls.entity_type
   and line.id = cls.entity_id

  union all

  -- La stessa osservazione puo' spiegare anche il contenitore operativo della
  -- riga. Questa e' una proiezione di lettura: non crea copie nei dati base.
  select
    concat('parent:', parent.subject_type, ':', cls.id),
    cls.organization_id,
    parent.subject_type,
    parent.subject_id,
    cls.source_email_id,
    cls.source_document_id,
    cls.source_line_number,
    coalesce(cls.observed_values, '{}'::jsonb),
    line.confidence,
    coalesce(line.needs_review, false),
    cls.created_at
  from public.canonical_line_sources cls
  join public.canonical_operational_lines line
    on line.organization_id = cls.organization_id
   and line.entity_kind = cls.entity_type
   and line.id = cls.entity_id
  cross join lateral (
    values
      ('project'::text, line.project_id),
      ('order'::text, line.order_id),
      ('quote'::text, line.quote_id),
      ('delivery_note'::text, line.delivery_note_id)
  ) as parent(subject_type, subject_id)
  where parent.subject_id is not null

  union all

  -- Compatibilita' con righe storiche che hanno una fonte diretta ma non
  -- ancora una riga nella tabella append-only delle provenienze.
  select
    concat('canonical-direct:', line.entity_kind, ':', line.id, ':', line.source_email_id),
    line.organization_id,
    line.entity_kind,
    line.id,
    line.source_email_id,
    line.source_document_id,
    null::integer,
    jsonb_strip_nulls(jsonb_build_object(
      'description', line.description,
      'item_code', line.item_code,
      'quantity', line.quantity,
      'unit', line.unit,
      'required_date', line.required_date,
      'due_date', line.due_date,
      'status', line.status,
      'confidence', line.confidence
    )),
    line.confidence,
    coalesce(line.needs_review, false),
    line.created_at
  from public.canonical_operational_lines line
  where line.source_email_id is not null
    and not exists (
      select 1
      from public.canonical_line_sources source
      where source.organization_id = line.organization_id
        and source.entity_type = line.entity_kind
        and source.entity_id = line.id
        and source.source_email_id = line.source_email_id
    )

  union all

  select
    source.id::text,
    source.organization_id,
    'invoice'::text,
    source.invoice_id,
    source.source_email_id,
    source.source_document_id,
    null::integer,
    coalesce(source.observed_values, '{}'::jsonb),
    invoice.confidence,
    coalesce(invoice.needs_review, false),
    coalesce(source.observed_at, source.created_at)
  from public.invoice_sources source
  join public.invoices invoice
    on invoice.organization_id = source.organization_id
   and invoice.id = source.invoice_id

  union all

  select
    concat('quote:', quote.id, ':', coalesce(quote.source_email_id::text, quote.source_document_id::text)),
    quote.organization_id,
    'quote'::text,
    quote.id,
    quote.source_email_id,
    quote.source_document_id,
    null::integer,
    jsonb_strip_nulls(jsonb_build_object(
      'quote_code', quote.quote_code,
      'quote_type', quote.quote_type,
      'supplier_name', quote.supplier_name,
      'customer_name', quote.customer_name,
      'total_amount', quote.total_amount,
      'currency', quote.currency,
      'valid_until', quote.valid_until,
      'status', quote.status
    )),
    quote.confidence,
    coalesce(quote.needs_review, false),
    quote.created_at
  from public.quotes quote
  where quote.source_email_id is not null or quote.source_document_id is not null

  union all

  select
    concat('delivery-note:', note.id, ':', coalesce(note.source_email_id::text, note.source_document_id::text)),
    note.organization_id,
    'delivery_note'::text,
    note.id,
    note.source_email_id,
    note.source_document_id,
    null::integer,
    jsonb_strip_nulls(jsonb_build_object(
      'ddt_number', note.ddt_number,
      'supplier_name', note.supplier_name,
      'delivery_date', note.delivery_date,
      'order_code', note.order_code,
      'project_code', note.project_code,
      'status', note.status
    )),
    note.confidence,
    coalesce(note.needs_review, false),
    note.created_at
  from public.delivery_notes note
  where note.source_email_id is not null or note.source_document_id is not null

  union all

  select
    concat('buyer-action:', action.id, ':', action.source_email_id),
    action.organization_id,
    'buyer_action'::text,
    action.id,
    action.source_email_id,
    null::uuid,
    null::integer,
    jsonb_strip_nulls(jsonb_build_object(
      'action_type', action.action_type,
      'title', action.title,
      'detail', action.detail,
      'status', action.status
    )),
    email.confidence,
    coalesce(email.needs_review, false) or action.status = 'needs_review',
    action.created_at
  from public.buyer_actions action
  join public.processed_emails email
    on email.organization_id = action.organization_id
   and email.id = action.source_email_id
  where action.source_email_id is not null

  union all

  -- Le email presenti direttamente nella coda importazioni sono evidenza di
  -- se stesse; il contenuto di quelle non operative resta protetto dalla UI.
  select
    concat('processed-email:', email.id),
    email.organization_id,
    'processed_email'::text,
    email.id,
    email.id,
    null::uuid,
    null::integer,
    jsonb_strip_nulls(jsonb_build_object(
      'classification_origin', email.classification_origin,
      'classification_type', email.classification_type,
      'status', email.status
    )),
    email.confidence,
    coalesce(email.needs_review, false),
    coalesce(email.processed_at, email.created_at)
  from public.processed_emails email
)
select
  link.evidence_id,
  link.organization_id,
  link.subject_type,
  link.subject_id,
  case
    when link.source_document_id is not null then 'document'
    else 'email'
  end::text as evidence_kind,
  link.source_email_id,
  link.source_document_id,
  link.source_line_number,
  link.observed_values,
  email.subject as email_subject,
  email.from_address as email_from,
  email.to_addresses as email_to,
  email.direction as email_direction,
  email.received_at as email_date,
  email.classification_origin,
  email.classification_type,
  email.confidence as email_confidence,
  email.needs_review as email_needs_review,
  coalesce(document.filename, document.name) as document_name,
  coalesce(document.document_type, document.type) as document_type,
  document.confidence as document_confidence,
  document.needs_review as document_needs_review,
  link.assertion_confidence,
  case
    when link.assertion_needs_review
      or coalesce(email.needs_review, false)
      or coalesce(document.needs_review, false)
      then 'needs_review'
    when coalesce(link.assertion_confidence, document.confidence, email.confidence) >= 0.90
      then 'certain'
    when coalesce(link.assertion_confidence, document.confidence, email.confidence) >= 0.75
      then 'probable'
    else 'uncertain'
  end::text as confidence_status,
  coalesce(link.assertion_confidence, document.confidence, email.confidence) as confidence,
  coalesce(email.received_at, document.received_at, link.linked_at) as observed_at,
  link.linked_at
from evidence_links link
left join public.processed_emails email
  on email.organization_id = link.organization_id
 and email.id = link.source_email_id
left join public.documents document
  on document.organization_id = link.organization_id
 and document.id = link.source_document_id;

revoke all on table public.operational_evidence from public, anon, authenticated;
grant select on table public.operational_evidence to service_role;
