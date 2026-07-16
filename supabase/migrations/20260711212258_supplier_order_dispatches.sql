-- FASE 1 — Workflow ordini verso fornitori. Migrazione ADDITIVA: nessuna
-- tabella/colonna esistente viene alterata in modo distruttivo.

CREATE TABLE IF NOT EXISTS public.supplier_order_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_code text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  project_code text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  supplier_email text,
  contact_name text,
  sender_mailbox_id uuid REFERENCES public.mailboxes(id) ON DELETE SET NULL,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','sent','waiting_confirmation','confirmed','failed','cancelled')),
  approval_required boolean NOT NULL DEFAULT true,
  order_version integer NOT NULL DEFAULT 1,
  line_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  material_line_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  prepared_at timestamptz,
  prepared_by text,
  approved_at timestamptz,
  approved_by text,
  sent_at timestamptz,
  smtp_message_id text,
  smtp_thread_id text,
  confirmation_email_id uuid REFERENCES public.processed_emails(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  promised_date date,
  reminder_count integer NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indici sulle relazioni e sulle chiavi di matching risposta
CREATE INDEX IF NOT EXISTS idx_sod_order_id ON public.supplier_order_dispatches(order_id);
CREATE INDEX IF NOT EXISTS idx_sod_supplier_id ON public.supplier_order_dispatches(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sod_status ON public.supplier_order_dispatches(status);
CREATE INDEX IF NOT EXISTS idx_sod_smtp_message_id ON public.supplier_order_dispatches(smtp_message_id);
CREATE INDEX IF NOT EXISTS idx_sod_smtp_thread_id ON public.supplier_order_dispatches(smtp_thread_id);
CREATE INDEX IF NOT EXISTS idx_sod_order_code ON public.supplier_order_dispatches(order_code);
CREATE INDEX IF NOT EXISTS idx_sod_project_code ON public.supplier_order_dispatches(project_code);

-- Protezione doppio invio: un solo dispatch ATTIVO per ordine + versione.
-- Attivo = in lavorazione (draft/approved/sent/waiting_confirmation).
-- confirmed/failed/cancelled non bloccano una nuova versione.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_dispatch_per_order_version
  ON public.supplier_order_dispatches(order_id, order_version)
  WHERE order_id IS NOT NULL
    AND status IN ('draft','approved','sent','waiting_confirmation');

-- updated_at automatico (funzione già presente dalle migrazioni precedenti)
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.supplier_order_dispatches;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.supplier_order_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: come le altre tabelle private, solo backend/service role.
ALTER TABLE public.supplier_order_dispatches ENABLE ROW LEVEL SECURITY;

-- Colonne additive di supporto (nullable, non rompono nulla)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS supplier_order_status text;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS dispatch_id uuid REFERENCES public.supplier_order_dispatches(id) ON DELETE SET NULL;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS reminder_type text DEFAULT 'supplier_order';
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS attempt integer DEFAULT 1;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS smtp_message_id text;
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS approval_required boolean DEFAULT true;

-- Impostazioni FASE 5 (additive, visibili in dashboard)
INSERT INTO public.settings (key, value, type, "group", description, customer_visible, status) VALUES
('supplier_orders.enabled', 'true', 'boolean', 'supplier_orders', 'Abilita la preparazione ordini verso fornitori', true, 'active'),
('supplier_orders.prepare_drafts', 'true', 'boolean', 'supplier_orders', 'Prepara automaticamente le bozze ordine dai materiali', true, 'active'),
('supplier_orders.send_mode', 'approval_required', 'string', 'supplier_orders', 'Modalita invio ordine: sempre con approvazione del buyer', true, 'active'),
('supplier_orders.auto_send', 'false', 'boolean', 'supplier_orders', 'Invio automatico ordini fornitore (mai attivo nella prima versione)', true, 'active'),
('supplier_confirmations.matching_enabled', 'true', 'boolean', 'supplier_orders', 'Collega automaticamente le risposte dei fornitori agli ordini inviati', true, 'active'),
('supplier_reminders.enabled', 'true', 'boolean', 'supplier_orders', 'Abilita i solleciti verso i fornitori', true, 'active'),
('supplier_reminders.auto_send', 'false', 'boolean', 'supplier_orders', 'Invio automatico dei solleciti (mai attivo nella prima versione)', true, 'active'),
('supplier_reminders.days_after_send', '3', 'number', 'supplier_orders', 'Giorni di attesa conferma prima di proporre un sollecito', true, 'active'),
('supplier_reminders.max_attempts', '2', 'number', 'supplier_orders', 'Numero massimo di solleciti per ordine', true, 'active')
ON CONFLICT (key) DO NOTHING;
