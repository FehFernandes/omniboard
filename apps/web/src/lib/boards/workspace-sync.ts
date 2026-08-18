// Workspace synchronization with the storage.
//
// A single place decides *when* to save, *what* to save and *what to do when it
// fails*. This used to be scattered: the core's autosave (which only knows the
// BoardManager snapshot) plus a parallel debounce for metadata and comments, both
// writing the same key.
//
// Rules that hold here:
//   1. Nothing is saved before the load finishes — a premature save would
//      overwrite what is stored with a blank workspace.
//   2. `prune` (discarding metadata/comments of boards that do not exist) only
//      runs after the load: the document the BoardManager creates in its
//      constructor is throwaway and would take with it whatever the user wrote
//      in that window.
//   3. Leaving the page saves whatever was sitting in the debounce.
//   4. A write failure is NOT silent: the state turns to "error", the data stays
//      pending and there is a retry with backoff. Saying "saved" without having
//      saved is the worst possible outcome — the user trusts it and closes the
//      tab.
//   5. A conflict (another tab wrote first) is not overwritten: we reload the
//      state from the server and warn.
import { unwrapWorkspace, wrapWorkspace, type BoardMetaStore } from './board-meta';
import type { CommentsByBoard, CommentStore } from './comments';

/** BoardManager event, as far as it matters here. */
export interface ManagerEvent {
  type: string;
  documents?: { id: string }[];
  activeId?: string;
}

/** The minimum of the BoardManager used here (makes it testable without a canvas). */
export interface ManagerLike {
  toJSON(): unknown;
  loadJSON(data: never): void;
  list(): { id: string }[];
  getActiveId(): string;
  on(type: 'documentsChange' | 'activeChange', listener: (e: ManagerEvent) => void): () => void;
  board: { on(type: 'change', listener: () => void): () => void };
}

/** Result of a read from the storage. */
export interface EnvelopeRead {
  /** Raw envelope (or null when there is nothing stored). */
  envelope: unknown;
  /** Server version, when the storage has concurrency control. */
  version?: number;
}

/** Conflict error: another client wrote first. */
export class VersionConflict extends Error {
  constructor(readonly read: EnvelopeRead) {
    super('workspace changed elsewhere');
    this.name = 'ConflitoDeVersao';
  }
}

/** Storage of the raw envelope (localStorage, backend, ...). */
export interface EnvelopeStorage {
  read(): EnvelopeRead | Promise<EnvelopeRead>;
  /**
   * Writes. It MUST reject on failure (the UI depends on that so it does not
   * lie) and throw {@link VersionConflict} when the version does not match.
   */
  write(envelope: unknown, version?: number): { version?: number } | Promise<{ version?: number }>;
}

/** Save state, so the UI can show the truth. */
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface WorkspaceSyncOptions {
  manager: ManagerLike;
  metaStore: BoardMetaStore;
  commentStore: CommentStore;
  storage: EnvelopeStorage;
  /** Read when `storage` is empty: localStorage → cloud migration on 1st login. */
  migrateFrom?: EnvelopeStorage;
  /** Debounce window. Defaults to 500ms. `0` saves immediately. */
  debounceMs?: number;
  /** Wait before the 1st retry; doubles on each failure (capped at 30s). */
  retryBaseMs?: number;
  /** How many attempts before giving up and leaving it in "error". Default 5. */
  maxAttempts?: number;
  /** The save state changed (for the indicator). */
  onState?: (state: SaveState, info: { error?: unknown; attempt: number }) => void;
  /** Another client wrote: we already reloaded the state from the server. */
  onConflict?: () => void;
  onError?: (err: unknown) => void;
  /** Injectable for tests. */
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

export interface WorkspaceSync {
  /** Resolves once the persisted state (or its absence) has been applied. */
  ready: Promise<void>;
  /** Saves whatever is pending right now. Resolves when it finishes (or fails). */
  flush: () => Promise<void>;
  /** Current save state. */
  state: () => SaveState;
  /** Is there a change not yet confirmed by the server? */
  hasPendingChanges: () => boolean;
  detach: () => void;
}

export function syncWorkspace(opts: WorkspaceSyncOptions): WorkspaceSync {
  const { manager, metaStore, commentStore, storage } = opts;
  const debounceMs = opts.debounceMs ?? 500;
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const maxAttempts = opts.maxAttempts ?? 5;
  const onError = opts.onError ?? (() => {});
  const setT = opts.scheduler?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.scheduler?.clearTimeout ?? ((h) => clearTimeout(h as never));

  // Id of the document the BoardManager creates on its own; the saved snapshot
  // swaps it for another. Whatever is commented until then is reanchored on the
  // board that takes over.
  const initialBoardId = manager.getActiveId();
  let loaded = false;
  let cancelled = false;
  let pending = false;
  let timer: unknown = null;
  let version: number | undefined;
  let currentState: SaveState = 'idle';
  let attempt = 0;
  /**
   * Applying state that came from outside (initial load or conflict).
   *
   * `manager.loadJSON` emits the same events as a user edit. Without this guard,
   * reloading after a conflict scheduled a new save, which conflicted again —
   * an infinite loop of requests.
   */
  let applyingRemote = false;
  /** Write queue: one at a time, always with the most recent state. */
  let queue: Promise<void> = Promise.resolve();

  const setState = (e: SaveState, error?: unknown) => {
    currentState = e;
    opts.onState?.(e, { error, attempt });
  };

  const envelope = () =>
    wrapWorkspace(
      manager.toJSON(),
      metaStore.all(),
      metaStore.folders(),
      commentStore.all() as Record<string, unknown[]>,
    );

  /** Applies an envelope to the stores and returns the workspace snapshot. */
  const apply = (raw: unknown): unknown => {
    const { workspace, meta, folders, comments } = unwrapWorkspace(raw);
    metaStore.replace(meta, folders);
    commentStore.replace(comments as CommentsByBoard);
    return workspace;
  };

  const pruneOrphans = () => {
    const ids = manager.list().map((d) => d.id);
    metaStore.prune(ids);
    commentStore.prune(ids);
  };

  /** Reloads the state from the server after a conflict. */
  const reload = (read: EnvelopeRead) => {
    version = read.version;
    applyingRemote = true;
    try {
      const ws = apply(read.envelope);
      if (ws) manager.loadJSON(ws as never);
      pruneOrphans();
    } finally {
      applyingRemote = false;
    }
    opts.onConflict?.();
  };

  const write = async (): Promise<void> => {
    if (!pending || !loaded || cancelled) return;
    // Mark it before writing: changes during the await go back to pending.
    pending = false;
    setState('saving');
    try {
      const r = await storage.write(envelope(), version);
      if (cancelled) return;
      if (r?.version !== undefined) version = r.version;
      attempt = 0;
      setState(pending ? 'pending' : 'saved');
      if (pending) schedule();
    } catch (err) {
      if (cancelled) return;
      // The data was not accepted: it stays pending.
      pending = true;

      if (err instanceof VersionConflict) {
        // Another tab won. Overwriting would erase its work.
        try {
          reload(err.read);
          pending = false;
          attempt = 0;
          setState('saved');
        } catch (e2) {
          onError(e2);
          setState('error', e2);
        }
        return;
      }

      onError(err);
      attempt += 1;
      if (attempt <= maxAttempts) {
        // Exponential backoff with a cap: an unstable network does not turn into
        // a storm of requests, and the next attempt is automatic.
        const delay = Math.min(retryBaseMs * 2 ** (attempt - 1), 30_000);
        setState('error', err);
        if (timer !== null) clearT(timer);
        timer = setT(() => void writeSerial(), delay);
      } else {
        // It gave up trying on its own; the next event (or flush) tries again.
        setState('error', err);
      }
    }
  };

  /**
   * Serializes the writes: one at a time, and always a fresh attempt at the end
   * of the queue. Reusing the in-flight promise would make `flush` "finish"
   * without saving what just changed.
   */
  const writeSerial = (): Promise<void> => {
    queue = queue.then(
      () => write(),
      () => write(),
    );
    return queue;
  };

  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
    return writeSerial();
  };

  const schedule = () => {
    // A change that came from the server does not generate a save back.
    if (applyingRemote) return;
    pending = true;
    if (currentState !== 'saving') setState('pending');
    if (timer !== null) clearT(timer);
    if (debounceMs <= 0) {
      void writeSerial();
      return;
    }
    timer = setT(() => void writeSerial(), debounceMs);
  };

  const offs: (() => void)[] = [
    manager.board.on('change', schedule),
    manager.on('documentsChange', (e) => {
      if (loaded) pruneOrphans();
      if (e.activeId) metaStore.patch(e.activeId, { updatedAt: Date.now() });
      schedule();
    }),
    manager.on('activeChange', schedule),
    metaStore.subscribe(schedule),
    commentStore.subscribe(schedule),
  ];

  const ready = (async () => {
    const read = await storage.read();
    version = read.version;
    let workspace = apply(read.envelope);
    let migrated = false;
    if (!workspace && opts.migrateFrom) {
      const local = await opts.migrateFrom.read();
      workspace = apply(local.envelope);
      migrated = Boolean(workspace);
    }
    if (cancelled) return;

    // Applying the stored state is not a user edit: it generates no save.
    applyingRemote = true;
    try {
      if (workspace) manager.loadJSON(workspace as never);
      loaded = true;
      const activeId = manager.getActiveId();
      if (activeId !== initialBoardId) commentStore.rekey(initialBoardId, activeId);
      pruneOrphans();
    } finally {
      applyingRemote = false;
    }

    // A migration has to be written to the destination; and whatever changed
    // during the load (comments included) lived only in memory.
    if (migrated) pending = true;
    if (pending) await writeSerial();
  })().catch((err) => {
    onError(err);
    setState('error', err);
  });

  // Closing the tab must not cost whatever was in the debounce.
  const onLeave = () => void flush();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  // Browser warning when there is an unconfirmed change. Only in that case:
  // asking for confirmation without a reason trains the user to ignore the
  // warning.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (pending || currentState === 'saving' || currentState === 'error') {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    ready,
    flush,
    state: () => currentState,
    hasPendingChanges: () => pending,
    detach() {
      void flush();
      cancelled = true;
      if (timer !== null) clearT(timer);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      offs.forEach((off) => off());
    },
  };
}
