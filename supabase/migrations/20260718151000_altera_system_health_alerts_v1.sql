-- Altera Brain v1.3: system health alerts and hourly coverage history.
--
-- Technical alerts stay separate from buyer tasks. The snapshot table keeps
-- only one lightweight sample per source and hour, so the product can detect
-- a real deterioration instead of labelling every partial source as a trend.

create table if not exists public.data_source_coverage_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_key text not null,
  status text not null check (status in ('available', 'partial', 'unavailable', 'stale')),
  reliability numeric(5,4) not null check (reliability >= 0 and reliability <= 1),
  observed_count integer not null default 0,
  available_sources integer not null default 0,
  configured_sources integer not null default 0,
  captured_hour timestamptz not null,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint uniq_data_source_coverage_snapshot
    unique (organization_id, source_key, captured_hour)
);

create index if not exists idx_data_source_coverage_snapshots_history
  on public.data_source_coverage_snapshots(organization_id, source_key, captured_hour desc);

alter table public.data_source_coverage_snapshots enable row level security;
revoke all on table public.data_source_coverage_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.data_source_coverage_snapshots to service_role;

create or replace function public.capture_data_source_coverage_snapshot(p_organization_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  affected_rows integer := 0;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  insert into public.data_source_coverage_snapshots (
    organization_id,
    source_key,
    status,
    reliability,
    observed_count,
    available_sources,
    configured_sources,
    captured_hour,
    captured_at,
    metadata
  )
  select
    coverage.organization_id,
    coverage.source_key,
    coverage.status,
    coverage.reliability,
    coverage.observed_count,
    coverage.available_sources,
    coverage.configured_sources,
    date_trunc('hour', now()),
    now(),
    coverage.metadata
  from public.data_source_coverage coverage
  where coverage.organization_id = p_organization_id
  on conflict (organization_id, source_key, captured_hour)
  do update set
    status = excluded.status,
    reliability = excluded.reliability,
    observed_count = excluded.observed_count,
    available_sources = excluded.available_sources,
    configured_sources = excluded.configured_sources,
    captured_at = excluded.captured_at,
    metadata = excluded.metadata;

  get diagnostics affected_rows = row_count;

  delete from public.data_source_coverage_snapshots
  where organization_id = p_organization_id
    and captured_hour < now() - interval '90 days';

  return affected_rows;
end;
$$;

revoke all on function public.capture_data_source_coverage_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.capture_data_source_coverage_snapshot(uuid) to service_role;

-- Seed one baseline sample. Future samples are captured by the email worker.
insert into public.data_source_coverage_snapshots (
  organization_id,
  source_key,
  status,
  reliability,
  observed_count,
  available_sources,
  configured_sources,
  captured_hour,
  captured_at,
  metadata
)
select
  coverage.organization_id,
  coverage.source_key,
  coverage.status,
  coverage.reliability,
  coverage.observed_count,
  coverage.available_sources,
  coverage.configured_sources,
  date_trunc('hour', now()),
  now(),
  coverage.metadata
from public.data_source_coverage coverage
on conflict (organization_id, source_key, captured_hour) do nothing;

create or replace view public.system_health_alerts
with (security_invoker = true)
as
with extraction_stats as (
  select
    organization_id,
    count(*) filter (
      where lower(coalesce(status, '')) = 'error'
        and received_at >= now() - interval '72 hours'
    )::integer as error_count,
    max(received_at) filter (
      where lower(coalesce(status, '')) = 'error'
        and received_at >= now() - interval '72 hours'
    ) as last_error_at,
    count(*) filter (
      where lower(trim(coalesce(status, ''))) = 'processing'
        and received_at < now() - interval '30 minutes'
    )::integer as stuck_count,
    min(received_at) filter (
      where lower(trim(coalesce(status, ''))) = 'processing'
        and received_at < now() - interval '30 minutes'
    ) as oldest_stuck_at
  from public.processed_emails
  group by organization_id
),
candidate_stats as (
  select
    organization_id,
    count(*) filter (
      where status = 'needs_review'
        and created_at < now() - interval '24 hours'
    )::integer as aged_review_count,
    min(created_at) filter (
      where status = 'needs_review'
        and created_at < now() - interval '24 hours'
    ) as oldest_review_at
  from public.extraction_candidates
  group by organization_id
),
linkage as (
  select
    coverage.organization_id,
    coverage.status,
    coverage.reliability,
    coverage.observed_count,
    coverage.available_sources,
    coverage.configured_sources,
    coverage.last_observed_at,
    coverage.message,
    coverage.limitation,
    previous.reliability as previous_reliability,
    previous.captured_hour as previous_captured_at
  from public.data_source_coverage coverage
  left join lateral (
    select snapshot.reliability, snapshot.captured_hour
    from public.data_source_coverage_snapshots snapshot
    where snapshot.organization_id = coverage.organization_id
      and snapshot.source_key = coverage.source_key
      and snapshot.captured_hour < date_trunc('hour', now())
    order by snapshot.captured_hour desc
    limit 1
  ) previous on true
  where coverage.source_key = 'operational_linking'
)
select
  mailbox.organization_id,
  ('mailbox-error:' || mailbox.id)::text as alert_key,
  'mailbox'::text as category,
  'critical'::text as severity,
  ('Errore casella: ' || coalesce(nullif(trim(mailbox.mailbox_name), ''), mailbox.email_address))::text as title,
  'L\'ultimo controllo della casella non si e concluso correttamente. Le altre caselle continuano a essere controllate.'::text as message,
  'Controlla connessione'::text as action_label,
  'settings'::text as target_view,
  mailbox.id::text as entity_id,
  coalesce(mailbox.last_check_at, mailbox.connected_at, mailbox.created_at) as detected_at,
  jsonb_build_object(
    'mailbox_name', mailbox.mailbox_name,
    'last_error', mailbox.last_error,
    'last_check_at', mailbox.last_check_at
  ) as metadata
from public.mailboxes mailbox
where mailbox.active
  and nullif(trim(coalesce(mailbox.last_error, '')), '') is not null

union all

select
  mailbox.organization_id,
  ('mailbox-stale:' || mailbox.id),
  'mailbox',
  'critical',
  ('Casella non aggiornata: ' || coalesce(nullif(trim(mailbox.mailbox_name), ''), mailbox.email_address)),
  'Nessun controllo riuscito da oltre 30 minuti. I nuovi messaggi potrebbero non essere ancora presenti in OrderWatch.',
  'Controlla connessione',
  'settings',
  mailbox.id::text,
  coalesce(mailbox.last_check_at, mailbox.connected_at, mailbox.created_at),
  jsonb_build_object(
    'mailbox_name', mailbox.mailbox_name,
    'last_check_at', mailbox.last_check_at,
    'stale_after_minutes', 30
  )
from public.mailboxes mailbox
where mailbox.active
  and mailbox.connection_status = 'connected'
  and nullif(trim(coalesce(mailbox.last_error, '')), '') is null
  and coalesce(mailbox.last_check_at, mailbox.connected_at, mailbox.created_at) < now() - interval '30 minutes'

union all

select
  mailbox.organization_id,
  ('mailbox-disconnected:' || mailbox.id),
  'mailbox',
  'warning',
  ('Casella da collegare: ' || coalesce(nullif(trim(mailbox.mailbox_name), ''), mailbox.email_address)),
  'La casella e attiva nelle impostazioni ma non risulta collegata al worker email.',
  'Apri caselle email',
  'settings',
  mailbox.id::text,
  coalesce(mailbox.connected_at, mailbox.created_at),
  jsonb_build_object('connection_status', mailbox.connection_status)
from public.mailboxes mailbox
where mailbox.active
  and mailbox.connection_status <> 'connected'
  and nullif(trim(coalesce(mailbox.last_error, '')), '') is null

union all

select
  stats.organization_id,
  'extraction-errors-72h',
  'extraction',
  case when stats.error_count >= 3 then 'critical' else 'warning' end,
  'Elaborazioni email non concluse',
  format('Email non elaborate correttamente nelle ultime 72 ore: %s.', stats.error_count),
  'Apri importazioni',
  'imports',
  null::text,
  stats.last_error_at,
  jsonb_build_object('error_count', stats.error_count, 'window_hours', 72)
from extraction_stats stats
where stats.error_count > 0

union all

select
  stats.organization_id,
  'processing-stuck',
  'extraction',
  'critical',
  'Elaborazioni bloccate',
  format('%s email risultano in lavorazione da oltre 30 minuti.', stats.stuck_count),
  'Apri importazioni',
  'imports',
  null::text,
  stats.oldest_stuck_at,
  jsonb_build_object('stuck_count', stats.stuck_count, 'stale_after_minutes', 30)
from extraction_stats stats
where stats.stuck_count > 0

union all

select
  stats.organization_id,
  'aged-extraction-review',
  'data_quality',
  'warning',
  'Estrazioni in attesa di verifica',
  format('%s estrazioni sono in quarantena da oltre 24 ore e non alimentano ancora i dati canonici.', stats.aged_review_count),
  'Apri importazioni',
  'imports',
  null::text,
  stats.oldest_review_at,
  jsonb_build_object('aged_review_count', stats.aged_review_count, 'age_hours', 24)
from candidate_stats stats
where stats.aged_review_count > 0

union all

select
  linkage.organization_id,
  'operational-linking-coverage',
  'data_quality',
  case
    when linkage.reliability < 0.60
      or coalesce(linkage.previous_reliability - linkage.reliability, 0) >= 0.15 then 'critical'
    else 'warning'
  end,
  case
    when coalesce(linkage.previous_reliability - linkage.reliability, 0) >= 0.05
      then 'Tracciabilita in peggioramento'
    else 'Tracciabilita da completare'
  end,
  case
    when coalesce(linkage.previous_reliability - linkage.reliability, 0) >= 0.05
      then format(
        'La copertura e scesa dal %s%% al %s%%. %s righe restano da collegare o verificare.',
        round(linkage.previous_reliability * 100),
        round(linkage.reliability * 100),
        greatest(linkage.configured_sources - linkage.available_sources, 0)
      )
    else format(
      '%s righe su %s sono collegate a un ordine o a un lavoro; %s restano da collegare o verificare.',
      linkage.available_sources,
      linkage.configured_sources,
      greatest(linkage.configured_sources - linkage.available_sources, 0)
    )
  end,
  'Apri copertura dati',
  'settings',
  null::text,
  coalesce(linkage.last_observed_at, now()),
  jsonb_build_object(
    'reliability', linkage.reliability,
    'previous_reliability', linkage.previous_reliability,
    'previous_captured_at', linkage.previous_captured_at,
    'linked_count', linkage.available_sources,
    'total_count', linkage.configured_sources
  )
from linkage
where linkage.reliability < 0.85
   or coalesce(linkage.previous_reliability - linkage.reliability, 0) >= 0.05;

comment on view public.system_health_alerts is
  'Altera Brain v1.3: avvisi tecnici tenant-scoped, separati dalle attivita operative del buyer.';

revoke all on public.system_health_alerts from anon, authenticated;
grant select on public.system_health_alerts to service_role;
