do $$
declare
  v_organization_id uuid;
  v_source_email_id uuid;
begin
  select id into v_organization_id
  from public.organizations
  where slug = 'graphic-center'
  limit 1;

  select id into v_source_email_id
  from public.processed_emails
  where organization_id = v_organization_id
    and message_id = '<902689566.37754041784278462437.JavaMail.nds@p1090213.prod.cloud.fedex.com>'
  limit 1;

  if v_source_email_id is null then
    return;
  end if;

  delete from public.contact_emails
  where organization_id = v_organization_id
    and source_email_id = v_source_email_id
    and normalized_email = 'trackingupdates@fedex.com'
    and verified = false
    and match_enabled = false;

  update public.contact_candidates
  set status = 'rejected',
      resolved_by = 'system:data_quality_cleanup',
      resolved_at = now(),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'reason', 'Indirizzo automatico del vettore: non appartiene all identita anagrafica Makito.'
      )
  where organization_id = v_organization_id
    and source_email_id = v_source_email_id
    and status = 'pending';

  update public.processed_emails
  set linked_order_code = null,
      needs_review = true,
      updated_at = now()
  where organization_id = v_organization_id
    and id = v_source_email_id;

  insert into public.extraction_candidates (
    organization_id,
    candidate_type,
    status,
    reason,
    extracted_payload,
    source_email_id
  )
  select
    v_organization_id,
    'unknown',
    'needs_review',
    'Notifica FedEx associata a Makito, ma il riferimento 0083669570 non corrisponde a un ordine presente.',
    jsonb_build_object(
      'document_type', 'DELIVERY_UPDATE',
      'carrier', 'FedEx',
      'tracking_number', '874423295755',
      'order_reference', '0083669570',
      'supplier_name', 'Makito Italia Srl'
    ),
    v_source_email_id
  where not exists (
    select 1
    from public.extraction_candidates
    where organization_id = v_organization_id
      and source_email_id = v_source_email_id
      and candidate_type = 'unknown'
  );

  insert into public.buyer_actions (
    organization_id,
    action_type,
    status,
    title,
    detail,
    supplier_name,
    source_email_id,
    direction
  )
  select
    v_organization_id,
    'other',
    'needs_review',
    'Collega spedizione FedEx a un ordine',
    'Tracking 874423295755: Makito e la controparte commerciale, FedEx e il vettore. Il riferimento 0083669570 non coincide con un ordine presente.',
    'Makito Italia Srl',
    v_source_email_id,
    'inbound'
  where not exists (
    select 1
    from public.buyer_actions
    where organization_id = v_organization_id
      and source_email_id = v_source_email_id
      and status = 'needs_review'
  );
end $$;
