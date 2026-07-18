-- Two financial emails referenced DDT 404/2026 inside their PDFs and were
-- historically materialized as delivery notes. The subjects identify the
-- primary documents exactly: one invoice and one credit note. Remove the
-- false DDT/order artifacts and retain both emails as financial records that
-- require review of amounts and dates.
with target_emails as (
  select
    pe.*,
    case
      when pe.subject ~* 'nota[[:space:]]+di[[:space:]]+credito[[:space:]]+185[[:space:]-]+2026'
        then '185-2026'
      when pe.subject ~* 'fattura[[:space:]]+186[[:space:]-]+2026'
        then '186-2026'
      else null
    end as financial_number,
    case
      when pe.subject ~* 'nota[[:space:]]+di[[:space:]]+credito' then 'unknown'
      else 'supplier_invoice'
    end as financial_type
  from public.processed_emails pe
  where pe.subject ~* 'B&G[[:space:]]+PRINT[[:space:]]+SERVICE'
    and (
      pe.subject ~* 'nota[[:space:]]+di[[:space:]]+credito[[:space:]]+185[[:space:]-]+2026'
      or pe.subject ~* 'fattura[[:space:]]+186[[:space:]-]+2026'
    )
), false_notes as (
  select distinct dn.*
  from public.delivery_notes dn
  join target_emails te
    on te.organization_id = dn.organization_id
   and te.id = dn.source_email_id
  where lower(regexp_replace(coalesce(dn.ddt_number, ''), '[^a-zA-Z0-9]', '', 'g')) = '4042026'
), inserted_invoices as (
  insert into public.invoices (
    organization_id,
    invoice_number,
    invoice_type,
    supplier_id,
    supplier_name,
    order_id,
    order_code,
    status,
    confidence,
    needs_review,
    source_email_id,
    source_document_id,
    notes
  )
  select
    te.organization_id,
    te.financial_number,
    te.financial_type,
    fn.supplier_id,
    fn.supplier_name,
    null,
    null,
    'to_review',
    0.99,
    true,
    te.id,
    fn.source_document_id,
    case
      when te.financial_type = 'unknown'
        then 'Nota di credito identificata dall oggetto; importo e riferimenti da verificare.'
      else 'Fattura identificata dall oggetto; importo e riferimenti da verificare.'
    end
  from target_emails te
  join false_notes fn
    on fn.organization_id = te.organization_id and fn.source_email_id = te.id
  where not exists (
    select 1
    from public.invoices current
    where current.organization_id = te.organization_id
      and current.source_email_id = te.id
  )
  returning id
), cleared_documents as (
  update public.documents d
  set order_id = null, needs_review = true
  from target_emails te
  where d.organization_id = te.organization_id
    and d.source_email_id = te.id
  returning d.id
), reclassified_emails as (
  update public.processed_emails pe
  set
    pre_classification = 'SUPPLIER',
    final_classification = 'SUPPLIER',
    classification_origin = 'SUPPLIER',
    classification_type = 'SUPPLIER_INVOICE',
    needs_review = true,
    updated_at = now()
  from target_emails te
  where pe.organization_id = te.organization_id and pe.id = te.id
  returning pe.id
), removed_provenance as (
  delete from public.canonical_line_sources cls
  using public.delivery_note_lines dnl, false_notes fn
  where cls.organization_id = dnl.organization_id
    and cls.entity_type = 'delivery_note_line'
    and cls.entity_id = dnl.id
    and dnl.organization_id = fn.organization_id
    and dnl.delivery_note_id = fn.id
  returning cls.id
), removed_notes as (
  delete from public.delivery_notes dn
  using false_notes fn
  where dn.organization_id = fn.organization_id and dn.id = fn.id
  returning dn.order_id, dn.organization_id
)
delete from public.orders o
using removed_notes removed
where o.organization_id = removed.organization_id
  and o.id = removed.order_id
  and o.order_code = 'DDT-404 - 2026'
  and not exists (
    select 1 from public.delivery_notes dn
    where dn.organization_id = o.organization_id and dn.order_id = o.id
  )
  and not exists (
    select 1 from public.purchase_order_lines pol
    where pol.organization_id = o.organization_id and pol.order_id = o.id
  );
