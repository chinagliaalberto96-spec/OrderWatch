-- Separates customer deliverables from actual procurement needs.
-- Project requirements describe what the customer asked for; procurement
-- requirements describe what the buyer has explicitly decided to purchase.

create extension if not exists pgcrypto;

create unique index if not exists uniq_project_requirements_org_id
  on public.project_requirements (organization_id, id);
create unique index if not exists uniq_projects_org_id
  on public.projects (organization_id, id);
create unique index if not exists uniq_suppliers_org_id
  on public.suppliers (organization_id, id);
create unique index if not exists uniq_processed_emails_org_id
  on public.processed_emails (organization_id, id);
create unique index if not exists uniq_documents_org_id
  on public.documents (organization_id, id);

create table if not exists public.procurement_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid,
  source_project_requirement_id uuid,
  supplier_id uuid,
  item_code text,
  description text not null,
  requested_quantity numeric(18,4) check (requested_quantity is null or requested_quantity > 0),
  unit_of_measure text,
  required_date date,
  canonical_key text not null,
  identity_key text not null,
  status text not null default 'draft' check (
    status in ('draft','approved','partially_ordered','ordered','fulfilled','cancelled','needs_review')
  ),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  needs_review boolean not null default true,
  source_email_id uuid,
  source_document_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_procurement_requirement_project_tenant
    foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  constraint fk_procurement_requirement_source_tenant
    foreign key (organization_id, source_project_requirement_id)
    references public.project_requirements(organization_id, id) on delete restrict,
  constraint fk_procurement_requirement_supplier_tenant
    foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id) on delete restrict,
  constraint fk_procurement_requirement_email_tenant
    foreign key (organization_id, source_email_id)
    references public.processed_emails(organization_id, id) on delete restrict,
  constraint fk_procurement_requirement_document_tenant
    foreign key (organization_id, source_document_id)
    references public.documents(organization_id, id) on delete restrict,
  constraint uniq_procurement_requirement_canonical
    unique (organization_id, project_id, canonical_key)
);

create unique index if not exists uniq_procurement_requirements_org_id
  on public.procurement_requirements (organization_id, id);
create index if not exists idx_procurement_requirements_project
  on public.procurement_requirements (organization_id, project_id, status);
create index if not exists idx_procurement_requirements_source
  on public.procurement_requirements (organization_id, source_project_requirement_id)
  where source_project_requirement_id is not null;
create index if not exists idx_procurement_requirements_supplier
  on public.procurement_requirements (organization_id, supplier_id)
  where supplier_id is not null;

create table if not exists public.procurement_order_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  procurement_requirement_id uuid not null,
  purchase_order_line_id uuid not null,
  allocated_quantity numeric(18,4) check (allocated_quantity is null or allocated_quantity > 0),
  created_at timestamptz not null default now(),
  constraint fk_procurement_allocation_requirement_tenant
    foreign key (organization_id, procurement_requirement_id)
    references public.procurement_requirements(organization_id, id) on delete cascade,
  constraint fk_procurement_allocation_order_line_tenant
    foreign key (organization_id, purchase_order_line_id)
    references public.purchase_order_lines(organization_id, id) on delete cascade,
  constraint uniq_procurement_order_allocation
    unique (organization_id, procurement_requirement_id, purchase_order_line_id)
);

create index if not exists idx_procurement_allocations_requirement
  on public.procurement_order_allocations (organization_id, procurement_requirement_id);
create index if not exists idx_procurement_allocations_order_line
  on public.procurement_order_allocations (organization_id, purchase_order_line_id);

drop trigger if exists trg_set_updated_at on public.procurement_requirements;
create trigger trg_set_updated_at before update on public.procurement_requirements
  for each row execute function public.set_updated_at();

alter table public.procurement_requirements enable row level security;
alter table public.procurement_order_allocations enable row level security;
revoke all on table public.procurement_requirements from public, anon, authenticated;
revoke all on table public.procurement_order_allocations from public, anon, authenticated;
grant select, insert, update, delete on table public.procurement_requirements to service_role;
grant select, insert, update, delete on table public.procurement_order_allocations to service_role;

-- Add the new domain entity to the backend-only canonical projection. The
-- legacy material_lines table remains excluded.
create or replace view public.canonical_operational_lines_base
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
  req.id,
  req.organization_id,
  'procurement_requirement'::text,
  req.id,
  req.project_id,
  p.project_code,
  allocation.order_id,
  allocation.order_code,
  null::uuid,
  null::uuid,
  req.supplier_id,
  s.name,
  p.customer,
  'procurement_requirement'::text,
  req.source_email_id,
  req.source_document_id,
  req.item_code,
  req.description,
  req.requested_quantity,
  null::numeric,
  greatest(coalesce(req.requested_quantity, 0) - coalesce(allocation.allocated_quantity, 0), 0),
  req.unit_of_measure,
  req.required_date,
  allocation.due_date,
  case req.status
    when 'needs_review' then 'Da verificare'
    when 'draft' then 'Da definire'
    when 'approved' then 'Da ordinare'
    when 'partially_ordered' then 'Parzialmente ordinato'
    when 'ordered' then 'Ordinato'
    when 'fulfilled' then 'Ricevuto'
    when 'cancelled' then 'Annullato'
  end,
  req.confidence,
  req.needs_review,
  req.canonical_key,
  req.identity_key,
  req.created_at,
  req.updated_at
from public.procurement_requirements req
left join public.projects p
  on p.organization_id = req.organization_id and p.id = req.project_id
left join public.suppliers s
  on s.organization_id = req.organization_id and s.id = req.supplier_id
left join lateral (
  select
    case when count(distinct pol.order_id) = 1 then min(pol.order_id::text)::uuid end as order_id,
    case when count(distinct pol.order_id) = 1 then min(o.order_code) end as order_code,
    min(pol.promised_date) as due_date,
    sum(coalesce(poa.allocated_quantity, pol.ordered_quantity, 0)) as allocated_quantity
  from public.procurement_order_allocations poa
  join public.purchase_order_lines pol
    on pol.organization_id = poa.organization_id and pol.id = poa.purchase_order_line_id
  join public.orders o
    on o.organization_id = pol.organization_id and o.id = pol.order_id
  where poa.organization_id = req.organization_id
    and poa.procurement_requirement_id = req.id
) allocation on true

union all

select
  ql.id, ql.organization_id, 'quote_line'::text, ql.quote_id, q.project_id, q.project_code,
  null::uuid, null::text, ql.quote_id, null::uuid, q.supplier_id, q.supplier_name,
  q.customer_name, 'quote'::text, ql.source_email_id, ql.source_document_id,
  ql.item_code, ql.description, ql.quantity, null::numeric, ql.quantity,
  ql.unit_of_measure, ql.required_date, ql.promised_date,
  case when ql.needs_review then 'Da verificare'
    when q.status in ('rejected','cancelled') then 'Annullato'
    when q.status in ('converted','accepted') then 'Ordinato'
    else 'Preventivo' end,
  ql.confidence, ql.needs_review, ql.canonical_key, ql.identity_key, ql.created_at, ql.updated_at
from public.quote_lines ql
join public.quotes q on q.organization_id = ql.organization_id and q.id = ql.quote_id

union all

select
  pol.id, pol.organization_id, 'purchase_order_line'::text, pol.order_id, o.project_id,
  o.project_code, pol.order_id, o.order_code, null::uuid, null::uuid, o.supplier_id,
  o.supplier_name, null::text, 'supplier_order'::text, pol.source_email_id,
  pol.source_document_id, coalesce(pol.supplier_item_code, pol.internal_item_code),
  pol.description, pol.ordered_quantity, null::numeric, pol.ordered_quantity,
  pol.unit_of_measure, o.required_date, pol.promised_date,
  case when pol.needs_review or pol.status = 'draft' then 'Da verificare'
    when pol.status in ('received','over_received') then 'Ricevuto'
    when pol.status = 'cancelled' then 'Annullato'
    when pol.status = 'partially_received' then 'Parziale'
    else 'Confermato' end,
  pol.confidence, pol.needs_review, pol.canonical_key, pol.identity_key, pol.created_at, pol.updated_at
from public.purchase_order_lines pol
join public.orders o on o.organization_id = pol.organization_id and o.id = pol.order_id

union all

select
  dnl.id, dnl.organization_id, 'delivery_note_line'::text, dnl.delivery_note_id,
  coalesce(dn.project_id, o.project_id), coalesce(dn.project_code, o.project_code),
  dn.order_id, dn.order_code, null::uuid, dnl.delivery_note_id, dn.supplier_id,
  dn.supplier_name, null::text, 'ddt'::text, dnl.source_email_id,
  dnl.source_document_id, coalesce(dnl.supplier_item_code, dnl.internal_item_code),
  dnl.description, dnl.delivered_quantity, dnl.delivered_quantity, 0::numeric,
  dnl.unit_of_measure, null::date, dn.delivery_date,
  case when dnl.needs_review then 'Da verificare' else 'Ricevuto' end,
  dnl.confidence, dnl.needs_review, dnl.canonical_key, dnl.identity_key, dnl.created_at, dnl.updated_at
from public.delivery_note_lines dnl
join public.delivery_notes dn
  on dn.organization_id = dnl.organization_id and dn.id = dnl.delivery_note_id
left join public.orders o
  on o.organization_id = dn.organization_id and o.id = dn.order_id;

revoke all on table public.canonical_operational_lines_base from public, anon, authenticated;
grant select on table public.canonical_operational_lines_base to service_role;
