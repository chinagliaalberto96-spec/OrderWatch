-- Remove the legacy order fabricated from a DDT reference. Financial-document
-- reclassification detached every real business artifact before this cleanup.
delete from public.material_line_revisions revision
where revision.material_line_id in (
  select line.id
  from public.material_lines line
  join public.orders purchase_order on purchase_order.id = line.order_id
  where purchase_order.order_code = 'DDT-404 - 2026'
    and purchase_order.source_email_id is null
    and purchase_order.notes like 'Ordine creato automaticamente da un DDT%'
);

delete from public.material_lines line
using public.orders purchase_order
where line.order_id = purchase_order.id
  and purchase_order.order_code = 'DDT-404 - 2026'
  and purchase_order.source_email_id is null
  and purchase_order.notes like 'Ordine creato automaticamente da un DDT%'
  and not exists (
    select 1 from public.purchase_order_lines canonical_line
    where canonical_line.order_id = purchase_order.id
  );

delete from public.orders purchase_order
where purchase_order.order_code = 'DDT-404 - 2026'
  and purchase_order.source_email_id is null
  and purchase_order.notes like 'Ordine creato automaticamente da un DDT%'
  and not exists (select 1 from public.documents row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.delivery_notes row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.invoices row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.purchase_order_lines row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.material_lines row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.project_requirements row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.customer_confirmations row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.reminders row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.buyer_actions row where row.order_id = purchase_order.id)
  and not exists (select 1 from public.supplier_order_dispatches row where row.order_id = purchase_order.id);
