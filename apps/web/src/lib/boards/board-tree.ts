// Board tree logic and drag & drop.
//
// Everything here is a pure function over the metadata (see board-meta.ts): it
// takes folders + boards and returns the structure or the set of changes to
// apply. It is kept apart from the component so it can be tested without a DOM
// and so React only has to render the result.

import type { BoardFolder, BoardMeta, BoardMetaMap } from './board-meta';

export interface BoardSummary {
  id: string;
  name: string;
}

export type TreeItem =
  | { kind: 'folder'; id: string; name: string; folder: BoardFolder }
  | { kind: 'board'; id: string; name: string; meta: BoardMeta };

export type ItemKind = TreeItem['kind'];

/** Where the dragged item will be dropped relative to the target. */
export type DropMode = 'before' | 'inside' | 'after';

export interface DragRef {
  kind: ItemKind;
  id: string;
}

/** Stable key per item — `id` alone could collide between a folder and a board. */
export const itemKey = (item: Pick<TreeItem, 'kind' | 'id'>) => `${item.kind}:${item.id}`;

const normalizeParent = (value: string | null | undefined) => value || null;

/**
 * children returns the direct contents of a parent, sorted.
 *
 * Criterion: `position` first (what the user defined by dragging); ties are
 * broken with folder before board and finally by name — so the list never
 * "jumps" when two items share a position (e.g. freshly created ones at 0).
 */
export function children(
  folders: readonly BoardFolder[],
  boards: readonly BoardSummary[],
  meta: BoardMetaMap,
  parentId: string | null,
): TreeItem[] {
  const items: TreeItem[] = [
    ...folders
      .filter((f) => normalizeParent(f.parentId) === parentId)
      .map((f): TreeItem => ({ kind: 'folder', id: f.id, name: f.name, folder: f })),
    ...boards
      .filter((b) => normalizeParent(meta[b.id]?.folderId) === parentId)
      .map((b): TreeItem => ({ kind: 'board', id: b.id, name: b.name, meta: meta[b.id] ?? {} })),
  ];

  return items.sort((a, b) => {
    const posA = a.kind === 'folder' ? a.folder.position : (a.meta.position ?? 0);
    const posB = b.kind === 'folder' ? b.folder.position : (b.meta.position ?? 0);
    if (posA !== posB) return posA - posB;
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

/** isDescendant tells whether `folderId` sits inside `ancestorId` (at any depth). */
export function isDescendant(
  folders: readonly BoardFolder[],
  folderId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(folderId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    if (seen.has(current.parentId)) return false; // cycle: bail out instead of hanging
    seen.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return false;
}

/** Chain of ancestors of a folder, from the immediate parent to the root. */
export function ancestors(folders: readonly BoardFolder[], folderId: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  let current = byId.get(folderId);
  while (current?.parentId) {
    out.push(current.parentId);
    current = byId.get(current.parentId);
  }
  return out;
}

/** Result of a move: what to write into the store. */
export interface MoveResult {
  boards: Record<string, BoardMeta>;
  folders: Record<string, Partial<BoardFolder>>;
  /** Reason for the refusal, when the move is invalid. */
  rejected?: string;
}

const EMPTY: MoveResult = { boards: {}, folders: {} };

/**
 * move computes the changes of moving an item inside `destParentId`, at position
 * `destIndex`.
 *
 * Strategy: it rebuilds the order of the destination container (and of the
 * source one, if different) and reassigns `position` sequentially. Reindexing is
 * simpler and more predictable than trying to space positions out, and the cost
 * is irrelevant at this scale.
 */
export function move(
  folders: readonly BoardFolder[],
  boards: readonly BoardSummary[],
  meta: BoardMetaMap,
  dragged: DragRef,
  destParentId: string | null,
  destIndex: number,
): MoveResult {
  if (dragged.kind === 'folder') {
    if (destParentId === dragged.id) {
      return { ...EMPTY, rejected: 'A folder cannot be moved inside itself' };
    }
    if (destParentId && isDescendant(folders, destParentId, dragged.id)) {
      return { ...EMPTY, rejected: 'A folder cannot be moved inside one of its own children' };
    }
  }

  const sourceParentId =
    dragged.kind === 'folder'
      ? normalizeParent(folders.find((f) => f.id === dragged.id)?.parentId)
      : normalizeParent(meta[dragged.id]?.folderId);

  const sameContainer = sourceParentId === destParentId;
  const key = itemKey(dragged);

  const destItems = children(folders, boards, meta, destParentId).filter(
    (item) => itemKey(item) !== key,
  );

  // When reordering inside the same container, removing the item before
  // inserting shifts every later index by 1 — hence the adjustment.
  const originalIndex = children(folders, boards, meta, destParentId).findIndex(
    (item) => itemKey(item) === key,
  );
  let index = destIndex;
  if (sameContainer && originalIndex >= 0 && originalIndex < destIndex) index -= 1;
  index = Math.max(0, Math.min(index, destItems.length));

  const movingItem =
    dragged.kind === 'folder'
      ? children(folders, boards, meta, sourceParentId).find((i) => itemKey(i) === key)
      : children(folders, boards, meta, sourceParentId).find((i) => itemKey(i) === key);
  if (!movingItem) return EMPTY;

  const ordered = [...destItems];
  ordered.splice(index, 0, movingItem);

  const result: MoveResult = { boards: {}, folders: {} };
  const assign = (items: TreeItem[], parentId: string | null) => {
    items.forEach((item, position) => {
      if (item.kind === 'folder') result.folders[item.id] = { parentId, position };
      else result.boards[item.id] = { folderId: parentId, position };
    });
  };

  assign(ordered, destParentId);
  // The source container is reindexed too, otherwise it is left with holes.
  if (!sameContainer) {
    assign(
      children(folders, boards, meta, sourceParentId).filter((item) => itemKey(item) !== key),
      sourceParentId,
    );
  }

  return result;
}

/**
 * dropTarget translates the pointer position over a row into (parent, index).
 *
 * The central band of a folder means "drop inside"; the edges mean
 * before/after, like in Noki's note manager.
 */
export function dropModeFor(item: Pick<TreeItem, 'kind'>, ratio: number): DropMode {
  if (item.kind === 'folder' && ratio >= 0.28 && ratio <= 0.72) return 'inside';
  return ratio < 0.5 ? 'before' : 'after';
}

/** Free position at the end of a container (used when creating new items). */
export function nextPosition(
  folders: readonly BoardFolder[],
  boards: readonly BoardSummary[],
  meta: BoardMetaMap,
  parentId: string | null,
): number {
  return children(folders, boards, meta, parentId).length;
}
