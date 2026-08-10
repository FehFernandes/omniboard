export { Board } from "./Board";
export { ClipboardManager } from "./ClipboardManager";
export type { ClipboardManagerDeps } from "./ClipboardManager";
export { EdgePanManager } from "./EdgePanManager";
export type { EdgePanOptions, EdgePanManagerDeps } from "./EdgePanManager";
export { ElementRegistryImpl } from "./ElementRegistry";
export { normalizeEmbedUrl } from "./EmbedManager";
export { EmbedManager } from "./EmbedManager";
export { ImageManager } from "./ImageManager";
export type { ImageManagerDeps, ImageUploader } from "./ImageManager";
export { InputManager } from "./InputManager";
export type { InputHandlers } from "./InputManager";
export { TextEditManager } from "./TextEditManager";
export type { TextEditManagerDeps } from "./TextEditManager";
export { Camera } from "./Camera";
export { Scene } from "./Scene";
export { History } from "./History";
export { CanvasRenderer } from "./CanvasRenderer";
export {
  createElement,
  normalizeElement,
  hitTestElement,
  DEFAULT_STYLE,
  DEFAULT_TEXT_STYLE,
  DEFAULT_LABEL_STYLE,
} from "./elements";

export {
  getHandles,
  hitTestHandle,
  resizeElement,
  rotationFromPointer,
  RESIZE_CURSORS,
  HANDLE_SIZE,
  ROTATE_OFFSET,
} from "./selection";
export type { Handle, HandleName } from "./selection";

export * from "./geometry";
export { THEMES } from "./themes";
export type { Theme, ThemePalette } from "./themes";
export {
  attachPersistence,
  localStorageAdapter,
  memoryAdapter,
  attachWorkspacePersistence,
  workspaceLocalStorageAdapter,
} from "./persistence";
export type {
  StorageAdapter,
  PersistenceOptions,
  WorkspaceStorageAdapter,
  WorkspacePersistenceOptions,
} from "./persistence";
export { BoardManager } from "./BoardManager";
export type {
  BoardDocument,
  BoardDocumentMeta,
  WorkspaceSnapshot,
  BoardManagerEvent,
  BoardManagerEventType,
  BoardManagerEventOf,
  BoardManagerOptions,
} from "./BoardManager";
export { SCHEMA_VERSION } from "./types";
export { STICKY_COLORS } from "./types";
export {
  ContextMenu,
  SelectionToolbar,
  OVERLAY_THEMES,
} from "./overlays";
export type { MenuItem, ToolbarButton, OverlayTheme } from "./overlays";
export { ICONS } from "./icons";
export { confetti } from "./confetti";
export type { ConfettiOptions } from "./confetti";
export { computeSnap } from "./snapping";
export type { SnapLine, SnapResult } from "./snapping";
export {
  findConnectionTarget,
  resolveAnchor,
  getAnchorPoints,
  getElementAnchorHandles,
  ANCHOR_HANDLE_GAP,
  ANCHOR_GRAB_RADIUS,
  ANCHOR_ZONE_PADDING,
  findAnchorHost,
  isConnectable,
  getElementAnchors,
} from "./connections";
export type { ConnectionCandidate } from "./connections";
export { tasksLayout, tasksHitTest, TASKS_STYLE, PRIORITY_COLOR } from "./tasks";
export type { TasksLayout, TasksRow, TasksHit } from "./tasks";
export type * from "./types";
export type * from "./plugin-types";

// Tools
export { ToolManager, registerBuiltinTools } from "./tools";
export { HandTool } from "./tools/HandTool";
export { SelectionTool } from "./tools/SelectionTool";
export { DrawTool } from "./tools/DrawTool";
export type { DrawToolOptions } from "./tools/DrawTool";
export { FreedrawTool } from "./tools/FreedrawTool";
export { TextTool } from "./tools/TextTool";
export { ImageTool } from "./tools/ImageTool";
export { EmbedTool } from "./tools/EmbedTool";
export type { Interaction, InternalToolContext } from "./tools";
