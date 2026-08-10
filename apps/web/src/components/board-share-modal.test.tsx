import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BoardShareModal } from './board-share-modal';
import { ApiClient } from '../lib/api/client';
import { createMemoryTokenStore } from '../lib/auth/token-store';
import { fetchPublicBoard, shareUrl } from '../lib/boards/share';

const store = createMemoryTokenStore({ access: 'tok', refresh: 'ref' });

const SHARE = {
  id: 's1',
  board_id: 'b1',
  board_name: 'Arquitetura',
  token: 'tok-public-long-enough-to-look-real-000',
  views: 0,
};

/** Client with responses programmed per route+method. */
function fakeClient(rotas: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url).replace('http://api.test', '')}`;
    calls.push(key);
    const body = rotas[key];
    if (body === undefined) {
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'no stub' }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ success: true, ...(body as object) }) } as Response;
  });
  const client = new ApiClient({
    baseUrl: 'http://api.test',
    store,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  return { client, calls };
}

function open(rotas: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const { client, calls } = fakeClient(rotas);
  const onClose = vi.fn();
  const onWarn = vi.fn();
  render(
    <BoardShareModal
      client={client}
      boardId="b1"
      boardName="Arquitetura"
      openId
      onClose={onClose}
      onWarn={onWarn}
      {...props}
    />,
  );
  return { calls, onClose, onWarn };
}

describe('share modal', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('closed, it renders nothing', () => {
    const { client } = fakeClient({});
    render(
      <BoardShareModal
        client={client}
        boardId="b1"
        boardName="X"
        openId={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with no link yet, it offers to create one and explains what happens', async () => {
    open({ 'GET /shares': { shares: [] } });

    await waitFor(() => expect(screen.getByRole('button', { name: /create read-only link/i })).toBeTruthy());
    // The warning is what decides whether the user should create it: it has to be
    // in the body.
    expect(document.body.textContent).toMatch(/without an account/i);
  });

  it('shows the link that already exists instead of creating another one', async () => {
    const { calls } = open({ 'GET /shares': { shares: [SHARE] } });

    const field = (await waitFor(() =>
      screen.getByLabelText('Board link'),
    )) as HTMLInputElement;
    expect(field.value).toBe(shareUrl(SHARE.token, window.location.origin));
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(0);
  });

  it('creating a link calls the API and starts showing the address', async () => {
    const { calls } = open({
      'GET /shares': { shares: [] },
      'POST /shares': { share: SHARE },
    });

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /create read-only link/i })));

    const field = (await waitFor(() =>
      screen.getByLabelText('Board link'),
    )) as HTMLInputElement;
    expect(field.value).toContain(SHARE.token);
    expect(calls).toContain('POST /shares');
  });

  it('copying puts the URL on the clipboard', async () => {
    open({ 'GET /shares': { shares: [SHARE] } });
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /copy link/i })));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        shareUrl(SHARE.token, window.location.origin),
      ),
    );
    expect(await waitFor(() => screen.getByText(/copied/i))).toBeTruthy();
  });

  it('a denied clipboard does not break it: it says to copy by hand', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) },
    });
    const { onWarn } = open({ 'GET /shares': { shares: [SHARE] } });

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /copy link/i })));
    await waitFor(() => expect(onWarn).toHaveBeenCalledWith(expect.stringMatching(/manualmente/i)));
    // The field stays available for manual selection.
    expect(screen.getByLabelText('Board link')).toBeTruthy();
  });

  // Sharing without a visible revoke is a trap.
  it('revoking disables the link and returns to the initial state', async () => {
    const { calls, onWarn } = open({
      'GET /shares': { shares: [SHARE] },
      'DELETE /shares/s1': {},
    });

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /desativar link/i })));

    await waitFor(() => expect(screen.getByRole('button', { name: /create read-only link/i })).toBeTruthy());
    expect(calls).toContain('DELETE /shares/s1');
    expect(onWarn).toHaveBeenCalledWith('Link desativado');
  });

  it('shows the access count', async () => {
    open({ 'GET /shares': { shares: [{ ...SHARE, views: 3 }] } });
    expect(await waitFor(() => screen.getByText(/3 views/i))).toBeTruthy();
  });

  it('a failure while querying does not leave the screen mute', async () => {
    open({});
    expect(await waitFor(() => screen.getByRole('alert'))).toBeTruthy();
  });

  it('Escape closes', async () => {
    const { onClose } = open({ 'GET /shares': { shares: [SHARE] } });
    await waitFor(() => screen.getByLabelText('Board link'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('a link from another board is not mistaken for this one', async () => {
    open({ 'GET /shares': { shares: [{ ...SHARE, board_id: 'other' }] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /create read-only link/i })).toBeTruthy());
  });
});

describe('URL and public read', () => {
  it('builds the URL with the current domain', () => {
    expect(shareUrl('abc', 'https://app.example.com')).toBe('https://app.example.com/b/abc');
  });

  it('a 404 turns into a revoked-link message', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);
    await expect(
      fetchPublicBoard('t', 'http://api.test', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/no longer exists|revoked/i);
  });

  it('returns name and snapshot when the link is valid', async () => {
    const fetchFn = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ board: { name: 'Arq', snapshot: { type: 'openboard' } } }),
        }) as Response,
    );
    const b = await fetchPublicBoard('t', 'http://api.test/', fetchFn as unknown as typeof fetch);
    expect(b.name).toBe('Arq');
    // No double slash even with a base ending in "/".
    expect(String(fetchFn.mock.calls[0][0])).toBe('http://api.test/public/shares/t');
  });

  // The route is anonymous: sending Authorization here would only risk leaking
  // the session.
  it('does not send an authentication header', async () => {
    const fetchFn = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        ({ ok: true, status: 200, json: async () => ({ board: { name: 'x', snapshot: {} } }) }) as Response,
    );
    await fetchPublicBoard('t', 'http://api.test', fetchFn as unknown as typeof fetch);
    expect(fetchFn.mock.calls[0][1]).toBeUndefined();
  });

  it('a response without a snapshot is an explicit error', async () => {
    const fetchFn = vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ board: { name: 'x' } }) }) as Response,
    );
    await expect(
      fetchPublicBoard('t', 'http://api.test', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow(/empty|unavailable/i);
  });
});
