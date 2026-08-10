import { describe, it, expect, vi } from 'vitest';
import {
  BoardMetaStore,
  pruneMeta,
  unwrapWorkspace,
  wrapWorkspace,
  type BoardMetaMap,
} from './board-meta';

const snapshot = { type: 'openboard-workspace', version: 1, activeId: 'a', documents: [] };

describe('workspace envelope', () => {
  it('wraps and unwraps preserving snapshot and metadata', () => {
    const meta: BoardMetaMap = { a: { starred: true, updatedAt: 10 } };
    const out = unwrapWorkspace(wrapWorkspace(snapshot, meta));
    expect(out.workspace).toEqual(snapshot);
    expect(out.meta).toEqual(meta);
  });

  // Backwards compatibility: whoever already had saved boards wrote the raw
  // snapshot.
  it('accepts a raw snapshot saved before the envelope existed', () => {
    const out = unwrapWorkspace(snapshot);
    expect(out.workspace).toEqual(snapshot);
    expect(out.meta).toEqual({});
  });

  it('tolerates empty or corrupted storage', () => {
    const empty = { workspace: null, meta: {}, folders: [], comments: {} };
    expect(unwrapWorkspace(null)).toEqual(empty);
    expect(unwrapWorkspace(undefined)).toEqual(empty);
    // An envelope without valid meta/folders/comments must not blow up.
    const out = unwrapWorkspace({ type: 'omniboard-workspace-envelope', version: 1, workspace: snapshot });
    expect(out.meta).toEqual({});
    expect(out.folders).toEqual([]);
    expect(out.comments).toEqual({});
  });

  // Comments travel in the same envelope: losing them here means losing them on
  // reload.
  it('preserves comments across the wrap/unwrap cycle', () => {
    const comments = { b1: [{ id: 'c1', x: 1, y: 2, text: 'oi', author: 'Ana', createdAt: 5 }] };
    const out = unwrapWorkspace(wrapWorkspace(snapshot, {}, [], comments));
    expect(out.comments).toEqual(comments);
  });
});

describe('pruneMeta', () => {
  it('drops metadata for boards that no longer exist', () => {
    const meta: BoardMetaMap = { a: { starred: true }, b: { starred: false } };
    expect(pruneMeta(meta, ['a'])).toEqual({ a: { starred: true } });
  });
});

describe('BoardMetaStore', () => {
  it('toggles starred and notifies', () => {
    const store = new BoardMetaStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.toggleStarred('a')).toBe(true);
    expect(store.get('a').starred).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(store.toggleStarred('a')).toBe(false);
    expect(store.get('a').starred).toBe(false);
  });

  it('touch records the instant of the change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    const store = new BoardMetaStore();
    store.touch('a');
    expect(store.get('a').updatedAt).toBe(Date.parse('2026-01-02T03:04:05Z'));
    vi.useRealTimers();
  });

  it('patch preserves fields that already exist', () => {
    const store = new BoardMetaStore({ a: { starred: true } });
    store.patch('a', { updatedAt: 7 });
    expect(store.get('a')).toEqual({ starred: true, updatedAt: 7 });
  });

  it('replace does not notify by default (avoids a save loop on load)', () => {
    const store = new BoardMetaStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.replace({ a: { starred: true } });
    expect(listener).not.toHaveBeenCalled();
    expect(store.get('a').starred).toBe(true);
  });

  it('prune only notifies when something is removed', () => {
    const store = new BoardMetaStore({ a: {}, b: {} });
    const listener = vi.fn();
    store.subscribe(listener);

    store.prune(['a', 'b']);
    expect(listener).not.toHaveBeenCalled();

    store.prune(['a']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.all())).toEqual(['a']);
  });

  it('unsubscribe stops the notifications', () => {
    const store = new BoardMetaStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();
    store.touch('a');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('BoardMetaStore — folders', () => {
  it('creates, renames and toggles expansion', () => {
    const store = new BoardMetaStore();
    const f = store.createFolder('Estudos', null, 0);
    expect(store.folders()).toHaveLength(1);
    expect(f.expanded).toBe(true);

    store.renameFolder(f.id, 'Arquitetura');
    expect(store.folders()[0].name).toBe('Arquitetura');

    store.toggleFolder(f.id);
    expect(store.folders()[0].expanded).toBe(false);
  });

  // Deleting a folder is organization, not destruction: the contents move up to
  // the parent.
  it('deleting a folder promotes its contents to the parent, without deleting boards', () => {
    const store = new BoardMetaStore();
    const parent = store.createFolder('Pai', null, 0);
    const child = store.createFolder('Filha', parent.id, 0);
    store.patch('b1', { folderId: child.id, position: 0 });

    store.deleteFolder(child.id);

    expect(store.folders().map((f) => f.id)).toEqual([parent.id]);
    expect(store.get('b1').folderId).toBe(parent.id);
  });

  it('deleting a folder at the root promotes its contents to the root', () => {
    const store = new BoardMetaStore();
    const f = store.createFolder('Solta', null, 0);
    store.patch('b1', { folderId: f.id });

    store.deleteFolder(f.id);

    expect(store.folders()).toHaveLength(0);
    expect(store.get('b1').folderId).toBeNull();
  });

  it('patchMany applies everything in a single notification', () => {
    const store = new BoardMetaStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.patchMany({ a: { position: 0 }, b: { position: 1 } });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get('a').position).toBe(0);
    expect(store.get('b').position).toBe(1);
  });

  it('patchFolders updates parent and position', () => {
    const store = new BoardMetaStore();
    const a = store.createFolder('A', null, 0);
    const b = store.createFolder('B', null, 1);

    store.patchFolders({ [b.id]: { parentId: a.id, position: 0 } });

    const updated = store.folders().find((f) => f.id === b.id);
    expect(updated?.parentId).toBe(a.id);
    expect(updated?.position).toBe(0);
  });

  it('replace loads folders from storage without notifying', () => {
    const store = new BoardMetaStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.replace({}, [{ id: 'f1', name: 'F1', parentId: null, position: 0 }]);
    expect(store.folders()).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
