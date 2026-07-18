-- Preserve the raw purchase-order state in the UI projection. An order that
-- has only been placed is not yet confirmed by the supplier.
alter view public.canonical_operational_lines
  rename to canonical_operational_lines_base;

create view public.canonical_operational_lines
with (security_invoker = true)
as
select
  c.id,
  c.organization_id,
  c.entity_kind,
  c.parent_id,
  c.project_id,
  c.project_code,
  c.order_id,
  c.order_code,
  c.quote_id,
  c.delivery_note_id,
  c.supplier_id,
  c.supplier_name,
  c.customer_name,
  c.source_type,
  c.source_email_id,
  c.source_document_id,
  c.item_code,
  c.description,
  c.quantity,
  c.delivered_quantity,
  c.remaining_quantity,
  c.unit,
  c.required_date,
  c.due_date,
  case
    when c.entity_kind = 'purchase_order_line' and pol.status = 'ordered' then 'Ordinato'
    else c.status
  end as status,
  c.confidence,
  c.needs_review,
  c.canonical_key,
  c.identity_key,
  c.created_at,
  c.updated_at
from public.canonical_operational_lines_base c
left join public.purchase_order_lines pol
  on c.entity_kind = 'purchase_order_line'
 and pol.organization_id = c.organization_id
 and pol.id = c.id;

revoke all on table public.canonical_operational_lines_base from public, anon, authenticated;
grant select on table public.canonical_operational_lines_base to service_role;
revoke all on table public.canonical_operational_lines from public, anon, authenticated;
grant select on table public.canonical_operational_lines to service_role;
