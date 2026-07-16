CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.processed_emails
  ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES public.mailboxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('inbound','outbound')) DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS to_addresses JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cc_addresses JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS thread_id TEXT,
  ADD COLUMN IF NOT EXISTS classification_origin TEXT CHECK (
    classification_origin IN ('SUPPLIER','CUSTOMER','INTERNAL','ADMIN','NOISE','UNCLEAR','OTHER')
  ),
  ADD COLUMN IF NOT EXISTS classification_type TEXT,
  ADD COLUMN IF NOT EXISTS privacy_mode TEXT CHECK (privacy_mode IN ('full','metadata_only','discarded')) DEFAULT 'metadata_only',
  ADD COLUMN IF NOT EXISTS skipped_reason TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attachment_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS filename TEXT,
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS file_hash TEXT,
  ADD COLUMN IF NOT EXISTS extracted_text_hash TEXT,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.material_lines
  ADD COLUMN IF NOT EXISTS source_reference TEXT,
  ADD COLUMN IF NOT EXISTS normalized_reference TEXT,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS delivered_quantity TEXT,
  ADD COLUMN IF NOT EXISTS remaining_quantity TEXT,
  ADD COLUMN IF NOT EXISTS promised_date DATE,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS vat_number TEXT,
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS domain TEXT,
  ADD COLUMN IF NOT EXISTS merge_status TEXT CHECK (merge_status IN ('active','duplicate_candidate','merged')) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS merged_into_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source_reference TEXT,
  ADD COLUMN IF NOT EXISTS normalized_reference TEXT,
  ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_buyer_action_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.supplier_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  source_email_id UUID REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_code TEXT,
  quote_type TEXT CHECK (quote_type IN ('supplier_quote','customer_quote_request','customer_quote','unknown')) DEFAULT 'unknown',
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  customer_name TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  project_code TEXT,
  quote_date DATE,
  valid_until DATE,
  total_amount NUMERIC(12,2),
  currency TEXT DEFAULT 'EUR',
  status TEXT CHECK (status IN ('new','to_review','approved','converted','rejected','archived')) DEFAULT 'new',
  confidence NUMERIC(3,2),
  needs_review BOOLEAN DEFAULT TRUE,
  source_email_id UUID REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.delivery_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ddt_number TEXT,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  order_code TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  project_code TEXT,
  delivery_date DATE,
  received_date DATE,
  status TEXT CHECK (status IN ('new','matched','partial','to_review','archived')) DEFAULT 'new',
  confidence NUMERIC(3,2),
  needs_review BOOLEAN DEFAULT TRUE,
  source_email_id UUID REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT,
  invoice_type TEXT CHECK (invoice_type IN ('supplier_invoice','customer_invoice','sdi_invoice','unknown')) DEFAULT 'unknown',
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  supplier_vat TEXT,
  customer_name TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  order_code TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  project_code TEXT,
  invoice_date DATE,
  due_date DATE,
  total_amount NUMERIC(12,2),
  currency TEXT DEFAULT 'EUR',
  sdi_identifier TEXT,
  xml_payload_hash TEXT,
  status TEXT CHECK (status IN ('new','matched','to_review','paid','archived')) DEFAULT 'new',
  confidence NUMERIC(3,2),
  needs_review BOOLEAN DEFAULT TRUE,
  source_email_id UUID REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.buyer_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT CHECK (
    action_type IN ('followup_sent','order_marked_received','quote_converted','classification_corrected','supplier_merged','line_item_updated','manual_note','other')
  ) DEFAULT 'other',
  status TEXT CHECK (status IN ('open','done','cancelled','needs_review')) DEFAULT 'open',
  title TEXT NOT NULL,
  detail TEXT,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  order_code TEXT,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  project_code TEXT,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  material_line_id UUID REFERENCES public.material_lines(id) ON DELETE SET NULL,
  source_email_id UUID REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  direction TEXT CHECK (direction IN ('inbound','outbound','manual')) DEFAULT 'manual',
  action_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.entity_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT CHECK (entity_type IN ('supplier','customer','project','order','material','sender')) NOT NULL,
  entity_id UUID,
  canonical_name TEXT,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT CHECK (source IN ('ai','buyer','system','import')) DEFAULT 'system',
  confidence NUMERIC(3,2),
  active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entity_type, normalized_alias)
);

CREATE TABLE IF NOT EXISTS public.learning_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type TEXT CHECK (
    rule_type IN ('classification','matching','ignore_sender','trusted_sender','supplier_alias','customer_alias','document_pattern','privacy')
  ) NOT NULL,
  pattern TEXT NOT NULL,
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority INTEGER DEFAULT 100,
  active BOOLEAN DEFAULT TRUE,
  source TEXT CHECK (source IN ('buyer_correction','system','admin','import')) DEFAULT 'system',
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.classification_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID REFERENCES public.processed_emails(id) ON DELETE CASCADE,
  original_origin TEXT,
  original_type TEXT,
  corrected_origin TEXT,
  corrected_type TEXT,
  correction_reason TEXT,
  corrected_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.settings (key, value, type, "group", description, customer_visible, status) VALUES
('ai.classification_taxonomy', 'v2_two_level', 'string', 'ai', 'Classificazione a due livelli: origine + tipo documento/processo', false, 'planned'),
('runtime.read_outbound_mail', 'false', 'boolean', 'runtime', 'Legge anche le email inviate per ricostruire azioni buyer', true, 'planned'),
('runtime.poll_window_minutes', '20', 'number', 'runtime', 'Finestra temporale di lettura email per evitare perdite se una mail viene gia letta da un utente', true, 'active'),
('privacy.other_email_policy', 'metadata_only', 'string', 'privacy', 'Per email OTHER/NOISE salva solo metadati minimi, non contenuto', true, 'active'),
('review.low_confidence_threshold', '0.85', 'number', 'review', 'Soglia sotto cui un dato va in revisione umana', true, 'active'),
('matching.fuzzy_order_refs', 'true', 'boolean', 'matching', 'Normalizza riferimenti ordine come n., ord., rif., #', false, 'planned'),
('sdi.xml_invoice_parser', 'true', 'boolean', 'sdi', 'Usa parser XML per fatture elettroniche SDI quando presente', false, 'planned')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_processed_emails_direction ON public.processed_emails(direction);
CREATE INDEX IF NOT EXISTS idx_processed_emails_origin_type ON public.processed_emails(classification_origin, classification_type);
CREATE INDEX IF NOT EXISTS idx_processed_emails_thread_id ON public.processed_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_processed_emails_needs_review ON public.processed_emails(needs_review);
CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON public.documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_documents_type ON public.documents(document_type);
CREATE INDEX IF NOT EXISTS idx_material_lines_normalized_reference ON public.material_lines(normalized_reference);
CREATE INDEX IF NOT EXISTS idx_material_lines_needs_review ON public.material_lines(needs_review);
CREATE INDEX IF NOT EXISTS idx_suppliers_vat_number ON public.suppliers(vat_number);
CREATE INDEX IF NOT EXISTS idx_suppliers_normalized_name ON public.suppliers(normalized_name);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON public.supplier_contacts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_email ON public.supplier_contacts(email);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_project_code ON public.quotes(project_code);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_order_code ON public.delivery_notes(order_code);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_status ON public.delivery_notes(status);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON public.invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_vat ON public.invoices(supplier_vat);
CREATE INDEX IF NOT EXISTS idx_buyer_actions_status ON public.buyer_actions(status);
CREATE INDEX IF NOT EXISTS idx_buyer_actions_action_at ON public.buyer_actions(action_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup ON public.entity_aliases(entity_type, normalized_alias) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_learning_rules_lookup ON public.learning_rules(rule_type, priority) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_classification_feedback_email ON public.classification_feedback(email_id);

ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buyer_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_feedback ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'updated_at'
      AND table_name IN (
        'supplier_contacts',
        'quotes',
        'delivery_notes',
        'invoices',
        'buyer_actions',
        'entity_aliases',
        'learning_rules'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END;
$$;
