-- Reverts 0009. Removes the public links: the boards themselves are unaffected
-- (their content lives in the workspace).
DROP TABLE IF EXISTS public.board_shares;
