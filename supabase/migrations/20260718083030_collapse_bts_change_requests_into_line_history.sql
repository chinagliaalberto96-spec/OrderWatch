-- BTS Adv / LAV-38: le email di change request storiche erano state
-- materializzate come nuove righe. Manteniamo le due maglie reali e
-- trasferiamo tutte le fonti successive nella cronologia delle rispettive
-- righe, senza perdere provenienza.
do $$
declare
  v_project_id uuid;
  v_org_id uuid;
  v_italy_line_id uuid;
  v_france_line_id uuid;
  v_latest_france_email_id uuid;
begin
  select p.id, p.organization_id
    into v_project_id, v_org_id
  from public.projects p
  where p.project_code = 'LAV-38'
    and lower(coalesce(p.customer, '')) = 'bts adv'
  order by p.created_at
  limit 1;

  if v_project_id is null then
    return;
  end if;

  select pr.id into v_italy_line_id
  from public.project_requirements pr
  where pr.organization_id = v_org_id
    and pr.project_id = v_project_id
    and lower(pr.description) like '%maglia%italian%'
    and pr.requested_quantity is not null
  order by pr.created_at desc
  limit 1;

  select pr.id into v_france_line_id
  from public.project_requirements pr
  where pr.organization_id = v_org_id
    and pr.project_id = v_project_id
    and lower(pr.description) like '%maglia%frances%'
    and pr.requested_quantity is not null
  order by pr.created_at desc
  limit 1;

  if v_italy_line_id is null or v_france_line_id is null then
    raise exception 'BTS cleanup aborted: the two canonical shirt lines were not found';
  end if;

  -- Ogni osservazione che menziona la Francia diventa storia della maglia
  -- francese. La richiesta combinata Italia/Francia viene collegata a entrambe.
  insert into public.canonical_line_sources (
    organization_id, entity_type, entity_id, source_email_id,
    source_document_id, source_line_number, observed_values, created_at
  )
  select
    cls.organization_id, 'project_requirement', v_france_line_id,
    cls.source_email_id, cls.source_document_id, cls.source_line_number,
    cls.observed_values || jsonb_build_object('historical_change_request', true),
    cls.created_at
  from public.canonical_line_sources cls
  join public.project_requirements duplicate on duplicate.id = cls.entity_id
  where duplicate.organization_id = v_org_id
    and duplicate.project_id = v_project_id
    and duplicate.id not in (v_italy_line_id, v_france_line_id)
    and lower(duplicate.description) ~ '(franc|magli)'
  on conflict (organization_id, entity_type, entity_id, source_email_id, source_line_number)
  do nothing;

  insert into public.canonical_line_sources (
    organization_id, entity_type, entity_id, source_email_id,
    source_document_id, source_line_number, observed_values, created_at
  )
  select
    cls.organization_id, 'project_requirement', v_italy_line_id,
    cls.source_email_id, cls.source_document_id, cls.source_line_number,
    cls.observed_values || jsonb_build_object('historical_change_request', true),
    cls.created_at
  from public.canonical_line_sources cls
  join public.project_requirements duplicate on duplicate.id = cls.entity_id
  where duplicate.organization_id = v_org_id
    and duplicate.project_id = v_project_id
    and duplicate.id not in (v_italy_line_id, v_france_line_id)
    and lower(duplicate.description) like '%italian%'
  on conflict (organization_id, entity_type, entity_id, source_email_id, source_line_number)
  do nothing;

  delete from public.canonical_line_sources cls
  using public.project_requirements duplicate
  where cls.entity_id = duplicate.id
    and duplicate.organization_id = v_org_id
    and duplicate.project_id = v_project_id
    and duplicate.id not in (v_italy_line_id, v_france_line_id)
    and lower(duplicate.description) ~ '(magli|personalizz|nomi)';

  delete from public.project_requirements pr
  where pr.organization_id = v_org_id
    and pr.project_id = v_project_id
    and pr.id not in (v_italy_line_id, v_france_line_id)
    and lower(pr.description) ~ '(magli|personalizz|nomi)';

  select cls.source_email_id into v_latest_france_email_id
  from public.canonical_line_sources cls
  join public.processed_emails pe on pe.id = cls.source_email_id
  where cls.organization_id = v_org_id
    and cls.entity_type = 'project_requirement'
    and cls.entity_id = v_france_line_id
  order by pe.received_at desc nulls last
  limit 1;

  update public.project_requirements
  set source_email_id = coalesce(v_latest_france_email_id, source_email_id),
      status = 'needs_review',
      needs_review = true,
      notes = 'Modifiche cliente successive rilevate: verificare la personalizzazione piu recente.',
      updated_at = now()
  where id = v_france_line_id
    and organization_id = v_org_id;
end $$;
