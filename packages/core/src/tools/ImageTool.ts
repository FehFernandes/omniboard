/**
 * ImageTool — Click to prompt for an image file, then place it at that point.
 */

import type { Tool, ToolContext } from "../plugin-types";
import type { Point } from "../types";
import type { InternalToolContext } from "./types";

export class ImageTool implements Tool {
  readonly id = "image";
  readonly label = "Image";
  readonly cursor = "crosshair";

  onActivate(ctx: ToolContext): void {
    ctx.setCursor("crosshair");
  }

  onPointerDown(ctx: ToolContext, _e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;
    ictx.setTool("selection");
    ictx.setInteraction({ kind: "idle" });
    ictx.promptImageAt(world);
  }
}
