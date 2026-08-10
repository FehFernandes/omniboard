import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth/auth-context';

// Guard: only lets authenticated users through; otherwise sends to /login.
export function ProtectedRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <div className="p-8 text-gray-500">Loading…</div>;
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}
