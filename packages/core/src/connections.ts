/**
 * Connection/anchor helpers for snapping arrows to elements (start and end).
 * Used by the Board during arrow creation/resize and when moving connected elements.
 */

import { elementBounds } from "./geometry";
import type { AnchorPosition, BoardElement, Bounds, Point } from "./types";

const ANCHOR_NAMES: AnchorPosition[] = ["top", "right", "bottom", "left"];

/** World-space position of each anchor on a given bounds. */
export function getAnchorPoints(b: Bounds): Record<AnchorPosition, Point> {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    center: { x: cx, y: cy },
    top: { x: cx, y: b.minY },
    right: { x: b.maxX, y: cy },
    bottom: { x: cx, y: b.maxY },
    left: { x: b.minX, y: cy },
  };
}

export interface ConnectionCandidate {
  element: BoardElement;
  anchor: AnchorPosition;
  point: Point;
  dist: number;
}

/**
 * Find the nearest element anchor to `world` within `threshold`.
 * Excludes elements in `exclude` (typically the arrow being created).
 */
export function findConnectionTarget(
  world: Point,
  elements: BoardElement[],
  exclude: Set<string>,
  threshold: number,
): ConnectionCandidate | null {
  let best: ConnectionCandidate | null = null;
  for (const el of elements) {
    if (exclude.has(el.id)) continue;
    // Only connect to shapes/rects/ellipses/tasks/etc (skip lines/freedraw/text)
    if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") continue;
    const b = elementBounds(el);
    const anchors = getAnchorPoints(b);
    for (const name of ANCHOR_NAMES) {
      const p = anchors[name];
      const d = Math.hypot(p.x - world.x, p.y - world.y);
      if (d <= threshold && (!best || d < best.dist)) {
        best = { element: el, anchor: name, point: p, dist: d };
      }
    }
  }
  return best;
}

/**
 * Resolve an element+anchor into a world-space point (for placing arrow endpoints).
 */
export function resolveAnchor(el: BoardElement, anchor: AnchorPosition): Point {
  const b = elementBounds(el);
  return getAnchorPoints(b)[anchor];
}

/**
 * Get all anchor points of an element as an array (for rendering indicators).
 */
export function getElementAnchors(el: BoardElement): { anchor: AnchorPosition; point: Point }[] {
  const b = elementBounds(el);
  const pts = getAnchorPoints(b);
  return ANCHOR_NAMES.map((a) => ({ anchor: a, point: pts[a] }));
}

/**
 * Distance (in screen px) that connection anchor dots sit OUTSIDE the border.
 *
 * It exists because the `n`/`e`/`s`/`w` resize handles sit exactly in the middle
 * of each edge — the same position as the anchors. With both things on the same
 * point, dragging to resize and dragging to pull an arrow competed for the same
 * click. Pushing the anchor dot outwards separates the two gestures.
 */
export const ANCHOR_HANDLE_GAP = 13;

/**
 * Radius (screen px) for grabbing a connection anchor dot.
 *
 * The dot is drawn with radius 5; the click target is twice that so the gesture
 * does not demand precision. It does not go past 10 because the resize handle
 * sits `ANCHOR_HANDLE_GAP` (13px) away and the anchor takes priority on the
 * click — a larger radius would steal resizing.
 */
export const ANCHOR_GRAB_RADIUS = 10;

/** Outward direction of each anchor, used to push it outside the element. */
const ANCHOR_DIRECTION: Record<AnchorPosition, Point> = {
  center: { x: 0, y: 0 },
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * Anchors to GRAB: `point` is where the anchor dot is drawn and clicked (outside
 * the element) and `attach` is where the arrow actually lands (on the border).
 * Keeping the two apart leaves the connection geometry intact.
 */
export function getElementAnchorHandles(
  el: BoardElement,
  zoom: number,
  gap: number = ANCHOR_HANDLE_GAP,
): { anchor: AnchorPosition; point: Point; attach: Point }[] {
  const offset = gap / zoom;
  return getElementAnchors(el).map(({ anchor, point }) => {
    const dir = ANCHOR_DIRECTION[anchor];
    return {
      anchor,
      attach: point,
      point: { x: point.x + dir.x * offset, y: point.y + dir.y * offset },
    };
  });
}

/** Types that take no connection (an arrow does not anchor to another arrow). */
export function isConnectable(el: BoardElement | null | undefined): boolean {
  return (
    !!el &&
    el.type !== "line" &&
    el.type !== "arrow" &&
    el.type !== "freedraw" &&
    el.type !== "text"
  );
}

/**
 * Padding (screen px) of the zone that keeps anchors visible, beyond `gap`.
 *
 * The dots sit OUTSIDE the border, so requiring the pointer INSIDE the element
 * made them disappear exactly when the user moved the mouse to grab them — the
 * gesture of pulling an arrow was nearly impossible. The zone covers the border,
 * the dots and a small buffer zone.
 */
export const ANCHOR_ZONE_PADDING = 12;

/**
 * Element whose anchors should be shown for a world point.
 *
 * We prefer the element under the cursor; if there is none, the first one (from
 * top to bottom) whose anchor zone contains the point. That way the dots stay
 * visible along the path between the element and them.
 */
export function findAnchorHost(
  world: Point,
  elements: BoardElement[],
  zoom: number,
  hit?: BoardElement | null,
  gap: number = ANCHOR_HANDLE_GAP,
  padding: number = ANCHOR_ZONE_PADDING,
): BoardElement | null {
  if (isConnectable(hit)) return hit ?? null;
  const margem = (gap + padding) / zoom;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isConnectable(el) || el.isDeleted) continue;
    const b = elementBounds(el);
    if (
      world.x >= b.minX - margem &&
      world.x <= b.maxX + margem &&
      world.y >= b.minY - margem &&
      world.y <= b.maxY + margem
    ) {
      return el;
    }
  }
  return null;
}

