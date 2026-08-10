-- Reverts 0007. Note: rows created while 0007 was applied have
-- password NULL, o que impede restaurar o NOT NULL direto. Preenchemos com ''
-- (an invalid hash — bcrypt never validates against an empty string), so those
-- accounts remain without a usable password, as expected.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_provider character varying(20) NOT NULL DEFAULT 'local';

UPDATE public.users SET failed_attempts = 0 WHERE failed_attempts IS NULL;
ALTER TABLE public.users ALTER COLUMN failed_attempts SET NOT NULL;

UPDATE public.users SET password = '' WHERE password IS NULL;
ALTER TABLE public.users ALTER COLUMN password SET NOT NULL;
