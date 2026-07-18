-- Replies in the same proven email conversation used to create a new quote
-- container. Merge only the known chains, using stable RFC Message-ID values,
-- and preserve every source email on the surviving canonical lines.
create temporary table quote_conversation_merge (
  root_message_id text not null,
  duplicate_message_id text not null
) on commit drop;

insert into quote_conversation_merge (root_message_id, duplicate_message_id) values
  ('<CAEv5bCgzZSnTo4C=HnwGYM8w-EwfYvdOmNy5T4nafVigzywnxQ@mail.gmail.com>', '<CAEv5bCgw46CJXN1eitxm53oXkz=eyPp-4dwhntXi4MK55PxcTw@mail.gmail.com>'),
  ('<CAEv5bCgzZSnTo4C=HnwGYM8w-EwfYvdOmNy5T4nafVigzywnxQ@mail.gmail.com>', '<CAEv5bCinFOOSkw+3pGVF+VcL06m6Pphx2OXG6On8hdft3_b4hw@mail.gmail.com>'),
  ('<CAAfz+42e4NdhfHn7tCVVAO1F5sYYBDD9KOUOxuRLEGVG3RsREA@mail.gmail.com>', '<CAAfz+40jY9ZX=F1K5JzC6dehhPYTygi+YdOD0j928JK68iXRrA@mail.gmail.com>'),
  ('<AM9PR04MB8437B28A57CE63B77529EAB885F92@AM9PR04MB8437.eurprd04.prod.outlook.com>', '<PAXPR04MB90053BEC4B8DEE4684C4821AECF92@PAXPR04MB9005.eurprd04.prod.outlook.com>');

create temporary table resolved_quote_merge on commit drop as
select root_quote.organization_id,
       root_quote.id as root_quote_id,
       duplicate_quote.id as duplicate_quote_id
from quote_conversation_merge requested
join public.processed_emails root_email
  on root_email.message_id = requested.root_message_id
join public.processed_emails duplicate_email
  on duplicate_email.message_id = requested.duplicate_message_id
 and duplicate_email.organization_id = root_email.organization_id
join public.quotes root_quote
  on root_quote.source_email_id = root_email.id
 and root_quote.organization_id = root_email.organization_id
join public.quotes duplicate_quote
  on duplicate_quote.source_email_id = duplicate_email.id
 and duplicate_quote.organization_id = duplicate_email.organization_id
where root_quote.quote_type = duplicate_quote.quote_type
  and root_quote.id <> duplicate_quote.id;

insert into public.canonical_line_sources (
  organization_id,
  entity_type,
  entity_id,
  source_email_id,
  source_document_id,
  source_line_number,
  observed_values
)
select source.organization_id,
       'quote_line',
       root_line.id,
       source.source_email_id,
       source.source_document_id,
       source.source_line_number,
       source.observed_values
from resolved_quote_merge mapping
join public.quote_lines duplicate_line
  on duplicate_line.quote_id = mapping.duplicate_quote_id
 and duplicate_line.organization_id = mapping.organization_id
join public.quote_lines root_line
  on root_line.quote_id = mapping.root_quote_id
 and root_line.organization_id = mapping.organization_id
 and root_line.canonical_key = duplicate_line.canonical_key
join public.canonical_line_sources source
  on source.organization_id = mapping.organization_id
 and source.entity_type = 'quote_line'
 and source.entity_id = duplicate_line.id
on conflict (organization_id, entity_type, entity_id, source_email_id, source_line_number)
do nothing;

delete from public.canonical_line_sources source
using public.quote_lines duplicate_line, resolved_quote_merge mapping
where source.organization_id = mapping.organization_id
  and source.entity_type = 'quote_line'
  and source.entity_id = duplicate_line.id
  and duplicate_line.quote_id = mapping.duplicate_quote_id
  and duplicate_line.organization_id = mapping.organization_id;

delete from public.quote_lines duplicate_line
using resolved_quote_merge mapping
where duplicate_line.organization_id = mapping.organization_id
  and duplicate_line.quote_id = mapping.duplicate_quote_id;

delete from public.quotes duplicate_quote
using resolved_quote_merge mapping
where duplicate_quote.organization_id = mapping.organization_id
  and duplicate_quote.id = mapping.duplicate_quote_id;
