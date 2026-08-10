import type { Camera } from "./Camera";
import type { Point } from "./types";

export interface InputHandlers {
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
  onWheel(e: WheelEvent): void;
  onDoubleClick(e: MouseEvent): void;
  onKeyDown(e: KeyboardEvent): void;
  onKeyUp(e: KeyboardEvent): void;
  onDragOver(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  onContextMenu(e: MouseEvent): void;
}

/**
 * Manages all DOM event binding/unbinding for the board canvas.
 * Provides coordinate translation utilities (screen ↔ world).
 * Delegates actual event handling to the Board via the InputHandlers interface.
 */
export class InputManager {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private attached = false;

  // Bound listeners for cleanup
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundDblClick: (e: MouseEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundDragOver: (e: DragEvent) => void;
  private boundDrop: (e: DragEvent) => void;
  private boundPaste: (e: ClipboardEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;

  constructor(canvas: HTMLCanvasElement, camera: Camera, handlers: InputHandlers) {
    this.canvas = canvas;
    this.camera = camera;

    this.boundPointerDown = (e) => handlers.onPointerDown(e);
    this.boundPointerMove = (e) => handlers.onPointerMove(e);
    this.boundPointerUp = (e) => handlers.onPointerUp(e);
    this.boundWheel = (e) => handlers.onWheel(e);
    this.boundDblClick = (e) => handlers.onDoubleClick(e);
    this.boundKeyDown = (e) => handlers.onKeyDown(e);
    this.boundKeyUp = (e) => handlers.onKeyUp(e);
    this.boundDragOver = (e) => handlers.onDragOver(e);
    this.boundDrop = (e) => handlers.onDrop(e);
    this.boundPaste = (e) => handlers.onPaste(e);
    this.boundContextMenu = (e) => handlers.onContextMenu(e);
  }

  /** Translate a DOM pointer/mouse event to canvas-relative screen coordinates. */
  getScreenPoint(e: PointerEvent | MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Translate a DOM pointer/mouse event directly to world (scene) coordinates. */
  getWorldPoint(e: PointerEvent | MouseEvent): Point {
    const s = this.getScreenPoint(e);
    return this.camera.screenToWorld(s.x, s.y);
  }

  /** Attach all event listeners to canvas and window. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;

    this.canvas.addEventListener("pointerdown", this.boundPointerDown);
    window.addEventListener("pointermove", this.boundPointerMove);
    window.addEventListener("pointerup", this.boundPointerUp);
    this.canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.boundDblClick);
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
    this.canvas.addEventListener("dragover", this.boundDragOver);
    this.canvas.addEventListener("drop", this.boundDrop);
    window.addEventListener("paste", this.boundPaste);
    this.canvas.addEventListener("contextmenu", this.boundContextMenu);
  }

  /** Remove all event listeners. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    this.canvas.removeEventListener("pointerdown", this.boundPointerDown);
    window.removeEventListener("pointermove", this.boundPointerMove);
    window.removeEventListener("pointerup", this.boundPointerUp);
    this.canvas.removeEventListener("wheel", this.boundWheel);
    this.canvas.removeEventListener("dblclick", this.boundDblClick);
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    this.canvas.removeEventListener("dragover", this.boundDragOver);
    this.canvas.removeEventListener("drop", this.boundDrop);
    window.removeEventListener("paste", this.boundPaste);
    this.canvas.removeEventListener("contextmenu", this.boundContextMenu);
  }

  /** Set the canvas cursor style. */
  setCursor(cursor: string): void {
    this.canvas.style.cursor = cursor;
  }

  /** Get the canvas element (for pointer capture). */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  destroy(): void {
    this.detach();
  }
}
