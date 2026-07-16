ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_auth_user_id
  ON public.app_users(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

COMMENT ON COLUMN public.app_users.auth_user_id IS
  'Collegamento opzionale a Supabase Auth. NULL mantiene compatibilita legacy Graphic Center.';
