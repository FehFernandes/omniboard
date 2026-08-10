import type { BoardElement, Bounds, Point } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Frame name: plain text above the border, LEFT-aligned.
 *
 * Size in world units (scales with zoom like the rest of the drawing) and gap
 * to the border. They live here, and not in the renderer, because the hit-test
 * and the inline editor need the same geometry — if each computed its own, the
 * text would jump when entering edit mode and the click area would not match
 * what is on screen.
 */
export const FRAME_NAME_FONT_SIZE = 14;
export const FRAME_NAME_GAP = 5;

/** Bottom-left corner (baseline) of a frame name. */
export function frameNameOrigin(el: { x: number; y: number }): Point {
  return { x: el.x, y: el.y - FRAME_NAME_GAP };
}

/**
 * Clickable strip of the name, above the border.
 *
 * The width is an ESTIMATE from the character count (the hit-test is pure, with
 * no canvas to measure text): ~0.55 of the font size per glyph in system-ui. It
 * is off by a little, and the click threshold covers the difference. Capped at
 * the frame width so it does not create an invisible area beside it.
 */
export function frameNameHitBox(el: {
  x: number;
  y: number;
  width: number;
  title?: string;
  label?: string;
}): Bounds | null {
  const name = el.title || el.label;
  if (!name) return null;
  const fs = FRAME_NAME_FONT_SIZE;
  const estimated = name.length * fs * 0.55;
  const width = Math.min(Math.max(estimated, fs * 2), Math.max(Math.abs(el.width), fs * 2));
  return {
    minX: el.x,
    maxX: el.x + width,
    minY: el.y - fs - FRAME_NAME_GAP * 2,
    maxY: el.y,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Rotate point `p` around `center` by `angle` radians. */
export function rotatePoint(p: Point, center: Point, angle: number): Point {
  if (angle === 0) return { x: p.x, y: p.y };
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * c - dy * s,
    y: center.y + dx * s + dy * c,
  };
}

export function elementCenter(el: BoardElement): Point {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** Axis-aligned bounds ignoring rotation. */
export function elementAABB(el: BoardElement): Bounds {
  const minX = Math.min(el.x, el.x + el.width);
  const minY = Math.min(el.y, el.y + el.height);
  const maxX = Math.max(el.x, el.x + el.width);
  const maxY = Math.max(el.y, el.y + el.height);
  return { minX, minY, maxX, maxY };
}

/** Bounds that fully contain a (possibly rotated) element. */
export function elementBounds(el: BoardElement): Bounds {
  const c = elementCenter(el);
  const aabb = elementAABB(el);
  if (!el.angle) return aabb;
  const corners: Point[] = [
    { x: aabb.minX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.maxY },
    { x: aabb.minX, y: aabb.maxY },
  ].map((p) => rotatePoint(p, c, el.angle));
  return boundsFromPoints(corners);
}

export function boundsFromPoints(points: Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function getElementsBounds(els: BoardElement[]): Bounds | null {
  if (els.length === 0) return null;
  let acc = elementBounds(els[0]);
  for (let i = 1; i < els.length; i++) {
    acc = unionBounds(acc, elementBounds(els[i]));
  }
  return acc;
}

export function pointInBounds(p: Point, b: Bounds, pad = 0): boolean {
  return (
    p.x >= b.minX - pad &&
    p.x <= b.maxX + pad &&
    p.y >= b.minY - pad &&
    p.y <= b.maxY + pad
  );
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

/** Shortest distance from point p to segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

let idCounter = 0;
/** Small, dependency-free unique id. */
export function nanoid(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8) +
    "-" +
    idCounter.toString(36)
  );
}
