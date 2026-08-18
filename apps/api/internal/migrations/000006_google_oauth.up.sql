-- Migration 0006: social login (Sign in with Google).
--
-- Links a local account to a Google account through the ID token `sub` claim —
-- the provider's stable user identifier (the email can change, `sub` cannot).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_id character varying(64);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_provider character varying(20) NOT NULL DEFAULT 'local';

-- Uniqueness of `sub`: one Google user cannot map to two accounts.
-- Local accounts store NULL and, since NULLs do not collide in a unique index
-- do Postgres, todas convivem sem conflito.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON public.users USING btree (google_id);
