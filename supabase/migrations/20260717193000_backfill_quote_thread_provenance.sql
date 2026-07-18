-- Reconnect historical messages to an existing quote only when the business
-- reference identifies exactly one quote inside the organization. This adds
-- provenance; it never creates or merges a business entity.
with unique_quotes as (
  select
    organization_id,
    lower(regexp_replace(quote_code, '[^a-zA-Z0-9]', '', 'g')) as reference_key,
    (array_agg(id order by id::text))[1] as quote_id
  from public.quotes
  where nullif(trim(quote_code), '') is not null
  group by organization_id, lower(regexp_replace(quote_code, '[^a-zA-Z0-9]', '', 'g'))
  having count(*) = 1
), matching_messages as (
  select
    pe.organization_id,
    pe.id as source_email_id,
    pe.subject,
    pe.from_address,
    pe.classification_type,
    uq.quote_id
  from public.processed_emails pe
  cross join lateral regexp_match(
    pe.subject,
    '(?i)preventivo[[:space:]]+([[:alnum:]][[:alnum:]./_-]*)'
  ) as matched
  join unique_quotes uq
    on uq.organization_id = pe.organization_id
   and uq.reference_key = lower(regexp_replace(matched[1], '[^a-zA-Z0-9]', '', 'g'))
  where pe.status = 'done'
)
insert into public.canonical_line_sources (
  organization_id,
  entity_type,
  entity_id,
  source_email_id,
  source_document_id,
  source_line_number,
  observed_values
)
select
  mm.organization_id,
  'quote_line',
  ql.id,
  mm.source_email_id,
  ql.source_document_id,
  ql.line_number,
  jsonb_build_object(
    'subject', mm.subject,
    'from_address', mm.from_address,
    'classification_type', mm.classification_type,
    'matched_by', 'unique_quote_reference_in_subject'
  )
from matching_messages mm
join public.quote_lines ql
  on ql.organization_id = mm.organization_id
 and ql.quote_id = mm.quote_id
on conflict (
  organization_id,
  entity_type,
  entity_id,
  source_email_id,
  source_line_number
) do nothing;
