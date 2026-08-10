import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './routes/protected-route';
import { LoginPage } from './pages/login';
import { GoogleCallbackPage } from './pages/auth-google-callback';
import { AccountPage } from './pages/account';
import { BillingPage } from './pages/billing';
import { BillingSuccessPage, BillingCancelPage } from './pages/billing-result';
import { BoardApp } from './pages/board-app';
import { PrivacyPage, TermsPage } from './pages/legal';
import { SharedBoardPage } from './pages/shared-board';

export function App() {
  return (
    <Routes>
      {/* Entry point: the board straight away, with no login gate. */}
      <Route path="/" element={<BoardApp />} />

      {/* Auth (optional — only needed to save to the cloud). Single path:
          Google. There is no /register: the account is created on first login. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />

      {/* Board shared by link: public and read-only. The token in the URL is
          the credential — it neither requires nor uses a session. */}
      <Route path="/b/:token" element={<SharedBoardPage />} />

      {/* Legal pages: public and independent of anything in the board. They are
          required by Google's consent screen (privacy policy + terms). */}
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      {/* Portuguese aliases: the addresses already submitted to Google's OAuth
          form, kept working so the verification does not break. */}
      <Route path="/privacidade" element={<Navigate to="/privacy" replace />} />
      <Route path="/termos" element={<Navigate to="/terms" replace />} />

      {/* Account/billing pages (require login) */}
      <Route element={<ProtectedRoute />}>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/billing/success" element={<BillingSuccessPage />} />
        <Route path="/billing/cancel" element={<BillingCancelPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
