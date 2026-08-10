import {
  boundsFromPoints,
  distanceToSegment,
  elementAABB,
  elementCenter,
  frameNameHitBox,
  nanoid,
  pointInBounds,
  rotatePoint,
} from "./geometry";
import type {
  BoardElement,
  ElementStyle,
  ElementType,
  EmbedElement,
  FreedrawElement,
  ImageElement,
  LinearElement,
  Point,
  TasksElement,
  ShapeElement,
  StickyElement,
  FrameElement,
  LinkElement,
  NoteElement,
  TextElement,
  TextStyle,
} from "./types";

export const DEFAULT_STYLE: ElementStyle = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  opacity: 1,
  roughness: 0,
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 20,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: "normal",
  fontStyle: "normal",
  textAlign: "left",
  verticalAlign: "top",
};

export const DEFAULT_LABEL_STYLE: TextStyle = {
  ...DEFAULT_TEXT_STYLE,
  textAlign: "center",
  verticalAlign: "middle",
};

let versionCounter = 1;
export function nextVersion(): number {
  return versionCounter++;
}

export function createElement(
  type: ElementType,
  props: Partial<BoardElement> & { x: number; y: number },
  style: Partial<ElementStyle & TextStyle> = {},
): BoardElement {
  const bottom = {
    id: props.id ?? nanoid(),
    type,
    x: props.x,
    y: props.y,
    width: props.width ?? 0,
    height: props.height ?? 0,
    angle: props.angle ?? 0,
    version: nextVersion(),
    ...DEFAULT_STYLE,
    ...style,
  };

  switch (type) {
    case "rectangle":
    case "ellipse":
      return { ...bottom, type } as BoardElement;
    case "line":
    case "arrow":
      return {
        ...bottom,
        type,
        points: (props as Partial<LinearElement>).points ?? [
          { x: 0, y: 0 },
          { x: bottom.width, y: bottom.height },
        ],
        controlOffset: (props as Partial<LinearElement>).controlOffset,
        curveType: (props as Partial<LinearElement>).curveType,
        sourceId: (props as Partial<LinearElement>).sourceId,
        sourceAnchor: (props as Partial<LinearElement>).sourceAnchor,
        targetId: (props as Partial<LinearElement>).targetId,
        targetAnchor: (props as Partial<LinearElement>).targetAnchor,
      } as BoardElement;
    case "freedraw":
      return {
        ...bottom,
        type,
        points: (props as Partial<FreedrawElement>).points ?? [{ x: 0, y: 0 }],
        pressures: (props as Partial<FreedrawElement>).pressures,
      } as BoardElement;
    case "text":
      return {
        ...bottom,
        type,
        text: (props as Partial<TextElement>).text ?? "",
        fontSize: (props as Partial<TextElement>).fontSize ?? DEFAULT_TEXT_STYLE.fontSize,
        fontFamily:
          (props as Partial<TextElement>).fontFamily ??
          DEFAULT_TEXT_STYLE.fontFamily,
        fontWeight:
          (props as Partial<TextElement>).fontWeight ??
          DEFAULT_TEXT_STYLE.fontWeight,
        fontStyle:
          (props as Partial<TextElement>).fontStyle ??
          DEFAULT_TEXT_STYLE.fontStyle,
        textAlign: (props as Partial<TextElement>).textAlign ?? DEFAULT_TEXT_STYLE.textAlign,
        verticalAlign:
          (props as Partial<TextElement>).verticalAlign ??
          DEFAULT_TEXT_STYLE.verticalAlign,
      } as BoardElement;
    case "image":
      return {
        ...bottom,
        type,
        src: (props as Partial<ImageElement>).src ?? "",
        aspectRatio: (props as Partial<ImageElement>).aspectRatio,
        backgroundColor: "transparent",
      } as BoardElement;
    case "embed":
      return {
        ...bottom,
        type,
        src: (props as Partial<EmbedElement>).src ?? "",
        backgroundColor: "transparent",
      } as BoardElement;
    case "tasks":
      return {
        ...bottom,
        type,
        title: (props as Partial<TasksElement>).title ?? "Tarefas",
        items:
          (props as Partial<TasksElement>).items ?? [
            { text: "New task", done: false, priority: "medium" },
          ],
        backgroundColor: "transparent",
      } as BoardElement;
    case "shape":
      return {
        ...bottom,
        type,
        shape: (props as Partial<ShapeElement>).shape ?? "diamond",
      } as BoardElement;
    case "sticky":
      return {
        ...bottom,
        type,
        color: (props as Partial<StickyElement>).color ?? "#FFF9B1",
        text: (props as Partial<StickyElement>).text ?? "",
        backgroundColor: "transparent",
        strokeWidth: 0,
      } as BoardElement;
    case "frame":
      return {
        ...bottom,
        type,
        // Default name: the label has to exist for the user to discover that it
        // can be renamed (double click on the name, top-left corner).
        title: (props as Partial<FrameElement>).title ?? "Frame",
        backgroundColor: "#ffffff",
        strokeColor: "#d4d4d8",
        strokeWidth: 1.5,
      } as BoardElement;
    case "link":
      return {
        ...bottom,
        type,
        targetId: (props as Partial<LinkElement>).targetId,
        label: (props as Partial<LinkElement>).label ?? "",
        subtitle: (props as Partial<LinkElement>).subtitle,
        backgroundColor: "#eef2ff",
        strokeColor: "#4f46e5",
        strokeWidth: 1.5,
      } as BoardElement;
    case "note":
      return {
        ...bottom,
        type,
        title: (props as Partial<NoteElement>).title ?? "",
        text: (props as Partial<NoteElement>).text ?? "",
        color: (props as Partial<NoteElement>).color ?? "#f59e0b",
        backgroundColor: "#ffffff",
        strokeColor: "#d4d4d8",
        strokeWidth: 1.5,
      } as BoardElement;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown element type: ${_exhaustive as string}`);
    }
  }
}

/** Normalize negative width/height (e.g. after dragging up-left) into a top-left origin. */
export function normalizeElement<T extends BoardElement>(el: T): T {
  // Linear elements (line/arrow) store their geometry in `points` relative to
  // (x, y). Simply flipping width/height would leave the points pointing the
  // wrong way, so we re-anchor the origin to the points' bounding box and remap
  // the points to stay relative to that origin. This keeps the visible shape in
  // place while making the bounding box (used for selection + labels) tight and
  // correct.
  if ((el.type === "line" || el.type === "arrow") && "points" in el) {
    const lin = el as unknown as LinearElement;
    if (lin.points.length === 0) return el;
    const b = boundsFromPoints(lin.points);
    const points = lin.points.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }));
    return {
      ...el,
      x: lin.x + b.minX,
      y: lin.y + b.minY,
      width: b.maxX - b.minX,
      height: b.maxY - b.minY,
      points,
    } as T;
  }

  let { x, y, width, height } = el;
  if (width < 0) {
    x = x + width;
    width = -width;
  }
  if (height < 0) {
    y = y + height;
    height = -height;
  }
  return { ...el, x, y, width, height };
}

/**
 * Hit test a single element at a world-space point.
 * `threshold` is in world units (already scaled for zoom by the caller).
 */
export function hitTestElement(
  el: BoardElement,
  point: Point,
  threshold = 6,
): boolean {
  const center = elementCenter(el);
  // Transform the query point into the element's local (unrotated) frame.
  const local = el.angle ? rotatePoint(point, center, -el.angle) : point;

  switch (el.type) {
    case "rectangle":
    case "text": {
      const aabb = elementAABB(el);
      if (el.type === "text" || el.backgroundColor !== "transparent") {
        return pointInBounds(local, aabb, threshold);
      }
      // Outline-only hit test for the 4 edges.
      return pointNearRectOutline(local, aabb, threshold + el.strokeWidth);
    }
    case "image":
    case "embed":
    case "tasks":
    case "shape":
    case "sticky":
    case "link":
    case "note": {
      // Solid elements: hit anywhere inside.
      return pointInBounds(local, elementAABB(el), threshold);
    }
    case "frame": {
      // The name sits OUTSIDE the border (above, to the left). Including its
      // strip in the hit-test is what makes the name clickable: selecting,
      // dragging the frame by its title and renaming with a double click.
      if (pointInBounds(local, elementAABB(el), threshold)) return true;
      const faixa = frameNameHitBox(el as FrameElement);
      return faixa ? pointInBounds(local, faixa, threshold) : false;
    }
    case "ellipse": {
      const rx = el.width / 2;
      const ry = el.height / 2;
      if (rx === 0 || ry === 0) return false;
      const nx = (local.x - center.x) / rx;
      const ny = (local.y - center.y) / ry;
      const d = nx * nx + ny * ny;
      if (el.backgroundColor !== "transparent") return d <= 1.05;
      // near the ring
      const t = threshold / Math.min(rx, ry);
      return d <= (1 + t) ** 2 && d >= (1 - t) ** 2 - 0.05;
    }
    case "line":
    case "arrow":
    case "freedraw": {
      const lin = el as import("./types").LinearElement;
      const pts = lin.points;
      const t = threshold + el.strokeWidth + 4; // extra tolerance for easier grabbing

      // Check if this is a curved 2-point line/arrow.
      const co = lin.controlOffset;
      const isCurved =
        (el.type === "arrow" || el.type === "line") &&
        pts.length === 2 &&
        ((co && (co.x !== 0 || co.y !== 0)) || lin.curveType === "curve");

      if (isCurved) {
        // Sample the quadratic bezier and test distance to each segment.
        const p0 = { x: el.x + pts[0].x, y: el.y + pts[0].y };
        const pN = { x: el.x + pts[1].x, y: el.y + pts[1].y };
        const mx = (p0.x + pN.x) / 2;
        const my = (p0.y + pN.y) / 2;
        let cx: number, cy: number;
        if (co && (co.x !== 0 || co.y !== 0)) {
          cx = mx + co.x;
          cy = my + co.y;
        } else {
          const dx = pN.x - p0.x;
          const dy = pN.y - p0.y;
          const len = Math.hypot(dx, dy) || 1;
          cx = mx - (dy / len) * (len * 0.3);
          cy = my + (dx / len) * (len * 0.3);
        }
        // Sample 12 segments along the quadratic bezier.
        const N = 12;
        let prev = p0;
        for (let i = 1; i <= N; i++) {
          const tt = i / N;
          const inv = 1 - tt;
          const sx = inv * inv * p0.x + 2 * inv * tt * cx + tt * tt * pN.x;
          const sy = inv * inv * p0.y + 2 * inv * tt * cy + tt * tt * pN.y;
          const seg = { x: sx, y: sy };
          if (distanceToSegment(point, prev, seg) <= t) return true;
          prev = seg;
        }
        return false;
      }

      for (let i = 0; i < pts.length - 1; i++) {
        const a = { x: el.x + pts[i].x, y: el.y + pts[i].y };
        const b = { x: el.x + pts[i + 1].x, y: el.y + pts[i + 1].y };
        const qa = el.angle ? rotatePoint(a, center, el.angle) : a;
        const qb = el.angle ? rotatePoint(b, center, el.angle) : b;
        if (distanceToSegment(point, qa, qb) <= t) return true;
      }
      return false;
    }
    default: {
      const _exhaustive: never = el;
      return Boolean(_exhaustive);
    }
  }
}

function pointNearRectOutline(
  p: Point,
  aabb: { minX: number; minY: number; maxX: number; maxY: number },
  t: number,
): boolean {
  const corners = [
    { x: aabb.minX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.maxY },
    { x: aabb.minX, y: aabb.maxY },
  ];
  for (let i = 0; i < 4; i++) {
    if (distanceToSegment(p, corners[i], corners[(i + 1) % 4]) <= t) return true;
  }
  return false;
}
