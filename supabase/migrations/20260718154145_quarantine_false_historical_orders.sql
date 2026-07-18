begin;

create table if not exists public.data_quality_quarantine_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  business_reference text,
  reason text not null,
  source_email_id uuid references public.processed_emails(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb,
  quarantined_at timestamptz not null default now(),
  constraint uniq_data_quality_quarantine_entity
    unique (organization_id, entity_type, entity_id)
);

alter table public.data_quality_quarantine_log enable row level security;
revoke all on table public.data_quality_quarantine_log from public, anon, authenticated;
grant select, insert, update, delete on table public.data_quality_quarantine_log to service_role;

with source_emails as (
  select pe.id, pe.organization_id, pe.message_id
  from public.processed_emails pe
  join public.organizations organization
    on organization.id = pe.organization_id
   and organization.slug = 'graphic-center'
  where pe.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  )
), target_orders as (
  select purchase_order.*, source_email.message_id
  from public.orders purchase_order
  join source_emails source_email
    on source_email.organization_id = purchase_order.organization_id
   and source_email.id = purchase_order.source_email_id
  where purchase_order.order_code like 'GCG-AI-%'
)
insert into public.data_quality_quarantine_log (
  organization_id,
  entity_type,
  entity_id,
  business_reference,
  reason,
  source_email_id,
  snapshot
)
select
  target.organization_id,
  'order',
  target.id,
  target.order_code,
  case
    when target.message_id = '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>'
      then 'Email informativa sulla fatturazione erroneamente trasformata in ordine dalla pipeline storica.'
    else 'Conferma ordine senza riferimento reale e senza righe operative utilizzabili, trasformata in ordine dalla pipeline storica.'
  end,
  target.source_email_id,
  jsonb_build_object(
    'order', to_jsonb(target) - 'message_id',
    'purchase_order_lines', coalesce((
      select jsonb_agg(to_jsonb(line) order by line.line_number)
      from public.purchase_order_lines line
      where line.organization_id = target.organization_id
        and line.order_id = target.id
    ), '[]'::jsonb),
    'legacy_material_lines', coalesce((
      select jsonb_agg(to_jsonb(line) order by line.created_at)
      from public.material_lines line
      where line.organization_id = target.organization_id
        and line.order_id = target.id
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(document) order by document.created_at)
      from public.documents document
      where document.organization_id = target.organization_id
        and document.order_id = target.id
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(activity) order by activity.created_at)
      from public.activities activity
      where activity.organization_id = target.organization_id
        and activity.order_code = target.order_code
    ), '[]'::jsonb)
  )
from target_orders target
on conflict (organization_id, entity_type, entity_id) do update set
  business_reference = excluded.business_reference,
  reason = excluded.reason,
  source_email_id = excluded.source_email_id,
  snapshot = excluded.snapshot,
  quarantined_at = now();

-- The Makito message may be a genuine order confirmation, but it has no
-- reliable reference or operational line. Keep it in review instead of
-- representing it as an official empty purchase order.
with source_email as (
  select pe.*
  from public.processed_emails pe
  join public.organizations organization
    on organization.id = pe.organization_id
   and organization.slug = 'graphic-center'
  where pe.message_id = '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
), quarantined as (
  select quarantine.*
  from public.data_quality_quarantine_log quarantine
  join source_email
    on source_email.organization_id = quarantine.organization_id
   and source_email.id = quarantine.source_email_id
  where quarantine.entity_type = 'order'
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
  source_email.organization_id,
  'supplier_order',
  'needs_review',
  'Conferma ordine senza riferimento reale e senza righe operative affidabili. Nessun ordine ufficiale e stato mantenuto.',
  jsonb_build_object(
    'source_subject', source_email.subject,
    'source_classification', source_email.classification_type,
    'quarantined_record', quarantined.snapshot
  ),
  source_email.id
from source_email
join quarantined on quarantined.source_email_id = source_email.id
on conflict (organization_id, source_email_id, candidate_type) do update set
  status = 'needs_review',
  reason = excluded.reason,
  extracted_payload = excluded.extracted_payload,
  updated_at = now();

with target_orders as (
  select purchase_order.id, purchase_order.organization_id, purchase_order.order_code
  from public.orders purchase_order
  join public.processed_emails source_email
    on source_email.organization_id = purchase_order.organization_id
   and source_email.id = purchase_order.source_email_id
  join public.organizations organization
    on organization.id = purchase_order.organization_id
   and organization.slug = 'graphic-center'
  where source_email.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  )
    and purchase_order.order_code like 'GCG-AI-%'
), target_lines as (
  select line.id, line.organization_id
  from public.purchase_order_lines line
  join target_orders target
    on target.organization_id = line.organization_id
   and target.id = line.order_id
)
delete from public.canonical_line_sources source
using target_lines target
where source.organization_id = target.organization_id
  and source.entity_type = 'purchase_order_line'
  and source.entity_id = target.id;

with target_orders as (
  select purchase_order.id, purchase_order.organization_id
  from public.orders purchase_order
  join public.processed_emails source_email
    on source_email.organization_id = purchase_order.organization_id
   and source_email.id = purchase_order.source_email_id
  join public.organizations organization
    on organization.id = purchase_order.organization_id
   and organization.slug = 'graphic-center'
  where source_email.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  )
    and purchase_order.order_code like 'GCG-AI-%'
)
delete from public.purchase_order_lines line
using target_orders target
where line.organization_id = target.organization_id
  and line.order_id = target.id;

with target_orders as (
  select purchase_order.id, purchase_order.organization_id
  from public.orders purchase_order
  join public.processed_emails source_email
    on source_email.organization_id = purchase_order.organization_id
   and source_email.id = purchase_order.source_email_id
  join public.organizations organization
    on organization.id = purchase_order.organization_id
   and organization.slug = 'graphic-center'
  where source_email.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  )
    and purchase_order.order_code like 'GCG-AI-%'
)
delete from public.material_lines line
using target_orders target
where line.organization_id = target.organization_id
  and line.order_id = target.id;

with target_orders as (
  select purchase_order.id, purchase_order.organization_id
  from public.orders purchase_order
  join public.processed_emails source_email
    on source_email.organization_id = purchase_order.organization_id
   and source_email.id = purchase_order.source_email_id
  join public.organizations organization
    on organization.id = purchase_order.organization_id
   and organization.slug = 'graphic-center'
  where source_email.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  )
    and purchase_order.order_code like 'GCG-AI-%'
)
delete from public.documents document
using target_orders target
where document.organization_id = target.organization_id
  and document.order_id = target.id;

with target_orders as (
  select purchase_order.id, purchase_order.organization_id, purchase_order.order_code
  from public.orders purchase_order
  join public.processed_emails source_email
    on source_email.organization_id = purchase_order.organization_id
   and source_email.id = purchase_order.source_email_id
  join public.organizations organization
    on organization.id = purchase_order.organization_id
   and organization.slug = 'graphic-center'
  where source_email.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  )
    and purchase_order.order_code like 'GCG-AI-%'
)
delete from public.activities activity
using target_orders target
where activity.organization_id = target.organization_id
  and activity.order_code = target.order_code;

with target_orders as (
  select purchase_order.id, purchase_order.organization_id
  from public.orders purchase_order
  join public.processed_emails source_email
    on source_email.organization_id = purchase_order.organization_id
   and source_email.id = purchase_order.source_email_id
  join public.organizations organization
    on organization.id = purchase_order.organization_id
   and organization.slug = 'graphic-center'
  where source_email.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  )
    and purchase_order.order_code like 'GCG-AI-%'
)
delete from public.orders purchase_order
using target_orders target
where purchase_order.organization_id = target.organization_id
  and purchase_order.id = target.id;

update public.processed_emails source_email
set
  linked_order_code = null,
  needs_review = case
    when source_email.message_id = '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>' then true
    else false
  end,
  updated_at = now()
from public.organizations organization
where organization.id = source_email.organization_id
  and organization.slug = 'graphic-center'
  and source_email.message_id in (
    '<9404E8E4ED15464EBF4CF1F9E0DD25A0@caselle.local>',
    '<169c126021e89ab466b19a73f36ea4201ad5766d69475c7078f0cfed515b47ae@www.makito.eu>'
  );

commit;
