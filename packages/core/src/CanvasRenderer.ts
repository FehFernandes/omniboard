import type { Camera } from "./Camera";
import { elementCenter, frameNameOrigin, FRAME_NAME_FONT_SIZE, getElementsBounds } from "./geometry";
import { getHandles, HANDLE_SIZE } from "./selection";
import type { Scene } from "./Scene";
import type { ThemePalette } from "./themes";
import type {
  BoardElement,
  Bounds,
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
} from "./types";
import type { SnapLine } from "./snapping";
import { PRIORITY_COLOR, TASKS_STYLE, tasksLayout } from "./tasks";

export interface RenderState {
  scene: Scene;
  camera: Camera;
  selectedIds: Set<string>;
  /** Selection rectangle in world coords while box-selecting. */
  selectionBox?: Bounds | null;
  background: string;
  grid: boolean;
  /** Theme colors for grid/selection. */
  palette: ThemePalette;
  /** Standalone text element being edited via overlay (skip drawing it). */
  editingTextId?: string | null;
  /** Element whose centered label is being edited (skip drawing its label). */
  editingLabelId?: string | null;
  /** Loaded <img> elements keyed by their `src`, for drawing image elements. */
  imageCache?: Map<string, HTMLImageElement>;
  /** Resize handle size in screen px (defaults to HANDLE_SIZE). */
  handleSize?: number;
  /** Resize handle fill color (defaults to the background). */
  handleFill?: string;
  /** Grid dot spacing in world units (defaults to 20). */
  gridSpacing?: number;
  /** Background pattern style (defaults to "dots"). */
  gridPattern?: import("./types").GridPattern;
  /** When set, non-selected elements are dimmed (focus mode). */
  focusMode?: boolean;
  /** Alignment guide lines to draw (while dragging with snap). */
  snapGuides?: SnapLine[];
  /** Color of the alignment guide lines. */
  snapColor?: string;
  /** Connection indicator while creating an arrow near an anchor. */
  connectionIndicator?: { point: Point; anchors: { anchor: string; point: Point }[] } | null;
  /** Anchors shown on hover (clickable to start an arrow). */
  hoverAnchors?:
    | {
        elementId: string;
        anchors: { anchor: string; point: Point; attach?: Point }[];
        /** Anchor under the cursor, drawn highlighted. */
        active?: string;
      }
    | null;
}

/** Padding (world units) between an element's edge and its centered label. */
const LABEL_PADDING = 6;
const LABEL_FONT = "system-ui, -apple-system, sans-serif";

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  width = 0;
  height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OmniBoard: 2D canvas context not available");
    this.ctx = ctx;
  }

  /** Resize the backing store to match CSS size * devicePixelRatio. */
  resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1): void {
    this.dpr = dpr;
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  render(state: RenderState): void {
    const { ctx } = this;
    const { camera } = state;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // background
    if (state.background && state.background !== "transparent") {
      ctx.fillStyle = state.background;
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      ctx.clearRect(0, 0, this.width, this.height);
    }

    // world transform
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(camera.scrollX, camera.scrollY);

    if (state.grid) this.drawGrid(camera, state.palette.grid, state.gridSpacing ?? 20, state.gridPattern ?? "dots");

    const focus = state.focusMode && state.selectedIds.size > 0;
    for (const el of state.scene.getElements()) {
      if (el.id === state.editingTextId) continue;
      if (focus && !state.selectedIds.has(el.id)) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        this.drawElement(el, state);
        ctx.restore();
      } else {
        this.drawElement(el, state);
      }
    }

    if (state.selectedIds.size > 0) {
      this.drawSelection(state);
    }

    if (state.selectionBox) {
      this.drawSelectionBox(state.selectionBox, camera.zoom, state.palette);
    }

    if (state.snapGuides && state.snapGuides.length > 0) {
      this.drawSnapGuides(
        state.snapGuides,
        camera.zoom,
        state.snapColor ?? "#f0466e",
      );
    }

    if (state.connectionIndicator) {
      this.drawConnectionIndicator(state.connectionIndicator, camera.zoom, state.palette.selection);
    }

    if (state.hoverAnchors) {
      this.drawHoverAnchors(state.hoverAnchors, camera.zoom, state.palette.selection);
    }

    ctx.restore();
  }

  private drawHoverAnchors(
    ha: {
      elementId: string;
      anchors: { anchor: string; point: Point; attach?: Point }[];
      active?: string;
    },
    zoom: number,
    color: string,
  ): void {
    const { ctx } = this;
    ctx.save();
    const r = 5 / zoom;
    ctx.lineWidth = 1.5 / zoom;
    for (const a of ha.anchors) {
      // The dot under the cursor grows and inverts its colors: it is the visual
      // feedback for "drag from here to create an arrow".
      const ativa = a.anchor === ha.active;
      ctx.beginPath();
      ctx.arc(a.point.x, a.point.y, ativa ? r * 1.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = ativa ? color : "#ffffff";
      ctx.strokeStyle = ativa ? "#ffffff" : color;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawConnectionIndicator(
    ind: { point: Point; anchors: { anchor: string; point: Point }[] },
    zoom: number,
    color: string,
  ): void {
    const { ctx } = this;
    ctx.save();
    const r = 4 / zoom;
    // Draw all anchors as small circles.
    ctx.fillStyle = "transparent";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 / zoom;
    for (const a of ind.anchors) {
      ctx.beginPath();
      ctx.arc(a.point.x, a.point.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Highlight the active snap point.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ind.point.x, ind.point.y, r * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSnapGuides(guides: SnapLine[], zoom: number, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([]);
    const tick = 3 / zoom;
    for (const g of guides) {
      ctx.beginPath();
      if (g.vertical) {
        ctx.moveTo(g.coord, g.start);
        ctx.lineTo(g.coord, g.end);
        // small end ticks
        ctx.moveTo(g.coord - tick, g.start);
        ctx.lineTo(g.coord + tick, g.start);
        ctx.moveTo(g.coord - tick, g.end);
        ctx.lineTo(g.coord + tick, g.end);
      } else {
        ctx.moveTo(g.start, g.coord);
        ctx.lineTo(g.end, g.coord);
        ctx.moveTo(g.start, g.coord - tick);
        ctx.lineTo(g.start, g.coord + tick);
        ctx.moveTo(g.end, g.coord - tick);
        ctx.lineTo(g.end, g.coord + tick);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGrid(
    camera: Camera,
    color: string,
    spacing: number,
    pattern: import("./types").GridPattern = "dots",
  ): void {
    if (pattern === "none") return;
    const { ctx } = this;
    const topLeft = camera.screenToWorld(0, 0);
    const bottomRight = camera.screenToWorld(this.width, this.height);
    const startX = Math.floor(topLeft.x / spacing) * spacing;
    const startY = Math.floor(topLeft.y / spacing) * spacing;

    if (pattern === "dots") {
      const r = 1 / camera.zoom;
      ctx.fillStyle = color;
      for (let x = startX; x < bottomRight.x; x += spacing) {
        for (let y = startY; y < bottomRight.y; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / camera.zoom;

    // Small crosses at the intersections — this is Miro's signature background:
    // it marks the grid without the visual weight of continuous lines.
    if (pattern === "crosses") {
      const arm = 3 / camera.zoom;
      ctx.beginPath();
      for (let x = startX; x < bottomRight.x; x += spacing) {
        for (let y = startY; y < bottomRight.y; y += spacing) {
          ctx.moveTo(x - arm, y);
          ctx.lineTo(x + arm, y);
          ctx.moveTo(x, y - arm);
          ctx.lineTo(x, y + arm);
        }
      }
      ctx.stroke();
      return;
    }

    if (pattern === "lines" || pattern === "grid") {
      // Horizontal lines (both "lines" and "grid").
      ctx.beginPath();
      for (let y = startY; y < bottomRight.y; y += spacing) {
        ctx.moveTo(topLeft.x, y);
        ctx.lineTo(bottomRight.x, y);
      }
      // Vertical lines (only "grid").
      if (pattern === "grid") {
        for (let x = startX; x < bottomRight.x; x += spacing) {
          ctx.moveTo(x, topLeft.y);
          ctx.lineTo(x, bottomRight.y);
        }
      }
      ctx.stroke();
      return;
    }
  }

  private drawElement(el: BoardElement, state: RenderState): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = el.opacity;

    if (el.angle) {
      const c = elementCenter(el);
      ctx.translate(c.x, c.y);
      ctx.rotate(el.angle);
      ctx.translate(-c.x, -c.y);
    }

    ctx.strokeStyle = el.strokeColor;
    ctx.fillStyle = el.backgroundColor;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    switch (el.type) {
      case "rectangle":
        this.drawRect(el);
        break;
      case "ellipse":
        this.drawEllipse(el);
        break;
      case "line":
      case "arrow":
        this.drawLinear(el);
        break;
      case "freedraw":
        this.drawFreedraw(el);
        break;
      case "text":
        this.drawText(el);
        break;
      case "image":
        this.drawImage(el, state);
        break;
      case "embed":
        this.drawEmbed(el, state);
        break;
      case "tasks":
        this.drawTasks(el);
        break;
      case "shape":
        this.drawShape(el);
        break;
      case "sticky":
        this.drawSticky(el);
        break;
      case "frame":
        this.drawFrame(el, state);
        break;
      case "link":
        this.drawLink(el, state);
        break;
      case "note":
        this.drawNote(el, state);
        break;
    }

    // Centered label (elements that are not text).
    // `frame` is left out: its name is drawn in the top corner by drawFrame, and
    // drawing it here as well would duplicate it in the middle of the area.
    // `link`/`note` too: they draw their own content.
    if (
      el.type !== "text" &&
      el.type !== "frame" &&
      el.type !== "link" &&
      el.type !== "note" &&
      el.label &&
      el.id !== state.editingLabelId
    ) {
      this.drawCenteredLabel(el);
    }

    ctx.restore();
  }

  private drawImage(el: ImageElement, state: RenderState): void {
    const { ctx } = this;
    const img = state.imageCache?.get(el.src);
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        ctx.drawImage(img, el.x, el.y, el.width, el.height);
      } catch {
        this.drawImagePlaceholder(el, state, true);
      }
    } else {
      this.drawImagePlaceholder(el, state, false);
    }
  }

  private drawImagePlaceholder(
    el: ImageElement,
    state: RenderState,
    broken: boolean,
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = state.palette.selectionFill;
    ctx.strokeStyle = state.palette.grid;
    ctx.lineWidth = 1 / state.camera.zoom;
    ctx.beginPath();
    ctx.rect(el.x, el.y, el.width, el.height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = state.palette.defaultStroke;
    const fs = Math.max(10, Math.min(24, Math.abs(el.height) / 4));
    ctx.font = `${fs}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.6;
    ctx.fillText(
      broken ? "⚠ image" : "loading…",
      el.x + el.width / 2,
      el.y + el.height / 2,
    );
    ctx.restore();
  }

  /**
   * Embeds are rendered by a real <iframe> DOM overlay (managed by the Board).
   * On the canvas we only draw a subtle frame so selection/z-order feels right
   * and export/PNG has a visible placeholder.
   */
  private drawEmbed(el: EmbedElement, state: RenderState): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = state.palette.selectionFill;
    ctx.strokeStyle = state.palette.grid;
    ctx.lineWidth = 1 / state.camera.zoom;
    ctx.beginPath();
    ctx.rect(el.x, el.y, el.width, el.height);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Tasks card — faithful to the Noki dashboard "Tarefas" widget. */
  private drawTasks(el: TasksElement): void {
    const { ctx } = this;
    const S = TASKS_STYLE;
    if (el.width < 40 || el.height < 40) {
      // Too small to lay out meaningfully — just draw the panel.
      ctx.save();
      ctx.fillStyle = S.panel;
      ctx.beginPath();
      this.roundRectPath(el.x, el.y, el.width, el.height, 12);
      ctx.fill();
      ctx.restore();
      return;
    }
    const L = tasksLayout(el);
    const total = el.items.length;
    const done = el.items.filter((t) => t.done).length;
    const font = "system-ui, -apple-system, sans-serif";

    ctx.save();
    // Card background (clip content to rounded rect).
    const r = Math.min(S.radius, el.width / 2, el.height / 2);
    ctx.beginPath();
    this.roundRectPath(el.x, el.y, el.width, el.height, r);
    ctx.fillStyle = S.panel;
    ctx.fill();
    ctx.save();
    ctx.clip();

    const cy = L.headerY + S.headerH / 2;
    // Header icon: small yellow check-circle.
    const ir = 8;
    const icx = L.innerX + ir;
    ctx.strokeStyle = S.yellow;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(icx, cy, ir, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(icx - 3.6, cy);
    ctx.lineTo(icx - 1, cy + 2.6);
    ctx.lineTo(icx + 4, cy - 3);
    ctx.stroke();

    // Title.
    ctx.fillStyle = S.onPanel;
    ctx.font = `600 ${S.titleSize}px ${font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(el.title || "Tasks", icx + ir + 8, cy + 0.5);

    // Count (right aligned).
    ctx.fillStyle = S.muted;
    ctx.font = `${S.countSize}px ${font}`;
    ctx.textAlign = "right";
    ctx.fillText(`${done}/${total}`, L.innerX + L.innerW, cy + 0.5);

    // Progress bar.
    ctx.beginPath();
    this.roundRectPath(L.innerX, L.barY, L.innerW, L.barH, L.barH / 2);
    ctx.fillStyle = S.track;
    ctx.fill();
    if (total > 0 && done > 0) {
      const w = (L.innerW * done) / total;
      ctx.beginPath();
      this.roundRectPath(L.innerX, L.barY, w, L.barH, L.barH / 2);
      ctx.fillStyle = S.yellow;
      ctx.fill();
    }

    // Rows.
    ctx.textAlign = "left";
    for (const row of L.rows) {
      const item = el.items[row.index];
      const rcy = row.rect.y + row.rect.h / 2;
      const cb = row.checkbox;

      // Checkbox.
      ctx.beginPath();
      this.roundRectPath(cb.x, cb.y, cb.w, cb.h, 5);
      if (item.done) {
        ctx.fillStyle = S.yellow;
        ctx.fill();
        ctx.strokeStyle = S.check;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cb.x + 4, cb.y + cb.h / 2);
        ctx.lineTo(cb.x + cb.w / 2 - 1, cb.y + cb.h - 5);
        ctx.lineTo(cb.x + cb.w - 4, cb.y + 5);
        ctx.stroke();
      } else {
        ctx.strokeStyle = S.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Priority dot (right).
      const dotR = 3.5;
      const dotX = L.innerX + L.innerW - dotR;
      ctx.beginPath();
      ctx.arc(dotX, rcy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = PRIORITY_COLOR[item.priority ?? "medium"] ?? S.muted;
      ctx.fill();

      // Text (truncated to available width).
      const textX = cb.x + cb.w + 12;
      const textMaxW = dotX - dotR - 8 - textX;
      ctx.font = `${S.textSize}px ${font}`;
      ctx.fillStyle = item.done ? S.textDone : S.onPanel;
      const label = truncateText(ctx, item.text, textMaxW);
      ctx.fillText(label, textX, rcy + 0.5);
      if (item.done) {
        const tw = Math.min(ctx.measureText(label).width, textMaxW);
        ctx.strokeStyle = S.textDone;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(textX, rcy);
        ctx.lineTo(textX + tw, rcy);
        ctx.stroke();
      }
    }

    // Add button.
    const a = L.addButton;
    ctx.beginPath();
    this.roundRectPath(a.x, a.y, a.w, a.h, 12);
    ctx.fillStyle = S.addBg;
    ctx.fill();
    ctx.fillStyle = S.onPanel;
    ctx.font = `500 ${S.textSize}px ${font}`;
    ctx.textAlign = "center";
    ctx.fillText("＋  New task", a.x + a.w / 2, a.y + a.h / 2 + 0.5);

    ctx.restore(); // clip
    ctx.restore();
  }

  private drawCenteredLabel(el: BoardElement): void {
    const { ctx } = this;
    const fontSize = labelFontSize(el);
    const fontFamily = el.labelFontFamily ?? LABEL_FONT;
    const fontWeight = el.labelFontWeight ?? "normal";
    const fontStyle = el.labelFontStyle ?? "normal";
    const textAlign = el.labelTextAlign ?? "center";
    const verticalAlign = el.labelVerticalAlign ?? "middle";
    const maxWidth = Math.max(20, Math.abs(el.width) - LABEL_PADDING * 2);
    ctx.save();
    ctx.fillStyle = el.strokeColor;
    ctx.font = textCanvasFont({ fontSize, fontFamily, fontWeight, fontStyle });
    ctx.textAlign = textAlign;
    ctx.textBaseline = "middle";

    const lines = wrapText(ctx, el.label!, maxWidth);
    const lineHeight = fontSize * 1.25;
    const totalHeight = lines.length * lineHeight;
    const innerMinY = el.y + LABEL_PADDING;
    const innerMaxY = el.y + el.height - LABEL_PADDING;
    const x =
      textAlign === "left"
        ? el.x + LABEL_PADDING
        : textAlign === "right"
          ? el.x + el.width - LABEL_PADDING
          : el.x + el.width / 2;
    let y =
      verticalAlign === "top"
        ? innerMinY + lineHeight / 2
        : Math.max(
            innerMinY + lineHeight / 2,
            el.y + el.height / 2 - totalHeight / 2 + lineHeight / 2,
          );
    for (const line of lines) {
      if (y + lineHeight / 2 > innerMaxY) break;
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    ctx.restore();
  }

  private drawRect(el: BoardElement): void {
    const { ctx } = this;
    const r = Math.min(8, Math.abs(el.width) / 4, Math.abs(el.height) / 4);
    ctx.beginPath();
    this.roundRectPath(el.x, el.y, el.width, el.height, r);
    if (el.backgroundColor !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  }

  private roundRectPath(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const { ctx } = this;
    if (r <= 0) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawEllipse(el: BoardElement): void {
    const { ctx } = this;
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy,
      Math.abs(el.width) / 2,
      Math.abs(el.height) / 2,
      0,
      0,
      Math.PI * 2,
    );
    if (el.backgroundColor !== "transparent") ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  }

  private drawLinear(el: LinearElement): void {
    const { ctx } = this;
    const pts = el.points;
    if (pts.length < 2) return;

    const p0 = { x: el.x + pts[0].x, y: el.y + pts[0].y };
    const pN = { x: el.x + pts[pts.length - 1].x, y: el.y + pts[pts.length - 1].y };

    // Determine if this is a curved line (has a non-zero controlOffset or curveType=curve).
    const co = el.controlOffset;
    const hasCurve =
      pts.length === 2 &&
      ((co && (co.x !== 0 || co.y !== 0)) || el.curveType === "curve");

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);

    if (hasCurve) {
      const mx = (p0.x + pN.x) / 2;
      const my = (p0.y + pN.y) / 2;
      let cx: number, cy: number;
      if (co && (co.x !== 0 || co.y !== 0)) {
        cx = mx + co.x;
        cy = my + co.y;
      } else {
        // Auto curve (30% perpendicular offset).
        const dx = pN.x - p0.x;
        const dy = pN.y - p0.y;
        const len = Math.hypot(dx, dy) || 1;
        const offset = len * 0.3;
        cx = mx - (dy / len) * offset;
        cy = my + (dx / len) * offset;
      }
      ctx.quadraticCurveTo(cx, cy, pN.x, pN.y);
    } else {
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(el.x + pts[i].x, el.y + pts[i].y);
      }
    }
    ctx.stroke();

    if (el.type === "arrow") {
      let fromX: number, fromY: number;
      if (hasCurve) {
        const mx = (p0.x + pN.x) / 2;
        const my = (p0.y + pN.y) / 2;
        if (co && (co.x !== 0 || co.y !== 0)) {
          fromX = mx + co.x;
          fromY = my + co.y;
        } else {
          const dx = pN.x - p0.x;
          const dy = pN.y - p0.y;
          const len = Math.hypot(dx, dy) || 1;
          fromX = mx - (dy / len) * (len * 0.3);
          fromY = my + (dx / len) * (len * 0.3);
        }
      } else {
        fromX = el.x + pts[pts.length - 2].x;
        fromY = el.y + pts[pts.length - 2].y;
      }
      this.drawArrowHead({ x: fromX, y: fromY }, pN, el.strokeWidth);
    }
  }

  private drawArrowHead(from: Point, to: Point, strokeWidth: number): void {
    const { ctx } = this;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 10 + strokeWidth * 2;
    const a1 = angle + Math.PI - Math.PI / 7;
    const a2 = angle + Math.PI + Math.PI / 7;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x + size * Math.cos(a1), to.y + size * Math.sin(a1));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x + size * Math.cos(a2), to.y + size * Math.sin(a2));
    ctx.stroke();
  }

  private drawFreedraw(el: FreedrawElement): void {
    const { ctx } = this;
    const pts = el.points;
    if (pts.length === 0) return;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(el.x + pts[0].x, el.y + pts[0].y, el.strokeWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = el.strokeColor;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(el.x + pts[0].x, el.y + pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(el.x + p0.x, el.y + p0.y, el.x + midX, el.y + midY);
    }
    ctx.lineTo(
      el.x + pts[pts.length - 1].x,
      el.y + pts[pts.length - 1].y,
    );
    ctx.stroke();
  }

  private drawText(el: TextElement): void {
    const { ctx } = this;
    const fontSize = el.fontSize ?? 20;
    const fontFamily = el.fontFamily ?? LABEL_FONT;
    const fontWeight = el.fontWeight ?? "normal";
    const fontStyle = el.fontStyle ?? "normal";
    const textAlign = el.textAlign ?? "left";
    const verticalAlign = el.verticalAlign ?? "top";
    ctx.fillStyle = el.strokeColor;
    ctx.font = textCanvasFont({ fontSize, fontFamily, fontWeight, fontStyle });
    ctx.textBaseline = "top";
    ctx.textAlign = textAlign;
    const lines = el.text.split("\n");
    const lineHeight = fontSize * 1.25;
    const textHeight = lines.length * lineHeight;
    const anchorX =
      textAlign === "center"
        ? el.x + el.width / 2
        : textAlign === "right"
          ? el.x + el.width
          : el.x;
    const y =
      verticalAlign === "middle"
        ? el.y + Math.max(0, el.height - textHeight) / 2
        : el.y;
    lines.forEach((line, i) => {
      ctx.fillText(line, anchorX, y + i * lineHeight);
    });
  }

  /**
   * Post-it / sticky note: pastel color, soft shadow and nothing else.
   *
   * The content is NOT drawn here: the centered label takes care of it
   * (drawCenteredLabel), the same mechanism as the other elements. Before, the
   * text came out twice — in the top corner by this function and in the center by
   * the label — which looked like an extra "name" on top of the note.
   */
  private drawSticky(el: StickyElement): void {
    const { ctx } = this;
    const x = el.x;
    const y = el.y;
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    if (w < 4 || h < 4) return;
    const r = Math.min(4, w / 6, h / 6);

    // Shadow.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = el.color || "#FFF9B1";
    ctx.beginPath();
    this.roundRectPath(x, y, w, h, r);
    ctx.fill();
    ctx.restore();
  }

  /** Frame / whiteboard area: white bg, thin border, name badge on top-right. */
  private drawFrame(el: FrameElement, state: RenderState): void {
    const { ctx } = this;
    const x = el.x;
    const y = el.y;
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    const r = Math.min(8, w / 4, h / 4);

    // White fill.
    ctx.save();
    ctx.fillStyle = el.backgroundColor || "#ffffff";
    ctx.beginPath();
    this.roundRectPath(x, y, w, h, r);
    ctx.fill();

    // Thin border.
    ctx.strokeStyle = el.strokeColor || "#d4d4d8";
    ctx.lineWidth = el.strokeWidth || 1.5;
    ctx.stroke();
    ctx.restore();

    // Frame name: plain text above the border, to the left. No background and no
    // extra weight — it is an identification label, not a drawing element.
    //
    // `title` is the name field; `label` is accepted for compatibility with
    // frames saved before the name editor existed. It stays hidden during editing
    // so it does not show up duplicated under the text field.
    const name = el.title || el.label;
    if (name && state.editingLabelId !== el.id) {
      this.drawFrameName(name, el, state);
    }
  }

  /** Frame name (top-left corner, outside the border). */
  private drawFrameName(name: string, el: FrameElement, state: RenderState): void {
    const { ctx } = this;
    const fs = FRAME_NAME_FONT_SIZE;
    const origin = frameNameOrigin(el);
    ctx.save();
    ctx.font = `400 ${fs}px ${LABEL_FONT}`;
    ctx.fillStyle = state.palette.defaultStroke;
    ctx.globalAlpha = 0.7;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    // A long name is cut at the frame width instead of spilling out to the side.
    ctx.fillText(this.ellipsize(name, Math.max(Math.abs(el.width), fs * 3)), origin.x, origin.y);
    ctx.restore();
  }

  /** Cuts the text with "…" to fit the given width (font already applied). */
  private ellipsize(text: string, maxWidth: number): string {
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let corte = text;
    while (corte.length > 1 && ctx.measureText(corte + "…").width > maxWidth) {
      corte = corte.slice(0, -1);
    }
    return corte + "…";
  }

  /**
   * Shortcut to another board: a card with a round badge on the left, the name of
   * the destination and a chevron on the right showing it leads somewhere.
   *
   * The whole geometry comes from center + radius (no magic factors): the
   * previous version drew a frame with the arrow escaping its own box, which left
   * the icon visibly crooked at any size.
   */
  private drawLink(el: LinkElement, state: RenderState): void {
    const { ctx } = this;
    const x = el.width < 0 ? el.x + el.width : el.x;
    const y = el.height < 0 ? el.y + el.height : el.y;
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    if (w < 8 || h < 8) return;

    const r = Math.min(12, w / 6, h / 3);
    const color = el.strokeColor || "#4f46e5";
    const background =
      el.backgroundColor && el.backgroundColor !== "transparent" ? el.backgroundColor : "#eef2ff";
    const noTarget = !el.targetId;

    ctx.save();
    // Card with a soft shadow: gives it the same visual weight as the sticky.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.10)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = background;
    ctx.beginPath();
    this.roundRectPath(x, y, w, h, r);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = color;
    ctx.lineWidth = el.strokeWidth || 1.5;
    // No destination: dashed, so the incomplete state is visible.
    if (noTarget) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    this.roundRectPath(x, y, w, h, r);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Round badge with the arrow ──
    const pad = Math.min(14, w * 0.08, h * 0.2);
    const radius = Math.min(h * 0.3, w * 0.12, 18);
    const cx = x + pad + radius;
    const cy = y + h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = noTarget ? 0.35 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Arrow pointing right, centered in the badge: shaft + two equal diagonals.
    const s = radius * 0.5;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.4, radius * 0.16);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - s, cy);
    ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx + s * 0.25, cy - s * 0.75);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx + s * 0.25, cy + s * 0.75);
    ctx.stroke();

    // ── Textos ──
    const chevron = Math.min(8, w * 0.05);
    const tx = cx + radius + pad * 0.75;
    const maxText = Math.max(8, x + w - pad - chevron - pad * 0.5 - tx);
    const title = el.label || (noTarget ? "Choose a board…" : "Board");
    const fsTitulo = Math.max(11, Math.min(16, h * 0.26));
    ctx.font = `600 ${fsTitulo}px ${LABEL_FONT}`;
    ctx.fillStyle = noTarget ? color : state.palette.defaultStroke;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    const sub = el.subtitle?.trim();
    const temSub = !!sub && h >= fsTitulo * 3;
    const titleY = temSub ? y + h / 2 - fsTitulo * 0.1 : y + h / 2 + fsTitulo * 0.36;
    ctx.fillText(this.ellipsize(title, maxText), tx, titleY);

    if (temSub) {
      const fsSub = Math.max(9, fsTitulo * 0.7);
      ctx.font = `400 ${fsSub}px ${LABEL_FONT}`;
      ctx.globalAlpha = 0.55;
      ctx.fillText(this.ellipsize(sub!, maxText), tx, titleY + fsSub * 1.6);
      ctx.globalAlpha = 1;
    }

    // Chevron on the right: reinforces "this opens somewhere else".
    if (w > radius * 4) {
      const gx = x + w - pad;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(1.2, chevron * 0.22);
      ctx.beginPath();
      ctx.moveTo(gx - chevron * 0.6, cy - chevron * 0.6);
      ctx.lineTo(gx, cy);
      ctx.lineTo(gx - chevron * 0.6, cy + chevron * 0.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /**
   * Note: white card with a colored strip on top, title, rule and the text
   * preview. In the bottom-right corner, an "expand" glyph signals that clicking
   * opens the whole note.
   *
   * Only the preview is drawn: the full text would be illegible at low zoom and
   * expensive to render at high zoom — for writing there is the modal.
   */
  private drawNote(el: NoteElement, state: RenderState): void {
    const { ctx } = this;
    const x = el.width < 0 ? el.x + el.width : el.x;
    const y = el.height < 0 ? el.y + el.height : el.y;
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    if (w < 8 || h < 8) return;

    const r = Math.min(12, w / 8, h / 8);
    const color = el.color || "#f59e0b";
    const background =
      el.backgroundColor && el.backgroundColor !== "transparent" ? el.backgroundColor : "#ffffff";

    ctx.save();
    // Card + shadow.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = background;
    ctx.beginPath();
    this.roundRectPath(x, y, w, h, r);
    ctx.fill();
    ctx.restore();

    // Colored strip on top, clipped by the card itself (respects the corners).
    const faixaH = Math.max(4, Math.min(7, h * 0.05));
    ctx.save();
    ctx.beginPath();
    this.roundRectPath(x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, faixaH);
    ctx.restore();

    ctx.strokeStyle = el.strokeColor || "#e4e4e7";
    ctx.lineWidth = el.strokeWidth || 1.5;
    ctx.beginPath();
    this.roundRectPath(x, y, w, h, r);
    ctx.stroke();

    const pad = Math.min(14, w * 0.08, h * 0.1);
    const left = x + pad;
    const maxText = Math.max(8, w - pad * 2);
    const fsTitulo = Math.max(11, Math.min(16, h * 0.13));

    // Title.
    let cursorY = y + faixaH + pad + fsTitulo * 0.85;
    const title = el.title?.trim();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = `600 ${fsTitulo}px ${LABEL_FONT}`;
    ctx.fillStyle = state.palette.defaultStroke;
    if (title) {
      ctx.fillText(this.ellipsize(title, maxText), left, cursorY);
    } else {
      ctx.globalAlpha = 0.4;
      ctx.fillText(this.ellipsize("Note", maxText), left, cursorY);
      ctx.globalAlpha = 1;
    }

    // Thin rule separating title and body.
    const yRegua = cursorY + fsTitulo * 0.5;
    if (yRegua < y + h - pad) {
      ctx.strokeStyle = el.strokeColor || "#e4e4e7";
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, yRegua);
      ctx.lineTo(x + w - pad, yRegua);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Body preview: as many lines as fit, without invading the footer.
    const fsCorpo = Math.max(10, fsTitulo * 0.8);
    const lineHeight = fsCorpo * 1.5;
    const rodape = Math.min(16, h * 0.12);
    cursorY = yRegua + fsCorpo * 1.2;
    ctx.font = `400 ${fsCorpo}px ${LABEL_FONT}`;
    ctx.fillStyle = state.palette.defaultStroke;
    const body = (el.text || "").replace(/[ \t]+/g, " ").trim();

    if (body) {
      ctx.globalAlpha = 0.75;
      const lines = wrapText(ctx, body.replace(/\n+/g, " "), maxText);
      const available = Math.floor((y + h - rodape - cursorY) / lineHeight) + 1;
      const shown = Math.max(0, Math.min(lines.length, available));
      for (let i = 0; i < shown; i++) {
        const last = i === shown - 1 && shown < lines.length;
        ctx.fillText(last ? this.ellipsize(lines[i] + " …", maxText) : lines[i], left, cursorY);
        cursorY += lineHeight;
      }
    } else {
      ctx.globalAlpha = 0.38;
      ctx.fillText(this.ellipsize("Double-click to write…", maxText), left, cursorY);
    }
    ctx.globalAlpha = 1;

    // "Expand" corner marks in the bottom-right corner: two corner marks,
    // symmetrical. Arrows with a head were confusing at this size.
    const g = Math.min(10, w * 0.06, h * 0.08);
    if (g > 3.5) {
      const x2 = x + w - pad;
      const y2 = y + h - pad * 0.6;
      const x1 = x2 - g;
      const y1 = y2 - g;
      const len = g * 0.45;
      ctx.strokeStyle = state.palette.defaultStroke;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = Math.max(1.1, g * 0.18);
      ctx.lineCap = "round";
      ctx.beginPath();
      // ⌜ top-left
      ctx.moveTo(x1, y1 + len);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 + len, y1);
      // ⌟ bottom-right
      ctx.moveTo(x2, y2 - len);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - len, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Diagram / system-design shapes drawn within the element's bounding box. */
  private drawShape(el: ShapeElement): void {
    const { ctx } = this;
    const x = el.width < 0 ? el.x + el.width : el.x;
    const y = el.height < 0 ? el.y + el.height : el.y;
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    if (w < 1 || h < 1) return;
    const filled = el.backgroundColor !== "transparent";
    const stroked = el.strokeWidth > 0;
    const fillStroke = () => {
      if (filled) ctx.fill();
      if (stroked) ctx.stroke();
    };
    const poly = (pts: [number, number][]) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    };

    switch (el.shape) {
      case "diamond":
        poly([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);
        fillStroke();
        break;
      case "triangle":
        poly([[x + w / 2, y], [x + w, y + h], [x, y + h]]);
        fillStroke();
        break;
      case "hexagon":
        poly([
          [x + w * 0.25, y], [x + w * 0.75, y], [x + w, y + h / 2],
          [x + w * 0.75, y + h], [x + w * 0.25, y + h], [x, y + h / 2],
        ]);
        fillStroke();
        break;
      case "parallelogram": {
        const s = w * 0.25;
        poly([[x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]]);
        fillStroke();
        break;
      }
      case "pill": {
        const r = Math.min(h / 2, w / 2);
        ctx.beginPath();
        this.roundRectPath(x, y, w, h, r);
        fillStroke();
        break;
      }
      case "star": {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const inner = 0.42;
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? 1 : inner;
          pts.push([cx + Math.cos(ang) * (w / 2) * rr, cy + Math.sin(ang) * (h / 2) * rr]);
        }
        poly(pts);
        fillStroke();
        break;
      }
      case "document": {
        const wave = h * 0.12;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h - wave);
        ctx.bezierCurveTo(x + w * 0.75, y + h + wave, x + w * 0.75, y + h - 2 * wave, x + w * 0.5, y + h - wave);
        ctx.bezierCurveTo(x + w * 0.25, y + h, x + w * 0.25, y + h - 2 * wave, x, y + h - wave);
        ctx.closePath();
        fillStroke();
        break;
      }
      case "cloud": {
        ctx.beginPath();
        ctx.moveTo(x + 0.25 * w, y + 0.92 * h);
        ctx.bezierCurveTo(x + 0.02 * w, y + 0.92 * h, x + 0.02 * w, y + 0.58 * h, x + 0.22 * w, y + 0.54 * h);
        ctx.bezierCurveTo(x + 0.14 * w, y + 0.22 * h, x + 0.46 * w, y + 0.08 * h, x + 0.56 * w, y + 0.32 * h);
        ctx.bezierCurveTo(x + 0.72 * w, y + 0.06 * h, x + 0.98 * w, y + 0.22 * h, x + 0.86 * w, y + 0.5 * h);
        ctx.bezierCurveTo(x + 1.02 * w, y + 0.56 * h, x + 1.0 * w, y + 0.88 * h, x + 0.78 * w, y + 0.92 * h);
        ctx.closePath();
        fillStroke();
        break;
      }
      case "cylinder": {
        const rx = w / 2;
        const cx = x + rx;
        const ry = Math.max(3, Math.min(h * 0.16, rx * 0.85));
        if (filled) {
          ctx.beginPath();
          ctx.rect(x, y + ry, w, h - 2 * ry);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx, y + ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx, y + h - ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        if (stroked) {
          ctx.beginPath();
          ctx.moveTo(x, y + ry);
          ctx.lineTo(x, y + h - ry);
          ctx.moveTo(x + w, y + ry);
          ctx.lineTo(x + w, y + h - ry);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(cx, y + ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(cx, y + h - ry, rx, ry, 0, 0, Math.PI);
          ctx.stroke();
        }
        break;
      }
      // Stick figure (actor/person). It is stroke, not area: the head uses the
      // fill when there is one, the body is always a line.
      case "person": {
        const cx = x + w / 2;
        const rCabeca = Math.min(w * 0.22, h * 0.16);
        const topoCabeca = y + rCabeca * 0.2;
        const ombro = topoCabeca + rCabeca * 2.1;
        const quadril = y + h * 0.62;
        const larguraBraco = w * 0.42;
        const larguraPerna = w * 0.3;

        ctx.beginPath();
        ctx.arc(cx, topoCabeca + rCabeca, rCabeca, 0, Math.PI * 2);
        if (filled) ctx.fill();
        if (stroked) ctx.stroke();

        if (stroked) {
          ctx.beginPath();
          // Tronco.
          ctx.moveTo(cx, ombro);
          ctx.lineTo(cx, quadril);
          // Arms.
          ctx.moveTo(cx - larguraBraco, ombro + (quadril - ombro) * 0.3);
          ctx.lineTo(cx + larguraBraco, ombro + (quadril - ombro) * 0.3);
          // Legs.
          ctx.moveTo(cx, quadril);
          ctx.lineTo(cx - larguraPerna, y + h);
          ctx.moveTo(cx, quadril);
          ctx.lineTo(cx + larguraPerna, y + h);
          ctx.stroke();
        }
        break;
      }
      // Cube in perspective: service/server in architecture diagrams.
      case "cube": {
        const d = Math.min(w, h) * 0.22;
        const frenteY = y + d;
        const frenteW = w - d;
        ctx.beginPath();
        ctx.rect(x, frenteY, frenteW, h - d);
        fillStroke();
        // Top and side.
        ctx.beginPath();
        ctx.moveTo(x, frenteY);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + frenteW, frenteY);
        ctx.closePath();
        fillStroke();
        ctx.beginPath();
        ctx.moveTo(x + frenteW, frenteY);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h - d);
        ctx.lineTo(x + frenteW, y + h);
        ctx.closePath();
        fillStroke();
        break;
      }
      // Browser window: screens/pages in product flows.
      case "browser": {
        const bar = Math.min(h * 0.2, 22);
        const r = Math.min(6, w / 8, h / 8);
        ctx.beginPath();
        this.roundRectPath(x, y, w, h, r);
        fillStroke();
        if (stroked) {
          ctx.beginPath();
          ctx.moveTo(x, y + bar);
          ctx.lineTo(x + w, y + bar);
          ctx.stroke();
          // Three little dots on the title bar.
          const rp = Math.min(bar * 0.16, 3);
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(x + bar * 0.5 + i * rp * 3.2, y + bar / 2, rp, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        break;
      }
      case "folder": {
        const aba = Math.min(h * 0.18, 18);
        const abaW = w * 0.42;
        const r = Math.min(5, w / 10);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + abaW, y);
        ctx.lineTo(x + abaW + aba * 0.8, y + aba);
        ctx.lineTo(x + w - r, y + aba);
        ctx.quadraticCurveTo(x + w, y + aba, x + w, y + aba + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        fillStroke();
        break;
      }
      // Speech bubble: comment/remark inside the drawing.
      case "callout": {
        const corpoH = h * 0.78;
        const r = Math.min(10, w / 8, corpoH / 4);
        const biboX = x + w * 0.28;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + corpoH - r);
        ctx.quadraticCurveTo(x + w, y + corpoH, x + w - r, y + corpoH);
        ctx.lineTo(biboX + w * 0.14, y + corpoH);
        ctx.lineTo(biboX, y + h);
        ctx.lineTo(biboX, y + corpoH);
        ctx.lineTo(x + r, y + corpoH);
        ctx.quadraticCurveTo(x, y + corpoH, x, y + corpoH - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        fillStroke();
        break;
      }
      case "cross": {
        const e = Math.min(w, h) * 0.34;
        const cx = x + w / 2;
        const cy = y + h / 2;
        poly([
          [cx - e / 2, y], [cx + e / 2, y],
          [cx + e / 2, cy - e / 2], [x + w, cy - e / 2],
          [x + w, cy + e / 2], [cx + e / 2, cy + e / 2],
          [cx + e / 2, y + h], [cx - e / 2, y + h],
          [cx - e / 2, cy + e / 2], [x, cy + e / 2],
          [x, cy - e / 2], [cx - e / 2, cy - e / 2],
        ]);
        fillStroke();
        break;
      }
      // Block arrow: indicates direction/flow with an area (not a connection).
      case "arrowBlock": {
        const body = h * 0.5;
        const tip = Math.min(w * 0.32, h * 0.9);
        const cy = y + h / 2;
        poly([
          [x, cy - body / 2], [x + w - tip, cy - body / 2],
          [x + w - tip, y], [x + w, cy],
          [x + w - tip, y + h], [x + w - tip, cy + body / 2],
          [x, cy + body / 2],
        ]);
        fillStroke();
        break;
      }
    }
  }

  private drawSelection(state: RenderState): void {
    const { ctx } = this;
    const zoom = state.camera.zoom;
    const color = state.palette.selection;
    const selected = state.scene
      .getElements()
      .filter((e) => state.selectedIds.has(e.id));
    if (selected.length === 0) return;

    // Per-element outline
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([]);
    for (const el of selected) {
      ctx.save();
      if (el.angle) {
        const c = elementCenter(el);
        ctx.translate(c.x, c.y);
        ctx.rotate(el.angle);
        ctx.translate(-c.x, -c.y);
      }
      ctx.strokeRect(el.x, el.y, el.width, el.height);
      ctx.restore();
    }

    // Bounding box + handles (single-element uses its angle; multi uses AABB).
    const bounds = getElementsBounds(selected);
    if (!bounds) {
      ctx.restore();
      return;
    }
    const angle = selected.length === 1 ? selected[0].angle : 0;

    const handles = getHandles(bounds, angle, zoom);
    const hs = (state.handleSize ?? HANDLE_SIZE) / zoom;
    ctx.fillStyle =
      state.handleFill ??
      (state.background === "transparent" ? "#ffffff" : state.background);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / zoom;

    for (const h of handles) {
      if (h.name === "rotate") {
        ctx.beginPath();
        ctx.arc(h.point.x, h.point.y, hs / 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.rect(h.point.x - hs / 2, h.point.y - hs / 2, hs, hs);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Bend handle for 2-point arrows/lines (draggable to curve the line).
    if (selected.length === 1) {
      const el = selected[0];
      if (
        (el.type === "arrow" || el.type === "line") &&
        "points" in el &&
        (el as LinearElement).points.length === 2
      ) {
        const lin = el as LinearElement;
        const p0 = { x: lin.x + lin.points[0].x, y: lin.y + lin.points[0].y };
        const pN = { x: lin.x + lin.points[1].x, y: lin.y + lin.points[1].y };
        const mx = (p0.x + pN.x) / 2;
        const my = (p0.y + pN.y) / 2;
        const co = lin.controlOffset ?? { x: 0, y: 0 };
        const bx = mx + co.x;
        const by = my + co.y;
        const r = (hs * 0.7);
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawSelectionBox(box: Bounds, zoom: number, palette: ThemePalette): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = palette.selection;
    ctx.fillStyle = palette.selectionFill;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    ctx.fillRect(box.minX, box.minY, w, h);
    ctx.strokeRect(box.minX, box.minY, w, h);
    ctx.restore();
  }
}

/** Font size used for an element's centered label. */
export function labelFontSize(el: BoardElement): number {
  if (el.labelFontSize) return el.labelFontSize;
  const bottom = 20;
  const fit = Math.min(Math.abs(el.height) * 0.5, bottom);
  return Math.max(10, Math.min(bottom, fit || bottom));
}

/** Greedy word-wrap that also respects explicit newlines. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (maxWidth <= 0) return [text];
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const pieces = breakLongToken(ctx, word, maxWidth);
      for (const piece of pieces) {
        const candidate = line ? `${line} ${piece}` : piece;
        if (ctx.measureText(candidate).width > maxWidth && line) {
          out.push(line);
          line = piece;
        } else {
          line = candidate;
        }
      }
    }
    out.push(line);
  }
  return out;
}

function breakLongToken(
  ctx: CanvasRenderingContext2D,
  token: string,
  maxWidth: number,
): string[] {
  if (!token || ctx.measureText(token).width <= maxWidth) return [token];
  const out: string[] = [];
  let chunk = "";
  for (const char of token) {
    const candidate = chunk + char;
    if (chunk && ctx.measureText(candidate).width > maxWidth) {
      out.push(chunk);
      chunk = char;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) out.push(chunk);
  return out;
}

/** Truncate `text` with an ellipsis so it fits within `maxWidth` px. */
export function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}

export function textCanvasFont(style: {
  fontSize: number;
  fontFamily: string;
  fontWeight?: string;
  fontStyle?: string;
}): string {
  const fontStyle = style.fontStyle && style.fontStyle !== "normal"
    ? `${style.fontStyle} `
    : "";
  const fontWeight = style.fontWeight && style.fontWeight !== "normal"
    ? `${style.fontWeight} `
    : "";
  return `${fontStyle}${fontWeight}${style.fontSize}px ${style.fontFamily}`;
}
