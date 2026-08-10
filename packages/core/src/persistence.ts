import type { Board } from "./Board";
import type { BoardManager, WorkspaceSnapshot } from "./BoardManager";
import type { BoardSnapshot } from "./types";

/**
 * A storage backend for board snapshots. Implement this to persist to anything:
 * localStorage, IndexedDB, a REST API, Firestore, Supabase, S3, etc.
 *
 * `save` may be sync or async. `load` is optional and used by `loadOnStart`.
 */
export interface StorageAdapter {
  save(snapshot: BoardSnapshot): void | Promise<void>;
  load?(): BoardSnapshot | null | Promise<BoardSnapshot | null>;
}

export interface PersistenceOptions {
  /** Debounce window in ms before a save fires. Default 800. `0` = immediate. */
  debounceMs?: number;
  /** If true and the adapter has `load`, load the snapshot on attach. */
  loadOnStart?: boolean;
  /** Called after every successful save (handy for "saved ✓" UI). */
  onSave?: (snapshot: BoardSnapshot) => void;
  /** Called if a save/load rejects. Defaults to console.error. */
  onError?: (err: unknown) => void;
  /** Injectable timers (mainly for testing). */
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

/**
 * Wire a Board's `change` events to a {@link StorageAdapter} with debounced
 * autosave. Returns a `detach()` function that stops autosaving.
 *
 * ```ts
 * const detach = attachPersistence(board, localStorageAdapter("my-board"), {
 *   debounceMs: 500,
 *   loadOnStart: true,
 * });
 * ```
 */
export function attachPersistence(
  board: Board,
  adapter: StorageAdapter,
  opts: PersistenceOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 800;
  const onError = opts.onError ?? ((err: unknown) => console.error(err));
  const setT = opts.scheduler?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT =
    opts.scheduler?.clearTimeout ?? ((h) => clearTimeout(h as never));

  let handle: unknown = null;

  const flush = (): void => {
    handle = null;
    try {
      const snapshot = board.getSnapshot();
      Promise.resolve(adapter.save(snapshot))
        .then(() => opts.onSave?.(snapshot))
        .catch(onError);
    } catch (err) {
      onError(err);
    }
  };

  const schedule = (): void => {
    if (handle !== null) clearT(handle);
    if (debounceMs <= 0) {
      flush();
      return;
    }
    handle = setT(flush, debounceMs);
  };

  const off = board.on("change", schedule);

  if (opts.loadOnStart && adapter.load) {
    Promise.resolve(adapter.load())
      .then((snap) => {
        if (snap) board.loadSnapshot(snap);
      })
      .catch(onError);
  }

  return () => {
    if (handle !== null) clearT(handle);
    off();
  };
}

/** A {@link StorageAdapter} backed by `window.localStorage`. */
export function localStorageAdapter(key = "openboard"): StorageAdapter {
  return {
    save(snapshot) {
      localStorage.setItem(key, JSON.stringify(snapshot));
    },
    load() {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as BoardSnapshot) : null;
    },
  };
}

/** An in-memory {@link StorageAdapter}, useful for tests and prototyping. */
export function memoryAdapter(initial: BoardSnapshot | null = null): StorageAdapter & {
  current: BoardSnapshot | null;
} {
  const store = { current: initial };
  return {
    get current() {
      return store.current;
    },
    save(snapshot) {
      store.current = snapshot;
    },
    load() {
      return store.current;
    },
  };
}

// ------------------------------------------------------- Workspace (multi-board)

/** Storage backend for a whole {@link BoardManager} workspace. */
export interface WorkspaceStorageAdapter {
  save(snapshot: WorkspaceSnapshot): void | Promise<void>;
  load?(): WorkspaceSnapshot | null | Promise<WorkspaceSnapshot | null>;
}

export interface WorkspacePersistenceOptions {
  debounceMs?: number;
  loadOnStart?: boolean;
  onSave?: (snapshot: WorkspaceSnapshot) => void;
  onError?: (err: unknown) => void;
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

/**
 * Debounced autosave for a multi-board {@link BoardManager}. Saves the entire
 * workspace (all documents) on element edits, document add/remove/rename and
 * active-board changes. Returns a `detach()` function.
 */
export function attachWorkspacePersistence(
  manager: BoardManager,
  adapter: WorkspaceStorageAdapter,
  opts: WorkspacePersistenceOptions = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 800;
  const onError = opts.onError ?? ((err: unknown) => console.error(err));
  const setT = opts.scheduler?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT =
    opts.scheduler?.clearTimeout ?? ((h) => clearTimeout(h as never));

  let handle: unknown = null;

  const flush = (): void => {
    handle = null;
    try {
      const snapshot = manager.toJSON();
      Promise.resolve(adapter.save(snapshot))
        .then(() => opts.onSave?.(snapshot))
        .catch(onError);
    } catch (err) {
      onError(err);
    }
  };

  const schedule = (): void => {
    if (handle !== null) clearT(handle);
    if (debounceMs <= 0) {
      flush();
      return;
    }
    handle = setT(flush, debounceMs);
  };

  const offs = [
    manager.board.on("change", schedule),
    manager.on("documentsChange", schedule),
    manager.on("activeChange", schedule),
  ];

  if (opts.loadOnStart && adapter.load) {
    Promise.resolve(adapter.load())
      .then((snap) => {
        if (snap) manager.loadJSON(snap);
      })
      .catch(onError);
  }

  return () => {
    if (handle !== null) clearT(handle);
    offs.forEach((off) => off());
  };
}

/** A {@link WorkspaceStorageAdapter} backed by `window.localStorage`. */
export function workspaceLocalStorageAdapter(
  key = "openboard-workspace",
): WorkspaceStorageAdapter {
  return {
    save(snapshot) {
      localStorage.setItem(key, JSON.stringify(snapshot));
    },
    load() {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as WorkspaceSnapshot) : null;
    },
  };
}
