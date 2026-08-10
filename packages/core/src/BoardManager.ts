import type { Board } from "./Board";
import { nanoid } from "./geometry";
import type { BoardSnapshot } from "./types";

/** Lightweight metadata for a board document (no element payload). */
export interface BoardDocumentMeta {
  id: string;
  name: string;
}

/** A full board document: metadata + its serialized snapshot. */
export interface BoardDocument extends BoardDocumentMeta {
  snapshot: BoardSnapshot;
}

/** Serialized workspace containing every board document. */
export interface WorkspaceSnapshot {
  /**
   * Format marker. As in {@link BoardSnapshot.type}, the historical value
   * "openboard-workspace" is kept so already saved data stays valid.
   */
  type: "openboard-workspace";
  version: 1;
  activeId: string;
  documents: BoardDocument[];
}

export type BoardManagerEvent =
  | { type: "documentsChange"; documents: BoardDocumentMeta[]; activeId: string }
  | { type: "activeChange"; activeId: string };

export type BoardManagerEventType = BoardManagerEvent["type"];

/** The event a given manager `type` delivers (see BoardEventOf). */
export type BoardManagerEventOf<T extends BoardManagerEventType> = Extract<
  BoardManagerEvent,
  { type: T }
>;

type Listener = (e: BoardManagerEvent) => void;

export interface BoardManagerOptions {
  /** Initial documents. If omitted, the board's current state becomes doc #1. */
  documents?: BoardDocument[];
  /** Which document is active initially. Defaults to the first. */
  activeId?: string;
  /** Name for the auto-created first document. Default "Board 1". */
  defaultName?: string;
}

function emptySnapshot(): BoardSnapshot {
  return { type: "openboard", version: 1, elements: [] };
}

function cloneSnapshot(s: BoardSnapshot): BoardSnapshot {
  return JSON.parse(JSON.stringify(s)) as BoardSnapshot;
}

/**
 * Native multi-board support. Wraps a single {@link Board} (one canvas) and
 * manages several board **documents** you can switch between — like pages/tabs
 * in Miro. Switching persists the current document in-memory and loads the
 * target, so integration is just: create the manager, render tabs from
 * `list()`, and call `switch(id)` / `create()`.
 *
 * ```ts
 * const board = new Board(el);
 * const boards = new BoardManager(board);
 * boards.on("documentsChange", ({ documents, activeId }) => renderTabs(documents, activeId));
 * boards.create("Diagram");    // new board + switch to it
 * boards.switch(someId);
 * const json = boards.toJSON(); // persist the whole workspace
 * ```
 */
export class BoardManager {
  /** The underlying single-canvas board (shared by all documents). */
  readonly board: Board;

  private docs = new Map<string, BoardDocument>();
  private orderIds: string[] = [];
  private activeId!: string;
  private seq = 0;
  private listeners = new Map<BoardManagerEventType, Set<Listener>>();
  private offBoardChange: () => void;

  constructor(board: Board, options: BoardManagerOptions = {}) {
    this.board = board;

    const initial = options.documents?.length ? options.documents : null;
    if (initial) {
      for (const d of initial) {
        this.docs.set(d.id, { ...d, snapshot: cloneSnapshot(d.snapshot) });
        this.orderIds.push(d.id);
      }
      this.seq = initial.length;
      this.activeId =
        options.activeId && this.docs.has(options.activeId)
          ? options.activeId
          : initial[0].id;
      this.board.loadSnapshot(cloneSnapshot(this.docs.get(this.activeId)!.snapshot));
    } else {
      const id = nanoid();
      this.seq = 1;
      this.docs.set(id, {
        id,
        name: options.defaultName ?? "Board 1",
        snapshot: this.board.getSnapshot(),
      });
      this.orderIds.push(id);
      this.activeId = id;
    }

    // Keep the active document's snapshot in sync with live edits.
    this.offBoardChange = this.board.on("change", () => this.syncActive());
  }

  // ------------------------------------------------------------- Queries

  /** Ordered list of document metadata (id + name), for rendering tabs. */
  list(): BoardDocumentMeta[] {
    return this.orderIds.map((id) => {
      const d = this.docs.get(id)!;
      return { id: d.id, name: d.name };
    });
  }

  getActiveId(): string {
    return this.activeId;
  }

  /** Number of documents in the workspace. */
  get size(): number {
    return this.orderIds.length;
  }

  getActiveDocument(): BoardDocument {
    this.syncActive();
    return this.docs.get(this.activeId)!;
  }

  // ------------------------------------------------------------- Mutations

  /** Create a new blank board and switch to it. Returns its id. */
  create(name?: string): string {
    this.syncActive();
    const id = nanoid();
    this.seq += 1;
    this.docs.set(id, {
      id,
      name: name ?? `Board ${this.seq}`,
      snapshot: emptySnapshot(),
    });
    this.orderIds.push(id);
    this.setActive(id);
    this.emitDocuments();
    return id;
  }

  /** Switch the canvas to another document. */
  switch(id: string): void {
    if (id === this.activeId || !this.docs.has(id)) return;
    this.syncActive();
    this.setActive(id);
  }

  /** Rename a document. */
  rename(id: string, name: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;
    doc.name = name;
    this.emitDocuments();
  }

  /**
   * Remove a document. The last remaining document cannot be removed (it is
   * cleared instead). If the active document is removed, switches to a neighbor.
   */
  remove(id: string): void {
    if (!this.docs.has(id)) return;
    if (this.orderIds.length === 1) {
      // Keep at least one board: clear it instead of removing.
      const doc = this.docs.get(id)!;
      doc.snapshot = emptySnapshot();
      this.board.loadSnapshot(cloneSnapshot(doc.snapshot));
      this.emitDocuments();
      return;
    }
    const idx = this.orderIds.indexOf(id);
    this.orderIds.splice(idx, 1);
    this.docs.delete(id);
    if (this.activeId === id) {
      const neighbor = this.orderIds[Math.min(idx, this.orderIds.length - 1)];
      this.setActive(neighbor);
    }
    this.emitDocuments();
  }

  /** Duplicate a document (without switching to it). Returns the new id. */
  duplicate(id: string): string | null {
    const doc = this.docs.get(id);
    if (!doc) return null;
    if (id === this.activeId) this.syncActive();
    const newId = nanoid();
    this.seq += 1;
    const idx = this.orderIds.indexOf(id);
    this.docs.set(newId, {
      id: newId,
      name: `${doc.name} copy`,
      snapshot: cloneSnapshot(this.docs.get(id)!.snapshot),
    });
    this.orderIds.splice(idx + 1, 0, newId);
    this.emitDocuments();
    return newId;
  }

  /** Reorder a document to a new index (for drag-to-reorder tabs). */
  reorder(id: string, toIndex: number): void {
    const from = this.orderIds.indexOf(id);
    if (from === -1) return;
    const clamped = Math.max(0, Math.min(toIndex, this.orderIds.length - 1));
    this.orderIds.splice(from, 1);
    this.orderIds.splice(clamped, 0, id);
    this.emitDocuments();
  }

  // ------------------------------------------------------------- Serialize

  toJSON(): WorkspaceSnapshot {
    this.syncActive();
    return {
      type: "openboard-workspace",
      version: 1,
      activeId: this.activeId,
      documents: this.orderIds.map((id) => {
        const d = this.docs.get(id)!;
        return { id: d.id, name: d.name, snapshot: cloneSnapshot(d.snapshot) };
      }),
    };
  }

  loadJSON(data: string | WorkspaceSnapshot): void {
    const ws: WorkspaceSnapshot =
      typeof data === "string" ? JSON.parse(data) : data;
    if (ws?.type !== "openboard-workspace" || !ws.documents?.length) {
      throw new Error("OmniBoard: invalid workspace snapshot");
    }
    this.docs.clear();
    this.orderIds = [];
    for (const d of ws.documents) {
      this.docs.set(d.id, { ...d, snapshot: cloneSnapshot(d.snapshot) });
      this.orderIds.push(d.id);
    }
    this.seq = ws.documents.length;
    this.activeId = this.docs.has(ws.activeId)
      ? ws.activeId
      : ws.documents[0].id;
    this.board.loadSnapshot(cloneSnapshot(this.docs.get(this.activeId)!.snapshot));
    this.emitDocuments();
    this.emit({ type: "activeChange", activeId: this.activeId });
  }

  // ------------------------------------------------------------- Events

  on<T extends BoardManagerEventType>(
    type: T,
    listener: (e: BoardManagerEventOf<T>) => void,
  ): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener as Listener);
    return () => this.off(type, listener);
  }

  off<T extends BoardManagerEventType>(
    type: T,
    listener: (e: BoardManagerEventOf<T>) => void,
  ): void {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  /** Detach the board listener and clear manager listeners. */
  destroy(): void {
    this.offBoardChange();
    this.listeners.clear();
  }

  // ------------------------------------------------------------- Internals

  private setActive(id: string): void {
    this.activeId = id;
    this.board.loadSnapshot(cloneSnapshot(this.docs.get(id)!.snapshot));
    this.emit({ type: "activeChange", activeId: id });
  }

  private syncActive(): void {
    const doc = this.docs.get(this.activeId);
    if (doc) doc.snapshot = this.board.getSnapshot();
  }

  private emitDocuments(): void {
    this.emit({
      type: "documentsChange",
      documents: this.list(),
      activeId: this.activeId,
    });
  }

  private emit(e: BoardManagerEvent): void {
    this.listeners.get(e.type)?.forEach((l) => l(e));
  }
}
