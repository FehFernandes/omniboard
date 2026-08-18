-- Reverts the baseline migration (0001). CASCADE drops indexes/constraints too.
DROP TABLE IF EXISTS public.items CASCADE;
DROP TABLE IF EXISTS public.verification_tokens CASCADE;
DROP TABLE IF EXISTS public.sessions CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
