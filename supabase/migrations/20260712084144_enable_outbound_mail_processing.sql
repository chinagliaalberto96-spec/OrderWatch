ALTER TABLE public.mailboxes
  ADD COLUMN IF NOT EXISTS sent_folder TEXT DEFAULT 'INBOX.Sent',
  ADD COLUMN IF NOT EXISTS last_sent_check_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mailboxes_last_sent_check
  ON public.mailboxes(last_sent_check_at)
  WHERE active = TRUE AND connection_status = 'connected';

INSERT INTO public.settings (key, value, type, "group", description, customer_visible, status)
VALUES
  ('runtime.read_outbound_mail', 'true', 'boolean', 'runtime', 'Legge le email inviate per ricostruire ordini, conferme e solleciti del buyer', true, 'active'),
  ('runtime.outbound_link_policy', 'existing_entities_only', 'string', 'runtime', 'Le inviate aggiornano solo ordini e lavori esistenti; i casi incerti vanno in revisione', false, 'active')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  updated_at = NOW();

UPDATE public.mailboxes
SET sent_folder = COALESCE(NULLIF(sent_folder, ''), 'INBOX.Sent')
WHERE active = TRUE;
