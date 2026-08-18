import { describe, it, expect, vi } from 'vitest';
import {
  dataURLToFile,
  isDataURL,
  migrateEmbeddedImages,
  type MigratableBoard,
} from './migrate-embedded';
import type { BoardElement } from '@omniboard/react';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAX+aYogAAAABJRU5ErkJggg==';
const DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

function image(id: string, src: string): BoardElement {
  return {
    id, type: 'image', src,
    x: 0, y: 0, width: 100, height: 100, angle: 0, version: 1,
    strokeColor: '#000', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 1, opacity: 1,
  } as unknown as BoardElement;
}

function fakeBoard(elementos: BoardElement[]) {
  const map = new Map(elementos.map((e) => [e.id, { ...e }]));
  const updates: { id: string; src?: string; record?: boolean }[] = [];
  const board: MigratableBoard = {
    getElements: () => [...map.values()],
    updateElement: (id, patch, opts) => {
      const current = map.get(id);
      if (current) map.set(id, { ...current, ...patch } as BoardElement);
      updates.push({ id, src: (patch as { src?: string }).src, record: opts?.record });
    },
  };
  return {
    board,
    updates,
    read: (id: string) => map.get(id) as unknown as { src: string },
  };
}

describe('embedded image migration', () => {
  it('recognizes a data URL and ignores a storage URL', () => {
    expect(isDataURL(DATA_URL)).toBe(true);
    expect(isDataURL('https://cdn.test/a.png')).toBe(false);
    expect(isDataURL(undefined)).toBe(false);
  });

  it('converts a data URL into a File with the right type and extension', () => {
    const f = dataURLToFile(DATA_URL, 'x')!;
    expect(f).toBeInstanceOf(File);
    expect(f.type).toBe('image/png');
    expect(f.name).toBe('x.png');
    expect(f.size).toBe(70); // the 1x1 PNG is 70 bytes
  });

  it('a malformed data URL does not blow up', () => {
    expect(dataURLToFile('not a data url', 'x')).toBeNull();
    expect(dataURLToFile('data:image/png;base64,%%%', 'x')).toBeNull();
  });

  it('uploads the embedded ones and swaps src for the URL, without polluting undo', async () => {
    const { board, updates, read } = fakeBoard([
      image('i1', DATA_URL),
      image('i2', 'https://cdn.test/ja-migrada.png'),
      image('i3', DATA_URL),
    ]);
    const send = vi
      .fn<(f: File) => Promise<string>>()
      .mockResolvedValueOnce('https://cdn.test/1.png')
      .mockResolvedValueOnce('https://cdn.test/3.png');

    const r = await migrateEmbeddedImages(board, send);

    expect(r.found).toBe(2);
    expect(r.migrated).toBe(2);
    expect(r.bytesFreed).toBeGreaterThan(100);
    expect(read('i1').src).toBe('https://cdn.test/1.png');
    expect(read('i3').src).toBe('https://cdn.test/3.png');
    // The one already in storage was not touched.
    expect(read('i2').src).toBe('https://cdn.test/ja-migrada.png');
    // Maintenance must not become a user-visible undo step.
    expect(updates.every((u) => u.record === false)).toBe(true);
  });

  it('one upload at a time (does not fire N requests at once)', async () => {
    const { board } = fakeBoard([image('i1', DATA_URL), image('i2', DATA_URL)]);
    let inFlight = 0;
    let maxConcurrent = 0;
    const send = async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return 'https://cdn.test/x.png';
    };

    await migrateEmbeddedImages(board, send);
    expect(maxConcurrent).toBe(1);
  });

  // Storage being down must not cost the image: it stays as it was.
  it('an upload failure neither deletes nor corrupts the element', async () => {
    const { board, read } = fakeBoard([image('i1', DATA_URL)]);
    const r = await migrateEmbeddedImages(board, async () => {
      throw new Error('bucket fora');
    });

    expect(r.migrated).toBe(0);
    expect(read('i1').src).toBe(DATA_URL);
  });

  it('stops trying after the first storage failure', async () => {
    const { board } = fakeBoard([image('i1', DATA_URL), image('i2', DATA_URL)]);
    const send = vi.fn(async () => {
      throw new Error('offline');
    });

    await migrateEmbeddedImages(board, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a board with no embedded image makes no request', async () => {
    const { board } = fakeBoard([image('i1', 'https://cdn.test/a.png')]);
    const send = vi.fn(async () => 'x');
    const r = await migrateEmbeddedImages(board, send);
    expect(send).not.toHaveBeenCalled();
    expect(r).toEqual({ found: 0, migrated: 0, bytesFreed: 0 });
  });
});
