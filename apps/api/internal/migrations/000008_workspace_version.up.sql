-- Migration 0008: workspace version, to detect concurrent writes.
--
-- The workspace is a single document per user, saved whole. Without a version the
-- second tab (or the other device) overwrites what the first one wrote and the
-- user never finds out — silent loss of work.
--
-- With the column, PUT requires the version the client read: if it is not the
-- current one, the API answers 409 with the server state and the client decides
-- (today: reload and warn) instead of erasing what the other one did.
--
-- Existing rows start at 1; a client that does not send a version yet keeps
-- working (the handler treats a missing version as "do not check"), so this
-- migration does not break open sessions.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
