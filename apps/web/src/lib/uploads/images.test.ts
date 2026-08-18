import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createImageUploader, fetchUploadLimits, UploadError, formatSize } from './images';
import { ApiClient, ApiError } from '../api/client';
import { createMemoryTokenStore } from '../auth/token-store';

const store = createMemoryTokenStore({ access: 'tok', refresh: 'ref' });

/** Client with a controlled fetch: the 1st call is the API, the 2nd is the bucket PUT. */
function setup(replies: Array<Partial<Response> & { json?: () => Promise<unknown> }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = replies.shift() ?? { ok: true, status: 200, json: async () => ({}) };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: r.json ?? (async () => ({})),
    } as Response;
  });
  const client = new ApiClient({
    baseUrl: 'http://api.test',
    store,
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  // The bucket PUT uses the same double (the uploader accepts an injected fetchFn).
  const send = createImageUploader(client, { fetchFn: fetchFn as unknown as typeof fetch });
  return { client, calls, fetchFn, send };
}

const presignOK = {
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    upload: {
      upload_url: 'https://bucket.test/omniboard/u/1/abc.png?X-Amz-Signature=deadbeef',
      public_url: 'https://cdn.test/u/1/abc.png',
      key: 'u/1/abc.png',
      content_type: 'image/png',
      expires_in: 300,
      max_bytes: 10485760,
    },
  }),
};

const file = (name = 'foto.png', type = 'image/png', bytes = 1234) =>
  new File([new Uint8Array(bytes)], name, { type: type });

describe('image upload', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('signs on the API and sends the binary straight to the bucket', async () => {
    const { calls, send } = setup([presignOK, { ok: true, status: 200 }]);

    const url = await send(file());

    expect(url).toBe('https://cdn.test/u/1/abc.png');
    expect(calls).toHaveLength(2);

    // 1) presign on the API, with metadata (not the file).
    expect(calls[0].url).toBe('http://api.test/uploads/images');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ filename: 'foto.png', content_type: 'image/png', size: 1234 });

    // 2) PUT into the bucket with the content-type IDENTICAL to the signed one
    // (it is part of the signature; diverging gives a 403).
    expect(calls[1].url).toContain('https://bucket.test/');
    expect(calls[1].init?.method).toBe('PUT');
    expect((calls[1].init?.headers as Record<string, string>)['Content-Type']).toBe('image/png');
    expect(calls[1].init?.body).toBeInstanceOf(File);
  });

  it('the file is never sent to the API', async () => {
    const { calls, send } = setup([presignOK, { ok: true, status: 200 }]);
    await send(file('x.png', 'image/png', 5_000_000));
    // The body of the API call is small JSON, not the binary.
    expect(String(calls[0].init?.body).length).toBeLessThan(200);
    expect(calls[0].init?.body).not.toBeInstanceOf(File);
  });

  it('a 501 from the server marks upload as unavailable (board embeds instead)', async () => {
    const { send } = setup([
      { ok: false, status: 501, json: async () => ({ success: false, error: 'Uploads are not configured' }) },
    ]);
    await expect(send(file())).rejects.toMatchObject({
      name: 'UploadError',
      unavailable: true,
    });
  });

  it('a 413 turns into a message carrying the file size', async () => {
    const { send } = setup([
      { ok: false, status: 413, json: async () => ({ success: false, error: 'grande' }) },
    ]);
    const error = await send(file('g.png', 'image/png', 12 * 1024 * 1024))
      .catch((e) => e as UploadError);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).message).toContain('12,0 MB');
    expect((error as UploadError).unavailable).toBe(false);
  });

  it('a 415 warns about an unsupported format', async () => {
    const { send } = setup([
      { ok: false, status: 415, json: async () => ({ success: false, error: 'tipo' }) },
    ]);
    await expect(send(file('a.svg', 'image/svg+xml'))).rejects.toThrow(
      /not supported|Unsupported/i,
    );
  });

  it('the bucket refusing the PUT does not pass as success', async () => {
    const { send } = setup([presignOK, { ok: false, status: 403 }]);
    await expect(send(file())).rejects.toThrow(/recusou o envio \(403\)/);
  });

  it('an incomplete presign response is an error, not a bad URL in the board', async () => {
    const { send } = setup([
      { ok: true, status: 200, json: async () => ({ success: true, upload: { key: 'x' } }) },
    ]);
    await expect(send(file())).rejects.toThrow(/Invalid/i);
  });

  it('consultarLimites degrades to disabled when the API fails', async () => {
    const { client } = setup([
      { ok: false, status: 500, json: async () => ({ success: false, error: 'x' }) },
    ]);
    const limits = await fetchUploadLimits(client);
    expect(limits.enabled).toBe(false);
  });

  it('consultarLimites returns what the API reports', async () => {
    const { client } = setup([
      {
        ok: true,
        status: 200,
        json: async () => ({ success: true, enabled: true, max_bytes: 2048, types: ['image/png'] }),
      },
    ]);
    const limits = await fetchUploadLimits(client);
    expect(limits).toEqual({ enabled: true, maxBytes: 2048, types: ['image/png'] });
  });

  it('formats sizes in a readable way', () => {
    expect(formatSize(500)).toBe('1 KB');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5,0 MB');
  });

  it('a network ApiError does not leak raw to the UI', async () => {
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      store,
      fetchFn: (() => Promise.reject(new ApiError(0, 'boom'))) as unknown as typeof fetch,
    });
    await expect(createImageUploader(client)(file())).rejects.toBeInstanceOf(UploadError);
  });
});
