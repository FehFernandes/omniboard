-- Baseline migration (0001): initial schema.
-- Equivalente ao que o AutoMigrate produz para os modelos atuais
-- (users, sessions, verification_tokens, items), including the feed index
-- (cursor) e a busca full-text do Item.

CREATE TABLE public.users (
    id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    name character varying(150) NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    avatar character varying(500),
    is_active boolean DEFAULT true,
    email_verified_at timestamp with time zone,
    failed_attempts bigint DEFAULT 0,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    last_login_ip character varying(45)
);

CREATE TABLE public.sessions (
    id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    user_id uuid NOT NULL,
    refresh_hash character varying(64) NOT NULL,
    user_agent character varying(400),
    ip character varying(45),
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone
);

CREATE TABLE public.verification_tokens (
    id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    user_id uuid NOT NULL,
    purpose character varying(30) NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone,
    used_at timestamp with time zone
);

CREATE TABLE public.items (
    id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    user_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'active'::character varying,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, (((COALESCE(title, ''::character varying))::text || ' '::text) || COALESCE(description, ''::text)))) STORED
);

-- Primary keys
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.verification_tokens ADD CONSTRAINT verification_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.items ADD CONSTRAINT items_pkey PRIMARY KEY (id);

-- Indexes: users (globally unique email)
CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at);

-- Indexes: sessions
CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);
CREATE INDEX idx_sessions_deleted_at ON public.sessions USING btree (deleted_at);
CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at);
CREATE UNIQUE INDEX idx_sessions_refresh_hash ON public.sessions USING btree (refresh_hash);

-- Indexes: verification_tokens
CREATE INDEX idx_verification_tokens_user_id ON public.verification_tokens USING btree (user_id);
CREATE INDEX idx_verification_tokens_deleted_at ON public.verification_tokens USING btree (deleted_at);
CREATE INDEX idx_verification_tokens_expires_at ON public.verification_tokens USING btree (expires_at);
CREATE INDEX idx_verification_tokens_purpose ON public.verification_tokens USING btree (purpose);
CREATE UNIQUE INDEX idx_verification_tokens_token_hash ON public.verification_tokens USING btree (token_hash);

-- Indexes: items (cursor feed + full-text GIN)
CREATE INDEX idx_item_user_feed ON public.items USING btree (user_id, created_at DESC, id DESC);
CREATE INDEX idx_item_user_status ON public.items USING btree (user_id, status);
CREATE INDEX idx_item_search ON public.items USING gin (search_vector);
CREATE INDEX idx_items_user_id ON public.items USING btree (user_id);
CREATE INDEX idx_items_deleted_at ON public.items USING btree (deleted_at);
CREATE INDEX idx_items_status ON public.items USING btree (status);
