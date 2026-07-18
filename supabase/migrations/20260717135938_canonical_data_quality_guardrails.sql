-- Canonical data model for OrderWatch line-level entities.
-- Existing material_lines are intentionally left untouched: they are legacy
-- extraction data and will be rebuilt after the new pipeline is validated.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS normalized_reference text,
  ADD COLUMN IF NOT EXISTS source_thread_id text,
  ADD COLUMN IF NOT EXISTS source_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_confidence_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_confidence_check
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_customer_reference
  ON public.projects(organization_id, customer_contact_id, normalized_reference)
  WHERE customer_contact_id IS NOT NULL AND normalized_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_source_thread
  ON public.projects(organization_id, source_thread_id)
  WHERE source_thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_source_thread
  ON public.projects(organization_id, source_thread_id)
  WHERE source_thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_org_id
  ON public.projects(organization_id, id);

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS canonical_key text,
  ADD COLUMN IF NOT EXISTS normalized_reference text,
  ADD COLUMN IF NOT EXISTS source_thread_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_quotes_canonical_key
  ON public.quotes(organization_id, canonical_key)
  WHERE canonical_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_quotes_org_id
  ON public.quotes(organization_id, id);

ALTER TABLE public.purchase_order_lines
  ALTER COLUMN ordered_quantity DROP NOT NULL,
  ALTER COLUMN unit_of_measure DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical_key text,
  ADD COLUMN IF NOT EXISTS raw_quantity text,
  ADD COLUMN IF NOT EXISTS source_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_ordered_quantity_check;
ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_ordered_quantity_check
  CHECK (ordered_quantity IS NULL OR ordered_quantity > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchase_order_lines_canonical
  ON public.purchase_order_lines(organization_id, order_id, canonical_key)
  WHERE canonical_key IS NOT NULL;

ALTER TABLE public.delivery_note_lines
  ALTER COLUMN delivered_quantity DROP NOT NULL,
  ALTER COLUMN unit_of_measure DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS canonical_key text,
  ADD COLUMN IF NOT EXISTS raw_quantity text,
  ADD COLUMN IF NOT EXISTS source_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

ALTER TABLE public.delivery_note_lines DROP CONSTRAINT IF EXISTS delivery_note_lines_delivered_quantity_check;
ALTER TABLE public.delivery_note_lines ADD CONSTRAINT delivery_note_lines_delivered_quantity_check
  CHECK (delivered_quantity IS NULL OR delivered_quantity > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_delivery_note_lines_canonical
  ON public.delivery_note_lines(organization_id, delivery_note_id, canonical_key)
  WHERE canonical_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.project_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  canonical_key text NOT NULL,
  item_code text,
  description text NOT NULL,
  requested_quantity numeric(18,4) CHECK (requested_quantity IS NULL OR requested_quantity > 0),
  raw_quantity text,
  unit_of_measure text,
  required_date date,
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested','quoted','approved','ordered','fulfilled','cancelled','needs_review')
  ),
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  needs_review boolean NOT NULL DEFAULT false,
  source_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_requirements_project_tenant
    FOREIGN KEY (organization_id, project_id)
    REFERENCES public.projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT uniq_project_requirement_line_number UNIQUE (organization_id, project_id, line_number),
  CONSTRAINT uniq_project_requirement_canonical UNIQUE (organization_id, project_id, canonical_key)
);

CREATE TABLE IF NOT EXISTS public.quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  canonical_key text NOT NULL,
  item_code text,
  description text NOT NULL,
  quantity numeric(18,4) CHECK (quantity IS NULL OR quantity > 0),
  raw_quantity text,
  unit_of_measure text,
  unit_price numeric(18,4) CHECK (unit_price IS NULL OR unit_price >= 0),
  total_price numeric(18,2) CHECK (total_price IS NULL OR total_price >= 0),
  promised_date date,
  required_date date,
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  needs_review boolean NOT NULL DEFAULT false,
  source_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_quote_lines_quote_tenant
    FOREIGN KEY (organization_id, quote_id)
    REFERENCES public.quotes(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT uniq_quote_line_number UNIQUE (organization_id, quote_id, line_number),
  CONSTRAINT uniq_quote_line_canonical UNIQUE (organization_id, quote_id, canonical_key)
);

-- Every observation is retained here. Canonical rows can be updated without
-- losing which email/document supplied each version.
CREATE TABLE IF NOT EXISTS public.canonical_line_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (
    entity_type IN ('project_requirement','purchase_order_line','quote_line','delivery_note_line')
  ),
  entity_id uuid NOT NULL,
  source_email_id uuid NOT NULL REFERENCES public.processed_emails(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_line_number integer NOT NULL CHECK (source_line_number > 0),
  observed_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_canonical_line_source UNIQUE (
    organization_id, entity_type, entity_id, source_email_id, source_line_number
  )
);

-- Ambiguous extractions are retained without polluting canonical business
-- entities. A buyer can resolve them later through an explicit action.
CREATE TABLE IF NOT EXISTS public.extraction_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  candidate_type text NOT NULL CHECK (
    candidate_type IN ('supplier_order','customer_order','customer_change','unknown')
  ),
  status text NOT NULL DEFAULT 'needs_review' CHECK (
    status IN ('needs_review','resolved','rejected')
  ),
  reason text NOT NULL,
  extracted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_email_id uuid NOT NULL REFERENCES public.processed_emails(id) ON DELETE CASCADE,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  resolved_entity_type text,
  resolved_entity_id uuid,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_extraction_candidate_source UNIQUE (
    organization_id, source_email_id, candidate_type
  )
);

CREATE INDEX IF NOT EXISTS idx_project_requirements_project
  ON public.project_requirements(organization_id, project_id, line_number);
CREATE INDEX IF NOT EXISTS idx_quote_lines_quote
  ON public.quote_lines(organization_id, quote_id, line_number);
CREATE INDEX IF NOT EXISTS idx_canonical_line_sources_entity
  ON public.canonical_line_sources(organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_candidates_review
  ON public.extraction_candidates(organization_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.project_requirements;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.project_requirements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.quote_lines;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.extraction_candidates;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.extraction_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.project_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_line_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_candidates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.project_requirements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.quote_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.canonical_line_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.extraction_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.project_requirements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.canonical_line_sources TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.extraction_candidates TO service_role;
