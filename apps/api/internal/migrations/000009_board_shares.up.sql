-- Migration 0009: public read-only links to a board.
--
-- The token is the read credential, so it has a unique index and is generated with
-- cryptographic randomness in the code. The row remains after revocation
-- (revoked_at IS NOT NULL): deleting it would lose the trail of what was exposed
-- and open the door for the same token to exist again.
--
-- board_id is the document id inside the workspace (a BoardManager nanoid), not a
-- foreign key — the workspace is a single JSONB blob, with no per-board table.

CREATE TABLE IF NOT EXISTS public.board_shares (
    id          uuid PRIMARY KEY,
    created_at  timestamptz,
    updated_at  timestamptz,
    deleted_at  timestamptz,

    user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    board_id    varchar(64) NOT NULL,
    board_name  varchar(200),
    token       varchar(64) NOT NULL,

    revoked_at   timestamptz,
    views        bigint NOT NULL DEFAULT 0,
    last_view_at timestamptz
);

-- Lookup by token is the hot path of the public route.
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_shares_token ON public.board_shares (token);
CREATE INDEX IF NOT EXISTS idx_board_shares_user ON public.board_shares (user_id);
CREATE INDEX IF NOT EXISTS idx_board_shares_board ON public.board_shares (board_id);
CREATE INDEX IF NOT EXISTS idx_board_shares_deleted_at ON public.board_shares (deleted_at);
