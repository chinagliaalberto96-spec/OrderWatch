ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_app_users_platform_admin
  ON public.app_users (active)
  WHERE is_platform_admin = TRUE;

COMMENT ON COLUMN public.app_users.is_platform_admin IS
  'Amministratore interno OrderWatch. Non concede accesso senza una organization_membership attiva.';
