// Board comments.
//
// They live OUTSIDE the drawing snapshot for two reasons: they are not graphic
// content (they must not end up in the PNG export nor in the canvas undo
// history) and the core's BoardManager knows nothing about the concept. They
// live in the same persistence envelope as the metadata (see board-meta.ts), per
// board.
//
// The coordinates are WORLD coordinates: that way the pin stays at the same
// point of the drawing when the user pans or zooms.

export interface CommentReply {
  id: string;
  text: string;
  author: string;
  createdAt: number;
}

export interface BoardComment {
  id: string;
  /** Position in world coordinates. */
  x: number;
  y: number;
  text: string;
  author: string;
  createdAt: number;
  resolved?: boolean;
  replies?: CommentReply[];
}

/** Comments indexed by board. */
export type CommentsByBoard = Record<string, BoardComment[]>;

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

type Listener = (all: CommentsByBoard) => void;

/**
 * CommentStore keeps the comments in memory and notifies its observers.
 *
 * Same pattern as BoardMetaStore: the React overlay renders from here and the
 * persistence layer listens in order to save. Without it, a comment change would
 * not trigger a save (the BoardManager emits no event for it).
 */
export class CommentStore {
  private byBoard: CommentsByBoard;
  private listeners = new Set<Listener>();

  constructor(initial: CommentsByBoard = {}) {
    this.byBoard = { ...initial };
  }

  all(): CommentsByBoard {
    return this.byBoard;
  }

  /** Comments of a board, in creation order. */
  list(boardId: string): BoardComment[] {
    return this.byBoard[boardId] ?? [];
  }

  /**
   * Applies what came from the storage (on load). Does not notify by default.
   *
   * In-memory comments of boards absent from the payload are preserved: those
   * are the ones created before the load finished, and discarding them would
   * lose what the user just wrote (see rekey).
   */
  replace(all: CommentsByBoard, notify = false): void {
    const next = { ...all };
    for (const [id, list] of Object.entries(this.byBoard)) {
      if (!next[id]?.length && list.length) next[id] = list;
    }
    this.byBoard = next;
    if (notify) this.emit();
  }

  add(boardId: string, comment: Omit<BoardComment, 'id' | 'createdAt'>): BoardComment {
    const created: BoardComment = { ...comment, id: newId('c'), createdAt: Date.now() };
    this.byBoard = { ...this.byBoard, [boardId]: [...this.list(boardId), created] };
    this.emit();
    return created;
  }

  update(boardId: string, id: string, patch: Partial<BoardComment>): void {
    this.byBoard = {
      ...this.byBoard,
      [boardId]: this.list(boardId).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    };
    this.emit();
  }

  remove(boardId: string, id: string): void {
    this.byBoard = {
      ...this.byBoard,
      [boardId]: this.list(boardId).filter((c) => c.id !== id),
    };
    this.emit();
  }

  addReply(boardId: string, id: string, text: string, author: string): void {
    const reply: CommentReply = { id: newId('r'), text, author, createdAt: Date.now() };
    this.byBoard = {
      ...this.byBoard,
      [boardId]: this.list(boardId).map((c) =>
        c.id === id ? { ...c, replies: [...(c.replies ?? []), reply] } : c,
      ),
    };
    this.emit();
  }

  toggleResolved(boardId: string, id: string): void {
    const current = this.list(boardId).find((c) => c.id === id);
    if (!current) return;
    this.update(boardId, id, { resolved: !current.resolved });
  }

  /**
   * Moves the comments of one board to another.
   *
   * It serves the throwaway-board case: the BoardManager creates a blank
   * document in the constructor and only afterwards does the saved snapshot
   * arrive and replace everything with another id. A comment made in that window
   * would be orphaned and discarded by prune — reanchoring it on the active
   * board preserves what the user wrote.
   */
  rekey(fromId: string, toId: string): void {
    const origem = this.list(fromId);
    if (!origem.length || fromId === toId) return;
    const next = { ...this.byBoard, [toId]: [...this.list(toId), ...origem] };
    delete next[fromId];
    this.byBoard = next;
    this.emit();
  }

  /** Discards comments of boards that no longer exist. */
  prune(boardIds: readonly string[]): void {
    const keep = new Set(boardIds);
    const next: CommentsByBoard = {};
    for (const [id, list] of Object.entries(this.byBoard)) {
      if (keep.has(id)) next[id] = list;
    }
    if (Object.keys(next).length === Object.keys(this.byBoard).length) return;
    this.byBoard = next;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.byBoard);
  }
}

/** Author initial for the pin/avatar ("Ana Paula" → "A"). */
export function initial(author: string): string {
  const cleaned = (author || '?').trim();
  return (cleaned.charAt(0) || '?').toUpperCase();
}

/** Short relative label ("now", "5 min", "2 h", "3 d"). */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
