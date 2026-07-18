-- Keep provenance lookups fast. These indexes support audits and replay by
-- original email/document without exposing the canonical tables to clients.
create index if not exists idx_project_requirements_source_email
  on public.project_requirements (source_email_id)
  where source_email_id is not null;

create index if not exists idx_project_requirements_source_document
  on public.project_requirements (source_document_id)
  where source_document_id is not null;

create index if not exists idx_quote_lines_source_email
  on public.quote_lines (source_email_id)
  where source_email_id is not null;

create index if not exists idx_quote_lines_source_document
  on public.quote_lines (source_document_id)
  where source_document_id is not null;

create index if not exists idx_canonical_line_sources_source_email
  on public.canonical_line_sources (source_email_id);

create index if not exists idx_canonical_line_sources_source_document
  on public.canonical_line_sources (source_document_id)
  where source_document_id is not null;

create index if not exists idx_extraction_candidates_source_email
  on public.extraction_candidates (source_email_id);

create index if not exists idx_extraction_candidates_source_document
  on public.extraction_candidates (source_document_id)
  where source_document_id is not null;
