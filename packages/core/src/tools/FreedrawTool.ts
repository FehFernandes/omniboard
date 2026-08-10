/**
 * FreedrawTool — Freehand drawing tool.
 */

import type { Tool, ToolContext } from "../plugin-types";
import type { FreedrawElement, Point } from "../types";
import type { InternalToolContext } from "./types";
import { createElement } from "../elements";

export class FreedrawTool implements Tool {
  readonly id = "freedraw";
  readonly label = "Freehand";
  readonly cursor = "crosshair";
  readonly shortcuts = ["p", "d"];

  onActivate(ctx: ToolContext): void {
    ctx.setCursor("crosshair");
  }

  onPointerDown(ctx: ToolContext, e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;

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

    const el = createElement(
      "freedraw",
      { x: world.x, y: world.y, points: [{ x: 0, y: 0 }] },
      ictx.getStyle(),
    ) as FreedrawElement;
    ictx.addElement(el);
    ictx.setInteraction({ kind: "freedrawing", element: el });
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

    if (interaction.kind !== "freedrawing") return;

    const el = interaction.element;
    const live = ictx.getElement(el.id) as FreedrawElement | undefined;
    if (!live) return;
    const pts = [...live.points, { x: world.x - el.x, y: world.y - el.y }];
    ictx.updateElement(el.id, { points: pts } as Partial<FreedrawElement>);
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

    if (it.kind === "freedrawing") {
      const live = ictx.getElement(it.element.id) as FreedrawElement | undefined;
      if (live) {
        // Recompute bounding box from points.
        const pts = live.points;
        if (pts.length > 1) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          const newPts = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
          ictx.updateElement(live.id, {
            x: live.x + minX,
            y: live.y + minY,
            width: maxX - minX,
            height: maxY - minY,
            points: newPts,
          } as Partial<FreedrawElement>);
        }
      }
      ictx.emitChange();
    }

    ictx.setInteraction({ kind: "idle" });
    ictx.setTool("selection");
    ictx.markDirty();
  }
}
