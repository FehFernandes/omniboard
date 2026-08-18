import type { ApiErrorBody } from './types';
import type { TokenStore } from '../auth/token-store';

// Error thrown when the API answers with success=false or a non-2xx status.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // Raw body of the error response. Some endpoints add flags the UI needs to
    // inspect — e.g. two_factor_required on login, which asks for the second
    // step instead of being a final error.
    public body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  store: TokenStore;
  // Called when the session can no longer be renewed (refresh failed).
  onAuthError?: () => void;
  // Injectable for tests; defaults to the global fetch.
  fetchFn?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// ApiClient wraps the response envelope, the auth header and the automatic
// refresh on 401 (with refresh token rotation and single-flight).
export class ApiClient {
  private readonly baseUrl: string;
  private readonly store: TokenStore;
  private readonly onAuthError?: () => void;
  private readonly fetchFn: typeof fetch;
  // Keeps a single refresh in flight even with several concurrent 401s.
  private refreshing: Promise<boolean> | null = null;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.store = opts.store;
    this.onAuthError = opts.onAuthError;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async request<T>(method: Method, path: string, body?: unknown, retry = true): Promise<T> {
    const res = await this.rawFetch(method, path, body);

    // 401: try to renew the session ONCE and replay the original request.
    if (res.status === 401 && retry && path !== '/auth/refresh') {
      const ok = await this.tryRefresh();
      if (ok) return this.request<T>(method, path, body, false);
      this.store.clear();
      this.onAuthError?.();
    }

    const data = (await res.json().catch(() => null)) as (T & { success?: boolean }) | ApiErrorBody | null;
    if (data && (data as ApiErrorBody).success === false) {
      throw new ApiError(res.status, (data as ApiErrorBody).error, data as Record<string, unknown>);
    }
    if (!res.ok || !data) {
      throw new ApiError(res.status, `Request failed (${res.status})`);
    }
    return data as T;
  }

  private rawFetch(method: Method, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const access = this.store.getAccess();
    if (access) headers.Authorization = `Bearer ${access}`;
    return this.fetchFn(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // single-flight: funnels concurrent refreshes into a single call.
  private tryRefresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refresh = this.store.getRefresh();
    if (!refresh) return false;
    const res = await this.fetchFn(this.baseUrl + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const data = (await res.json().catch(() => null)) as
      | { success: true; access_token: string; refresh_token: string }
      | null;
    if (!res.ok || !data || data.success !== true) return false;
    // Rotation: the backend returns a new refresh token; we store both.
    this.store.set({ access: data.access_token, refresh: data.refresh_token });
    return true;
  }
}
