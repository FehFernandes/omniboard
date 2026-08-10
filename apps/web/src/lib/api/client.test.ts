import { describe, it, expect, vi } from 'vitest';
import { ApiClient, ApiError } from './client';
import { createMemoryTokenStore } from '../auth/token-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('sends Authorization and returns the data on success', async () => {
    const store = createMemoryTokenStore({ access: 'acc', refresh: 'ref' });
    const fetchFn = vi.fn(async (_url, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer acc');
      return json({ success: true, items: [1, 2] });
    });
    const client = new ApiClient({ baseUrl: 'http://x/api', store, fetchFn });
    const data = await client.get<{ items: number[] }>('/items');
    expect(data.items).toEqual([1, 2]);
  });

  it('refreshes on 401 (with rotation) and replays the request', async () => {
    const store = createMemoryTokenStore({ access: 'old', refresh: 'old-ref' });
    const fetchFn = vi.fn(async (url, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        return json({ success: true, access_token: 'new', refresh_token: 'new-ref' });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new'
        ? json({ success: true, items: [] })
        : json({ success: false, error: 'unauth' }, 401);
    });
    const client = new ApiClient({ baseUrl: 'http://x/api', store, fetchFn });

    const data = await client.get<{ items: unknown[] }>('/items');
    expect(data.items).toEqual([]);
    // Rotation: BOTH tokens were updated.
    expect(store.getAccess()).toBe('new');
    expect(store.getRefresh()).toBe('new-ref');
  });

  it('clears the session and calls onAuthError when the refresh fails', async () => {
    const store = createMemoryTokenStore({ access: 'old', refresh: 'bad' });
    const onAuthError = vi.fn();
    const fetchFn = vi.fn(async (url) => {
      if (String(url).endsWith('/auth/refresh')) return json({ success: false, error: 'nope' }, 401);
      return json({ success: false, error: 'unauth' }, 401);
    });
    const client = new ApiClient({ baseUrl: 'http://x/api', store, onAuthError, fetchFn });

    await expect(client.get('/items')).rejects.toBeInstanceOf(ApiError);
    expect(store.getAccess()).toBeNull();
    expect(onAuthError).toHaveBeenCalledOnce();
  });

  it('throws ApiError with the message from the error envelope', async () => {
    const store = createMemoryTokenStore({ access: 'acc', refresh: 'ref' });
    const fetchFn = vi.fn(async () => json({ success: false, error: 'Title is required' }, 400));
    const client = new ApiClient({ baseUrl: 'http://x/api', store, fetchFn });
    await expect(client.post('/items', {})).rejects.toMatchObject({
      status: 400,
      message: 'Title is required',
    });
  });

  it('single-flights: several concurrent 401s trigger ONE refresh', async () => {
    const store = createMemoryTokenStore({ access: 'old', refresh: 'old-ref' });
    let refreshCount = 0;
    const fetchFn = vi.fn(async (url, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshCount++;
        return json({ success: true, access_token: 'new', refresh_token: 'new-ref' });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new'
        ? json({ success: true, ok: true })
        : json({ success: false, error: 'unauth' }, 401);
    });
    const client = new ApiClient({ baseUrl: 'http://x/api', store, fetchFn });

    await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(refreshCount).toBe(1);
  });
});
