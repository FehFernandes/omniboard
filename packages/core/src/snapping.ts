import type { Bounds } from "./types";

/** A single alignment guide line in world coordinates. */
export interface SnapLine {
  /** true = vertical line (constant x); false = horizontal line (constant y). */
  vertical: boolean;
  /** The fixed coordinate (x for vertical, y for horizontal). */
  coord: number;
  /** Start along the perpendicular axis (y for vertical, x for horizontal). */
  start: number;
  /** End along the perpendicular axis. */
  end: number;
}

export interface SnapResult {
  /** Adjustment to add to the moving selection's x to align it. */
  dx: number;
  /** Adjustment to add to the moving selection's y to align it. */
  dy: number;
  /** Guide lines to render while the snap is active. */
  guides: SnapLine[];
}

/**
 * Compute alignment snapping for a moving bounding box against other elements'
 * bounding boxes — the "smart guides" behavior from Miro/Figma/Excalidraw.
 *
 * It checks the moving box's left/center/right against every other box's
 * left/center/right (and likewise top/center/bottom), and returns the smallest
 * adjustment (within `threshold`, in world units) that makes an edge or center
 * line up, plus the guide lines to draw.
 *
 * X and Y are resolved independently, so an element can snap horizontally and
 * vertically at the same time.
 */
export function computeSnap(
  moving: Bounds,
  others: Bounds[],
  threshold: number,
): SnapResult {
  const mCx = (moving.minX + moving.maxX) / 2;
  const mCy = (moving.minY + moving.maxY) / 2;
  const movX = [moving.minX, mCx, moving.maxX];
  const movY = [moving.minY, mCy, moving.maxY];

  let bestX: { delta: number; coord: number; other: Bounds } | null = null;
  let bestY: { delta: number; coord: number; other: Bounds } | null = null;

  for (const o of others) {
    const oX = [o.minX, (o.minX + o.maxX) / 2, o.maxX];
    const oY = [o.minY, (o.minY + o.maxY) / 2, o.maxY];

    for (const mx of movX) {
      for (const tx of oX) {
        const d = tx - mx;
        if (
          Math.abs(d) <= threshold &&
          (!bestX || Math.abs(d) < Math.abs(bestX.delta))
        ) {
          bestX = { delta: d, coord: tx, other: o };
        }
      }
    }
    for (const my of movY) {
      for (const ty of oY) {
        const d = ty - my;
        if (
          Math.abs(d) <= threshold &&
          (!bestY || Math.abs(d) < Math.abs(bestY.delta))
        ) {
          bestY = { delta: d, coord: ty, other: o };
        }
      }
    }
  }

  const dx = bestX ? bestX.delta : 0;
  const dy = bestY ? bestY.delta : 0;
  const guides: SnapLine[] = [];

  if (bestX) {
    const o = bestX.other;
    guides.push({
      vertical: true,
      coord: bestX.coord,
      start: Math.min(moving.minY + dy, o.minY),
      end: Math.max(moving.maxY + dy, o.maxY),
    });
  }
  if (bestY) {
    const o = bestY.other;
    guides.push({
      vertical: false,
      coord: bestY.coord,
      start: Math.min(moving.minX + dx, o.minX),
      end: Math.max(moving.maxX + dx, o.maxX),
    });
  }

  return { dx, dy, guides };
}
