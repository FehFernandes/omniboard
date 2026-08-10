/**
 * ToolManager — Manages registered tools and dispatches input events to the
 * active tool. Implements the ToolRegistry interface from plugin-types.ts.
 */

import type { Tool, ToolContext, ToolRegistry } from "../plugin-types";
import type { Point } from "../types";

export class ToolManager implements ToolRegistry {
  private tools = new Map<string, Tool>();
  private activeId: string | null = null;
  private ctx: ToolContext;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
  }

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  unregister(toolId: string): void {
    if (this.activeId === toolId) {
      this.tools.get(toolId)?.onDeactivate?.(this.ctx);
      this.activeId = null;
    }
    this.tools.delete(toolId);
  }

  get(toolId: string): Tool | undefined {
    return this.tools.get(toolId);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  getActive(): Tool | undefined {
    return this.activeId ? this.tools.get(this.activeId) : undefined;
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  setActive(toolId: string): void {
    if (this.activeId === toolId) return;
    const prev = this.activeId ? this.tools.get(this.activeId) : undefined;
    prev?.onDeactivate?.(this.ctx);
    this.activeId = toolId;
    const next = this.tools.get(toolId);
    next?.onActivate?.(this.ctx);
  }

  // ─── Event dispatch ─────────────────────────────────────────────────

  dispatchPointerDown(e: PointerEvent, world: Point): void {
    this.getActive()?.onPointerDown?.(this.ctx, e, world);
  }

  dispatchPointerMove(e: PointerEvent, world: Point): void {
    this.getActive()?.onPointerMove?.(this.ctx, e, world);
  }

  dispatchPointerUp(e: PointerEvent, world: Point): void {
    this.getActive()?.onPointerUp?.(this.ctx, e, world);
  }

  dispatchKeyDown(e: KeyboardEvent): boolean | void {
    return this.getActive()?.onKeyDown?.(this.ctx, e);
  }

  dispatchKeyUp(e: KeyboardEvent): void {
    this.getActive()?.onKeyUp?.(this.ctx, e);
  }

  dispatchDoubleClick(e: PointerEvent, world: Point): void {
    this.getActive()?.onDoubleClick?.(this.ctx, e, world);
  }

  /** Update the ToolContext (called when Board state changes). */
  updateContext(ctx: ToolContext): void {
    this.ctx = ctx;
  }
}
