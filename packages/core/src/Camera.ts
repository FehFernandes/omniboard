import { clamp } from "./geometry";
import type { CameraState, Point } from "./types";

/**
 * Handles the transform between screen (pixel) space and world (scene) space.
 *
 * screen = (world + scroll) * zoom
 * world  = screen / zoom - scroll
 */
export class Camera {
  scrollX: number;
  scrollY: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;

  constructor(state?: Partial<CameraState>, minZoom = 0.05, maxZoom = 30) {
    this.scrollX = state?.scrollX ?? 0;
    this.scrollY = state?.scrollY ?? 0;
    this.zoom = state?.zoom ?? 1;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
  }

  getState(): CameraState {
    return { scrollX: this.scrollX, scrollY: this.scrollY, zoom: this.zoom };
  }

  setState(state: Partial<CameraState>): void {
    if (state.scrollX !== undefined) this.scrollX = state.scrollX;
    if (state.scrollY !== undefined) this.scrollY = state.scrollY;
    if (state.zoom !== undefined) {
      this.zoom = clamp(state.zoom, this.minZoom, this.maxZoom);
    }
  }

  screenToWorld(sx: number, sy: number): Point {
    return {
      x: sx / this.zoom - this.scrollX,
      y: sy / this.zoom - this.scrollY,
    };
  }

  worldToScreen(wx: number, wy: number): Point {
    return {
      x: (wx + this.scrollX) * this.zoom,
      y: (wy + this.scrollY) * this.zoom,
    };
  }

  /** Pan by a delta expressed in screen pixels. */
  panBy(dxScreen: number, dyScreen: number): void {
    this.scrollX += dxScreen / this.zoom;
    this.scrollY += dyScreen / this.zoom;
  }

  /** Zoom keeping the given screen anchor point stationary in world space. */
  zoomTo(nextZoom: number, anchorScreen: Point): void {
    const clamped = clamp(nextZoom, this.minZoom, this.maxZoom);
    const worldBefore = this.screenToWorld(anchorScreen.x, anchorScreen.y);
    this.zoom = clamped;
    const worldAfter = this.screenToWorld(anchorScreen.x, anchorScreen.y);
    this.scrollX += worldAfter.x - worldBefore.x;
    this.scrollY += worldAfter.y - worldBefore.y;
  }

  zoomBy(factor: number, anchorScreen: Point): void {
    this.zoomTo(this.zoom * factor, anchorScreen);
  }
}
