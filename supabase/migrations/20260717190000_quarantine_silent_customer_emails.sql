-- Historical customer orders/changes that completed without creating any
-- domain artifact must never remain silently successful. Preserve metadata,
-- mark them for review, and do not invent projects or order lines.
with silent_customer_emails as (
  select pe.*
  from public.processed_emails pe
  where pe.status = 'done'
    and pe.classification_type in ('CUSTOMER_ORDER', 'CUSTOMER_CHANGE_REQUEST')
    and not exists (select 1 from public.documents d where d.source_email_id = pe.id)
    and not exists (select 1 from public.project_requirements pr where pr.source_email_id = pe.id)
    and not exists (select 1 from public.quote_lines ql where ql.source_email_id = pe.id)
    and not exists (select 1 from public.quotes q where q.source_email_id = pe.id)
    and not exists (select 1 from public.extraction_candidates ec where ec.source_email_id = pe.id)
)
insert into public.extraction_candidates (
  organization_id,
  candidate_type,
  status,
  reason,
  extracted_payload,
  source_email_id
)
select
  organization_id,
  case
    when classification_type = 'CUSTOMER_CHANGE_REQUEST' then 'customer_change'
    else 'customer_order'
  end,
  'needs_review',
  'Email cliente completata dalla pipeline storica senza un riferimento o un artefatto univoco. Nessun dato operativo e stato inventato.',
  jsonb_strip_nulls(jsonb_build_object(
    'subject', subject,
    'from_address', from_address,
    'classification_type', classification_type,
    'classification_origin', classification_origin,
    'confidence', confidence
  )),
  id
from silent_customer_emails
on conflict (organization_id, source_email_id, candidate_type) do nothing;

update public.processed_emails pe
set needs_review = true,
    updated_at = now()
where pe.status = 'done'
  and pe.classification_type in ('CUSTOMER_ORDER', 'CUSTOMER_CHANGE_REQUEST')
  and exists (
    select 1
    from public.extraction_candidates ec
    where ec.organization_id = pe.organization_id
      and ec.source_email_id = pe.id
      and ec.status = 'needs_review'
  );

insert into public.buyer_actions (
  organization_id,
  action_type,
  status,
  title,
  detail,
  source_email_id,
  direction
)
select
  ec.organization_id,
  'other',
  'needs_review',
  case ec.candidate_type
    when 'customer_change' then 'Collega modifica cliente a un lavoro'
    else 'Identifica ordine cliente'
  end,
  ec.reason,
  ec.source_email_id,
  'inbound'
from public.extraction_candidates ec
where ec.status = 'needs_review'
  and ec.candidate_type in ('customer_order', 'customer_change')
  and not exists (
    select 1
    from public.buyer_actions ba
    where ba.organization_id = ec.organization_id
      and ba.source_email_id = ec.source_email_id
      and ba.status = 'needs_review'
  );
