-- OrderWatch contact registry: canonical counterparties, verified email aliases,
-- review candidates and fuzzy matching. All data is tenant-scoped.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.normalize_contact_name(value text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      upper(extensions.unaccent(coalesce(value, ''))),
      '[^A-Z0-9]+', ' ', 'g'
    ),
    '\s+(S\s*R\s*L|S\s*P\s*A|S\s*A\s*S|S\s*N\s*C|S\s*C\s*R\s*L|S\s*S|SRLS|LTD|LIMITED|GMBH|INC|LLC)\s*$',
    '', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.normalize_contact_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(value, '')));
$$;

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  legal_name text NOT NULL,
  normalized_name text NOT NULL,
  type text NOT NULL DEFAULT 'unknown' CHECK (type IN ('supplier','customer','both','unknown')),
  vat_number text,
  domain text,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','inactive')),
  merged_into_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system','ai','manual','import','backfill')),
  legacy_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'merged' OR merged_into_contact_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  email text NOT NULL,
  normalized_email text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  match_enabled boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system','ai','manual','import','backfill')),
  source_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (normalized_email <> '')
);

CREATE TABLE IF NOT EXISTS public.contact_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system','ai','manual','import','backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (normalized_alias <> '')
);

CREATE TABLE IF NOT EXISTS public.contact_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  source_contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  proposed_name text NOT NULL,
  normalized_name text NOT NULL,
  proposed_email text,
  normalized_email text,
  proposed_type text NOT NULL DEFAULT 'unknown' CHECK (proposed_type IN ('supplier','customer','both','unknown')),
  matched_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  match_method text NOT NULL DEFAULT 'new' CHECK (match_method IN ('new','exact_email','exact_name','alias','fuzzy','duplicate')),
  similarity numeric(5,4),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','merged')),
  resolved_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  resolved_by text,
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_id_key ON public.contacts(organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contacts_legacy_supplier
  ON public.contacts(organization_id, legacy_supplier_id) WHERE legacy_supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_org_status_type ON public.contacts(organization_id, status, type);
CREATE INDEX IF NOT EXISTS idx_contacts_org_normalized_name ON public.contacts(organization_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm ON public.contacts USING gin (normalized_name extensions.gin_trgm_ops);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contacts_org_vat
  ON public.contacts(organization_id, upper(vat_number)) WHERE vat_number IS NOT NULL AND trim(vat_number) <> '' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_contact_emails_org_email
  ON public.contact_emails(organization_id, normalized_email);
CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON public.contact_emails(organization_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_emails_match ON public.contact_emails(organization_id, normalized_email)
  WHERE match_enabled = true AND verified = true;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_contact_aliases_org_contact_alias
  ON public.contact_aliases(organization_id, contact_id, normalized_alias);
CREATE INDEX IF NOT EXISTS idx_contact_aliases_org_alias ON public.contact_aliases(organization_id, normalized_alias);
CREATE INDEX IF NOT EXISTS idx_contact_aliases_trgm ON public.contact_aliases USING gin (normalized_alias extensions.gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_contact_candidate_source_email
  ON public.contact_candidates(organization_id, source_email_id)
  WHERE source_email_id IS NOT NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_contact_candidates_org_status ON public.contact_candidates(organization_id, status, created_at DESC);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contacts, public.contact_emails, public.contact_aliases, public.contact_candidates FROM anon, authenticated;

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS customer_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS supplier_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.material_lines ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.delivery_notes ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
ALTER TABLE public.processed_emails ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_supplier_contact_profile
  ON public.suppliers(organization_id, contact_id) WHERE contact_id IS NOT NULL AND merge_status <> 'merged';
CREATE INDEX IF NOT EXISTS idx_projects_customer_contact ON public.projects(organization_id, customer_contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_contact ON public.orders(organization_id, supplier_contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_contact ON public.documents(organization_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_material_lines_contact ON public.material_lines(organization_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_processed_emails_contact ON public.processed_emails(organization_id, contact_id);

CREATE OR REPLACE FUNCTION public.set_contact_registry_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON public.contacts;
CREATE TRIGGER trg_contacts_updated_at BEFORE UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.set_contact_registry_updated_at();
DROP TRIGGER IF EXISTS trg_contact_emails_updated_at ON public.contact_emails;
CREATE TRIGGER trg_contact_emails_updated_at BEFORE UPDATE ON public.contact_emails
FOR EACH ROW EXECUTE FUNCTION public.set_contact_registry_updated_at();
DROP TRIGGER IF EXISTS trg_contact_aliases_updated_at ON public.contact_aliases;
CREATE TRIGGER trg_contact_aliases_updated_at BEFORE UPDATE ON public.contact_aliases
FOR EACH ROW EXECUTE FUNCTION public.set_contact_registry_updated_at();
DROP TRIGGER IF EXISTS trg_contact_candidates_updated_at ON public.contact_candidates;
CREATE TRIGGER trg_contact_candidates_updated_at BEFORE UPDATE ON public.contact_candidates
FOR EACH ROW EXECUTE FUNCTION public.set_contact_registry_updated_at();

CREATE OR REPLACE FUNCTION public.find_contact_matches(
  p_organization_id uuid,
  p_name text,
  p_threshold numeric DEFAULT 0.76,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(contact_id uuid, legal_name text, contact_type text, score numeric, match_source text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH input AS (
    SELECT public.normalize_contact_name(p_name) AS normalized
  ), candidates AS (
    SELECT c.id, c.legal_name, c.type,
      extensions.similarity(c.normalized_name, input.normalized) AS score,
      'legal_name'::text AS match_source
    FROM public.contacts c CROSS JOIN input
    WHERE c.organization_id = p_organization_id AND c.status = 'active'
      AND extensions.similarity(c.normalized_name, input.normalized) >= p_threshold
    UNION ALL
    SELECT c.id, c.legal_name, c.type,
      extensions.similarity(a.normalized_alias, input.normalized) AS score,
      'alias'::text AS match_source
    FROM public.contact_aliases a
    JOIN public.contacts c ON c.id = a.contact_id AND c.organization_id = a.organization_id
    CROSS JOIN input
    WHERE a.organization_id = p_organization_id AND c.status = 'active'
      AND extensions.similarity(a.normalized_alias, input.normalized) >= p_threshold
  )
  SELECT DISTINCT ON (id) id, legal_name, type, score, match_source
  FROM candidates
  ORDER BY id, score DESC
  LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
$$;
REVOKE ALL ON FUNCTION public.find_contact_matches(uuid,text,numeric,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_contact_matches(uuid,text,numeric,integer) TO service_role;

-- Backfill supplier profiles as verified contacts.
INSERT INTO public.contacts (
  organization_id, legal_name, normalized_name, type, vat_number, domain,
  verification_status, source, legacy_supplier_id, notes
)
SELECT s.organization_id, s.name, public.normalize_contact_name(s.name), 'supplier', s.vat_number, s.domain,
  'verified', 'backfill', s.id, 'Creato dal profilo fornitore OrderWatch esistente.'
FROM public.suppliers s
WHERE s.contact_id IS NULL AND s.merge_status <> 'merged';

UPDATE public.suppliers s
SET contact_id = c.id
FROM public.contacts c
WHERE s.contact_id IS NULL
  AND c.organization_id = s.organization_id
  AND c.legacy_supplier_id = s.id;

INSERT INTO public.contact_aliases (organization_id, contact_id, alias, normalized_alias, verified, source)
SELECT s.organization_id, s.contact_id, s.name, public.normalize_contact_name(s.name), true, 'backfill'
FROM public.suppliers s
WHERE s.contact_id IS NOT NULL
ON CONFLICT (organization_id, contact_id, normalized_alias) DO NOTHING;

-- Existing supplier emails and manually managed supplier contacts are trusted.
INSERT INTO public.contact_emails (
  organization_id, contact_id, email, normalized_email, is_primary, verified, match_enabled, source
)
SELECT s.organization_id, s.contact_id, s.email, public.normalize_contact_email(s.email), true, true, true, 'backfill'
FROM public.suppliers s
WHERE s.contact_id IS NOT NULL AND s.email IS NOT NULL AND trim(s.email) <> ''
ON CONFLICT (organization_id, normalized_email) DO NOTHING;

INSERT INTO public.contact_emails (
  organization_id, contact_id, email, normalized_email, is_primary, verified, match_enabled, source, source_email_id
)
SELECT sc.organization_id, s.contact_id, sc.email, public.normalize_contact_email(sc.email), sc.is_primary, true, true, 'backfill', sc.source_email_id
FROM public.supplier_contacts sc
JOIN public.suppliers s ON s.id = sc.supplier_id AND s.organization_id = sc.organization_id
WHERE s.contact_id IS NOT NULL AND sc.email IS NOT NULL AND trim(sc.email) <> ''
ON CONFLICT (organization_id, normalized_email) DO NOTHING;

-- Learn sender addresses only when an operational record already linked that
-- source email to a supplier. These are trusted historical associations.
WITH linked_sender AS (
  SELECT DISTINCT pe.organization_id, s.contact_id,
    lower((regexp_match(pe.from_address, '[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]) AS email,
    pe.id AS source_email_id
  FROM public.processed_emails pe
  JOIN public.documents d ON d.source_email_id = pe.id AND d.organization_id = pe.organization_id
  JOIN public.suppliers s ON s.id = d.supplier_id AND s.organization_id = d.organization_id
  WHERE s.contact_id IS NOT NULL AND pe.from_address IS NOT NULL
  UNION
  SELECT DISTINCT pe.organization_id, s.contact_id,
    lower((regexp_match(pe.from_address, '[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]) AS email,
    pe.id AS source_email_id
  FROM public.processed_emails pe
  JOIN public.orders o ON o.source_email_id = pe.id AND o.organization_id = pe.organization_id
  JOIN public.suppliers s ON s.id = o.supplier_id AND s.organization_id = o.organization_id
  WHERE s.contact_id IS NOT NULL AND pe.from_address IS NOT NULL
)
INSERT INTO public.contact_emails (
  organization_id, contact_id, email, normalized_email, verified, match_enabled, source, source_email_id
)
SELECT organization_id, contact_id, email, email, true, true, 'backfill', source_email_id
FROM linked_sender WHERE email IS NOT NULL
ON CONFLICT (organization_id, normalized_email) DO NOTHING;

-- Customer names are historical AI-derived data: preserve them as pending,
-- never as trusted automatic matches until reviewed.
INSERT INTO public.contacts (
  organization_id, legal_name, normalized_name, type, verification_status, source, notes
)
SELECT p.organization_id, min(p.customer), public.normalize_contact_name(p.customer), 'customer', 'pending', 'backfill',
  'Creato dai lavori storici; richiede conferma prima del matching automatico.'
FROM public.projects p
WHERE p.customer IS NOT NULL AND trim(p.customer) <> '' AND p.customer_contact_id IS NULL
GROUP BY p.organization_id, public.normalize_contact_name(p.customer);

UPDATE public.projects p
SET customer_contact_id = c.id
FROM public.contacts c
WHERE p.customer_contact_id IS NULL
  AND c.organization_id = p.organization_id
  AND c.type IN ('customer','both')
  AND c.normalized_name = public.normalize_contact_name(p.customer)
  AND c.status = 'active';

INSERT INTO public.contact_aliases (organization_id, contact_id, alias, normalized_alias, verified, source)
SELECT p.organization_id, p.customer_contact_id, p.customer, public.normalize_contact_name(p.customer), false, 'backfill'
FROM public.projects p
WHERE p.customer_contact_id IS NOT NULL AND p.customer IS NOT NULL
ON CONFLICT (organization_id, contact_id, normalized_alias) DO NOTHING;

INSERT INTO public.contact_candidates (
  organization_id, source_contact_id, proposed_name, normalized_name, proposed_type,
  match_method, status, metadata
)
SELECT c.organization_id, c.id, c.legal_name, c.normalized_name, c.type,
  'new', 'pending', jsonb_build_object('reason', 'Cliente importato dai lavori storici')
FROM public.contacts c
WHERE c.source = 'backfill' AND c.type = 'customer' AND c.verification_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_candidates cc
    WHERE cc.source_contact_id = c.id AND cc.status = 'pending'
  );

-- Existing duplicate supplier profiles stay separate and become explicit
-- review candidates instead of being merged by the migration.
INSERT INTO public.contact_candidates (
  organization_id, source_contact_id, proposed_name, normalized_name,
  proposed_type, matched_contact_id, match_method, similarity, status, metadata
)
SELECT c.organization_id, c.id, c.legal_name, c.normalized_name,
  'supplier', match.id, 'duplicate', 1, 'pending',
  jsonb_build_object('reason', 'Schede fornitore storiche con lo stesso nome normalizzato')
FROM public.contacts c
JOIN LATERAL (
  SELECT other.id
  FROM public.contacts other
  WHERE other.organization_id = c.organization_id
    AND other.id <> c.id
    AND other.type IN ('supplier','both')
    AND other.status = 'active'
    AND other.normalized_name = c.normalized_name
    AND other.created_at <= c.created_at
  ORDER BY other.created_at, other.id
  LIMIT 1
) match ON true
WHERE c.legacy_supplier_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_candidates cc
    WHERE cc.organization_id = c.organization_id
      AND cc.source_contact_id = c.id
      AND cc.matched_contact_id = match.id
      AND cc.status = 'pending'
  );

-- Propagate canonical links to existing operational records.
UPDATE public.orders o SET supplier_contact_id = s.contact_id
FROM public.suppliers s
WHERE o.supplier_contact_id IS NULL AND o.supplier_id = s.id AND o.organization_id = s.organization_id;
UPDATE public.documents d SET contact_id = s.contact_id
FROM public.suppliers s
WHERE d.contact_id IS NULL AND d.supplier_id = s.id AND d.organization_id = s.organization_id;
UPDATE public.material_lines ml SET contact_id = s.contact_id
FROM public.suppliers s
WHERE ml.contact_id IS NULL AND ml.supplier_id = s.id AND ml.organization_id = s.organization_id;
UPDATE public.material_lines ml SET contact_id = p.customer_contact_id
FROM public.projects p
WHERE ml.contact_id IS NULL AND ml.project_id = p.id AND ml.organization_id = p.organization_id;
UPDATE public.quotes q SET contact_id = s.contact_id
FROM public.suppliers s
WHERE q.contact_id IS NULL AND q.supplier_id = s.id AND q.organization_id = s.organization_id;
UPDATE public.quotes q SET contact_id = p.customer_contact_id
FROM public.projects p
WHERE q.contact_id IS NULL AND q.project_id = p.id AND q.organization_id = p.organization_id;
UPDATE public.delivery_notes d SET contact_id = s.contact_id
FROM public.suppliers s
WHERE d.contact_id IS NULL AND d.supplier_id = s.id AND d.organization_id = s.organization_id;
UPDATE public.invoices i SET contact_id = s.contact_id
FROM public.suppliers s
WHERE i.contact_id IS NULL AND i.supplier_id = s.id AND i.organization_id = s.organization_id;
UPDATE public.processed_emails pe SET contact_id = o.supplier_contact_id
FROM public.orders o
WHERE pe.contact_id IS NULL AND pe.linked_order_code = o.order_code AND pe.organization_id = o.organization_id;
UPDATE public.processed_emails pe SET contact_id = p.customer_contact_id
FROM public.projects p
WHERE pe.contact_id IS NULL AND pe.linked_project_code = p.project_code AND pe.organization_id = p.organization_id;

INSERT INTO public.settings (organization_id, key, value, type, "group", description, customer_visible, status)
SELECT o.id, seed.key, seed.value, seed.type, seed.group_name, seed.description, seed.customer_visible, 'active'
FROM public.organizations o
CROSS JOIN (VALUES
  ('modules.contacts','true','boolean','modules','Anagrafica clienti e fornitori',false),
  ('matching.contact_fuzzy_threshold','0.76','number','matching','Soglia suggerimenti per nomi simili',false),
  ('matching.contact_auto_learn_candidates','true','boolean','matching','Registra automaticamente nuovi soggetti come candidati',false)
) AS seed(key,value,type,group_name,description,customer_visible)
ON CONFLICT (organization_id, key) DO NOTHING;

-- Atomic, non-destructive merge. Operational rows are repointed and the source
-- contact remains as an audit tombstone.
CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_organization_id uuid,
  p_source_contact_id uuid,
  p_target_contact_id uuid,
  p_actor text DEFAULT 'OrderWatch Admin'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_supplier uuid;
  target_supplier uuid;
BEGIN
  IF p_source_contact_id = p_target_contact_id THEN
    RAISE EXCEPTION 'Source and target contacts must differ';
  END IF;
  PERFORM 1 FROM public.contacts WHERE id = p_source_contact_id AND organization_id = p_organization_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source contact not found'; END IF;
  PERFORM 1 FROM public.contacts WHERE id = p_target_contact_id AND organization_id = p_organization_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target contact not found'; END IF;

  SELECT id INTO source_supplier FROM public.suppliers WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id AND merge_status <> 'merged' LIMIT 1;
  SELECT id INTO target_supplier FROM public.suppliers WHERE organization_id = p_organization_id AND contact_id = p_target_contact_id AND merge_status <> 'merged' LIMIT 1;
  IF source_supplier IS NOT NULL AND target_supplier IS NOT NULL THEN
    UPDATE public.orders SET supplier_id = target_supplier, supplier_contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND supplier_id = source_supplier;
    UPDATE public.documents SET supplier_id = target_supplier, contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND supplier_id = source_supplier;
    UPDATE public.material_lines SET supplier_id = target_supplier, contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND supplier_id = source_supplier;
    UPDATE public.quotes SET supplier_id = target_supplier, contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND supplier_id = source_supplier;
    UPDATE public.delivery_notes SET supplier_id = target_supplier, contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND supplier_id = source_supplier;
    UPDATE public.invoices SET supplier_id = target_supplier, contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND supplier_id = source_supplier;
    UPDATE public.supplier_contacts SET supplier_id = target_supplier WHERE organization_id = p_organization_id AND supplier_id = source_supplier;
    UPDATE public.suppliers SET merge_status = 'merged', merged_into_supplier_id = target_supplier, contact_id = NULL WHERE id = source_supplier AND organization_id = p_organization_id;
  ELSIF source_supplier IS NOT NULL THEN
    UPDATE public.suppliers SET contact_id = p_target_contact_id WHERE id = source_supplier AND organization_id = p_organization_id;
  END IF;

  DELETE FROM public.contact_emails source_email
   USING public.contact_emails target_email
   WHERE source_email.organization_id = p_organization_id
     AND source_email.contact_id = p_source_contact_id
     AND target_email.organization_id = p_organization_id
     AND target_email.contact_id = p_target_contact_id
     AND target_email.normalized_email = source_email.normalized_email;
  UPDATE public.contact_emails SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;

  DELETE FROM public.contact_aliases source_alias
   USING public.contact_aliases target_alias
   WHERE source_alias.organization_id = p_organization_id
     AND source_alias.contact_id = p_source_contact_id
     AND target_alias.organization_id = p_organization_id
     AND target_alias.contact_id = p_target_contact_id
     AND target_alias.normalized_alias = source_alias.normalized_alias;
  UPDATE public.contact_aliases SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;

  UPDATE public.projects SET customer_contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND customer_contact_id = p_source_contact_id;
  UPDATE public.orders SET supplier_contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND supplier_contact_id = p_source_contact_id;
  UPDATE public.documents SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;
  UPDATE public.material_lines SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;
  UPDATE public.quotes SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;
  UPDATE public.delivery_notes SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;
  UPDATE public.invoices SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;
  UPDATE public.processed_emails SET contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND contact_id = p_source_contact_id;
  UPDATE public.contact_candidates SET matched_contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND matched_contact_id = p_source_contact_id;
  UPDATE public.contact_candidates SET resolved_contact_id = p_target_contact_id WHERE organization_id = p_organization_id AND resolved_contact_id = p_source_contact_id;
  UPDATE public.contacts SET status = 'merged', merged_into_contact_id = p_target_contact_id,
    notes = concat_ws(E'\n', notes, 'Unito da ' || coalesce(p_actor, 'OrderWatch Admin') || ' il ' || now()::text)
  WHERE id = p_source_contact_id AND organization_id = p_organization_id;
  RETURN p_target_contact_id;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid,uuid,uuid,text) TO service_role;
