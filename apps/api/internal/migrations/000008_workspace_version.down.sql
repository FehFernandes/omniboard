-- Reverts 0008. Only the version counter is lost; workspace data stays.
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS version;
