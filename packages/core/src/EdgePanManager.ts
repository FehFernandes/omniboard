/**
 * EdgePanManager — Moves the camera when the mouse hovers near the edges of
 * the canvas, like in League of Legends / RTS games.
 *
 * Only pans on left, right, and bottom edges (not top, to avoid conflict with
 * browser UI). Stops immediately when the mouse leaves the window.
 */

import type { Camera } from "./Camera";

export interface EdgePanOptions {
  /** Width of the hot zone in pixels from each edge. Default: 15 */
  edgeSize?: number;
  /** Pan speed in px/frame at the very edge. Default: 16 */
  speed?: number;
  /** Whether edge panning is initially enabled. Default: true */
  enabled?: boolean;
}

export interface EdgePanManagerDeps {
  camera: Camera;
  canvas: HTMLCanvasElement;
  onPan: () => void; // called after each pan (to emit cameraChange + markDirty)
}

export class EdgePanManager {
  private camera: Camera;
  private canvas: HTMLCanvasElement;
  private onPan: () => void;

  private enabled: boolean;
  private edgeSize: number;
  private speed: number;

  private mouseX = -1;
  private mouseY = -1;
  private mouseInWindow = true;
  private canvasRect: DOMRect | null = null;
  private rafId: number | null = null;
  private looping = false;

  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;
  private boundMouseEnter: () => void;

  constructor(deps: EdgePanManagerDeps, options: EdgePanOptions = {}) {
    this.camera = deps.camera;
    this.canvas = deps.canvas;
    this.onPan = deps.onPan;

    this.enabled = options.enabled ?? true;
    this.edgeSize = options.edgeSize ?? 15;
    this.speed = options.speed ?? 16;

    this.boundMouseMove = (e) => this.onMouseMove(e);
    this.boundMouseLeave = () => this.onWindowLeave();
    this.boundMouseEnter = () => { this.mouseInWindow = true; };

    if (this.enabled) this.attach();
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.attach();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.detach();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEdgeSize(px: number): void {
    this.edgeSize = Math.max(1, px);
  }

  getEdgeSize(): number {
    return this.edgeSize;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(1, speed);
  }

  getSpeed(): number {
    return this.speed;
  }

  destroy(): void {
    this.detach();
  }

  // ─── Private ────────────────────────────────────────────────────────

  private attach(): void {
    window.addEventListener("mousemove", this.boundMouseMove);
    document.addEventListener("mouseleave", this.boundMouseLeave);
    document.addEventListener("mouseenter", this.boundMouseEnter);
  }

  private detach(): void {
    window.removeEventListener("mousemove", this.boundMouseMove);
    document.removeEventListener("mouseleave", this.boundMouseLeave);
    document.removeEventListener("mouseenter", this.boundMouseEnter);
    this.stopLoop();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.mouseInWindow) return;

    this.canvasRect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;

    const delta = this.computePanDelta();
    if (delta.x !== 0 || delta.y !== 0) {
      if (!this.looping) this.startLoop();
    } else {
      if (this.looping) this.stopLoop();
    }
  }

  private onWindowLeave(): void {
    this.mouseInWindow = false;
    this.stopLoop();
  }

  private startLoop(): void {
    if (this.looping) return;
    this.looping = true;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    this.looping = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (): void => {
    if (!this.looping || !this.mouseInWindow) {
      this.looping = false;
      this.rafId = null;
      return;
    }

    const delta = this.computePanDelta();
    if (delta.x !== 0 || delta.y !== 0) {
      this.camera.panBy(delta.x, delta.y);
      this.onPan();
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.looping = false;
      this.rafId = null;
    }
  };

  private computePanDelta(): { x: number; y: number } {
    if (!this.canvasRect || !this.mouseInWindow) return { x: 0, y: 0 };

    const rect = this.canvasRect;
    const edge = this.edgeSize;
    const mx = this.mouseX;
    const my = this.mouseY;

    // Mouse must be inside the canvas area.
    if (
      mx < rect.left || mx > rect.right ||
      my < rect.top || my > rect.bottom
    ) {
      return { x: 0, y: 0 };
    }

    const relX = mx - rect.left;
    const relY = my - rect.top;
    const w = rect.width;
    const h = rect.height;

    let panX = 0;
    let panY = 0;

    // Left edge
    if (relX < edge) {
      panX = this.speed * (1 - relX / edge);
    }
    // Right edge
    else if (relX > w - edge) {
      panX = -this.speed * (1 - (w - relX) / edge);
    }

    // Bottom edge only (no top edge — avoids conflict with browser tabs/UI)
    if (relY > h - edge) {
      panY = -this.speed * (1 - (h - relY) / edge);
    }

    return { x: panX, y: panY };
  }
}
