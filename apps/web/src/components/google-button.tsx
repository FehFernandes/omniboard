import { GOOGLE_LOGIN_URL } from '../lib/auth/google';

// Official Google logo (4 colors). aria-hidden because the link text already
// states the action — screen readers should not announce the drawing.
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.09l3.01-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

// GoogleButton takes the user to Google's consent screen — the only way into
// the application.
//
// It is an <a>, not a <button>: the OAuth flow requires a top-level browser
// navigation. There is no upfront availability check because the API does not
// boot without the Google credentials (see config.LoadGoogleOAuth).
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  return (
    <a
      href={GOOGLE_LOGIN_URL}
      className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
    >
      <GoogleLogo />
      {label}
    </a>
  );
}
