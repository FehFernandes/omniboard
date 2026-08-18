import { API_URL } from '../api/config';

// Entry point of the OAuth flow — the application's only login path. It has to
// be a top-level browser navigation (window.location or <a href>), never fetch:
// the backend answers with a redirect to Google's consent screen, which has to
// be rendered.
export const GOOGLE_LOGIN_URL = `${API_URL}/auth/google`;

// Front-end route where the backend hands control back at the end of the flow.
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

// Failure reasons returned by the backend in the `error` query param. They are
// stable keys (not sentences) precisely so the translation lives here, in the UI.
const ERROR_MESSAGES: Record<string, string> = {
  consent_denied: 'You cancelled access to your Google account.',
  invalid_state: 'The sign-in session expired or was started in another tab. Try again.',
  missing_code: 'Google did not return the authorization code. Try again.',
  google_failed: 'We could not validate your Google sign-in. Try again.',
  email_unverified: 'Your Google account does not have a verified email.',
  account_failed: 'We could not set up your account. Try again in a moment.',
  account_disabled: 'This account is disabled.',
};

// googleErrorMessage translates a reason coming from the backend. Unknown
// reasons fall back to a generic message instead of leaking the raw key on
// screen.
export function googleErrorMessage(reason: string): string {
  return ERROR_MESSAGES[reason] ?? 'Google sign-in failed. Try again.';
}
