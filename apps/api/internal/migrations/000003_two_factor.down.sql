-- Reverts migration 0003.
DROP TABLE IF EXISTS public.two_factor_recovery_codes CASCADE;
ALTER TABLE public.users DROP COLUMN IF EXISTS totp_enabled_at;
ALTER TABLE public.users DROP COLUMN IF EXISTS totp_secret;
