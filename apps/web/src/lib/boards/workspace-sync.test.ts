import { describe, it, expect, vi } from 'vitest';
import {
  VersionConflict,
  syncWorkspace,
  type EnvelopeStorage,
  type SaveState,
  type EnvelopeRead,
  type ManagerLike,
} from './workspace-sync';
import { BoardMetaStore } from './board-meta';
import { CommentStore } from './comments';

/**
 * BoardManager double with the behavior that matters here: the constructor
 * creates a document of its own and `loadJSON` replaces everything with other
 * ids.
 */
function fakeManager(initialId = 'novo-1') {
  const listeners = new Map<string, Set<(e: never) => void>>();
  let docs = [{ id: initialId, name: 'Board 1' }];
  let activeId = initialId;
  const emit = (type: string) => {
    listeners
      .get(type)
      ?.forEach((l) => (l as (e: unknown) => void)({ type, documents: [...docs], activeId }));
  };

  const manager = {
    toJSON: () => ({ type: 'openboard-workspace', version: 1, activeId, documents: [...docs] }),
    loadJSON(data: never) {
      const ws = data as unknown as { activeId: string; documents: { id: string; name: string }[] };
      docs = ws.documents.map((d) => ({ id: d.id, name: d.name }));
      activeId = ws.activeId;
      emit('documentsChange');
      emit('activeChange');
    },
    list: () => [...docs],
    getActiveId: () => activeId,
    on(type: 'documentsChange' | 'activeChange', listener: (e: never) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      return () => listeners.get(type)!.delete(listener);
    },
    board: {
      on(_type: 'change', listener: () => void) {
        if (!listeners.has('change')) listeners.set('change', new Set());
        listeners.get('change')!.add(listener as never);
        return () => listeners.get('change')!.delete(listener as never);
      },
    },
    /** Simulates an edit on the canvas. */
    edit: () => emit('change'),
  };
  return manager as ManagerLike & { edit: () => void };
}

/** In-memory storage, with programmable failures. */
function memory(initial: unknown = null, opts: { atraso?: boolean; version?: number } = {}) {
  const state = {
    value: initial,
    gravacoes: 0,
    version: opts.version ?? 1,
    /** Number of failures to simulate on the next writes. */
    falhar: 0,
    /** Error to throw (default: a network error). */
    error: undefined as unknown,
  };
  const storage: EnvelopeStorage = {
    read: () => {
      const read: EnvelopeRead = { envelope: state.value, version: state.version };
      return opts.atraso ? Promise.resolve(read) : read;
    },
    write(envelope) {
      if (state.falhar > 0) {
        state.falhar -= 1;
        throw state.error ?? new Error('rede caiu');
      }
      state.gravacoes += 1;
      state.version += 1;
      state.value = JSON.parse(JSON.stringify(envelope));
      return { version: state.version };
    },
  };
  return { storage, state };
}

function envelopeWith(boardId: string, comments: Record<string, unknown[]> = {}) {
  return {
    type: 'omniboard-workspace-envelope',
    version: 1,
    workspace: {
      type: 'openboard-workspace',
      version: 1,
      activeId: boardId,
      documents: [
        { id: boardId, name: 'Board 1', snapshot: { type: 'openboard', version: 1, elements: [] } },
      ],
    },
    meta: {},
    folders: [],
    comments,
  };
}

/** Saved envelope, typed just enough for the assertions. */
interface SavedEnvelope {
  comments: Record<string, { text: string }[]>;
}
const savedEnvelope = (v: unknown) => v as SavedEnvelope;

const comment = (id: string, text: string) => ({
  id,
  x: 10,
  y: 20,
  text,
  author: 'Ana',
  createdAt: 1,
});

/** Builds the sync with real stores and the given storage. */
function mount(
  storage: EnvelopeStorage,
  extra: Partial<Parameters<typeof syncWorkspace>[0]> = {},
  initialId = 'b1',
) {
  const manager = fakeManager(initialId);
  const commentStore = new CommentStore();
  const states: SaveState[] = [];
  const sync = syncWorkspace({
    manager,
    metaStore: new BoardMetaStore(),
    commentStore,
    storage,
    debounceMs: 0,
    onState: (e) => states.push(e),
    onError: () => {},
    ...extra,
  });
  return { manager, commentStore, sync, states };
}

describe('syncWorkspace', () => {
  it('saves comments into the envelope', async () => {
    const { storage, state } = memory(envelopeWith('b1'));
    const { commentStore, sync } = mount(storage);
    await sync.ready;

    commentStore.add('b1', { x: 1, y: 2, text: 'revisar', author: 'Ana' });
    await sync.flush();

    const saved = savedEnvelope(state.value);
    expect(saved.comments.b1).toHaveLength(1);
    expect(saved.comments.b1[0].text).toBe('revisar');
    sync.detach();
  });

  it('restores saved comments on load', async () => {
    const { storage } = memory(envelopeWith('b1', { b1: [comment('c1', 'old')] }));
    const { manager, commentStore, sync } = mount(storage, {}, 'novo-1');
    await sync.ready;

    expect(manager.getActiveId()).toBe('b1');
    expect(commentStore.list('b1')).toHaveLength(1);
    sync.detach();
  });

  // Regression: the board created by the constructor is replaced by the saved
  // snapshot. Commenting in that window (the cloud takes one request) used to
  // take the comment along with the discarded board, via prune.
  it('preserves a comment created before the load, reanchoring it on the active board', async () => {
    const { storage, state } = memory(envelopeWith('b1', { b1: [comment('c1', 'old')] }), {
      atraso: true,
    });
    const { commentStore, sync } = mount(storage, {}, 'descartavel');

    commentStore.add('descartavel', { x: 5, y: 5, text: 'durante o load', author: 'Ana' });
    await sync.ready;

    const texts = commentStore.list('b1').map((c) => c.text);
    expect(texts).toContain('durante o load');
    expect(texts).toContain('old');
    expect(commentStore.list('descartavel')).toHaveLength(0);
    expect(savedEnvelope(state.value).comments.b1).toHaveLength(2);
    sync.detach();
  });

  it('saves nothing before the load finishes (does not overwrite what is stored)', async () => {
    const { storage, state } = memory(envelopeWith('b1'), { atraso: true });
    const { manager, commentStore, sync } = mount(storage, {}, 'descartavel');

    manager.edit();
    commentStore.add('descartavel', { x: 0, y: 0, text: 'x', author: 'Ana' });
    expect(state.gravacoes).toBe(0);

    await sync.ready;
    expect(state.gravacoes).toBeGreaterThan(0);
    sync.detach();
  });

  it('flush writes what was sitting in the debounce', async () => {
    const { storage, state } = memory(envelopeWith('b1'));
    const { commentStore, sync } = mount(storage, { debounceMs: 5000 });
    await sync.ready;
    const before = state.gravacoes;

    commentStore.add('b1', { x: 0, y: 0, text: 'without waiting', author: 'Ana' });
    expect(state.gravacoes).toBe(before);

    await sync.flush();
    expect(savedEnvelope(state.value).comments.b1[0].text).toBe('without waiting');
    sync.detach();
  });

  it('discards comments of removed boards (only after the load)', async () => {
    const { storage } = memory(envelopeWith('b1'));
    const manager = fakeManager('b1');
    const commentStore = new CommentStore({
      b1: [comment('c1', 'fica')],
      sumiu: [comment('c2', 'vai')],
    });
    const sync = syncWorkspace({
      manager,
      metaStore: new BoardMetaStore(),
      commentStore,
      storage,
      debounceMs: 0,
    });
    await sync.ready;

    expect(commentStore.list('b1')).toHaveLength(1);
    expect(commentStore.list('sumiu')).toHaveLength(0);
    sync.detach();
  });

  it('migrates the local envelope to the cloud on the first login', async () => {
    const cloud = memory(null, { atraso: true });
    const local = memory(envelopeWith('b1', { b1: [comment('c1', 'do local')] }));
    const { commentStore, sync } = mount(
      cloud.storage,
      { migrateFrom: local.storage },
      'novo-1',
    );
    await sync.ready;

    expect(commentStore.list('b1')[0].text).toBe('do local');
    expect(cloud.state.gravacoes).toBeGreaterThan(0);
    expect(savedEnvelope(cloud.state.value).comments.b1).toHaveLength(1);
    sync.detach();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Honest saving: the worst outcome is saying "saved" without having saved.
// ─────────────────────────────────────────────────────────────────────────────
describe('syncWorkspace — write failure', () => {
  it('does not say "saved" when the write fails', async () => {
    const { storage, state } = memory(envelopeWith('b1'));
    const { commentStore, sync, states } = mount(storage, { retryBaseMs: 10_000 });
    await sync.ready;
    states.length = 0;

    // Persistent failure with the retry far away: nothing may turn into "saved"
    // along the way.
    state.falhar = 99;
    commentStore.add('b1', { x: 0, y: 0, text: 'x', author: 'Ana' });
    await sync.flush();

    expect(states).toContain('error');
    expect(states).not.toContain('saved');
    expect(sync.state()).toBe('error');
    // The data is still pending: it was not accepted by the server.
    expect(sync.hasPendingChanges()).toBe(true);
    sync.detach();
  });

  it('retries and confirms once the network comes back', async () => {
    const { storage, state } = memory(envelopeWith('b1'));
    const { commentStore, sync } = mount(storage, { retryBaseMs: 1 });
    await sync.ready;

    state.falhar = 2; // fails twice, then goes through
    commentStore.add('b1', { x: 0, y: 0, text: 'insistente', author: 'Ana' });

    // Wait for the backoff to settle (1ms, 2ms).
    for (let i = 0; i < 50 && sync.state() !== 'saved'; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(sync.state()).toBe('saved');
    expect(sync.hasPendingChanges()).toBe(false);
    expect(savedEnvelope(state.value).comments.b1[0].text).toBe('insistente');
    sync.detach();
  });

  it('gives up after the attempt limit, keeping the error state', async () => {
    const { storage, state } = memory(envelopeWith('b1'));
    const { commentStore, sync } = mount(storage, { retryBaseMs: 1, maxAttempts: 2 });
    await sync.ready;

    state.falhar = 99;
    commentStore.add('b1', { x: 0, y: 0, text: 'nunca vai', author: 'Ana' });
    await new Promise((r) => setTimeout(r, 60));

    expect(sync.state()).toBe('error');
    expect(sync.hasPendingChanges()).toBe(true);
    sync.detach();
  });

  it('a write error is reported (not swallowed)', async () => {
    const { storage, state } = memory(envelopeWith('b1'));
    const onError = vi.fn();
    const { commentStore, sync } = mount(storage, { onError, retryBaseMs: 10_000 });
    await sync.ready;

    state.falhar = 1;
    state.error = new Error('quota cheia');
    commentStore.add('b1', { x: 0, y: 0, text: 'x', author: 'Ana' });
    await sync.flush();

    expect(onError).toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe('quota cheia');
    sync.detach();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conflict: two tabs must not erase each other in silence.
// ─────────────────────────────────────────────────────────────────────────────
describe('syncWorkspace — version conflict', () => {
  it('sends the version it read on the save', async () => {
    const versions: (number | undefined)[] = [];
    const storage: EnvelopeStorage = {
      read: () => ({ envelope: envelopeWith('b1'), version: 7 }),
      write: (_env, version) => {
        versions.push(version);
        return { version: (version ?? 0) + 1 };
      },
    };
    const { commentStore, sync } = mount(storage);
    await sync.ready;

    commentStore.add('b1', { x: 0, y: 0, text: 'a', author: 'Ana' });
    await sync.flush();
    commentStore.add('b1', { x: 0, y: 0, text: 'b', author: 'Ana' });
    await sync.flush();

    // The first save uses the version from the load; the second, the one the
    // server returned.
    expect(versions).toEqual([7, 8]);
    sync.detach();
  });

  it('on a conflict it reloads the server state instead of overwriting', async () => {
    const fromServer = envelopeWith('b1', { b1: [comment('other-tab', 'written in the other tab')] });
    let first = true;
    const storage: EnvelopeStorage = {
      read: () => ({ envelope: envelopeWith('b1'), version: 1 }),
      write: () => {
        if (first) {
          first = false;
          throw new VersionConflict({ envelope: fromServer, version: 9 });
        }
        return { version: 10 };
      },
    };
    const onConflict = vi.fn();
    const { commentStore, sync } = mount(storage, { onConflict });
    await sync.ready;

    commentStore.add('b1', { x: 0, y: 0, text: 'minha aba', author: 'Ana' });
    await sync.flush();

    expect(onConflict).toHaveBeenCalled();
    // What the other tab wrote is here — it was not erased.
    expect(commentStore.list('b1').map((c) => c.text)).toContain('written in the other tab');
    expect(sync.state()).toBe('saved');
    sync.detach();
  });

  it('a conflict does not turn into an infinite retry', async () => {
    let attempts = 0;
    const storage: EnvelopeStorage = {
      read: () => ({ envelope: envelopeWith('b1'), version: 1 }),
      write: () => {
        attempts += 1;
        throw new VersionConflict({ envelope: envelopeWith('b1'), version: 2 });
      },
    };
    const { commentStore, sync } = mount(storage, { retryBaseMs: 1 });
    await sync.ready;

    commentStore.add('b1', { x: 0, y: 0, text: 'x', author: 'Ana' });
    await sync.flush();
    await new Promise((r) => setTimeout(r, 30));

    // A single attempt; a conflict is solved by reloading, not by repeating.
    expect(attempts).toBe(1);
    sync.detach();
  });
});
