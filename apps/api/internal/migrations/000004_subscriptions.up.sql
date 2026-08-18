-- Migration 0004: billing/subscription.
-- Creates the subscriptions table (one per user). Equivalent to what
-- AutoMigrate produz para o modelo models.Subscription.

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    user_id uuid NOT NULL,
    provider character varying(30),
    plan character varying(30) DEFAULT 'free'::character varying NOT NULL,
    status character varying(30) DEFAULT 'inactive'::character varying NOT NULL,
    provider_customer_id character varying(255),
    provider_subscription_id character varying(255),
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    PRIMARY KEY (id)
);

-- One subscription per user (unique user_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer_id ON public.subscriptions USING btree (provider_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription_id ON public.subscriptions USING btree (provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_deleted_at ON public.subscriptions USING btree (deleted_at);
