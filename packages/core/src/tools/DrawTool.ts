/**
 * DrawTool — Generic drawing tool for creating elements by dragging.
 * Instantiated per element type: rectangle, ellipse, line, arrow, shape,
 * sticky, frame, tasks.
 */

import type { Tool, ToolContext } from "../plugin-types";
import type { BoardElement, LinearElement, Point } from "../types";
import type { InternalToolContext } from "./types";
import { createElement, normalizeElement } from "../elements";
import { findConnectionTarget, getElementAnchors } from "../connections";

export interface DrawToolOptions {
  id: string;
  label: string;
  shortcuts?: string[];
  elementType: string;
  /** Whether to default-size on click (no-drag). */
  defaultSize?: { width: number; height: number };
  /** Opens the inline name editor on create (frames). */
  promptName?: boolean;
  /**
   * Triggers the element right after creating it (link/note): the user has just
   * said they want one, so it goes straight into configuration instead of
   * showing an empty card.
   */
  activateOnCreate?: boolean;
}

export class DrawTool implements Tool {
  readonly id: string;
  readonly label: string;
  readonly cursor = "crosshair";
  readonly shortcuts?: string[];
  private elementType: string;
  private defaultSize?: { width: number; height: number };
  private promptName: boolean;
  private activateOnCreate: boolean;

  constructor(opts: DrawToolOptions) {
    this.id = opts.id;
    this.label = opts.label;
    this.shortcuts = opts.shortcuts;
    this.elementType = opts.elementType;
    this.defaultSize = opts.defaultSize;
    this.promptName = opts.promptName ?? false;
    this.activateOnCreate = opts.activateOnCreate ?? false;
  }

  onActivate(ctx: ToolContext): void {
    ctx.setCursor("crosshair");
  }

  onPointerDown(ctx: ToolContext, e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;

    // If space is down, pan instead.
    if (ictx.isSpaceDown()) {
      ictx.setHoverAnchors(null);
      ictx.setInteraction({ kind: "panning", lastScreen: ictx.getScreenPoint(e) });
      ictx.capturePointer(e);
      ictx.setCursor("grabbing");
      return;
    }

    ictx.commitActiveEditor();
    ictx.setHoverAnchors(null);
    ictx.commitHistory();

    const extraProps: Partial<BoardElement> = {
      x: world.x,
      y: world.y,
      width: 0,
      height: 0,
    };

    if (this.elementType === "shape") {
      (extraProps as any).shape = ictx.getShapeKind();
    }
    if (this.elementType === "arrow" || this.elementType === "line") {
      (extraProps as any).curveType = ictx.getCurveType();
    }
    if (this.elementType === "sticky") {
      (extraProps as any).color = ictx.getStickyColor();
    }

    const el = createElement(
      this.elementType as any,
      extraProps as Partial<BoardElement> & { x: number; y: number },
      ictx.getStyle(),
    );
    ictx.addElement(el);
    ictx.setInteraction({ kind: "creating", element: el, startWorld: world });
    ictx.capturePointer(e);
    ictx.markDirty();
  }

  onPointerMove(ctx: ToolContext, e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;
    const interaction = ictx.getInteraction();

    if (interaction.kind === "panning") {
      const s = ictx.getScreenPoint(e);
      const dx = s.x - interaction.lastScreen.x;
      const dy = s.y - interaction.lastScreen.y;
      ictx.panBy(dx, dy);
      interaction.lastScreen = s;
      ictx.emitCamera();
      ictx.markDirty();
      return;
    }

    if (interaction.kind !== "creating") return;

    const el = interaction.element;
    const start = interaction.startWorld;

    if (el.type === "line" || el.type === "arrow") {
      let endX = world.x;
      let endY = world.y;
      ictx.setConnectionIndicator(null);
      if (el.type === "arrow") {
        const threshold = 24 / ictx.getZoom();
        const candidate = findConnectionTarget(
          world,
          ictx.getElements(),
          new Set([el.id]),
          threshold,
        );
        if (candidate) {
          endX = candidate.point.x;
          endY = candidate.point.y;
          ictx.setConnectionIndicator({
            point: candidate.point,
            anchors: getElementAnchors(candidate.element),
          });
        }
      }
      ictx.updateElement(el.id, {
        width: endX - start.x,
        height: endY - start.y,
        points: [{ x: 0, y: 0 }, { x: endX - start.x, y: endY - start.y }],
      } as Partial<LinearElement>);
    } else {
      ictx.updateElement(el.id, {
        width: world.x - start.x,
        height: world.y - start.y,
      });
    }
    ictx.markDirty();
  }

  onPointerUp(ctx: ToolContext, e: PointerEvent, _world: Point): void {
    const ictx = ctx as InternalToolContext;
    ictx.releasePointer(e);
    const it = ictx.getInteraction();

    if (it.kind === "panning") {
      ictx.setInteraction({ kind: "idle" });
      ictx.setCursor("crosshair");
      return;
    }

    if (it.kind !== "creating") {
      ictx.setInteraction({ kind: "idle" });
      return;
    }

    const live = ictx.getElement(it.element.id);
    if (live) {
      const tiny = Math.abs(live.width) < 2 && Math.abs(live.height) < 2;

      if (tiny && this.defaultSize) {
        ictx.updateElement(live.id, {
          x: live.x,
          y: live.y,
          width: this.defaultSize.width,
          height: this.defaultSize.height,
        });
        ictx.setSelection([live.id]);
        // Frame name: inline editor over the label, instead of a window.prompt
        // (which takes the user out of the canvas and does not show where the
        // name will appear).
        if (this.promptName && live.type === "frame") {
          ictx.openNameEditor(ictx.getElement(live.id) ?? live);
        }
      } else if (tiny) {
        // Too small — remove.
        ictx.removeElement(live.id);
      } else {
        const normalized = normalizeElement(live);
        // Tasks card minimum size.
        if (live.type === "tasks") {
          normalized.width = Math.max(normalized.width, 240);
          normalized.height = Math.max(normalized.height, 220);
        }
        // Arrow connection binding.
        if (normalized.type === "arrow") {
          const threshold = 24 / ictx.getZoom();
          const exclude = new Set([normalized.id]);
          const els = ictx.getElements();
          const startPt = { x: normalized.x + normalized.points[0].x, y: normalized.y + normalized.points[0].y };
          const endPt = { x: normalized.x + normalized.points[normalized.points.length - 1].x, y: normalized.y + normalized.points[normalized.points.length - 1].y };
          const src = findConnectionTarget(startPt, els, exclude, threshold);
          const tgt = findConnectionTarget(endPt, els, exclude, threshold);
          const patch: Partial<LinearElement> = { ...normalized };
          if (src) {
            patch.sourceId = src.element.id;
            patch.sourceAnchor = src.anchor;
            patch.points = [...normalized.points];
            patch.points[0] = { x: src.point.x - normalized.x, y: src.point.y - normalized.y };
          }
          if (tgt) {
            patch.targetId = tgt.element.id;
            patch.targetAnchor = tgt.anchor;
            patch.points = patch.points ?? [...normalized.points];
            const li = patch.points.length - 1;
            patch.points[li] = { x: tgt.point.x - normalized.x, y: tgt.point.y - normalized.y };
          }
          ictx.updateElement(live.id, patch as Partial<BoardElement>);
        } else {
          ictx.updateElement(live.id, normalized);
        }
        ictx.setSelection([live.id]);
        // A frame drawn by dragging also goes straight into naming mode: the
        // name is the whole reason a frame exists.
        if (this.promptName && live.type === "frame") {
          ictx.openNameEditor(ictx.getElement(live.id) ?? live);
        }
      }
    }

    ictx.emitChange();
    ictx.setConnectionIndicator(null);
    ictx.setInteraction({ kind: "idle" });
    ictx.setTool("selection");
    ictx.markDirty();

    // After emitChange: whoever listens to `elementActivate` (modal/navigation)
    // already sees the element in the scene.
    if (this.activateOnCreate) {
      const created = ictx.getElement(it.element.id);
      if (created) ictx.activateElement(created, "create");
    }
  }
}
