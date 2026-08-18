import { Link } from 'react-router-dom';
import { AuthCard } from '../components/ui';
import { GoogleButton } from '../components/google-button';

// Signing in is a navigation to Google — there is no form. The account is
// created on first access, so there is no signup screen either.
export function LoginPage() {
  return (
    <AuthCard title="Sign in">
      <p className="mb-4 text-sm text-gray-600">
        Use your Google account to sign in. On first access the account is created
        automatically.
      </p>
      <GoogleButton />
      <div className="mt-4 text-sm">
        <Link to="/" className="text-gray-600 hover:underline">
          Back to the board
        </Link>
      </div>
    </AuthCard>
  );
}
