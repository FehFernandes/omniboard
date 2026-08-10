// Migration of embedded images (data URL) to the bucket.
//
// Boards created before upload existed keep the whole image in base64 INSIDE the
// snapshot. That travels on every workspace save and is what used to blow past
// the API body limit. The migration runs once per loaded board: it uploads each
// data URL and swaps the element's `src` for the short URL.
//
// Safety rules of the process:
//   - One image at a time, so it does not fire N simultaneous uploads.
//   - A failure on one does not block the others nor delete anything: the
//     element keeps its data URL and tries again next session.
//   - With no upload available (anonymous, server without a bucket), it does
//     nothing.
import type { BoardElement } from '@omniboard/react';
import { reportError } from '../telemetry/errors';

/** The minimum of the Board used here. */
export interface MigratableBoard {
  getElements(): BoardElement[];
  updateElement(id: string, patch: Partial<BoardElement>, opts?: { record?: boolean }): void;
}

export interface MigrationResult {
  /** How many images were embedded. */
  found: number;
  /** How many made it to the bucket. */
  migrated: number;
  /** Approximate bytes removed from the snapshot. */
  bytesFreed: number;
}

/** Is this an image data URL? (http/https is already out of the snapshot) */
export function isDataURL(src: unknown): src is string {
  return typeof src === 'string' && src.startsWith('data:');
}

/** Converts a data URL into a File, so it can be uploaded. */
export function dataURLToFile(dataURL: string, name: string): File | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataURL);
  if (!m) return null;
  const [, type, base64, data] = m;
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    if (base64) {
      const bin = atob(data);
      bytes = new Uint8Array(new ArrayBuffer(bin.length));
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(data));
    }
    const ext = type.split('/')[1]?.split('+')[0] || 'png';
    return new File([bytes], `${name}.${ext}`, { type: type });
  } catch (err) {
    reportError('migracao.dataURL', err);
    return null;
  }
}

/**
 * Uploads the embedded images of the current board and swaps `src` for the
 * public URL.
 *
 * `record: false` on the update: this is maintenance, not a user edit — it must
 * not become an undo step (nor hijack their Ctrl+Z).
 */
export async function migrateEmbeddedImages(
  board: MigratableBoard,
  send: (file: File) => Promise<string>,
): Promise<MigrationResult> {
  const embedded = board.getElements().filter(
    (el) => el.type === 'image' && isDataURL((el as { src?: unknown }).src),
  );
  const result: MigrationResult = {
    found: embedded.length,
    migrated: 0,
    bytesFreed: 0,
  };

  for (const el of embedded) {
    const src = (el as unknown as { src: string }).src;
    const file = dataURLToFile(src, `migrada-${el.id}`);
    if (!file) continue;
    try {
      const url = await send(file);
      if (!url) continue;
      board.updateElement(el.id, { src: url } as Partial<BoardElement>, { record: false });
      result.migrated += 1;
      result.bytesFreed += src.length;
    } catch (err) {
      // Storage is down: stop trying the rest in this session (they would all
      // fail).
      reportError('migracao.upload', err);
      break;
    }
  }
  return result;
}
