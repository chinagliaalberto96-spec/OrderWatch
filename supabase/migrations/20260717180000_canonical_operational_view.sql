-- Backend-only compatibility projection for the product UI. Each row keeps
-- its real domain type; legacy material_lines are deliberately excluded.
alter table public.project_requirements
  add column if not exists order_id uuid;

alter table public.project_requirements
  drop constraint if exists fk_project_requirements_order_tenant;

alter table public.project_requirements
  add constraint fk_project_requirements_order_tenant
  foreign key (organization_id, order_id)
  references public.orders(organization_id, id) on delete set null;

create index if not exists idx_project_requirements_order
  on public.project_requirements (organization_id, order_id)
  where order_id is not null;

create or replace view public.canonical_operational_lines
with (security_invoker = true)
as
select
  pr.id,
  pr.organization_id,
  'project_requirement'::text as entity_kind,
  pr.project_id as parent_id,
  pr.project_id,
  p.project_code,
  pr.order_id,
  o.order_code,
  null::uuid as quote_id,
  null::uuid as delivery_note_id,
  o.supplier_id,
  o.supplier_name,
  p.customer as customer_name,
  'customer_request'::text as source_type,
  pr.source_email_id,
  pr.source_document_id,
  pr.item_code,
  pr.description,
  pr.requested_quantity as quantity,
  null::numeric as delivered_quantity,
  pr.requested_quantity as remaining_quantity,
  pr.unit_of_measure as unit,
  pr.required_date,
  o.due_date,
  case pr.status
    when 'needs_review' then 'Da verificare'
    when 'quoted' then 'Preventivo'
    when 'ordered' then 'Ordinato'
    when 'fulfilled' then 'Ricevuto'
    when 'cancelled' then 'Annullato'
    else 'Richiesto'
  end as status,
  pr.confidence,
  pr.needs_review,
  pr.canonical_key,
  pr.identity_key,
  pr.created_at,
  pr.updated_at
from public.project_requirements pr
join public.projects p
  on p.organization_id = pr.organization_id and p.id = pr.project_id
left join public.orders o
  on o.organization_id = pr.organization_id and o.id = pr.order_id

union all

select
  ql.id,
  ql.organization_id,
  'quote_line'::text,
  ql.quote_id,
  q.project_id,
  q.project_code,
  null::uuid,
  null::text,
  ql.quote_id,
  null::uuid,
  q.supplier_id,
  q.supplier_name,
  q.customer_name,
  'quote'::text,
  ql.source_email_id,
  ql.source_document_id,
  ql.item_code,
  ql.description,
  ql.quantity,
  null::numeric,
  ql.quantity,
  ql.unit_of_measure,
  ql.required_date,
  ql.promised_date,
  case
    when ql.needs_review then 'Da verificare'
    when q.status in ('rejected','cancelled') then 'Annullato'
    when q.status in ('converted','accepted') then 'Ordinato'
    else 'Preventivo'
  end,
  ql.confidence,
  ql.needs_review,
  ql.canonical_key,
  ql.identity_key,
  ql.created_at,
  ql.updated_at
from public.quote_lines ql
join public.quotes q
  on q.organization_id = ql.organization_id and q.id = ql.quote_id

union all

select
  pol.id,
  pol.organization_id,
  'purchase_order_line'::text,
  pol.order_id,
  o.project_id,
  o.project_code,
  pol.order_id,
  o.order_code,
  null::uuid,
  null::uuid,
  o.supplier_id,
  o.supplier_name,
  null::text,
  'supplier_order'::text,
  pol.source_email_id,
  pol.source_document_id,
  coalesce(pol.supplier_item_code, pol.internal_item_code),
  pol.description,
  pol.ordered_quantity,
  null::numeric,
  pol.ordered_quantity,
  pol.unit_of_measure,
  o.required_date,
  pol.promised_date,
  case
    when pol.needs_review or pol.status = 'draft' then 'Da verificare'
    when pol.status in ('received','over_received') then 'Ricevuto'
    when pol.status = 'cancelled' then 'Annullato'
    when pol.status = 'partially_received' then 'Parziale'
    else 'Confermato'
  end,
  pol.confidence,
  pol.needs_review,
  pol.canonical_key,
  pol.identity_key,
  pol.created_at,
  pol.updated_at
from public.purchase_order_lines pol
join public.orders o
  on o.organization_id = pol.organization_id and o.id = pol.order_id

union all

select
  dnl.id,
  dnl.organization_id,
  'delivery_note_line'::text,
  dnl.delivery_note_id,
  coalesce(dn.project_id, o.project_id),
  coalesce(dn.project_code, o.project_code),
  dn.order_id,
  dn.order_code,
  null::uuid,
  dnl.delivery_note_id,
  dn.supplier_id,
  dn.supplier_name,
  null::text,
  'ddt'::text,
  dnl.source_email_id,
  dnl.source_document_id,
  coalesce(dnl.supplier_item_code, dnl.internal_item_code),
  dnl.description,
  dnl.delivered_quantity,
  dnl.delivered_quantity,
  0::numeric,
  dnl.unit_of_measure,
  null::date,
  dn.delivery_date,
  case when dnl.needs_review then 'Da verificare' else 'Ricevuto' end,
  dnl.confidence,
  dnl.needs_review,
  dnl.canonical_key,
  dnl.identity_key,
  dnl.created_at,
  dnl.updated_at
from public.delivery_note_lines dnl
join public.delivery_notes dn
  on dn.organization_id = dnl.organization_id and dn.id = dnl.delivery_note_id
left join public.orders o
  on o.organization_id = dn.organization_id and o.id = dn.order_id;

revoke all on table public.canonical_operational_lines from public, anon, authenticated;
grant select on table public.canonical_operational_lines to service_role;
