do $$
declare
  line_ids uuid[];
  quote_ids uuid[];
  survivor_line_id uuid;
  duplicate_line_id uuid;
  survivor_quote_id uuid;
  duplicate_quote_id uuid;
begin
  select
    array_agg(ql.id order by pe.received_at, ql.created_at),
    array_agg(ql.quote_id order by pe.received_at, ql.created_at)
  into line_ids, quote_ids
  from quote_lines ql
  join quotes q on q.id = ql.quote_id and q.organization_id = ql.organization_id
  join projects p on p.id = q.project_id and p.organization_id = q.organization_id
  left join processed_emails pe on pe.id = ql.source_email_id
  where p.project_code = 'LAV-46'
    and q.quote_type = 'customer_quote_request'
    and ql.quantity = 50
    and ql.unit_of_measure = 'PZ'
    and lower(ql.description) like '%card%';

  if coalesce(array_length(line_ids, 1), 0) <> 2 then
    raise notice 'LAV-46 card cleanup skipped: expected 2 candidate lines, found %',
      coalesce(array_length(line_ids, 1), 0);
    return;
  end if;

  survivor_line_id := line_ids[1];
  duplicate_line_id := line_ids[2];
  survivor_quote_id := quote_ids[1];
  duplicate_quote_id := quote_ids[2];

  update quote_lines survivor
  set description = latest.description,
      quantity = latest.quantity,
      raw_quantity = latest.raw_quantity,
      unit_of_measure = latest.unit_of_measure,
      unit_price = latest.unit_price,
      total_price = latest.total_price,
      promised_date = latest.promised_date,
      required_date = latest.required_date,
      confidence = latest.confidence,
      needs_review = latest.needs_review,
      source_email_id = latest.source_email_id,
      source_document_id = latest.source_document_id,
      updated_at = now()
  from quote_lines latest
  where survivor.id = survivor_line_id
    and latest.id = duplicate_line_id;

  update canonical_line_sources
  set entity_id = survivor_line_id
  where entity_type = 'quote_line'
    and entity_id = duplicate_line_id;

  delete from quote_lines where id = duplicate_line_id;

  update quotes survivor
  set quote_code = coalesce(latest.quote_code, survivor.quote_code),
      normalized_reference = coalesce(latest.normalized_reference, survivor.normalized_reference),
      source_thread_id = coalesce(latest.source_thread_id, survivor.source_thread_id),
      status = latest.status,
      confidence = latest.confidence,
      needs_review = latest.needs_review,
      source_email_id = latest.source_email_id,
      source_document_id = coalesce(latest.source_document_id, survivor.source_document_id),
      notes = coalesce(latest.notes, survivor.notes),
      updated_at = now()
  from quotes latest
  where survivor.id = survivor_quote_id
    and latest.id = duplicate_quote_id;

  delete from quotes
  where id = duplicate_quote_id
    and not exists (select 1 from quote_lines where quote_id = duplicate_quote_id);
end
$$;
