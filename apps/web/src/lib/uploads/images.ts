// Image upload to the bucket (Cloudflare R2), in two steps.
//
// 1. The API signs a PUT URL (it never sees the file).
// 2. The browser sends the binary straight to the bucket.
//
// Why not send the file to the API: the board snapshot is saved whole on every
// change, and an image embedded as a data URL grows ~33% in base64 and rides
// along on EVERY save. Two photos and the workspace PUT goes past the API body
// limit — a failure the user does not see and that costs them their work. With
// the bucket, the board keeps only a short, stable URL.
import type { ApiClient } from '../api/client';

export interface UploadLimits {
  enabled: boolean;
  maxBytes: number;
  types: string[];
}

interface PresignResponse {
  upload: {
    upload_url: string;
    public_url: string;
    key: string;
    content_type: string;
    expires_in: number;
    max_bytes: number;
  };
}

/** Upload error carrying a message ready for the UI. */
export class UploadError extends Error {
  /** true when the server has no bucket: the board embeds the image instead. */
  readonly unavailable: boolean;

  constructor(message: string, unavailable = false) {
    super(message);
    this.name = 'UploadError';
    this.unavailable = unavailable;
  }
}

const MB = 1024 * 1024;

/** Formats bytes for an error message ("4,2 MB"). */
export function formatSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Creates the uploader the Board uses on paste/drag/file-pick.
 *
 * Rejects with {@link UploadError} — the Board then embeds the image and emits
 * `imageUploadError`, so the UI can warn without losing what the user pasted.
 *
 * `fetchFn` is injectable for tests (same convention as the ApiClient); the PUT
 * goes straight to the bucket and does not go through the API client.
 */
export function createImageUploader(
  client: ApiClient,
  opts: { fetchFn?: typeof fetch } = {},
) {
  const send = opts.fetchFn ?? globalThis.fetch.bind(globalThis);

  return async function sendImage(file: File): Promise<string> {
    const r = await client
      .post<PresignResponse>('/uploads/images', {
        filename: file.name || 'image',
        content_type: file.type || 'application/octet-stream',
        size: file.size,
      })
      .catch((err: unknown) => {
        const status = (err as { status?: number })?.status;
        // 501: server without a configured bucket. 413/415: file refused.
        if (status === 501) throw new UploadError('Uploads are not configured on the server', true);
        if (status === 413) throw new UploadError(`Image too large (${formatSize(file.size)})`);
        if (status === 415) throw new UploadError('Unsupported image format');
        throw new UploadError('Could not prepare the upload');
      });

    const up = r?.upload;
    if (!up?.upload_url || !up?.public_url) {
      throw new UploadError('Invalid upload response');
    }

    // PUT straight into the bucket. The content-type has to be IDENTICAL to the
    // signed one, otherwise the signature does not match (it is part of
    // SignedHeaders).
    const res = await send(up.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': up.content_type },
      body: file,
    }).catch(() => {
      throw new UploadError('Network failure while uploading the image');
    });

    if (!res.ok) {
      throw new UploadError(`O bucket recusou o envio (${res.status})`);
    }
    return up.public_url;
  };
}

/** Checks whether upload is available and under which limits. */
export async function fetchUploadLimits(client: ApiClient): Promise<UploadLimits> {
  try {
    const r = await client.get<{ enabled: boolean; max_bytes: number; types: string[] }>(
      '/uploads/limits',
    );
    return { enabled: !!r?.enabled, maxBytes: r?.max_bytes ?? 10 * MB, types: r?.types ?? [] };
  } catch {
    return { enabled: false, maxBytes: 10 * MB, types: [] };
  }
}
