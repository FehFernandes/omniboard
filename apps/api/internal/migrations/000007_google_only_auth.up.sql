-- Migration 0007: Google login becomes the ONLY authentication.
--
-- We do not drop the `password` column nor the lockout counters: that would erase
-- data irreversibly. Instead the code simply stops knowing about them, and the
-- column starts accepting NULL so inserts without a password work. Existing
-- hashes lie dormant — no endpoint reads them.
--
-- Expected consequence: accounts that only had a password (google_id IS NULL) can
-- no longer authenticate. Nothing is deleted; they can be recovered by linking the
-- matching Google `sub`, or removed manually.

ALTER TABLE public.users ALTER COLUMN password DROP NOT NULL;

-- failed_attempts / locked_until existed to slow down password brute force. With
-- no password there is nothing to slow down (that is Google's problem now). They
-- stay null/zero.
ALTER TABLE public.users ALTER COLUMN failed_attempts DROP NOT NULL;

-- auth_provider was introduced in 0006 to tell "local" from "google".
-- With a single provider the column is constant and tells us nothing.
ALTER TABLE public.users DROP COLUMN IF EXISTS auth_provider;
