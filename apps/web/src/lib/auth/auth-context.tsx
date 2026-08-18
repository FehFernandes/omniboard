import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClient } from '../api/client';
import { API_URL } from '../api/config';
import { createLocalTokenStore } from './token-store';
import type { AuthResponse, MeResponse, User } from '../api/types';
import type { UpdateProfileInput } from './schemas';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: Status;
  user: User | null;
  client: ApiClient;
  // The only way in: exchanges the opaque code returned by Google's callback
  // for the application's token pair. `totpCode` is only needed if the account
  // has 2FA enabled — the backend signals that with two_factor_required in the
  // body of the 401 error.
  loginWithGoogle: (code: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshMe: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const queryClient = useQueryClient();

  // store and client are stable for the whole lifetime of the provider.
  const store = useRef(createLocalTokenStore('app')).current;
  const client = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_URL,
        store,
        onAuthError: () => {
          queryClient.clear(); // drop cached data from the previous user
          setStatus('unauthenticated');
          setUser(null);
        },
      }),
    [store, queryClient],
  );

  const applyAuth = (data: AuthResponse) => {
    store.set({ access: data.access_token, refresh: data.refresh_token });
    setUser(data.user);
    setStatus('authenticated');
  };

  const refreshMe = async () => {
    const me = await client.get<MeResponse>('/auth/me');
    setUser(me.user);
    setStatus('authenticated');
  };

  // Hydrates the session on mount, if there is a stored token.
  useEffect(() => {
    if (!store.getAccess()) {
      setStatus('unauthenticated');
      return;
    }
    refreshMe().catch(() => {
      store.clear();
      setStatus('unauthenticated');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishLogout = () => {
    store.clear();
    queryClient.clear(); // drop cached data when the session ends
    setUser(null);
    setStatus('unauthenticated');
  };

  const loginWithGoogle = async (code: string, totpCode?: string) => {
    applyAuth(
      await client.post<AuthResponse>('/auth/google/exchange', {
        code,
        totp_code: totpCode ?? '',
      }),
    );
  };
  const logout = async () => {
    await client.post('/auth/logout').catch(() => undefined);
    finishLogout();
  };
  const logoutAll = async () => {
    await client.post('/auth/logout-all').catch(() => undefined);
    finishLogout();
  };
  const updateProfile = async (input: UpdateProfileInput) => {
    const res = await client.put<MeResponse>('/auth/me', input);
    setUser(res.user);
  };

  const value: AuthContextValue = {
    status,
    user,
    client,
    loginWithGoogle,
    logout,
    logoutAll,
    refreshMe,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// useAuth exposes the authentication context. Throws outside AuthProvider.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth has to be used inside <AuthProvider>');
  return ctx;
}
