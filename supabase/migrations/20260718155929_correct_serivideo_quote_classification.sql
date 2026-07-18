-- Historical metadata correction for a Serivideo supplier quote that was
-- persisted correctly as a quote but retained the initial invoice label.
-- Stable tenant slug + RFC Message-ID keep the migration portable and avoid
-- depending on generated database identifiers.
update public.processed_emails pe
set classification_origin = 'SUPPLIER',
    classification_type = 'SUPPLIER_QUOTE',
    final_classification = 'SUPPLIER',
    skipped_reason = 'Tipo documento corretto in SUPPLIER_QUOTE: il dato estratto e persistito e un preventivo fornitore',
    updated_at = now()
from public.organizations o
where o.id = pe.organization_id
  and o.slug = 'graphic-center'
  and pe.message_id = '<003701dd143f$d87e6480$897b2d80$@serivideo.it>'
  and pe.classification_type = 'SUPPLIER_INVOICE'
  and exists (
    select 1
    from public.quotes q
    where q.organization_id = pe.organization_id
      and q.source_email_id = pe.id
      and q.quote_type = 'supplier_quote'
  )
  and not exists (
    select 1
    from public.invoices i
    where i.organization_id = pe.organization_id
      and i.source_email_id = pe.id
  );
