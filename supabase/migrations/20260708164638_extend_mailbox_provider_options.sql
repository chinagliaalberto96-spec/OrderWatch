ALTER TABLE public.mailboxes DROP CONSTRAINT IF EXISTS mailboxes_provider_check;
ALTER TABLE public.mailboxes ADD CONSTRAINT mailboxes_provider_check CHECK (provider IN ('Hostinger','Gmail','Microsoft','Aruba','Zoho','Other'));
