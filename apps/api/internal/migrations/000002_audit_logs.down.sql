-- Reverts migration 0002.
DROP TABLE IF EXISTS public.audit_logs CASCADE;
