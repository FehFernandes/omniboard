import type { Scene } from "./Scene";
import type { BoardElement } from "./types";

interface HistoryEntry {
  elements: BoardElement[];
}

/**
 * Snapshot-based undo/redo. Each committed change stores a deep-ish copy of
 * the scene's raw elements. Simple and robust for an MVP; can be swapped for
 * a command/diff based approach later.
 */
export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  private snapshot(scene: Scene): HistoryEntry {
    return { elements: cloneElements(scene.getAllRaw()) };
  }

  /** Record the current state as a restore point. Clears the redo stack. */
  record(scene: Scene): void {
    this.past.push(this.snapshot(scene));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(scene: Scene): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.snapshot(scene));
    scene.replaceAll(cloneElements(prev.elements));
    return true;
  }

  redo(scene: Scene): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.snapshot(scene));
    scene.replaceAll(cloneElements(next.elements));
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

function cloneElements(els: BoardElement[]): BoardElement[] {
  return els.map((el) => {
    const copy = { ...el } as BoardElement;
    if ("points" in copy && copy.points) {
      copy.points = copy.points.map((p) => ({ x: p.x, y: p.y }));
    }
    if ("pressures" in copy && copy.pressures) {
      copy.pressures = [...copy.pressures];
    }
    return copy;
  });
}
