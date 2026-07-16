CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT CHECK (role IN ('Owner','IT','Admin','Buyer','ReadOnly')) DEFAULT 'Buyer',
  active BOOLEAN DEFAULT TRUE,
  receives_daily_report BOOLEAN DEFAULT FALSE,
  can_manage_settings BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS provider TEXT CHECK (provider IN ('Hostinger','Gmail','Microsoft','Other')) DEFAULT 'Hostinger';
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS imap_host TEXT;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS imap_port INTEGER DEFAULT 993;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS imap_secure BOOLEAN DEFAULT TRUE;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS smtp_host TEXT;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 465;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT TRUE;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS encrypted_password TEXT;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS encryption_version TEXT DEFAULT 'v1';
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
ALTER TABLE public.mailboxes ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_app_users_active ON public.app_users(active, role);
CREATE INDEX IF NOT EXISTS idx_mailboxes_connection ON public.mailboxes(active, connection_status);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.app_users;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_users (full_name, email, role, active, receives_daily_report, can_manage_settings, notes)
VALUES ('Admin Graphic Center', 'admin@graphiccenter.local', 'Admin', true, true, true, 'Placeholder admin da sostituire con utente reale del titolare/IT.')
ON CONFLICT (email) DO NOTHING;
