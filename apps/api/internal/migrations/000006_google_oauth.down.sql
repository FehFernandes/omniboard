DROP INDEX IF EXISTS public.idx_users_google_id;
ALTER TABLE public.users DROP COLUMN IF EXISTS auth_provider;
ALTER TABLE public.users DROP COLUMN IF EXISTS google_id;
