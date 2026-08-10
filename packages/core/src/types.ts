/**
 * Core type definitions for OmniBoard.
 * All geometry is expressed in "world" (scene) coordinates unless stated otherwise.
 */

import type { Theme } from "./themes";

export interface Point {
  x: number;
  y: number;
}

export type ElementType =
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "freedraw"
  | "text"
  | "image"
  | "embed"
  | "tasks"
  | "shape"
  | "sticky"
  | "frame"
  | "link"
  | "note";

export interface ElementStyle {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "solid" | "transparent";
  strokeWidth: number;
  opacity: number; // 0..1
  roughness?: number; // reserved for future hand-drawn rendering
}

export interface TextStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle";
}

export interface BaseElement extends ElementStyle {
  id: string;
  type: ElementType;
  /** Top-left corner of the element's bounding box in world coords. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in radians around the bounding-box center. */
  angle: number;
  /** Monotonic version, bumped on every mutation (useful for collab/diffing). */
  version: number;
  /** True while the element is being created/edited and should not be finalized. */
  isDeleted?: boolean;
  /** Optional text label rendered centered inside the element. */
  label?: string;
  labelFontSize?: TextStyle["fontSize"];
  labelFontFamily?: TextStyle["fontFamily"];
  labelFontWeight?: TextStyle["fontWeight"];
  labelFontStyle?: TextStyle["fontStyle"];
  labelTextAlign?: TextStyle["textAlign"];
  labelVerticalAlign?: TextStyle["verticalAlign"];
}

export interface RectangleElement extends BaseElement {
  type: "rectangle";
}

export interface EllipseElement extends BaseElement {
  type: "ellipse";
}

/** Line / arrow are defined by relative points from (x, y). */
export interface LinearElement extends BaseElement {
  type: "line" | "arrow";
  /** Points relative to (x, y). At least two. */
  points: Point[];
  /** Id of the element the start of this line/arrow is connected to. */
  sourceId?: string;
  /** Anchor position on the source element (defaults to nearest edge). */
  sourceAnchor?: AnchorPosition;
  /** Id of the element the end of this line/arrow is connected to. */
  targetId?: string;
  /** Anchor position on the target element. */
  targetAnchor?: AnchorPosition;
  /** Straight or curved path. Default "straight". */
  curveType?: CurveType;
  /**
   * Offset of the quadratic bezier control point relative to the midpoint of
   * the line segment (for 2-point lines/arrows). Dragging the "bend handle"
   * changes this. When absent or {0,0}, the line is straight.
   */
  controlOffset?: Point;
}

/** Anchoring positions on an element's bounding box. */
export type AnchorPosition = "center" | "top" | "right" | "bottom" | "left";

export interface FreedrawElement extends BaseElement {
  type: "freedraw";
  /** Points relative to (x, y). */
  points: Point[];
  /** Per-point pressure (parallel to points), optional. */
  pressures?: number[];
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: TextStyle["fontSize"];
  fontFamily: TextStyle["fontFamily"];
  fontWeight: TextStyle["fontWeight"];
  fontStyle: TextStyle["fontStyle"];
  textAlign: TextStyle["textAlign"];
  verticalAlign: TextStyle["verticalAlign"];
}

/** Raster image element. `src` is a data-URL or absolute/relative URL. */
export interface ImageElement extends BaseElement {
  type: "image";
  /** Image source (data URL or http(s) URL). */
  src: string;
  /** Intrinsic aspect ratio (width/height), used to keep proportions. */
  aspectRatio?: number;
}

/** Embedded external content rendered as an <iframe> DOM overlay. */
export interface EmbedElement extends BaseElement {
  type: "embed";
  /** URL loaded inside the iframe (already normalized to an embeddable URL). */
  src: string;
}

export type TaskPriority = "high" | "medium" | "low";

/** A single task inside a {@link TasksElement}. */
export interface TaskItem {
  text: string;
  done: boolean;
  priority?: TaskPriority;
}

/** An interactive checklist/tasks card (rendered on the canvas). */
export interface TasksElement extends BaseElement {
  type: "tasks";
  /** Card title. Defaults to "Tarefas". */
  title: string;
  items: TaskItem[];
}

/** Extra diagram / system-design shapes drawn within the bounding box. */
export type ShapeKind =
  | "diamond"
  | "triangle"
  | "hexagon"
  | "parallelogram"
  | "cylinder"
  | "cloud"
  | "document"
  | "star"
  | "pill"
  /** Stick figure: represents a person/actor. */
  | "person"
  | "cube"
  | "browser"
  | "folder"
  | "callout"
  | "cross"
  | "arrowBlock";

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: ShapeKind;
}

/** Pastel-colored sticky note (post-it). */
export interface StickyElement extends BaseElement {
  type: "sticky";
  /** Pastel background color of the note. */
  color: string;
  /** Text content of the note. */
  text: string;
}

/** Named colors for sticky notes. */
/**
 * Sticky colors. The first half are the original pastels (good for lots of
 * text); the second half are saturated tones, to make notes stand out and to
 * tell categories apart from a distance.
 *
 * The text is always dark (#1e1e1e), so we avoid tones dark enough to hurt
 * reading contrast.
 */
export const STICKY_COLORS = [
  // Pastels
  "#FFF9B1", // yellow (default)
  "#D1F7C4", // green
  "#AECBFA", // blue
  "#F9CBFF", // pink
  "#FFDDC1", // peach
  "#E8D5FF", // lilac
  // Strong
  "#FFD02F", // golden yellow
  "#FF9D48", // orange
  "#FF6B6B", // coral red
  "#F571C0", // magenta
  "#B39DFF", // violet
  "#5B9CFF", // blue
  "#3FD9C9", // turquoise
  "#67D96B", // lime green
] as const;

/**
 * Shortcut to another destination — in practice, another board.
 *
 * The core does not know the concept of a "board": it stores an opaque
 * `targetId` and notifies through an event (`elementActivate`) when the user
 * triggers the shortcut. Knowing what to do with the id is up to the application
 * (in the app, BoardManager.switch). This keeps the canvas independent of how
 * documents are organized.
 */
export interface LinkElement extends BaseElement {
  type: "link";
  /** Destination id (board). Empty = shortcut not configured yet. */
  targetId?: string;
  /** Text shown on the card. */
  label?: string;
  /** Secondary line (e.g. "board" or the folder name). */
  subtitle?: string;
}

/**
 * Long-text note. The card on the canvas shows a title and an excerpt; the whole
 * content is edited in a modal (the canvas is terrible for typing paragraphs).
 */
export interface NoteElement extends BaseElement {
  type: "note";
  title?: string;
  text: string;
  /** Color of the strip/border, to tell notes apart. */
  color?: string;
}

/**
 * Frame / whiteboard area: a white rectangle with a thin border and an
 * optional title. It's drawn *behind* other elements (lowest z-order by
 * convention) to serve as a bounded workspace/contrast area on the canvas.
 */
export interface FrameElement extends BaseElement {
  type: "frame";
  /** Label shown at the top-left outside the frame border. */
  title: string;
}

export type BoardElement =
  | RectangleElement
  | EllipseElement
  | LinearElement
  | FreedrawElement
  | TextElement
  | ImageElement
  | EmbedElement
  | TasksElement
  | ShapeElement
  | StickyElement
  | FrameElement
  | LinkElement
  | NoteElement;

export type ToolType =
  | "selection"
  | "hand"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "freedraw"
  | "text"
  | "image"
  | "embed"
  | "tasks"
  | "shape"
  | "sticky"
  | "frame"
  | "link"
  | "note";

/** Curve style for lines/arrows. */
export type CurveType = "straight" | "curve";

/** Background pattern for the canvas grid. */
export type GridPattern = "dots" | "crosses" | "lines" | "grid" | "none";
export interface CameraState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface BoardSnapshot {
  version: 1;
  /**
   * Format marker. The value is "openboard" for historical reasons (the project
   * used to be called that) and deliberately does NOT track the product name:
   * changing it would invalidate every file and localStorage already saved out
   * there. Treat it as a format identifier, not as a brand.
   */
  type: "openboard";
  /** Schema version for forward/backward migrations by consumers. */
  schemaVersion?: number;
  elements: BoardElement[];
  camera?: CameraState;
  /** Optional persisted appearance overrides. */
  appearance?: AppearanceConfig;
}

/** Current serialization schema version. Bumped on breaking format changes. */
export const SCHEMA_VERSION = 1;

/** Axis-aligned bounding box in world coordinates. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BoardOptions {
  /** Initial elements to load. */
  elements?: BoardElement[];
  /** Initial camera. */
  camera?: Partial<CameraState>;
  /** Color theme. Defaults to "light". */
  theme?: Theme;
  /** Canvas background color. Overrides the theme background when set. */
  background?: string;
  /** Show the dotted grid. */
  grid?: boolean;
  /** Default style applied to newly created elements. */
  defaultStyle?: Partial<ElementStyle>;
  /** Default text style applied to newly created text elements. */
  defaultTextStyle?: Partial<TextStyle>;
  /** Default text style applied to labels inside non-text elements. */
  defaultLabelStyle?: Partial<TextStyle>;
  /** Min/max zoom clamps. */
  minZoom?: number;
  maxZoom?: number;
  /** Visual appearance overrides (selection/grid colors, handle size, etc.). */
  appearance?: AppearanceConfig;
  /** Enable the built-in right-click context menu. Default true. */
  contextMenu?: boolean;
  /** Enable the built-in floating toolbar above the selection. Default true. */
  selectionToolbar?: boolean;
  /** Edge panning (move board when mouse is near screen edges, RTS-style).
   *  Set to `true` for defaults, `false` to disable, or an object to configure. */
  edgePan?: boolean | { edgeSize?: number; speed?: number; enabled?: boolean };
  /**
   * Uploads the image to an external storage and returns the public URL.
   *
   * Without it, pasted/dropped images become a data URL INSIDE the element — and
   * therefore inside the saved snapshot. With the hook, the board keeps only the
   * URL. If the promise rejects, the board embeds the image and emits
   * `imageUploadError`.
   */
  uploadImage?: import("./ImageManager").ImageUploader;
}

/**
 * Fine-grained visual customization. Every field is optional and overrides the
 * value derived from the current theme. This is what makes OmniBoard "skinnable"
 * without forking the renderer.
 */
export interface AppearanceConfig {
  /** Selection outline / handles color. */
  selectionColor?: string;
  /** Fill of the drag-select rectangle (usually semi-transparent). */
  selectionFill?: string;
  /** Dotted grid color. */
  gridColor?: string;
  /** Grid dot spacing in world units. Defaults to 20. */
  gridSpacing?: number;
  /** Background pattern style. Defaults to "dots". */
  gridPattern?: GridPattern;
  /** Resize handle size in screen pixels. Defaults to 8. */
  handleSize?: number;
  /** Resize handle fill color. Defaults to the background color. */
  handleFill?: string;
  /** Default stroke color for new elements (per-theme fallback otherwise). */
  strokeColor?: string;
  /** Color of the alignment/snap guide lines. Default a pink/red. */
  snapColor?: string;
}

export type BoardEvent =
  | { type: "change"; elements: BoardElement[] }
  | {
      type: "elementsChange";
      elements: BoardElement[];
      added: BoardElement[];
      updated: BoardElement[];
      removed: string[];
    }
  | { type: "selectionChange"; ids: string[] }
  | { type: "toolChange"; tool: ToolType }
  | { type: "themeChange"; theme: Theme }
  | { type: "appearanceChange"; appearance: AppearanceConfig }
  | { type: "embedActiveChange"; id: string | null }
  | { type: "lockChange"; locked: boolean }
  /**
   * The user triggered an element that needs UI outside the canvas: a shortcut
   * (`link`) to navigate or a note (`note`) to open in the modal. The core knows
   * neither how to navigate nor how to build a modal — the application decides.
   */
  | { type: "elementActivate"; element: BoardElement; reason: "click" | "create" }
  /** Image upload to the storage failed: it was embedded in the snapshot. */
  | { type: "imageUploadError"; error: unknown; file: File }
  | { type: "cameraChange"; camera: CameraState };

export type BoardEventType = BoardEvent["type"];

/**
 * The event that a given `type` delivers.
 *
 * It exists so `board.on("change", (e) => e.elements)` type-checks: without
 * narrowing, the listener receives the whole {@link BoardEvent} union and every
 * access needs a manual guard.
 */
export type BoardEventOf<T extends BoardEventType> = Extract<BoardEvent, { type: T }>;

/**
 * A single mutation operation, suitable for applying batches of changes coming
 * from a backend / realtime collaboration channel via `board.applyOperations`.
 */
export type ElementOperation =
  | { op: "add"; element: BoardElement }
  | { op: "update"; id: string; patch: Partial<BoardElement> }
  | { op: "remove"; id: string };
