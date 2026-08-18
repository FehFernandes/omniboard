import { nanoid } from "./geometry";
import type { BoardElement } from "./types";

export interface ClipboardManagerDeps {
  getElements: () => BoardElement[];
  getSelectedIds: () => Set<string>;
  addElement: (el: BoardElement) => void;
  setSelection: (ids: string[]) => void;
  commitHistory: () => void;
  emitChange: () => void;
  markDirty: () => void;
}

/**
 * Manages internal clipboard operations: copy, paste, duplicate.
 */
export class ClipboardManager {
  private clipboard: BoardElement[] = [];
  private deps: ClipboardManagerDeps;

  constructor(deps: ClipboardManagerDeps) {
    this.deps = deps;
  }

  /** Whether there's anything in the clipboard to paste. */
  hasContent(): boolean {
    return this.clipboard.length > 0;
  }

  /** Copy the current selection into the internal clipboard. */
  copy(): void {
    const selected = this.deps
      .getElements()
      .filter((e) => this.deps.getSelectedIds().has(e.id));
    if (selected.length > 0) this.clipboard = selected.map(cloneElement);
  }

  /** Paste clipboard contents with a small offset and select them. */
  paste(offset = 16): void {
    if (this.clipboard.length === 0) return;
    this.deps.commitHistory();
    const newIds: string[] = [];
    for (const el of this.clipboard) {
      const copy = cloneElement(el);
      copy.id = nanoid();
      copy.x += offset;
      copy.y += offset;
      this.deps.addElement(copy);
      newIds.push(copy.id);
    }
    this.deps.setSelection(newIds);
    this.deps.emitChange();
    this.deps.markDirty();
  }

  /** Duplicate the current selection in place (offset) and select the copies. */
  duplicateSelected(offset = 16): void {
    if (this.deps.getSelectedIds().size === 0) return;
    this.deps.commitHistory();
    const selected = this.deps
      .getElements()
      .filter((e) => this.deps.getSelectedIds().has(e.id));
    const newIds: string[] = [];
    for (const el of selected) {
      const copy = cloneElement(el);
      copy.id = nanoid();
      copy.x += offset;
      copy.y += offset;
      this.deps.addElement(copy);
      newIds.push(copy.id);
    }
    this.deps.setSelection(newIds);
    this.deps.emitChange();
    this.deps.markDirty();
  }

  destroy(): void {
    this.clipboard = [];
  }
}

function cloneElement(el: BoardElement): BoardElement {
  const copy = { ...el } as BoardElement;
  if ("points" in copy && copy.points) {
    copy.points = copy.points.map((p) => ({ x: p.x, y: p.y }));
  }
  if ("pressures" in copy && copy.pressures) {
    copy.pressures = [...copy.pressures];
  }
  return copy;
}
