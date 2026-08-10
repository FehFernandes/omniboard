-- Migration 0002: audit trail (append-only).
-- Equivalent to what AutoMigrate produces for the AuditLog model, plus the
-- feed por dono (createCompositeIndexes).

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    actor_user_id uuid,
    actor_email character varying(255),
    action character varying(60) NOT NULL,
    target_type character varying(60),
    target_id character varying(64),
    ip character varying(45),
    metadata jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON public.audit_logs (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);
-- Owner "feed" index for keyset pagination (actor_user_id, created_at DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_audit_actor_feed ON public.audit_logs (actor_user_id, created_at DESC, id DESC);
