import { nextVersion } from "./elements";
import type { BoardElement } from "./types";

/**
 * Ordered store of elements. Order in `order` array = z-index (last = top).
 * Kept intentionally simple; mutations return new element references so
 * consumers can diff cheaply.
 */
export class Scene {
  private elements = new Map<string, BoardElement>();
  private order: string[] = [];

  constructor(initial: BoardElement[] = []) {
    this.replaceAll(initial);
  }

  get size(): number {
    return this.order.length;
  }

  getElement(id: string): BoardElement | undefined {
    return this.elements.get(id);
  }

  /** All non-deleted elements in z-order (bottom -> top). */
  getElements(): BoardElement[] {
    const out: BoardElement[] = [];
    for (const id of this.order) {
      const el = this.elements.get(id);
      if (el && !el.isDeleted) out.push(el);
    }
    return out;
  }

  /** Raw elements including deleted (used for history snapshots). */
  getAllRaw(): BoardElement[] {
    return this.order
      .map((id) => this.elements.get(id))
      .filter((e): e is BoardElement => Boolean(e));
  }

  add(el: BoardElement): BoardElement {
    if (!this.elements.has(el.id)) this.order.push(el.id);
    this.elements.set(el.id, el);
    return el;
  }

  addMany(els: BoardElement[]): void {
    for (const el of els) this.add(el);
  }

  update(id: string, patch: Partial<BoardElement>): BoardElement | undefined {
    const prev = this.elements.get(id);
    if (!prev) return undefined;
    const next = {
      ...prev,
      ...patch,
      version: nextVersion(),
    } as BoardElement;
    this.elements.set(id, next);
    return next;
  }

  /** Soft-delete: marks element deleted but keeps it for undo. */
  remove(id: string): void {
    const el = this.elements.get(id);
    if (el) this.elements.set(id, { ...el, isDeleted: true, version: nextVersion() });
  }

  removeMany(ids: string[]): void {
    for (const id of ids) this.remove(id);
  }

  /** Move an element to the top of the z-order. */
  bringToFront(id: string): void {
    const idx = this.order.indexOf(id);
    if (idx === -1 || idx === this.order.length - 1) return;
    this.order.splice(idx, 1);
    this.order.push(id);
  }

  sendToBack(id: string): void {
    const idx = this.order.indexOf(id);
    if (idx <= 0) return;
    this.order.splice(idx, 1);
    this.order.unshift(id);
  }

  replaceAll(els: BoardElement[]): void {
    this.elements.clear();
    this.order = [];
    for (const el of els) {
      this.elements.set(el.id, el);
      this.order.push(el.id);
    }
  }

  clear(): void {
    this.replaceAll([]);
  }
}
