import type { Point, TasksElement } from "./types";

/**
 * Shared geometry for the tasks card so the renderer and the hit-test agree
 * pixel-for-pixel. All values are in world units (the card is drawn at its
 * world size and scaled by the camera zoom like any other element).
 */
export const TASKS_STYLE = {
  panel: "#303030",
  onPanel: "#ffffff",
  yellow: "#FFD85F",
  check: "#303030",
  track: "rgba(255,255,255,0.10)",
  rowHover: "rgba(255,255,255,0.05)",
  textDone: "rgba(255,255,255,0.35)",
  muted: "rgba(255,255,255,0.50)",
  border: "rgba(255,255,255,0.25)",
  addBg: "rgba(255,255,255,0.10)",
  radius: 24,
  pad: 16,
  headerH: 24,
  barTopGap: 12,
  barH: 6,
  listTopGap: 14,
  rowH: 30,
  addH: 34,
  addGap: 10,
  checkbox: 18,
  titleSize: 16,
  countSize: 13,
  textSize: 13.5,
} as const;

export const PRIORITY_COLOR: Record<string, string> = {
  high: TASKS_STYLE.yellow,
  medium: "rgba(255,255,255,0.5)",
  low: "rgba(255,255,255,0.25)",
  // Values from snapshots saved before the priorities were renamed to English.
  // Kept as aliases so an old board still renders with the same colors.
  alta: TASKS_STYLE.yellow,
  média: "rgba(255,255,255,0.5)",
  baixa: "rgba(255,255,255,0.25)",
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TasksRow {
  index: number;
  rect: Rect;
  checkbox: Rect;
}

export interface TasksLayout {
  innerX: number;
  innerW: number;
  headerY: number;
  barY: number;
  barH: number;
  rows: TasksRow[];
  addButton: Rect;
}

/** Compute the on-card layout (header, progress bar, visible rows, add button). */
export function tasksLayout(el: TasksElement): TasksLayout {
  const S = TASKS_STYLE;
  const innerX = el.x + S.pad;
  const innerW = Math.max(0, el.width - S.pad * 2);
  const headerY = el.y + S.pad;
  const barY = headerY + S.headerH + S.barTopGap;
  const listTop = barY + S.barH + S.listTopGap;
  const addY = el.y + el.height - S.pad - S.addH;
  const listBottom = addY - S.addGap;

  const rows: TasksRow[] = [];
  for (let i = 0; i < el.items.length; i++) {
    const rowY = listTop + i * S.rowH;
    if (rowY + S.rowH > listBottom) break; // clipped (overflow)
    rows.push({
      index: i,
      rect: { x: innerX, y: rowY, w: innerW, h: S.rowH },
      checkbox: {
        x: innerX,
        y: rowY + (S.rowH - S.checkbox) / 2,
        w: S.checkbox,
        h: S.checkbox,
      },
    });
  }

  return {
    innerX,
    innerW,
    headerY,
    barY,
    barH: S.barH,
    rows,
    addButton: { x: innerX, y: addY, w: innerW, h: S.addH },
  };
}

const inRect = (p: Point, r: Rect): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export type TasksHit =
  | { type: "toggle"; index: number }
  | { type: "add" }
  | null;

/** Which interactive region (if any) a world point hits on a tasks card. */
export function tasksHitTest(el: TasksElement, p: Point): TasksHit {
  const L = tasksLayout(el);
  if (inRect(p, L.addButton)) return { type: "add" };
  for (const row of L.rows) {
    if (inRect(p, row.rect)) return { type: "toggle", index: row.index };
  }
  return null;
}
