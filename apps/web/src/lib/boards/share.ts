// Board sharing through a read-only link.
//
// The token is the credential: whoever has the address sees the board, with no
// account. That is why the UI text says so plainly and revocation is one click
// away — a sharing feature without a visible revoke is a trap.
import type { ApiClient } from '../api/client';

export interface Share {
  id: string;
  board_id: string;
  board_name: string;
  token: string;
  views: number;
  last_view_at?: string;
}

/** Board received through the public route (name and snapshot only). */
export interface SharedBoard {
  name: string;
  snapshot: unknown;
}

/** URL the user copies. Built on the client so it honors the current domain. */
export function shareUrl(token: string, origem = window.location.origin): string {
  return `${origem}/b/${token}`;
}

/** Creates (or reuses) the board's link. */
export async function createShare(
  client: ApiClient,
  boardId: string,
  boardName: string,
): Promise<Share> {
  const r = await client.post<{ share: Share }>('/shares', {
    board_id: boardId,
    board_name: boardName,
  });
  return r.share;
}

/** The user's active links. */
export async function listShares(client: ApiClient): Promise<Share[]> {
  const r = await client.get<{ shares: Share[] | null }>('/shares');
  return r.shares ?? [];
}

/** Turns the link off. The address stops answering immediately. */
export async function revokeShare(client: ApiClient, id: string): Promise<void> {
  await client.delete(`/shares/${id}`);
}

/**
 * Fetches the public board. It does not use the ApiClient because this route is
 * anonymous: sending Authorization here would only risk leaking the session
 * token of whoever opened the link.
 */
export async function fetchPublicBoard(
  token: string,
  baseUrl: string,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<SharedBoard> {
  const res = await fetchFn(`${baseUrl.replace(/\/$/, '')}/public/shares/${encodeURIComponent(token)}`);
  if (res.status === 404) {
    throw new Error('This link no longer exists or was revoked.');
  }
  if (!res.ok) {
    throw new Error('Could not load this board.');
  }
  const body = (await res.json()) as { board?: SharedBoard };
  if (!body?.board?.snapshot) {
    throw new Error('This board is empty or unavailable.');
  }
  return body.board;
}
