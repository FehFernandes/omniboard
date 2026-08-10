/**
 * Built-in tools for OmniBoard.
 */

export { ToolManager } from "./ToolManager";
export { HandTool } from "./HandTool";
export { SelectionTool } from "./SelectionTool";
export { DrawTool } from "./DrawTool";
export type { DrawToolOptions } from "./DrawTool";
export { FreedrawTool } from "./FreedrawTool";
export { TextTool } from "./TextTool";
export { ImageTool } from "./ImageTool";
export { EmbedTool } from "./EmbedTool";
export type { Interaction, InternalToolContext } from "./types";

import { ToolManager } from "./ToolManager";
import { HandTool } from "./HandTool";
import { SelectionTool } from "./SelectionTool";
import { DrawTool } from "./DrawTool";
import { FreedrawTool } from "./FreedrawTool";
import { TextTool } from "./TextTool";
import { ImageTool } from "./ImageTool";
import { EmbedTool } from "./EmbedTool";

/**
 * Register all built-in tools into a ToolManager.
 */
export function registerBuiltinTools(manager: ToolManager): void {
  manager.register(new SelectionTool());
  manager.register(new HandTool());
  manager.register(new DrawTool({
    id: "rectangle",
    label: "Rectangle",
    shortcuts: ["r", "2"],
    elementType: "rectangle",
  }));
  manager.register(new DrawTool({
    id: "ellipse",
    label: "Ellipse",
    shortcuts: ["o", "3"],
    elementType: "ellipse",
  }));
  manager.register(new DrawTool({
    id: "line",
    label: "Line",
    shortcuts: ["l"],
    elementType: "line",
  }));
  manager.register(new DrawTool({
    id: "arrow",
    label: "Arrow",
    shortcuts: ["a", "4"],
    elementType: "arrow",
  }));
  manager.register(new DrawTool({
    id: "shape",
    label: "Shape",
    shortcuts: [],
    elementType: "shape",
  }));
  manager.register(new DrawTool({
    id: "sticky",
    label: "Sticky note",
    shortcuts: [],
    elementType: "sticky",
    defaultSize: { width: 200, height: 200 },
  }));
  manager.register(new DrawTool({
    id: "frame",
    label: "Frame",
    shortcuts: [],
    elementType: "frame",
    defaultSize: { width: 600, height: 400 },
    promptName: true,
  }));
  manager.register(new DrawTool({
    id: "tasks",
    label: "Tasks",
    shortcuts: [],
    elementType: "tasks",
    defaultSize: { width: 300, height: 360 },
  }));
  // Shortcut to another board: born asking for the destination
  // (activateOnCreate).
  manager.register(new DrawTool({
    id: "link",
    label: "Board shortcut",
    shortcuts: [],
    elementType: "link",
    defaultSize: { width: 240, height: 72 },
    activateOnCreate: true,
  }));
  // Long note: the card is the preview, the text is edited in the modal.
  manager.register(new DrawTool({
    id: "note",
    label: "Note",
    shortcuts: [],
    elementType: "note",
    defaultSize: { width: 260, height: 200 },
    activateOnCreate: true,
  }));
  manager.register(new FreedrawTool());
  manager.register(new TextTool());
  manager.register(new ImageTool());
  manager.register(new EmbedTool());
}
