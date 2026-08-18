import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth/auth-context';
import { googleErrorMessage } from '../lib/auth/google';
import { ApiError } from '../lib/api/client';
import { Alert, AuthCard, Button, TextField } from '../components/ui';

type State = 'exchanging' | 'two_factor' | 'error';

// twoFactorRequired identifies the 401 in which the backend asks for the second
// step instead of refusing the login. The exchange code stays valid in that case.
function twoFactorRequired(e: unknown): boolean {
  return e instanceof ApiError && e.body?.two_factor_required === true;
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

// GoogleCallbackPage is the route where the backend hands control back at the
// end of the OAuth flow. It receives a single-use opaque code in `?code=` and
// exchanges it for the application's token pair — the tokens never show up in
// the URL.
export function GoogleCallbackPage() {
  const { loginWithGoogle } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<State>('exchanging');
  const [msg, setMsg] = useState('');
  const [totp, setTotp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ran = useRef(false);

  const code = params.get('code');

  useEffect(() => {
    if (ran.current) return; // the code is single-use: do not exchange it twice under StrictMode
    ran.current = true;

    const reason = params.get('error');
    if (reason) {
      setState('error');
      setMsg(googleErrorMessage(reason));
      return;
    }
    if (!code) {
      setState('error');
      setMsg('Missing authentication code.');
      return;
    }

    loginWithGoogle(code)
      .then(() => nav('/', { replace: true }))
      .catch((e) => {
        if (twoFactorRequired(e)) {
          setState('two_factor');
          return;
        }
        setState('error');
        setMsg(errorMessage(e, 'Could not finish signing in.'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    setSubmitting(true);
    setMsg('');
    try {
      await loginWithGoogle(code, totp.trim());
      nav('/', { replace: true });
    } catch (err) {
      setMsg(errorMessage(err, 'Invalid code.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'two_factor') {
    return (
      <AuthCard title="Two-step verification">
        <Alert>{msg}</Alert>
        <form onSubmit={submitTotp} className="space-y-3" noValidate>
          <TextField
            label="Authenticator code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
          <Button type="submit" disabled={submitting || totp.trim() === ''} className="w-full">
            {submitting ? 'Checking…' : 'Confirm'}
          </Button>
        </form>
        <p className="mt-3 text-xs text-gray-500">
          You can also use one of the recovery codes generated when you enabled 2FA.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Entrando com o Google">
      {state === 'exchanging' && <p className="text-sm text-gray-600" role="status">Finishing sign-in…</p>}
      {state === 'error' && (
        <>
          <Alert>{msg}</Alert>
          <div className="text-sm">
            <Link to="/login" className="hover:underline">
              Voltar para o login
            </Link>
          </div>
        </>
      )}
    </AuthCard>
  );
}
