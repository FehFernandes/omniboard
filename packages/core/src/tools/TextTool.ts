/**
 * TextTool — Click to create a text element and open its inline editor.
 */

import type { Tool, ToolContext } from "../plugin-types";
import type { Point, TextElement } from "../types";
import type { InternalToolContext } from "./types";
import { createElement } from "../elements";

export class TextTool implements Tool {
  readonly id = "text";
  readonly label = "Text";
  readonly cursor = "text";
  readonly shortcuts = ["t"];

  onActivate(ctx: ToolContext): void {
    ctx.setCursor("text");
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
      "text",
      { x: world.x, y: world.y, width: 0, height: 0 },
      ictx.getStyle(),
    ) as TextElement;
    ictx.addElement(el);
    ictx.setSelection([el.id]);
    ictx.openTextEditor(el);
    ictx.setInteraction({ kind: "idle" });
    ictx.setTool("selection");
    ictx.capturePointer(e);
    ictx.markDirty();
  }

  onPointerMove(ctx: ToolContext, e: PointerEvent, _world: Point): void {
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
    }
  }

  onPointerUp(ctx: ToolContext, e: PointerEvent, _world: Point): void {
    const ictx = ctx as InternalToolContext;
    ictx.releasePointer(e);
    const it = ictx.getInteraction();
    if (it.kind === "panning") {
      ictx.setInteraction({ kind: "idle" });
      ictx.setCursor("text");
    }
  }
}
