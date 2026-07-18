alter table public.invoices
  add column if not exists canonical_key text;

create unique index if not exists invoices_organization_canonical_key_uidx
  on public.invoices (organization_id, canonical_key)
  where canonical_key is not null;

create table if not exists public.invoice_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  source_email_id uuid references public.processed_emails(id) on delete set null,
  source_document_id uuid references public.documents(id) on delete set null,
  observed_values jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_id, source_email_id)
);

alter table public.invoice_sources enable row level security;

create index if not exists invoice_sources_invoice_idx
  on public.invoice_sources (organization_id, invoice_id, observed_at desc);

create index if not exists invoice_sources_email_idx
  on public.invoice_sources (organization_id, source_email_id)
  where source_email_id is not null;

-- Corregge le classificazioni storiche in cui tipo documento e origine
-- commerciale si contraddicevano. I casi operativi restano in revisione.
update public.processed_emails
set classification_origin = 'SUPPLIER',
    final_classification = 'SUPPLIER',
    needs_review = true,
    confidence = least(coalesce(confidence, 0.70), 0.70),
    updated_at = now()
where classification_type in (
    'SUPPLIER_ORDER_CONFIRMATION',
    'SUPPLIER_DELIVERY_UPDATE',
    'SUPPLIER_QUOTE',
    'SUPPLIER_DDT',
    'SUPPLIER_INVOICE',
    'SUPPLIER_PAYMENT_REMINDER'
  )
  and classification_origin is distinct from 'SUPPLIER';

update public.processed_emails
set classification_origin = 'CUSTOMER',
    final_classification = 'CUSTOMER',
    needs_review = true,
    confidence = least(coalesce(confidence, 0.70), 0.70),
    updated_at = now()
where classification_type in (
    'CUSTOMER_ORDER',
    'CUSTOMER_QUOTE_REQUEST',
    'CUSTOMER_CHANGE_REQUEST'
  )
  and classification_origin is distinct from 'CUSTOMER';

update public.processed_emails
set classification_origin = 'NOISE',
    final_classification = 'OTHER',
    updated_at = now()
where classification_type = 'NOISE'
  and classification_origin is distinct from 'NOISE';

-- Conserva la provenienza anche per tutte le fatture gia' esistenti.
insert into public.invoice_sources (
  organization_id,
  invoice_id,
  source_email_id,
  source_document_id,
  observed_values,
  observed_at
)
select
  i.organization_id,
  i.id,
  i.source_email_id,
  i.source_document_id,
  jsonb_build_object(
    'invoice_number', i.invoice_number,
    'invoice_date', i.invoice_date,
    'order_code', i.order_code,
    'total_amount', i.total_amount,
    'payment_due_date', i.due_date,
    'supplier_name', i.supplier_name,
    'supplier_vat', i.supplier_vat,
    'historical_backfill', true
  ),
  coalesce(pe.received_at, i.created_at)
from public.invoices i
left join public.processed_emails pe on pe.id = i.source_email_id
where i.source_email_id is not null
on conflict (organization_id, invoice_id, source_email_id) do nothing;

-- Le due notifiche Makito hanno message-id differenti ma rappresentano lo
-- stesso oggetto economico: stesso fornitore, ordine, importo, scadenza e
-- oggetto. Si mantiene una sola fattura con entrambe le email nella storia.
do $$
declare
  invoice_ids uuid[];
  survivor_id uuid;
  duplicate_id uuid;
begin
  select array_agg(i.id order by pe.received_at, i.created_at)
  into invoice_ids
  from public.invoices i
  left join public.processed_emails pe on pe.id = i.source_email_id
  where regexp_replace(
      regexp_replace(upper(coalesce(i.order_code, '')), '[^A-Z0-9]', '', 'g'),
      '^0+', ''
    ) = '13542272'
    and i.total_amount = 99.31
    and i.due_date = date '2026-09-30'
    and lower(coalesce(i.supplier_name, '')) like '%makito%';

  if coalesce(array_length(invoice_ids, 1), 0) <> 2 then
    raise notice 'Makito invoice consolidation skipped: expected 2 candidates, found %',
      coalesce(array_length(invoice_ids, 1), 0);
    return;
  end if;

  survivor_id := invoice_ids[1];
  duplicate_id := invoice_ids[2];

  update public.invoice_sources
  set invoice_id = survivor_id
  where invoice_id = duplicate_id;

  update public.invoices survivor
  set invoice_number = coalesce(latest.invoice_number, survivor.invoice_number),
      invoice_date = coalesce(latest.invoice_date, survivor.invoice_date),
      order_id = coalesce(latest.order_id, survivor.order_id),
      order_code = coalesce(latest.order_code, survivor.order_code),
      project_id = coalesce(latest.project_id, survivor.project_id),
      project_code = coalesce(latest.project_code, survivor.project_code),
      due_date = coalesce(latest.due_date, survivor.due_date),
      total_amount = coalesce(latest.total_amount, survivor.total_amount),
      status = case when survivor.status = 'matched' then survivor.status else latest.status end,
      confidence = greatest(survivor.confidence, latest.confidence),
      needs_review = survivor.needs_review or latest.needs_review,
      source_email_id = latest.source_email_id,
      source_document_id = coalesce(latest.source_document_id, survivor.source_document_id),
      notes = coalesce(latest.notes, survivor.notes),
      updated_at = now()
  from public.invoices latest
  where survivor.id = survivor_id
    and latest.id = duplicate_id;

  delete from public.invoices where id = duplicate_id;
end
$$;

-- Una fattura incompleta resta consultabile, ma non viene considerata
-- definitivamente verificata finche' i dati chiave non sono disponibili.
update public.invoices
set needs_review = true,
    status = case when status = 'matched' then status else 'to_review' end,
    updated_at = now()
where invoice_number is null
   or due_date is null;
