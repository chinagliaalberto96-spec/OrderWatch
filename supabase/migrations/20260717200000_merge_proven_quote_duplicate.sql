-- The two Prima Assicurazioni messages are reminders for the same quote:
-- same organization, supplier, quote reference, amount and line identity.
-- Keep the first parent, enrich it with the latest values and retain both
-- source emails as append-only provenance.
with matching_quotes as (
  select q.*
  from public.quotes q
  where lower(regexp_replace(coalesce(q.quote_code, ''), '[^a-zA-Z0-9]', '', 'g')) = 'gv355yr'
    and lower(regexp_replace(coalesce(q.supplier_name, ''), '[^a-zA-Z0-9]', '', 'g')) = 'primaassicurazioni'
    and q.total_amount = 886.03
), ranked as (
  select
    mq.*,
    first_value(mq.id) over (order by mq.created_at, mq.id::text) as survivor_id,
    row_number() over (order by mq.created_at, mq.id::text) as position
  from matching_quotes mq
), line_matches as (
  select
    duplicate_line.organization_id,
    duplicate_line.id as duplicate_line_id,
    survivor_line.id as survivor_line_id,
    duplicate_line.source_email_id,
    duplicate_line.source_document_id,
    duplicate_line.line_number,
    duplicate_line.unit_price,
    duplicate_line.total_price,
    duplicate_line.description
  from ranked duplicate_quote
  join public.quote_lines duplicate_line
    on duplicate_line.organization_id = duplicate_quote.organization_id
   and duplicate_line.quote_id = duplicate_quote.id
  join public.quote_lines survivor_line
    on survivor_line.organization_id = duplicate_line.organization_id
   and survivor_line.quote_id = duplicate_quote.survivor_id
   and survivor_line.identity_key = duplicate_line.identity_key
  where duplicate_quote.position > 1
), copied_sources as (
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
    source.organization_id,
    'quote_line',
    match.survivor_line_id,
    source.source_email_id,
    source.source_document_id,
    source.source_line_number,
    source.observed_values || jsonb_build_object('merged_duplicate_quote', true)
  from line_matches match
  join public.canonical_line_sources source
    on source.organization_id = match.organization_id
   and source.entity_type = 'quote_line'
   and source.entity_id = match.duplicate_line_id
  on conflict (
    organization_id,
    entity_type,
    entity_id,
    source_email_id,
    source_line_number
  ) do nothing
  returning 1
), enriched_lines as (
  update public.quote_lines survivor
  set
    unit_price = coalesce(survivor.unit_price, match.unit_price),
    total_price = coalesce(survivor.total_price, match.total_price),
    updated_at = now()
  from line_matches match
  where survivor.organization_id = match.organization_id
    and survivor.id = match.survivor_line_id
  returning survivor.id
), removed_sources as (
  delete from public.canonical_line_sources source
  using line_matches match
  where source.organization_id = match.organization_id
    and source.entity_type = 'quote_line'
    and source.entity_id = match.duplicate_line_id
  returning source.id
)
delete from public.quotes q
using ranked duplicate_quote
where duplicate_quote.position > 1
  and q.organization_id = duplicate_quote.organization_id
  and q.id = duplicate_quote.id;
