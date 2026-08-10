import { describe, it, expect } from 'vitest';
import {
  ancestors,
  children,
  dropModeFor,
  isDescendant,
  itemKey,
  move,
  nextPosition,
  type BoardSummary,
} from './board-tree';
import type { BoardFolder, BoardMetaMap } from './board-meta';

const folder = (id: string, parentId: string | null, position: number): BoardFolder => ({
  id,
  name: id.toUpperCase(),
  parentId,
  position,
});

//  root
//  ├── f1 (folder)
//  │   └── b2
//  ├── b0
//  └── b1
const folders: BoardFolder[] = [folder('f1', null, 0)];
const boards: BoardSummary[] = [
  { id: 'b0', name: 'Alpha' },
  { id: 'b1', name: 'Beta' },
  { id: 'b2', name: 'Gamma' },
];
const meta: BoardMetaMap = {
  b0: { position: 1 },
  b1: { position: 2 },
  b2: { folderId: 'f1', position: 0 },
};

describe('children', () => {
  it('lists the direct contents of the root in position order', () => {
    expect(children(folders, boards, meta, null).map(itemKey)).toEqual([
      'folder:f1',
      'board:b0',
      'board:b1',
    ]);
  });

  it('lists the contents of a folder', () => {
    expect(children(folders, boards, meta, 'f1').map(itemKey)).toEqual(['board:b2']);
  });

  it('treats a missing folderId as the root', () => {
    const out = children([], [{ id: 'x', name: 'X' }], {}, null);
    expect(out.map(itemKey)).toEqual(['board:x']);
  });

  // Without a tie-break, freshly created items (all at position 0) would swap
  // places on every render.
  it('breaks position ties with folder before board and then by name', () => {
    const f = [folder('fa', null, 0)];
    const b = [
      { id: 'z', name: 'Zebra' },
      { id: 'a', name: 'Abacaxi' },
    ];
    const m: BoardMetaMap = { z: { position: 0 }, a: { position: 0 } };
    expect(children(f, b, m, null).map(itemKey)).toEqual(['folder:fa', 'board:a', 'board:z']);
  });
});

describe('isDescendant / ancestors', () => {
  const nested = [folder('f1', null, 0), folder('f2', 'f1', 0), folder('f3', 'f2', 0)];

  it('recognizes descendancy at any depth', () => {
    expect(isDescendant(nested, 'f3', 'f1')).toBe(true);
    expect(isDescendant(nested, 'f2', 'f1')).toBe(true);
    expect(isDescendant(nested, 'f1', 'f3')).toBe(false);
  });

  it('does not hang on a corrupted cycle', () => {
    const cycle = [folder('a', 'b', 0), folder('b', 'a', 0)];
    expect(isDescendant(cycle, 'a', 'zzz')).toBe(false);
  });

  it('lists ancestors from the parent up to the root', () => {
    expect(ancestors(nested, 'f3')).toEqual(['f2', 'f1']);
    expect(ancestors(nested, 'f1')).toEqual([]);
  });
});

describe('dropModeFor', () => {
  it('the central band of a folder means drop inside', () => {
    expect(dropModeFor({ kind: 'folder' }, 0.5)).toBe('inside');
    expect(dropModeFor({ kind: 'folder' }, 0.1)).toBe('before');
    expect(dropModeFor({ kind: 'folder' }, 0.9)).toBe('after');
  });

  it('a board never accepts a drop inside', () => {
    expect(dropModeFor({ kind: 'board' }, 0.5)).toBe('after');
    expect(dropModeFor({ kind: 'board' }, 0.2)).toBe('before');
  });
});

describe('move', () => {
  it('moves a board into a folder and reindexes both sides', () => {
    const r = move(folders, boards, meta, { kind: 'board', id: 'b0' }, 'f1', 1);
    // Destination: b2 (0) and b0 (1).
    expect(r.boards.b2).toEqual({ folderId: 'f1', position: 0 });
    expect(r.boards.b0).toEqual({ folderId: 'f1', position: 1 });
    // Source reindexed, with no hole where b0 used to be.
    expect(r.folders.f1).toEqual({ parentId: null, position: 0 });
    expect(r.boards.b1).toEqual({ folderId: null, position: 1 });
  });

  it('reorders inside the same container by adjusting the index', () => {
    // Move b0 (index 1) to the end of the root (index 3).
    const r = move(folders, boards, meta, { kind: 'board', id: 'b0' }, null, 3);
    expect(r.folders.f1).toEqual({ parentId: null, position: 0 });
    expect(r.boards.b1).toEqual({ folderId: null, position: 1 });
    expect(r.boards.b0).toEqual({ folderId: null, position: 2 });
  });

  it('moves a board from the folder to the root', () => {
    const r = move(folders, boards, meta, { kind: 'board', id: 'b2' }, null, 0);
    expect(r.boards.b2).toEqual({ folderId: null, position: 0 });
  });

  it('refuses to move a folder into itself', () => {
    const r = move(folders, boards, meta, { kind: 'folder', id: 'f1' }, 'f1', 0);
    expect(r.rejected).toBeTruthy();
    expect(r.boards).toEqual({});
  });

  it('refuses to move a folder into one of its descendants', () => {
    const nested = [folder('f1', null, 0), folder('f2', 'f1', 0)];
    const r = move(nested, [], {}, { kind: 'folder', id: 'f1' }, 'f2', 0);
    expect(r.rejected).toBeTruthy();
  });

  it('accepts moving a folder into another folder', () => {
    const two = [folder('f1', null, 0), folder('f2', null, 1)];
    const r = move(two, [], {}, { kind: 'folder', id: 'f2' }, 'f1', 0);
    expect(r.rejected).toBeUndefined();
    expect(r.folders.f2).toEqual({ parentId: 'f1', position: 0 });
  });

  it('an out-of-bounds index is clamped to the end', () => {
    // b2 comes from folder f1; the root already has 3 items (f1, b0, b1), so the
    // end is 3.
    const r = move(folders, boards, meta, { kind: 'board', id: 'b2' }, null, 99);
    expect(r.boards.b2?.position).toBe(3);
  });
});

describe('nextPosition', () => {
  it('returns the size of the container', () => {
    expect(nextPosition(folders, boards, meta, null)).toBe(3);
    expect(nextPosition(folders, boards, meta, 'f1')).toBe(1);
    expect(nextPosition(folders, boards, meta, 'inexistente')).toBe(0);
  });
});
