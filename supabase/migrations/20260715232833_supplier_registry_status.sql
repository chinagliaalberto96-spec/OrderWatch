-- Supplier registry lifecycle is separate from merge_status:
-- merge_status preserves identity tombstones, while registry_status controls
-- whether a profile is trusted, awaits review, or is intentionally hidden.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS registry_status text NOT NULL DEFAULT 'verified';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'suppliers_registry_status_check'
      AND conrelid = 'public.suppliers'::regclass
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_registry_status_check
      CHECK (registry_status IN ('verified', 'candidate', 'ignored'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_suppliers_org_registry_status
  ON public.suppliers(organization_id, registry_status)
  WHERE merge_status <> 'merged';

-- SDI notification addresses are technical transport identities, never
-- commercial suppliers. Records remain available for audit/history.
UPDATE public.suppliers
SET registry_status = 'ignored', updated_at = now()
WHERE lower(name) ~ '^sdi[0-9]+@pec\.fatturapa\.it$';

-- Consolidate the remaining SITCA administrative alias through the existing
-- atomic merge function so every operational foreign key is repointed safely.
DO $$
DECLARE
  org_id uuid;
  source_contact uuid;
  target_contact uuid;
BEGIN
  SELECT id INTO org_id
  FROM public.organizations
  WHERE slug = 'graphic-center'
  LIMIT 1;

  IF org_id IS NULL THEN RETURN; END IF;

  SELECT contact_id INTO source_contact
  FROM public.suppliers
  WHERE organization_id = org_id
    AND lower(name) = 'sitca | amministrazione'
    AND merge_status <> 'merged'
  LIMIT 1;

  SELECT contact_id INTO target_contact
  FROM public.suppliers
  WHERE organization_id = org_id
    AND lower(name) = 'sitca'
    AND merge_status <> 'merged'
  LIMIT 1;

  IF source_contact IS NOT NULL AND target_contact IS NOT NULL
     AND source_contact <> target_contact THEN
    PERFORM public.merge_contacts(
      org_id,
      source_contact,
      target_contact,
      'OrderWatch supplier registry cleanup'
    );
  END IF;
END;
$$;
