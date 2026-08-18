/**
 * EmbedTool — Click to prompt for a URL, then place an embed (iframe) at that point.
 */

import type { Tool, ToolContext } from "../plugin-types";
import type { Point } from "../types";
import type { InternalToolContext } from "./types";

export class EmbedTool implements Tool {
  readonly id = "embed";
  readonly label = "Embed";
  readonly cursor = "crosshair";

  onActivate(ctx: ToolContext): void {
    ctx.setCursor("crosshair");
  }

  onPointerDown(ctx: ToolContext, _e: PointerEvent, world: Point): void {
    const ictx = ctx as InternalToolContext;
    ictx.setTool("selection");
    ictx.setInteraction({ kind: "idle" });
    const url = window.prompt(
      "Cole a URL para incorporar (YouTube, Vimeo, site...):",
      "",
    );
    if (url && url.trim()) {
      ictx.addEmbed(url.trim(), { position: world });
    }
  }
}
