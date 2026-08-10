/**
 * HandTool — Pans the canvas by dragging.
 */

import type { Tool, ToolContext } from "../plugin-types";
import type { Point } from "../types";
import type { InternalToolContext } from "./types";

export class HandTool implements Tool {
  readonly id = "hand";
  readonly label = "Pan";
  readonly cursor = "grab";
  readonly shortcuts = ["h"];

  onActivate(ctx: ToolContext): void {
    ctx.setCursor("grab");
  }

  onPointerDown(ctx: ToolContext, e: PointerEvent, _world: Point): void {
    const ictx = ctx as InternalToolContext;
    ictx.setInteraction({
      kind: "panning",
      lastScreen: ictx.getScreenPoint(e),
    });
    ictx.capturePointer(e);
    ctx.setCursor("grabbing");
  }

  onPointerMove(ctx: ToolContext, e: PointerEvent, _world: Point): void {
    const ictx = ctx as InternalToolContext;
    const interaction = ictx.getInteraction();
    if (interaction.kind !== "panning") return;

    const s = ictx.getScreenPoint(e);
    const dx = s.x - interaction.lastScreen.x;
    const dy = s.y - interaction.lastScreen.y;
    ictx.panBy(dx, dy);
    interaction.lastScreen = s;
    ictx.emitCamera();
    ictx.markDirty();
  }

  onPointerUp(ctx: ToolContext, e: PointerEvent, _world: Point): void {
    const ictx = ctx as InternalToolContext;
    ictx.releasePointer(e);
    ictx.setInteraction({ kind: "idle" });
    ctx.setCursor("grab");
  }
}
