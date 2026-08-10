/**
 * Extended ToolContext for built-in tools.
 *
 * Built-in tools need deeper access than what plugin tools get via the public
 * ToolContext interface. This file defines the extended contract.
 */

import type { ToolContext } from "../plugin-types";
import type {
  BoardElement,
  Bounds,
  FreedrawElement,
  Point,
  ShapeKind,
  TextElement,
  ToolType,
} from "../types";
import type { HandleName } from "../selection";
import type { SnapLine } from "../snapping";

/**
 * Interaction state shared between Board and tools.
 * Tools set this to communicate what drag operation is happening.
 */
export type Interaction =
  | { kind: "idle" }
  | {
      kind: "panning";
      lastScreen: Point;
      startScreen?: Point;
      maybeTaskAction?: { id: string; hit: any };
      /** A short click in hand mode triggers link/note (without editing). */
      maybeActivate?: BoardElement;
    }
  | { kind: "creating"; element: BoardElement; startWorld: Point }
  | { kind: "freedrawing"; element: FreedrawElement }
  | { kind: "moving"; startWorld: Point; origins: Map<string, BoardElement>; maybeActivateEmbedId?: string; maybeTaskAction?: { id: string; hit: any } }
  | { kind: "resizing"; handle: HandleName; orig: BoardElement }
  | { kind: "rotating"; orig: BoardElement }
  | { kind: "bending"; arrowId: string; midpoint: Point }
  | { kind: "boxselect"; startWorld: Point };

/**
 * Extended context available to built-in tools. Provides access to internal
 * Board facilities that are not exposed to external plugins.
 */
export interface InternalToolContext extends ToolContext {
  // Interaction state
  getInteraction(): Interaction;
  setInteraction(interaction: Interaction): void;

  // Selection details
  snapshotSelection(): Map<string, BoardElement>;

  // Scene access
  getElementsRaw(): BoardElement[];
  hitTest(world: Point): BoardElement | null;
  hitHoverAnchor(world: Point): { elementId: string; anchor: string; point: Point } | null;
  setHoverAnchors(
    anchors:
      | {
          elementId: string;
          anchors: { anchor: string; point: Point; attach?: Point }[];
          active?: string;
        }
      | null,
  ): void;

  // Camera
  panBy(dx: number, dy: number): void;
  getScreenPoint(e: PointerEvent | MouseEvent): Point;

  // Tools
  setTool(tool: ToolType): void;
  getTool(): ToolType;

  // Shape-creation options
  getShapeKind(): ShapeKind;
  getCurveType(): import("../types").CurveType;
  getStickyColor(): string;

  // Snapping
  setSnapGuides(guides: SnapLine[]): void;

  // Connection indicator
  setConnectionIndicator(indicator: { point: Point; anchors: { anchor: string; point: Point }[] } | null): void;

  // Text editing
  openTextEditor(el: TextElement): void;
  openLabelEditor(el: BoardElement): void;
  /** Name editor (frame: label in the top-right corner). */
  openNameEditor(el: BoardElement): void;
  /**
   * Tells the application the element was triggered (link/note): opening a modal
   * or navigating is up to the outer layer. See the `elementActivate` event.
   */
  activateElement(el: BoardElement, reason: "click" | "create"): void;
  commitActiveEditor(): void;
  isEditing(): boolean;

  // Embed/Image managers
  embedDeactivate(): void;
  embedActivate(id: string): void;
  promptImageAt(world: Point): void;

  // Canvas
  capturePointer(e: PointerEvent): void;
  releasePointer(e: PointerEvent): void;

  // Rendering / notification
  emitChange(): void;
  emitSelectionChange(): void;
  emitCamera(): void;

  // Resize operations
  applyResize(orig: BoardElement, handle: HandleName, world: Point): void;

  // Connected arrows update
  updateConnectedArrows(movedIds: Set<string>): void;

  // Box selection
  setSelectionBox(box: Bounds | null): void;
  applyBoxSelection(box: Bounds): void;

  // Tasks
  applyTaskAction(id: string, hit: any, record?: boolean): void;

  // Lock state
  isLocked(): boolean;

  // Space key
  isSpaceDown(): boolean;

  // Embed creation (public Board API proxied for EmbedTool)
  addEmbed(url: string, opts?: { position?: Point }): void;
}
