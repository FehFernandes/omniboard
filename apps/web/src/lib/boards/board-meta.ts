// Per-board metadata (starred, last change).
//
// Why a parallel store: the BoardManager from @omniboard/core models each board
// as `{ id, name, snapshot }` — there is no field for starred or for a date. And
// since persistence saves exactly `manager.toJSON()`, any extra field stuffed in
// there would be discarded on the next save.
//
// So we keep the metadata OUTSIDE the snapshot and persist both together in an
// envelope (see wrapWorkspace/unwrapWorkspace). This requires no backend change:
// the `workspaces.data` column is free-form JSONB.

export interface BoardMeta {
  /** Pinned by the user — floats to the top and shows in the "Favoritos" filter. */
  starred?: boolean;
  /** Epoch ms of the last known change. Feeds the "Recentes" filter. */
  updatedAt?: number;
  /** Folder containing the board. null/absent = root of the tree. */
  folderId?: string | null;
  /**
   * Order within the parent (folder or root).
   *
   * The tree ordering lives HERE, and not in the BoardManager's `reorder()`: the
   * manager's flat list cannot express hierarchy, and keeping two sources of
   * order in sync would be a source of bugs. The manager remains the owner of
   * the boards' content; the tree owns the presentation.
   */
  position?: number;
}

export type BoardMetaMap = Record<string, BoardMeta>;

/** Folder of the board tree. It only exists in the metadata — the core does not know about it. */
export interface BoardFolder {
  id: string;
  name: string;
  /** null = folder at the root. */
  parentId: string | null;
  position: number;
  /** Open/closed in the tree. Persisted so the UI remembers across sessions. */
  expanded?: boolean;
}

/** Persisted envelope: workspace snapshot + metadata + folders + comments. */
export interface WorkspaceEnvelope {
  type: 'omniboard-workspace-envelope';
  version: 1;
  workspace: unknown;
  meta: BoardMetaMap;
  folders: BoardFolder[];
  /** Comments per board. See lib/boards/comments.ts. */
  comments?: Record<string, unknown[]>;
}

const ENVELOPE_TYPE = 'omniboard-workspace-envelope';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** wrapWorkspace builds the envelope that goes to the storage. */
export function wrapWorkspace(
  workspace: unknown,
  meta: BoardMetaMap,
  folders: BoardFolder[] = [],
  comments: Record<string, unknown[]> = {},
): WorkspaceEnvelope {
  return { type: ENVELOPE_TYPE, version: 1, workspace, meta, folders, comments };
}

/**
 * unwrapWorkspace accepts the two shapes that may exist in the storage:
 * the new envelope and the raw snapshot written before this feature
 * (backwards compatibility — without it, anyone with saved boards would lose
 * them).
 */
export function unwrapWorkspace(raw: unknown): {
  workspace: unknown;
  meta: BoardMetaMap;
  folders: BoardFolder[];
  comments: Record<string, unknown[]>;
} {
  if (isRecord(raw) && raw.type === ENVELOPE_TYPE) {
    return {
      workspace: raw.workspace ?? null,
      meta: isRecord(raw.meta) ? (raw.meta as BoardMetaMap) : {},
      // `folders` and `comments` did not exist in the first versions of the
      // envelope: absence = empty.
      folders: Array.isArray(raw.folders) ? (raw.folders as BoardFolder[]) : [],
      comments: isRecord(raw.comments) ? (raw.comments as Record<string, unknown[]>) : {},
    };
  }
  // Old format: the WorkspaceSnapshot itself, without metadata.
  return { workspace: raw ?? null, meta: {}, folders: [], comments: {} };
}

/** pruneMeta discards metadata of boards that no longer exist. */
export function pruneMeta(meta: BoardMetaMap, existingIds: readonly string[]): BoardMetaMap {
  const keep = new Set(existingIds);
  const next: BoardMetaMap = {};
  for (const [id, value] of Object.entries(meta)) {
    if (keep.has(id)) next[id] = value;
  }
  return next;
}

type Listener = (state: { meta: BoardMetaMap; folders: BoardFolder[] }) => void;

/** Generates a short id for folders (it does not need to be cryptographic). */
function folderId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * BoardMetaStore keeps metadata and folders in memory and notifies interested
 * parties.
 *
 * It exists because two parts need the same state: the React panel (to render
 * the tree) and the imperative persistence layer (to include everything in the
 * save). `subscribe` allows triggering the save when only the metadata changes —
 * the BoardManager emits no event in those cases.
 */
export class BoardMetaStore {
  private meta: BoardMetaMap;
  private folderList: BoardFolder[];
  private listeners = new Set<Listener>();

  constructor(initial: BoardMetaMap = {}, folders: BoardFolder[] = []) {
    this.meta = { ...initial };
    this.folderList = [...folders];
  }

  all(): BoardMetaMap {
    return this.meta;
  }

  folders(): BoardFolder[] {
    return this.folderList;
  }

  get(id: string): BoardMeta {
    return this.meta[id] ?? {};
  }

  /** Replaces everything (used when loading from storage). Does not notify by default. */
  replace(meta: BoardMetaMap, folders: BoardFolder[] = [], notify = false): void {
    this.meta = { ...meta };
    this.folderList = [...folders];
    if (notify) this.emit();
  }

  patch(id: string, changes: BoardMeta): void {
    this.meta = { ...this.meta, [id]: { ...this.meta[id], ...changes } };
    this.emit();
  }

  /** patchMany applies several changes in a single notification (used in drag & drop). */
  patchMany(changes: Record<string, BoardMeta>): void {
    const next = { ...this.meta };
    for (const [id, value] of Object.entries(changes)) {
      next[id] = { ...next[id], ...value };
    }
    this.meta = next;
    this.emit();
  }

  toggleStarred(id: string): boolean {
    const starred = !this.get(id).starred;
    this.patch(id, { starred });
    return starred;
  }

  /** touch marks the board as changed right now (feeds "Recentes"). */
  touch(id: string): void {
    this.patch(id, { updatedAt: Date.now() });
  }

  // ── Folders ──

  createFolder(name: string, parentId: string | null = null, position = 0): BoardFolder {
    const folder: BoardFolder = { id: folderId(), name, parentId, position, expanded: true };
    this.folderList = [...this.folderList, folder];
    this.emit();
    return folder;
  }

  renameFolder(id: string, name: string): void {
    this.folderList = this.folderList.map((f) => (f.id === id ? { ...f, name } : f));
    this.emit();
  }

  toggleFolder(id: string): void {
    this.folderList = this.folderList.map((f) =>
      f.id === id ? { ...f, expanded: !(f.expanded ?? true) } : f,
    );
    this.emit();
  }

  /**
   * Removes the folder and promotes its contents to its parent — it never
   * deletes boards. Deleting a folder is an organization action, not a content
   * destruction one.
   */
  deleteFolder(id: string): void {
    const target = this.folderList.find((f) => f.id === id);
    if (!target) return;
    const grandparent = target.parentId;

    this.folderList = this.folderList
      .filter((f) => f.id !== id)
      .map((f) => (f.parentId === id ? { ...f, parentId: grandparent } : f));

    const nextMeta = { ...this.meta };
    for (const [boardId, info] of Object.entries(nextMeta)) {
      if (info.folderId === id) nextMeta[boardId] = { ...info, folderId: grandparent };
    }
    this.meta = nextMeta;
    this.emit();
  }

  patchFolders(changes: Record<string, Partial<BoardFolder>>): void {
    this.folderList = this.folderList.map((f) => (changes[f.id] ? { ...f, ...changes[f.id] } : f));
    this.emit();
  }

  /** prune removes orphan metadata; it only notifies if something was dropped. */
  prune(existingIds: readonly string[]): void {
    const next = pruneMeta(this.meta, existingIds);
    if (Object.keys(next).length === Object.keys(this.meta).length) return;
    this.meta = next;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = { meta: this.meta, folders: this.folderList };
    for (const listener of this.listeners) listener(state);
  }
}
