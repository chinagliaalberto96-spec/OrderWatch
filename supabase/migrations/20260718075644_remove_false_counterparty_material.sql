-- Remove one confirmed extraction artefact from the Makito order confirmation.
-- The actual ordered material remains on order 13542272; "ARC'S" was a page
-- label without quantity, item code or price and must not be treated as a line.
delete from public.canonical_line_sources
where entity_type = 'purchase_order_line'
  and entity_id in (
    select pol.id
    from public.purchase_order_lines pol
    join public.orders o on o.id = pol.order_id and o.organization_id = pol.organization_id
    join public.processed_emails pe on pe.id = pol.source_email_id and pe.organization_id = pol.organization_id
    where o.order_code = '13542272'
      and pe.message_id = '<ADR51000001634951100A5EA6641F1091FD19FD7F54B0D6D22E3@MAKITO.ES>'
      and upper(pol.description) = 'ARC''S'
      and pol.ordered_quantity is null
      and pol.supplier_item_code is null
      and pol.unit_price is null
      and pol.total_price is null
  );

delete from public.purchase_order_lines pol
using public.orders o, public.processed_emails pe
where o.id = pol.order_id
  and o.organization_id = pol.organization_id
  and pe.id = pol.source_email_id
  and pe.organization_id = pol.organization_id
  and o.order_code = '13542272'
  and pe.message_id = '<ADR51000001634951100A5EA6641F1091FD19FD7F54B0D6D22E3@MAKITO.ES>'
  and upper(pol.description) = 'ARC''S'
  and pol.ordered_quantity is null
  and pol.supplier_item_code is null
  and pol.unit_price is null
  and pol.total_price is null;

delete from public.material_lines ml
using public.processed_emails pe
where pe.id = ml.source_email_id
  and pe.organization_id = ml.organization_id
  and pe.message_id = '<ADR51000001634951100A5EA6641F1091FD19FD7F54B0D6D22E3@MAKITO.ES>'
  and ml.order_code = '13542272'
  and upper(ml.description) = 'ARC''S'
  and ml.quantity is null
  and ml.item_code is null
  and ml.unit_price is null
  and ml.total_price is null;
