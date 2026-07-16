-- ============================================================
-- CANCELLO 2 — Isolamento multi-tenant. Migrazione ADDITIVA.
-- Nessun record esistente viene eliminato. Ogni tabella applicativa
-- riceve organization_id NOT NULL, backfillato su Graphic Center Group Srl
-- (tenant storico, auth_mode=legacy). RLS abilitato sulle nuove tabelle con
-- ZERO policy (stesso pattern gia' in uso: solo service_role bypassa RLS,
-- nessun accesso anon/authenticated diretto — l'app parla sempre via
-- service role server-side, mai con anon key dal browser).
-- ============================================================

-- 1. organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended','archived')),
  auth_mode text NOT NULL DEFAULT 'legacy' CHECK (auth_mode IN ('legacy','supabase')),
  timezone text NOT NULL DEFAULT 'Europe/Rome',
  locale text NOT NULL DEFAULT 'it-IT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.organizations;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. organization_memberships
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  auth_user_id uuid,
  role text NOT NULL DEFAULT 'ReadOnly' CHECK (role IN ('Owner','IT','Admin','Buyer','ReadOnly')),
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, app_user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON public.organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON public.organization_memberships(app_user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_auth_user ON public.organization_memberships(auth_user_id);

-- Un solo tenant predefinito per utente (indice unico parziale)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_membership_per_user
  ON public.organization_memberships(app_user_id) WHERE is_default;

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.organization_memberships;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;

-- 3. Tenant storico Graphic Center
INSERT INTO public.organizations (slug, name, display_name, status, auth_mode, timezone, locale)
VALUES ('graphic-center', 'Graphic Center Group Srl', 'Graphic Center Group Srl', 'active', 'legacy', 'Europe/Rome', 'it-IT')
ON CONFLICT (slug) DO NOTHING;

-- 4. organization_id NOT NULL su tutte le tabelle applicative, backfill su
-- Graphic Center (unico tenant esistente), FK + indice. Sequenza sicura:
-- colonna nullable -> backfill -> verifica -> NOT NULL -> FK -> indice.
DO $$
DECLARE
  gc_id uuid;
  tbl text;
  remaining_nulls bigint;
  tables text[] := ARRAY[
    'app_users','mailboxes','settings','orders','projects','suppliers','supplier_contacts',
    'processed_emails','documents','material_lines','quotes','delivery_notes','invoices',
    'buyer_actions','activities','reminders','daily_reports','report_recipients',
    'customer_confirmations','supplier_order_dispatches','learning_rules',
    'classification_feedback','entity_aliases'
  ];
BEGIN
  SELECT id INTO gc_id FROM public.organizations WHERE slug = 'graphic-center';
  IF gc_id IS NULL THEN
    RAISE EXCEPTION 'Tenant Graphic Center non trovato: migrazione interrotta.';
  END IF;

  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid', tbl);
    EXECUTE format('UPDATE public.%I SET organization_id = %L WHERE organization_id IS NULL', tbl, gc_id);

    EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE organization_id IS NULL', tbl) INTO remaining_nulls;
    IF remaining_nulls > 0 THEN
      RAISE EXCEPTION 'Tabella % ha ancora % righe con organization_id NULL: migrazione interrotta.', tbl, remaining_nulls;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = tbl || '_organization_id_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id)',
        tbl, tbl || '_organization_id_fkey'
      );
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(organization_id)', 'idx_' || tbl || '_organization_id', tbl);
  END LOOP;
END $$;

-- 5. Vincoli di univocita' tenant-aware (sostituiscono i vincoli globali).
-- Decisione documentata su app_users.email: RESTA globale (non convertito a
-- (organization_id, email)). app_users rappresenta l'identita' GLOBALE della
-- persona (un solo profilo per email/login); l'appartenenza a piu' tenant e i
-- relativi ruoli vivono in organization_memberships (che consente gia' piu'
-- righe per lo stesso app_user_id su organizzazioni diverse). Duplicare
-- app_users per tenant avrebbe creato N identita' per la stessa persona.
-- app_users.organization_id rappresenta il tenant "di origine/storico" del
-- profilo (compatibilita' col pilota legacy), non l'unico tenant accessibile.

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_project_code_key;
ALTER TABLE public.projects ADD CONSTRAINT projects_org_project_code_key UNIQUE (organization_id, project_code);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_code_key;
ALTER TABLE public.orders ADD CONSTRAINT orders_org_order_code_key UNIQUE (organization_id, order_code);

ALTER TABLE public.processed_emails DROP CONSTRAINT IF EXISTS processed_emails_message_id_key;
ALTER TABLE public.processed_emails ADD CONSTRAINT processed_emails_org_message_id_key UNIQUE (organization_id, message_id);

ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_key_key;
ALTER TABLE public.settings ADD CONSTRAINT settings_org_key_key UNIQUE (organization_id, key);

ALTER TABLE public.daily_reports DROP CONSTRAINT IF EXISTS daily_reports_report_id_key;
ALTER TABLE public.daily_reports ADD CONSTRAINT daily_reports_org_report_id_key UNIQUE (organization_id, report_id);

ALTER TABLE public.entity_aliases DROP CONSTRAINT IF EXISTS entity_aliases_entity_type_normalized_alias_key;
ALTER TABLE public.entity_aliases ADD CONSTRAINT entity_aliases_org_type_alias_key UNIQUE (organization_id, entity_type, normalized_alias);

-- 6. Indice non-unico tenant-aware per la deduplica fornitori (worker)
CREATE INDEX IF NOT EXISTS idx_suppliers_org_normalized_name ON public.suppliers(organization_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_suppliers_org_domain ON public.suppliers(organization_id, domain);

-- 7. Seed organization_memberships per i 3 app_users storici di Graphic
-- Center (nessun utente Supabase Auth creato: auth_user_id resta NULL,
-- coerente con auth_mode=legacy). Predispone il modello dati per un futuro
-- passaggio di GC a auth_mode=supabase senza ulteriori migrazioni.
INSERT INTO public.organization_memberships (organization_id, app_user_id, role, active, is_default)
SELECT o.id, u.id, u.role, u.active, true
FROM public.app_users u
CROSS JOIN (SELECT id FROM public.organizations WHERE slug = 'graphic-center') o
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_memberships m
  WHERE m.organization_id = o.id AND m.app_user_id = u.id
);
