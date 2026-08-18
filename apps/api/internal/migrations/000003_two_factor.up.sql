-- Migration 0003: 2FA (TOTP).
-- Adds 2FA columns to users and creates the recovery codes table.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS totp_secret character varying(64);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS public.two_factor_recovery_codes (
    id uuid NOT NULL,
    created_at timestamp with time zone,
    user_id uuid NOT NULL,
    code_hash character varying(64) NOT NULL,
    used_at timestamp with time zone,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_2fa_recovery_user_id ON public.two_factor_recovery_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_2fa_recovery_code_hash ON public.two_factor_recovery_codes (code_hash);
