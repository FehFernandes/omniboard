import { elementCenter, rotatePoint } from "./geometry";
import type { BoardElement, Bounds, Point } from "./types";

export type HandleName =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "rotate";

export interface Handle {
  name: HandleName;
  /** World-space center of the handle. */
  point: Point;
}

/** Size of a resize handle in screen pixels. */
export const HANDLE_SIZE = 8;
/** Distance of the rotate handle above the top edge, in screen pixels. */
export const ROTATE_OFFSET = 24;

/**
 * Compute handle positions for a single element (or the union bounds passed in).
 * `zoom` converts the pixel offsets into world units.
 */
export function getHandles(
  bounds: Bounds,
  angle: number,
  zoom: number,
): Handle[] {
  const { minX, minY, maxX, maxY } = bounds;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const center = { x: cx, y: cy };
  const rotateGap = ROTATE_OFFSET / zoom;

  const raw: Record<HandleName, Point> = {
    nw: { x: minX, y: minY },
    n: { x: cx, y: minY },
    ne: { x: maxX, y: minY },
    e: { x: maxX, y: cy },
    se: { x: maxX, y: maxY },
    s: { x: cx, y: maxY },
    sw: { x: minX, y: maxY },
    w: { x: minX, y: cy },
    rotate: { x: cx, y: minY - rotateGap },
  };

  return (Object.keys(raw) as HandleName[]).map((name) => ({
    name,
    point: angle ? rotatePoint(raw[name], center, angle) : raw[name],
  }));
}

/** Return the handle hit by a world-space point, or null. */
export function hitTestHandle(
  handles: Handle[],
  point: Point,
  zoom: number,
): HandleName | null {
  const r = (HANDLE_SIZE / zoom) * 1.2;
  for (const h of handles) {
    if (Math.abs(point.x - h.point.x) <= r && Math.abs(point.y - h.point.y) <= r) {
      return h.name;
    }
  }
  return null;
}

export const RESIZE_CURSORS: Record<HandleName, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  rotate: "grab",
};

/**
 * Resize an element given the dragged handle and the pointer delta in world space.
 * Rotation is ignored for the MVP resize math (handles axis-aligned resize on the
 * element's local frame is approximated for unrotated elements; rotated elements
 * resize along world axes).
 */
export function resizeElement(
  el: BoardElement,
  handle: HandleName,
  world: Point,
): Partial<BoardElement> {
  let { x, y, width, height } = el;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes("w")) {
    width = right - world.x;
    x = world.x;
  }
  if (handle.includes("e")) {
    width = world.x - x;
  }
  if (handle.includes("n")) {
    height = bottom - world.y;
    y = world.y;
  }
  if (handle.includes("s")) {
    height = world.y - y;
  }

  return { x, y, width, height };
}

/** Angle (radians) from element center to a world point, used for rotation. */
export function rotationFromPointer(el: BoardElement, world: Point): number {
  const c = elementCenter(el);
  return Math.atan2(world.y - c.y, world.x - c.x) + Math.PI / 2;
}
