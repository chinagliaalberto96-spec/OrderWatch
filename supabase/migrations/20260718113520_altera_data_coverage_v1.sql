-- Altera Brain v1: copertura delle fonti.
--
-- La vista non crea una seconda verita': calcola in tempo reale cosa
-- OrderWatch puo' osservare usando caselle, email e artefatti gia' esistenti.
-- L'app la legge solo server-side con service_role, come il resto del prodotto.

create or replace view public.data_source_coverage
with (security_invoker = true)
as
with mailbox_stats as (
  select
    organization_id,
    count(*) filter (where active) as configured_mailboxes,
    count(*) filter (where active and connection_status = 'connected') as connected_mailboxes,
    count(*) filter (
      where active
        and connection_status = 'connected'
        and nullif(trim(coalesce(sent_folder, '')), '') is not null
    ) as sent_capable_mailboxes,
    max(last_check_at) as last_mailbox_check_at,
    max(last_sent_check_at) as last_sent_check_at
  from public.mailboxes
  group by organization_id
),
email_stats as (
  select
    organization_id,
    count(*) filter (where direction = 'inbound') as inbound_count,
    count(*) filter (where direction = 'outbound') as outbound_count,
    count(*) filter (where coalesce(has_attachments, false)) as attachment_email_count,
    count(*) filter (where coalesce(needs_review, false)) as needs_review_count,
    count(*) filter (where lower(coalesce(status, '')) = 'error') as error_count,
    max(received_at) filter (where direction = 'inbound') as last_inbound_at,
    max(received_at) filter (where direction = 'outbound') as last_outbound_at
  from public.processed_emails
  group by organization_id
),
document_stats as (
  select
    organization_id,
    count(*) as document_count,
    count(*) filter (where coalesce(needs_review, false)) as review_document_count,
    max(received_at) as last_document_at
  from public.documents
  group by organization_id
),
line_stats as (
  select
    organization_id,
    count(*) as line_count,
    count(*) filter (where order_id is not null or project_id is not null) as linked_line_count,
    count(*) filter (where coalesce(needs_review, false)) as review_line_count,
    max(created_at) as last_line_at
  from public.canonical_operational_lines
  group by organization_id
),
runtime_settings as (
  select
    organization_id,
    coalesce(
      max(value) filter (where key = 'runtime.read_outbound_mail'),
      'false'
    ) as read_outbound_mail
  from public.settings
  group by organization_id
),
base as (
  select
    organization.id as organization_id,
    coalesce(mailbox.configured_mailboxes, 0)::integer as configured_mailboxes,
    coalesce(mailbox.connected_mailboxes, 0)::integer as connected_mailboxes,
    coalesce(mailbox.sent_capable_mailboxes, 0)::integer as sent_capable_mailboxes,
    mailbox.last_mailbox_check_at,
    mailbox.last_sent_check_at,
    coalesce(email.inbound_count, 0)::integer as inbound_count,
    coalesce(email.outbound_count, 0)::integer as outbound_count,
    coalesce(email.attachment_email_count, 0)::integer as attachment_email_count,
    coalesce(email.needs_review_count, 0)::integer as needs_review_count,
    coalesce(email.error_count, 0)::integer as error_count,
    email.last_inbound_at,
    email.last_outbound_at,
    coalesce(document.document_count, 0)::integer as document_count,
    coalesce(document.review_document_count, 0)::integer as review_document_count,
    document.last_document_at,
    coalesce(line.line_count, 0)::integer as line_count,
    coalesce(line.linked_line_count, 0)::integer as linked_line_count,
    coalesce(line.review_line_count, 0)::integer as review_line_count,
    line.last_line_at,
    lower(coalesce(runtime.read_outbound_mail, 'false')) = 'true' as outbound_enabled
  from public.organizations organization
  left join mailbox_stats mailbox on mailbox.organization_id = organization.id
  left join email_stats email on email.organization_id = organization.id
  left join document_stats document on document.organization_id = organization.id
  left join line_stats line on line.organization_id = organization.id
  left join runtime_settings runtime on runtime.organization_id = organization.id
)
select
  organization_id,
  'inbound_email'::text as source_key,
  'Comunicazioni'::text as category,
  'Email in entrata'::text as label,
  case
    when connected_mailboxes = 0 then 'unavailable'
    when inbound_count = 0 then 'partial'
    else 'available'
  end::text as status,
  case
    when connected_mailboxes = 0 then 0::numeric
    when inbound_count = 0 then 0.40::numeric
    else 1::numeric
  end as reliability,
  inbound_count as observed_count,
  last_inbound_at as last_observed_at,
  connected_mailboxes as available_sources,
  configured_mailboxes as configured_sources,
  case
    when connected_mailboxes = 0 then 'Nessuna casella in entrata collegata.'
    when inbound_count = 0 then 'Le caselle sono collegate, ma non risultano ancora email elaborate.'
    else format('%s email in entrata osservate da %s caselle collegate.', inbound_count, connected_mailboxes)
  end::text as message,
  case
    when connected_mailboxes = 0 then 'OrderWatch non puo verificare ordini, risposte o documenti ricevuti via email.'
    when inbound_count = 0 then 'La copertura sara valutabile dopo le prime elaborazioni.'
    else null
  end::text as limitation,
  jsonb_build_object(
    'last_mailbox_check_at', last_mailbox_check_at,
    'error_count', error_count
  ) as metadata
from base

union all

select
  organization_id,
  'outbound_email',
  'Comunicazioni',
  'Email in uscita',
  case
    when not outbound_enabled then 'unavailable'
    when connected_mailboxes = 0 or sent_capable_mailboxes = 0 then 'unavailable'
    when outbound_count < 3 then 'partial'
    else 'available'
  end,
  case
    when not outbound_enabled then 0::numeric
    when connected_mailboxes = 0 or sent_capable_mailboxes = 0 then 0::numeric
    when outbound_count = 0 then 0.25::numeric
    when outbound_count < 3 then 0.55::numeric
    else 1::numeric
  end,
  outbound_count,
  last_outbound_at,
  sent_capable_mailboxes,
  configured_mailboxes,
  case
    when not outbound_enabled then 'La lettura delle email in uscita e disattivata.'
    when connected_mailboxes = 0 then 'Nessuna casella collegata per leggere la posta inviata.'
    when sent_capable_mailboxes = 0 then 'Le caselle collegate non espongono una cartella Inviata utilizzabile.'
    when outbound_count = 0 then 'La cartella Inviata viene controllata, ma non sono state osservate email in uscita.'
    when outbound_count < 3 then format('Sono state osservate solo %s email in uscita.', outbound_count)
    else format('%s email in uscita osservate.', outbound_count)
  end,
  case
    when not outbound_enabled or connected_mailboxes = 0 or sent_capable_mailboxes = 0
      then 'OrderWatch non puo affermare se solleciti, ordini o conferme siano stati inviati.'
    when outbound_count < 3
      then 'Lo storico osservato e insufficiente: le conclusioni su solleciti e conferme inviate restano parziali.'
    else null
  end,
  jsonb_build_object(
    'last_sent_check_at', last_sent_check_at,
    'outbound_enabled', outbound_enabled
  )
from base

union all

select
  organization_id,
  'email_attachments',
  'Documenti',
  'Allegati email',
  case
    when connected_mailboxes = 0 then 'unavailable'
    when attachment_email_count = 0 then 'partial'
    else 'available'
  end,
  case
    when connected_mailboxes = 0 then 0::numeric
    when attachment_email_count = 0 then 0.40::numeric
    else 1::numeric
  end,
  attachment_email_count,
  last_document_at,
  connected_mailboxes,
  configured_mailboxes,
  case
    when connected_mailboxes = 0 then 'Gli allegati email non sono osservabili.'
    when attachment_email_count = 0 then 'Nessuna email con allegati e stata ancora elaborata.'
    else format('%s email con allegati e %s documenti estratti.', attachment_email_count, document_count)
  end,
  case
    when attachment_email_count = 0 then 'La presenza o assenza di documenti operativi non e ancora valutabile.'
    when review_document_count > 0 then format('%s documenti richiedono verifica.', review_document_count)
    else null
  end,
  jsonb_build_object(
    'document_count', document_count,
    'review_document_count', review_document_count
  )
from base

union all

select
  organization_id,
  'operational_linking',
  'Tracciabilita',
  'Collegamento a ordini e lavori',
  case
    when line_count = 0 then 'unavailable'
    when linked_line_count::numeric / nullif(line_count, 0) >= 0.85 then 'available'
    else 'partial'
  end,
  case
    when line_count = 0 then 0::numeric
    else round(linked_line_count::numeric / line_count, 2)
  end,
  line_count,
  last_line_at,
  linked_line_count,
  line_count,
  case
    when line_count = 0 then 'Nessuna riga operativa disponibile.'
    else format('%s righe su %s sono collegate a un ordine o a un lavoro.', linked_line_count, line_count)
  end,
  case
    when line_count = 0 then 'La tracciabilita non puo ancora essere valutata.'
    when linked_line_count < line_count then format('%s righe restano da collegare o verificare.', line_count - linked_line_count)
    else null
  end,
  jsonb_build_object(
    'needs_review_count', review_line_count,
    'linked_line_count', linked_line_count,
    'total_line_count', line_count
  )
from base;

comment on view public.data_source_coverage is
  'Altera Brain v1: copertura osservabile delle fonti per tenant, calcolata senza duplicare i dati operativi.';

revoke all on public.data_source_coverage from anon, authenticated;
grant select on public.data_source_coverage to service_role;
