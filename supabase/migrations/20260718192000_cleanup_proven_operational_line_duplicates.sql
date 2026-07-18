-- Merge only line revisions proven by stable source Message-IDs and preserve
-- every source/evidence row. Similar-but-ambiguous materials are quarantined.
create table if not exists public.data_quality_merge_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  entity_type text not null,
  survivor_id uuid not null,
  duplicate_id uuid not null,
  reason text not null,
  survivor_snapshot jsonb not null,
  duplicate_snapshot jsonb not null,
  merged_at timestamptz not null default now(),
  unique (organization_id, entity_type, duplicate_id)
);

alter table public.data_quality_merge_log enable row level security;
revoke all on table public.data_quality_merge_log from public, anon, authenticated;
grant select, insert on table public.data_quality_merge_log to service_role;

create temporary table proven_quote_line_merges (
  organization_id uuid not null,
  survivor_line_id uuid not null,
  duplicate_line_id uuid not null,
  survivor_quote_id uuid not null,
  duplicate_quote_id uuid not null,
  reason text not null
) on commit drop;

-- Fedrigoni: same supplier, same subject and exact line identity. The second
-- observation adds quantity/unit and is therefore the surviving state.
insert into proven_quote_line_merges
select newer.organization_id,
       newer.id,
       older.id,
       newer.quote_id,
       older.quote_id,
       'Aggiornamento preventivo Fedrigoni: stessa identita materiale; mantenuta osservazione piu completa.'
from public.processed_emails old_email
join public.quote_lines older
  on older.organization_id = old_email.organization_id
 and older.source_email_id = old_email.id
join public.processed_emails new_email
  on new_email.organization_id = old_email.organization_id
 and new_email.message_id = '<AM9PR04MB8437B28A57CE63B77529EAB885F92@AM9PR04MB8437.eurprd04.prod.outlook.com>'
join public.quote_lines newer
  on newer.organization_id = new_email.organization_id
 and newer.source_email_id = new_email.id
 and newer.identity_key = older.identity_key
where old_email.message_id = '<AM9PR04MB8437B40A1BD18733B78ADDCE85FA2@AM9PR04MB8437.eurprd04.prod.outlook.com>'
  and older.quote_id <> newer.quote_id;

-- ISCOT: the reply repeats the only line of the same project with the same
-- quantity/unit and a more explicit description.
insert into proven_quote_line_merges
select newer.organization_id,
       newer.id,
       older.id,
       newer.quote_id,
       older.quote_id,
       'Revisione richiesta ISCOT: stessa conversazione, progetto, quantita e unita; mantenuta descrizione piu recente.'
from public.processed_emails old_email
join public.quote_lines older
  on older.organization_id = old_email.organization_id
 and older.source_email_id = old_email.id
join public.quotes old_quote
  on old_quote.organization_id = older.organization_id
 and old_quote.id = older.quote_id
join public.processed_emails new_email
  on new_email.organization_id = old_email.organization_id
 and new_email.message_id = '<GVUPR03MB11260FF00DB15DF272C823C68FFF92@GVUPR03MB11260.eurprd03.prod.outlook.com>'
join public.quote_lines newer
  on newer.organization_id = new_email.organization_id
 and newer.source_email_id = new_email.id
join public.quotes new_quote
  on new_quote.organization_id = newer.organization_id
 and new_quote.id = newer.quote_id
 and new_quote.project_id = old_quote.project_id
where old_email.message_id = '<GVUPR03MB1126043B86D8E1AB730414FBBFFF92@GVUPR03MB11260.eurprd03.prod.outlook.com>'
  and older.quote_id <> newer.quote_id
  and older.quantity = newer.quantity
  and coalesce(older.unit_of_measure, '') = coalesce(newer.unit_of_measure, '');

insert into public.data_quality_merge_log (
  organization_id,
  entity_type,
  survivor_id,
  duplicate_id,
  reason,
  survivor_snapshot,
  duplicate_snapshot
)
select mapping.organization_id,
       'quote_line',
       mapping.survivor_line_id,
       mapping.duplicate_line_id,
       mapping.reason,
       to_jsonb(survivor),
       to_jsonb(duplicate)
from proven_quote_line_merges mapping
join public.quote_lines survivor on survivor.id = mapping.survivor_line_id
join public.quote_lines duplicate on duplicate.id = mapping.duplicate_line_id
on conflict (organization_id, entity_type, duplicate_id) do nothing;

insert into public.canonical_line_sources (
  organization_id,
  entity_type,
  entity_id,
  source_email_id,
  source_document_id,
  source_line_number,
  observed_values,
  created_at
)
select source.organization_id,
       source.entity_type,
       mapping.survivor_line_id,
       source.source_email_id,
       source.source_document_id,
       source.source_line_number,
       source.observed_values,
       source.created_at
from proven_quote_line_merges mapping
join public.canonical_line_sources source
  on source.organization_id = mapping.organization_id
 and source.entity_type = 'quote_line'
 and source.entity_id = mapping.duplicate_line_id
on conflict (organization_id, entity_type, entity_id, source_email_id, source_line_number)
do update set
  source_document_id = coalesce(excluded.source_document_id, canonical_line_sources.source_document_id),
  observed_values = canonical_line_sources.observed_values || excluded.observed_values;

delete from public.canonical_line_sources source
using proven_quote_line_merges mapping
where source.organization_id = mapping.organization_id
  and source.entity_type = 'quote_line'
  and source.entity_id = mapping.duplicate_line_id;

-- Promote the best observed due date without overwriting richer canonical
-- values already present on the survivor.
update public.quote_lines survivor
set required_date = coalesce(
      survivor.required_date,
      evidence.best_required_date
    ),
    needs_review = case
      when survivor.description is not null and survivor.quantity is not null then false
      else survivor.needs_review
    end,
    updated_at = now()
from proven_quote_line_merges mapping
left join lateral (
  select max(nullif(e.observed_values ->> 'required_date', '')::date) as best_required_date
  from public.canonical_line_sources e
  where e.organization_id = mapping.organization_id
    and e.entity_type = 'quote_line'
    and e.entity_id = mapping.survivor_line_id
) evidence on true
where survivor.organization_id = mapping.organization_id
  and survivor.id = mapping.survivor_line_id;

delete from public.quote_lines duplicate
using proven_quote_line_merges mapping
where duplicate.organization_id = mapping.organization_id
  and duplicate.id = mapping.duplicate_line_id;

delete from public.quotes duplicate_quote
using proven_quote_line_merges mapping
where duplicate_quote.organization_id = mapping.organization_id
  and duplicate_quote.id = mapping.duplicate_quote_id
  and not exists (
    select 1 from public.quote_lines line where line.quote_id = duplicate_quote.id
  );

-- The same photowall identity appears under two different projects/customers.
-- This is not safe to merge automatically: make the ambiguity explicit.
with collisions as (
  select pr.organization_id, pr.identity_key
  from public.project_requirements pr
  where pr.identity_key is not null
  group by pr.organization_id, pr.identity_key
  having count(distinct pr.project_id) > 1
), candidates as (
  select pr.*, p.project_code, p.customer
  from collisions collision
  join public.project_requirements pr
    on pr.organization_id = collision.organization_id
   and pr.identity_key = collision.identity_key
  join public.projects p
    on p.organization_id = pr.organization_id
   and p.id = pr.project_id
)
update public.project_requirements requirement
set needs_review = true,
    status = case
      when requirement.status in ('approved','ordered','fulfilled','cancelled') then requirement.status
      else 'needs_review'
    end,
    updated_at = now()
from candidates candidate
where requirement.id = candidate.id;

insert into public.extraction_candidates (
  organization_id,
  candidate_type,
  status,
  reason,
  extracted_payload,
  source_email_id,
  source_document_id
)
select pr.organization_id,
       'line_ambiguity',
       'needs_review',
       'La stessa identita materiale compare in lavori/clienti diversi. Serve confermare se i lavori vadano uniti o mantenuti separati.',
       jsonb_build_object(
         'entity_type', 'project_requirement',
         'requirement_id', pr.id,
         'project_id', pr.project_id,
         'project_code', p.project_code,
         'customer', p.customer,
         'identity_key', pr.identity_key,
         'description', pr.description
       ),
       pr.source_email_id,
       pr.source_document_id
from public.project_requirements pr
join public.projects p
  on p.organization_id = pr.organization_id
 and p.id = pr.project_id
where pr.identity_key is not null
  and exists (
    select 1
    from public.project_requirements other
    where other.organization_id = pr.organization_id
      and other.identity_key = pr.identity_key
      and other.project_id <> pr.project_id
  )
  and pr.source_email_id is not null
on conflict (organization_id, source_email_id, candidate_type)
do update set
  status = 'needs_review',
  reason = excluded.reason,
  extracted_payload = excluded.extracted_payload,
  source_document_id = coalesce(excluded.source_document_id, extraction_candidates.source_document_id),
  updated_at = now();
