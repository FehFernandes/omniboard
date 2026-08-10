import { Camera } from "./Camera";
import { CanvasRenderer, labelFontSize } from "./CanvasRenderer";
import { ClipboardManager } from "./ClipboardManager";
import { confetti } from "./confetti";
import { EdgePanManager } from "./EdgePanManager";
import { ElementRegistryImpl } from "./ElementRegistry";
import { EmbedManager, normalizeEmbedUrl } from "./EmbedManager";
import { ImageManager } from "./ImageManager";
import { InputManager } from "./InputManager";
import { TextEditManager } from "./TextEditManager";
import { ToolManager, registerBuiltinTools } from "./tools";
import type { Interaction, InternalToolContext } from "./tools";
import {
  createElement,
  DEFAULT_LABEL_STYLE,
  DEFAULT_TEXT_STYLE,
  DEFAULT_STYLE,
  hitTestElement,
} from "./elements";
import { boundsIntersect, elementBounds, getElementsBounds } from "./geometry";
import { History } from "./History";
import { Scene } from "./Scene";
import {
  type HandleName,
  resizeElement,
} from "./selection";
import { type Theme, type ThemePalette, THEMES } from "./themes";
import {
  ContextMenu,
  type MenuItem,
  OVERLAY_THEMES,
  type OverlayTheme,
  SelectionToolbar,
  type ToolbarButton,
} from "./overlays";
import { ICONS } from "./icons";
import { type SnapLine } from "./snapping";
import { tasksHitTest, type TasksHit } from "./tasks";
import {
  ANCHOR_GRAB_RADIUS,
  resolveAnchor,
} from "./connections";
import type {
  AppearanceConfig,
  BoardElement,
  BoardEvent,
  BoardEventType,
  BoardOptions,
  BoardSnapshot,
  Bounds,
  ElementStyle,
  EmbedElement,
  ElementOperation,
  ImageElement,
  LinearElement,
  Point,
  TextElement,
  TextStyle,
  TasksElement,
  TaskItem,
  ShapeKind,
  FrameElement,
  ToolType,
  BoardEventOf,
} from "./types";
import { SCHEMA_VERSION } from "./types";

type Listener = (e: BoardEvent) => void;

const HIT_THRESHOLD = 8; // screen px

export class Board {
  readonly scene: Scene;
  readonly camera: Camera;
  private renderer: CanvasRenderer;
  private history = new History();
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private resizeObserver: ResizeObserver;

  private tool: ToolType = "selection";
  private shapeKind: ShapeKind = "diamond";
  private curveType: import("./types").CurveType = "straight";
  private stickyColor = "#FFF9B1";
  private selectedIds = new Set<string>();
  private interaction: Interaction = { kind: "idle" };
  private selectionBox: Bounds | null = null;

  private theme: Theme;
  private explicitBackground?: string;
  private showGrid: boolean;
  private style: ElementStyle;
  private textStyle: TextStyle;
  private labelStyle: TextStyle;
  private clipboardManager!: ClipboardManager;
  private inputManager!: InputManager;
  private toolManager!: ToolManager;
  private elementRegistry: ElementRegistryImpl;
  private appearance: AppearanceConfig;
  /** Snapshot of element id -> version at the last emitted change, for diffing. */
  private lastVersions = new Map<string, number>();

  private listeners = new Map<BoardEventType, Set<Listener>>();
  private dirty = true;
  private rafId: number | null = null;
  private spaceDown = false;
  private destroyed = false;
  /** When true: editing is disabled; drag pans and embeds/tasks stay interactive. */
  private locked = false;
  /** When true: non-selected elements are dimmed for focus. */
  private focusMode = false;

  /** Manages inline text / label editing. */
  private textEditManager!: TextEditManager;

  /** Manages image loading and caching. */
  private imageManager!: ImageManager;
  /** Manages embed (iframe) DOM overlays. */
  private embedManager!: EmbedManager;
  private edgePanManager: EdgePanManager | null = null;

  /** Optional built-in UI overlays (Miro-like). */
  private contextMenu: ContextMenu | null = null;
  private selectionToolbar: SelectionToolbar | null = null;
  /** True while coalescing arrow-key nudges into a single undo step. */
  private nudging = false;
  /** Active alignment guides while dragging (world coords). */
  private snapGuides: SnapLine[] = [];
  /** Connection candidate (arrow endpoint near an anchor) for indicator rendering. */
  private connectionIndicator: { point: Point; anchors: { anchor: string; point: Point }[] } | null = null;
  /** Anchors shown on hover (for starting a connection by clicking on one). */
  private hoverAnchors:
    | {
        elementId: string;
        anchors: { anchor: string; point: Point; attach?: Point }[];
        active?: string;
      }
    | null = null;

  constructor(container: HTMLElement, options: BoardOptions = {}) {
    this.container = container;
    this.theme = options.theme ?? "light";
    this.explicitBackground = options.background;
    this.showGrid = options.grid ?? true;
    this.appearance = { ...options.appearance };
    this.style = {
      ...DEFAULT_STYLE,
      strokeColor:
        this.appearance.strokeColor ?? THEMES[this.theme].defaultStroke,
      ...options.defaultStyle,
    };
    this.textStyle = {
      ...DEFAULT_TEXT_STYLE,
      ...options.defaultTextStyle,
    };
    this.labelStyle = {
      ...DEFAULT_LABEL_STYLE,
      ...options.defaultLabelStyle,
    };

    this.scene = new Scene(options.elements ?? []);
    this.elementRegistry = new ElementRegistryImpl();
    this.syncVersionSnapshot();
    this.camera = new Camera(
      options.camera,
      options.minZoom ?? 0.05,
      options.maxZoom ?? 30,
    );

    // Canvas setup
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    container.appendChild(this.canvas);
    this.renderer = new CanvasRenderer(this.canvas);

    // Image manager handles loading and caching of image elements.
    this.imageManager = new ImageManager({
      getElements: () => this.scene.getElements(),
      addImage: (src, opts) => this.addImage(src, opts),
      markDirty: () => this.markDirty(),
      // External storage (optional): without it the image stays embedded in the
    // snapshot.
      uploadImage: options.uploadImage,
      onUploadError: (err, file) => {
        this.emit({ type: "imageUploadError", error: err, file });
      },
    });

    // Clipboard manager handles copy/paste/duplicate.
    this.clipboardManager = new ClipboardManager({
      getElements: () => this.scene.getElements(),
      getSelectedIds: () => this.selectedIds,
      addElement: (el) => this.scene.add(el),
      setSelection: (ids) => this.setSelection(ids),
      commitHistory: () => this.commitHistory(),
      emitChange: () => this.emitChange(),
      markDirty: () => this.markDirty(),
    });

    // Embed manager handles all iframe overlays above the canvas.
    this.embedManager = new EmbedManager(container, {
      camera: this.camera,
      getElements: () => this.scene.getElements(),
      getSelectedIds: () => this.selectedIds,
      getSelectionColor: () => this.getPalette().selection,
      isLocked: () => this.locked,
      onActiveChange: (id) => this.emit({ type: "embedActiveChange", id }),
    });

    // Text edit manager handles inline textarea editing.
    this.textEditManager = new TextEditManager({
      camera: this.camera,
      container,
      canvas: this.canvas,
      getElement: (id) => this.scene.getElement(id),
      updateElement: (id, patch) => this.scene.update(id, patch),
      removeElement: (id) => {
        this.scene.replaceAll(this.scene.getAllRaw().filter((x) => x.id !== id));
        this.pruneSelection();
      },
      commitHistory: () => this.commitHistory(),
      getElementTextStyle: (el) => this.getElementTextStyle(el),
      getElementLabelStyle: (el) => this.getElementLabelStyle(el),
      getNameColor: () => this.getPalette().defaultStroke,
      onTextCommitted: () => {
        this.emitChange();
        this.markDirty();
      },
      markDirty: () => this.markDirty(),
    });

    if (options.contextMenu ?? true) this.contextMenu = new ContextMenu(container);
    if (options.selectionToolbar ?? true) {
      this.selectionToolbar = new SelectionToolbar(container);
      this.selectionToolbar.setTheme(this.getOverlayTheme());
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();

    // Input manager handles all DOM event binding and coordinate translation.
    this.inputManager = new InputManager(this.canvas, this.camera, {
      onPointerDown: (e) => this.onPointerDown(e),
      onPointerMove: (e) => this.onPointerMove(e),
      onPointerUp: (e) => this.onPointerUp(e),
      onWheel: (e) => this.onWheel(e),
      onDoubleClick: (e) => this.onDoubleClick(e),
      onKeyDown: (e) => this.onKeyDown(e),
      onKeyUp: (e) => this.onKeyUp(e),
      onDragOver: (e) => this.onDragOver(e),
      onDrop: (e) => this.onDrop(e),
      onPaste: (e) => this.onPaste(e),
      onContextMenu: (e) => this.onContextMenu(e),
    });
    this.inputManager.attach();

    // Tool manager — registers all built-in tools and dispatches pointer events.
    this.toolManager = new ToolManager(this.createToolContext());
    registerBuiltinTools(this.toolManager);
    this.toolManager.setActive("selection");

    // Edge panning (RTS-style: move board when mouse is near screen edges).
    const edgePanOpt = options.edgePan;
    if (edgePanOpt !== false) {
      const epOpts = typeof edgePanOpt === "object" ? edgePanOpt : {};
      this.edgePanManager = new EdgePanManager(
        {
          camera: this.camera,
          canvas: this.canvas,
          onPan: () => { this.emitCamera(); this.markDirty(); },
        },
        epOpts,
      );
    }

    this.startLoop();
  }

  // ─── Internal Tool Context ───────────────────────────────────────────

  /** Builds the InternalToolContext that tools use to interact with the Board. */
  private createToolContext(): InternalToolContext {
    const board = this;
    return {
      // ToolContext (plugin-types.ts)
      getElements: () => board.scene.getElements(),
      getElement: (id) => board.scene.getElement(id),
      addElement: (el) => { board.scene.add(el); },
      updateElement: (id, patch) => { board.scene.update(id, patch); },
      removeElement: (id) => {
        board.scene.replaceAll(board.scene.getAllRaw().filter((x) => x.id !== id));
        board.pruneSelection();
      },
      screenToWorld: (sx, sy) => board.camera.screenToWorld(sx, sy),
      worldToScreen: (wx, wy) => board.camera.worldToScreen(wx, wy),
      getZoom: () => board.camera.zoom,
      getSelectedIds: () => [...board.selectedIds],
      setSelection: (ids) => board.setSelection(ids),
      clearSelection: () => { board.selectedIds.clear(); board.emit({ type: "selectionChange", ids: [] }); },
      commitHistory: () => board.commitHistory(),
      markDirty: () => board.markDirty(),
      setCursor: (c) => { board.canvas.style.cursor = c; },
      getStyle: () => ({ ...board.style, ...board.textStyle }),
      getCanvasPoint: (e) => board.inputManager.getWorldPoint(e),

      // InternalToolContext extensions
      getInteraction: () => board.interaction,
      setInteraction: (it) => { board.interaction = it; },
      snapshotSelection: () => board.snapshotSelection(),
      getElementsRaw: () => board.scene.getAllRaw(),
      hitTest: (w) => board.hitTest(w),
      hitHoverAnchor: (w) => board.hitHoverAnchor(w),
      setHoverAnchors: (a) => { board.hoverAnchors = a; },
      panBy: (dx, dy) => board.camera.panBy(dx, dy),
      getScreenPoint: (e) => board.inputManager.getScreenPoint(e),
      setTool: (t) => board.setTool(t),
      getTool: () => board.tool,
      getShapeKind: () => board.shapeKind,
      getCurveType: () => board.curveType,
      getStickyColor: () => board.stickyColor,
      setSnapGuides: (g) => { board.snapGuides = g; },
      setConnectionIndicator: (ind) => { board.connectionIndicator = ind; },
      openTextEditor: (el) => board.textEditManager.openTextEditor(el),
      openLabelEditor: (el) => board.textEditManager.openLabelEditor(el),
      // Frame name: dedicated editor, anchored to the label in the top-right
      // corner. Falls back to the label editor for other types.
      openNameEditor: (el) => {
        if (el.type === "frame") board.textEditManager.openFrameNameEditor(el);
        else board.textEditManager.openLabelEditor(el);
      },
      activateElement: (el, reason) => board.activateElement(el, reason),
      commitActiveEditor: () => board.textEditManager.commitActiveEditor(),
      isEditing: () => board.textEditManager.isEditing(),
      embedDeactivate: () => board.embedManager.deactivate(),
      embedActivate: (id) => board.embedManager.activate(id),
      promptImageAt: (w) => board.imageManager.promptImageFileAt(w),
      capturePointer: (e) => board.canvas.setPointerCapture(e.pointerId),
      releasePointer: (e) => {
        if (board.canvas.hasPointerCapture(e.pointerId)) {
          board.canvas.releasePointerCapture(e.pointerId);
        }
      },
      emitChange: () => board.emitChange(),
      emitSelectionChange: () => board.emit({ type: "selectionChange", ids: [...board.selectedIds] }),
      emitCamera: () => board.emitCamera(),
      applyResize: (orig, handle, world) => board.applyResize(orig, handle, world),
      updateConnectedArrows: (ids) => board.updateConnectedArrows(ids),
      setSelectionBox: (box) => { board.selectionBox = box; },
      applyBoxSelection: (box) => board.applyBoxSelection(box),
      applyTaskAction: (id, hit, record) => board.applyTaskAction(id, hit, record),
      isLocked: () => board.locked,
      isSpaceDown: () => board.spaceDown,
      addEmbed: (url, opts) => board.addEmbed(url, opts),
    };
  }

  // ---------------------------------------------------------------- Public API

  setTool(tool: ToolType): void {
    this.tool = tool;
    this.toolManager.setActive(tool);
    this.updateCursor();
    this.emit({ type: "toolChange", tool });
  }

  getTool(): ToolType {
    return this.tool;
  }

  /** Get the ToolManager (implements ToolRegistry) for registering custom tools. */
  getToolRegistry(): ToolManager {
    return this.toolManager;
  }

  /** Get the ElementRegistry for registering custom element types. */
  getElementRegistry(): ElementRegistryImpl {
    return this.elementRegistry;
  }

  /** Get the current shape kind used by the "shape" tool. */
  getShapeKind(): ShapeKind {
    return this.shapeKind;
  }

  /** Set the shape kind and switch to the "shape" tool (draw to create it). */
  setShapeKind(kind: ShapeKind): void {
    this.shapeKind = kind;
    this.setTool("shape");
  }

  /** Get the color used when creating new sticky notes. */
  getStickyColor(): string {
    return this.stickyColor;
  }

  /** Set the color for the next sticky note creation. */
  setStickyColor(color: string): void {
    this.stickyColor = color;
  }

  /** Get the current curve type for new arrows/lines. */
  getCurveType(): import("./types").CurveType {
    return this.curveType;
  }

  /** Switch between straight and curved arrows/lines. */
  setCurveType(type: import("./types").CurveType): void {    this.curveType = type;
    // Also update selected arrows.
    if (this.selectedIds.size > 0) {
      for (const id of this.selectedIds) {
        const el = this.scene.getElement(id);
        if (el && (el.type === "arrow" || el.type === "line")) {
          this.scene.update(id, { curveType: type } as Partial<LinearElement>);
        }
      }
      this.emitChange();
      this.markDirty();
    }
  }

  /**
   * Lock mode ("interact & navigate"): disables editing (select/move/resize/
   * draw). Dragging pans the canvas, and embeds/tasks stay directly
   * interactive — great for using iframes and checking tasks without editing.
   */
  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (locked) {
      this.textEditManager.commitActiveEditor();
      this.embedManager.deactivate();
      this.selectedIds.clear();
      this.emit({ type: "selectionChange", ids: [] });
      this.contextMenu?.hide();
    }
    this.emit({ type: "lockChange", locked });
    this.updateCursor();
    this.markDirty();
  }

  isLocked(): boolean {
    return this.locked;
  }

  toggleLock(): void {
    this.setLocked(!this.locked);
  }

  // ------------------------------------------------------------- Edge Pan

  /** Enable edge panning (RTS-style: board moves when mouse is near edges). */
  enableEdgePan(): void {
    this.edgePanManager?.enable();
  }

  /** Disable edge panning. */
  disableEdgePan(): void {
    this.edgePanManager?.disable();
  }

  /** Check if edge panning is currently enabled. */
  isEdgePanEnabled(): boolean {
    return this.edgePanManager?.isEnabled() ?? false;
  }

  /** Toggle edge panning on/off. */
  toggleEdgePan(): void {
    if (this.edgePanManager) {
      if (this.edgePanManager.isEnabled()) this.edgePanManager.disable();
      else this.edgePanManager.enable();
    }
  }

  // ------------------------------------------------------------- Focus mode

  /** Enable/disable focus mode: dims all non-selected elements. */
  setFocusMode(on: boolean): void {
    if (this.focusMode === on) return;
    this.focusMode = on;
    this.markDirty();
  }

  /** Whether focus mode is currently active. */
  isFocusMode(): boolean {
    return this.focusMode;
  }

  /** Toggle focus mode. */
  toggleFocusMode(): void {
    this.setFocusMode(!this.focusMode);
  }

  /** Fire a confetti celebration over the board. Returns a cancel function. */
  celebrate(options: import("./confetti").ConfettiOptions = {}): () => void {
    return confetti({ container: this.container, ...options });
  }

  // ------------------------------------------------------------- Camera helper

  /** Recenter the camera so the given world point is at the viewport center. */
  centerOn(worldX: number, worldY: number): void {
    this.camera.scrollX = this.renderer.width / 2 / this.camera.zoom - worldX;
    this.camera.scrollY = this.renderer.height / 2 / this.camera.zoom - worldY;
    this.emitCamera();
    this.markDirty();
  }

  // ------------------------------------------------------------- Theme

  getPalette(): ThemePalette {
    const bottom = THEMES[this.theme];
    return {
      ...bottom,
      grid: this.appearance.gridColor ?? bottom.grid,
      selection: this.appearance.selectionColor ?? bottom.selection,
      selectionFill: this.appearance.selectionFill ?? bottom.selectionFill,
      defaultStroke: this.appearance.strokeColor ?? bottom.defaultStroke,
    };
  }

  /** Get the current appearance overrides (empty object = pure theme). */
  getAppearance(): AppearanceConfig {
    return { ...this.appearance };
  }

  /**
   * Override visual appearance (selection/grid colors, handle size, grid
   * spacing, ...). Pass a partial; unspecified fields keep their current value.
   * This is the primary "theming/skinning" entry point.
   */
  setAppearance(appearance: AppearanceConfig): void {
    this.appearance = { ...this.appearance, ...appearance };
    this.emit({ type: "appearanceChange", appearance: this.getAppearance() });
    this.markDirty();
  }

  getBackground(): string {
    return this.explicitBackground ?? this.getPalette().background;
  }

  getTheme(): Theme {
    return this.theme;
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    const oldStroke = THEMES[this.theme].defaultStroke;
    this.theme = theme;
    // Migrate the default stroke color only if it wasn't customized.
    if (this.style.strokeColor === oldStroke) {
      this.style.strokeColor = THEMES[theme].defaultStroke;
    }
    this.emit({ type: "themeChange", theme });
    this.markDirty();
  }

  toggleTheme(): void {
    this.setTheme(this.theme === "light" ? "dark" : "light");
  }

  setBackground(color: string | undefined): void {
    this.explicitBackground = color;
    this.markDirty();
  }

  setGrid(show: boolean): void {
    this.showGrid = show;
    this.markDirty();
  }

  getGrid(): boolean {
    return this.showGrid;
  }

  setStyle(style: Partial<ElementStyle>): void {
    this.style = { ...this.style, ...style };
    // Apply to current selection too.
    if (this.selectedIds.size > 0) {
      this.commitHistory();
      for (const id of this.selectedIds) this.scene.update(id, { ...style });
      this.emitChange();
      this.markDirty();
    }
  }

  getStyle(): ElementStyle {
    return { ...this.style };
  }

  setTextStyle(style: Partial<TextStyle>): void {
    this.textStyle = { ...this.textStyle, ...style };
    const selectedText = this.scene
      .getElements()
      .filter((el): el is TextElement => el.type === "text" && this.selectedIds.has(el.id));
    if (selectedText.length === 0) return;

    this.commitHistory();
    for (const el of selectedText) {
      this.updateTextElementStyle(el, style);
    }
    this.emitChange();
    this.markDirty();
  }

  getTextStyle(): TextStyle {
    return { ...this.textStyle };
  }

  setLabelStyle(style: Partial<TextStyle>): void {
    this.labelStyle = { ...this.labelStyle, ...style };
    const selectedLabelElements = this.scene
      .getElements()
      .filter((el) => el.type !== "text" && this.selectedIds.has(el.id));
    if (selectedLabelElements.length === 0) return;

    this.commitHistory();
    for (const el of selectedLabelElements) {
      this.scene.update(el.id, this.textStyleToLabelPatch(style));
    }
    this.emitChange();
    this.markDirty();
  }

  getLabelStyle(): TextStyle {
    return { ...this.labelStyle };
  }

  getElements(): BoardElement[] {
    return this.scene.getElements();
  }

  /**
   * Search all elements for text matching the query (case-insensitive).
   * Looks in label, text, title and task items. Returns matching elements.
   */
  search(query: string): BoardElement[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.scene.getElements().filter((el) => {
      const parts: string[] = [];
      if (el.label) parts.push(el.label);
      const anyEl = el as unknown as {
        text?: string;
        title?: string;
        items?: { text: string }[];
      };
      if (anyEl.text) parts.push(anyEl.text);
      if (anyEl.title) parts.push(anyEl.title);
      if (Array.isArray(anyEl.items)) {
        for (const it of anyEl.items) if (it?.text) parts.push(it.text);
      }
      return parts.join(" \u0000 ").toLowerCase().includes(q);
    });
  }

  /**
   * Search and select all matching elements, then zoom to fit them.
   * Returns the number of matches.
   */
  searchAndFocus(query: string): number {
    const matches = this.search(query);
    if (matches.length === 0) return 0;
    this.setSelection(matches.map((e) => e.id));
    this.zoomToElements(matches, 120);
    return matches.length;
  }

  /**
   * Auto-arrange elements into a layout. Operates on the current selection
   * (if 2+ selected) or on all elements otherwise. Records one undo step.
   *
   * @param type   "grid" | "horizontal" | "vertical" | "circle"
   * @param gap    spacing between elements in world units (default 40)
   */
  autoLayout(
    type: "grid" | "horizontal" | "vertical" | "circle" = "grid",
    gap = 40,
  ): void {
    const selected = [...this.selectedIds];
    const els =
      selected.length >= 2
        ? selected.map((id) => this.scene.getElement(id)).filter(Boolean) as BoardElement[]
        : this.scene.getElements();
    if (els.length < 2) return;

    this.commitHistory();

    // Anchor at the top-left of the current bounding box.
    let minX = Infinity;
    let minY = Infinity;
    for (const el of els) {
      const b = elementBounds(el);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
    }

    if (type === "circle") {
      // Place centers evenly on a circle sized to fit the elements.
      const maxDim = Math.max(...els.map((e) => Math.max(e.width, e.height)));
      const radius = Math.max(
        (els.length * (maxDim + gap)) / (2 * Math.PI),
        maxDim + gap,
      );
      const cx = minX + radius;
      const cy = minY + radius;
      els.forEach((el, i) => {
        const angle = (i / els.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + radius * Math.cos(angle) - el.width / 2;
        const y = cy + radius * Math.sin(angle) - el.height / 2;
        this.scene.update(el.id, { x, y });
      });
    } else if (type === "horizontal") {
      let cursorX = minX;
      for (const el of els) {
        this.scene.update(el.id, { x: cursorX, y: minY });
        cursorX += el.width + gap;
      }
    } else if (type === "vertical") {
      let cursorY = minY;
      for (const el of els) {
        this.scene.update(el.id, { x: minX, y: cursorY });
        cursorY += el.height + gap;
      }
    } else {
      // grid — roughly square, row-major, using the widest/tallest as cell size.
      const cols = Math.ceil(Math.sqrt(els.length));
      const cellW = Math.max(...els.map((e) => e.width)) + gap;
      const cellH = Math.max(...els.map((e) => e.height)) + gap;
      els.forEach((el, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        this.scene.update(el.id, {
          x: minX + col * cellW,
          y: minY + row * cellH,
        });
      });
    }

    this.updateConnectedArrows(new Set(els.map((e) => e.id)));
    this.emitChange();
    this.markDirty();
  }

  getSelectedIds(): string[] {
    return [...this.selectedIds];
  }

  setSelection(ids: string[]): void {
    this.selectedIds = new Set(ids);
    this.emit({ type: "selectionChange", ids: [...this.selectedIds] });
    this.markDirty();
  }

  /** Replace all elements (does not clear history). */
  setElements(elements: BoardElement[]): void {
    this.scene.replaceAll(elements);
    this.selectedIds.clear();
    this.syncVersionSnapshot();
    this.emitChange();
    this.markDirty();
  }

  deleteSelected(): void {
    if (this.selectedIds.size === 0) return;
    this.commitHistory();
    this.scene.removeMany([...this.selectedIds]);
    this.selectedIds.clear();
    this.emit({ type: "selectionChange", ids: [] });
    this.emitChange();
    this.markDirty();
  }

  clear(): void {
    this.commitHistory();
    this.scene.clear();
    this.selectedIds.clear();
    this.emitChange();
    this.markDirty();
  }

  /** Copy the current selection into the internal clipboard. */
  copy(): void {
    this.clipboardManager.copy();
  }

  /** Paste clipboard contents with a small offset and select them. */
  paste(offset = 16): void {
    this.clipboardManager.paste(offset);
  }

  /** Duplicate the current selection in place (offset) and select the copies. */
  duplicateSelected(offset = 16): void {
    this.clipboardManager.duplicateSelected(offset);
  }

  bringToFront(): void {
    if (this.selectedIds.size === 0) return;
    this.commitHistory();
    for (const id of this.selectedIds) this.scene.bringToFront(id);
    this.emitChange();
    this.markDirty();
  }

  sendToBack(): void {
    if (this.selectedIds.size === 0) return;
    this.commitHistory();
    for (const id of [...this.selectedIds].reverse()) this.scene.sendToBack(id);
    this.emitChange();
    this.markDirty();
  }

  /** Set (or clear, with empty string) the centered label of an element. */
  setLabel(id: string, label: string): void {
    if (!this.scene.getElement(id)) return;
    this.commitHistory();
    this.scene.update(id, {
      label: label || undefined,
      ...this.textStyleToLabelPatch(this.labelStyle),
    });
    this.emitChange();
    this.markDirty();
  }

  // -------------------------------------------------------- Images / embeds

  /**
   * Add an image element from a source (data URL or http(s) URL). The element
   * is placed centered at `position` (world coords) or the viewport center, and
   * resized to the image's intrinsic size (capped by `maxSize`) once loaded.
   * Returns the new element id.
   */
  addImage(
    src: string,
    opts: { position?: Point; maxSize?: number } = {},
  ): string {
    this.commitHistory();
    const maxSize = opts.maxSize ?? 400;
    const center = opts.position ?? this.viewportCenterWorld();
    const el = createElement(
      "image",
      { x: center.x - 120, y: center.y - 120, width: 240, height: 240, src },
      this.style,
    ) as ImageElement;
    this.scene.add(el);
    this.imageManager.ensureImage(src);
    this.setSelection([el.id]);

    const img = this.imageManager.getCache().get(src);
    const applySize = () => {
      const cur = this.scene.getElement(el.id);
      if (!cur || !img || !img.naturalWidth) return;
      const ar = img.naturalWidth / img.naturalHeight || 1;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxSize || h > maxSize) {
        if (ar >= 1) {
          w = maxSize;
          h = maxSize / ar;
        } else {
          h = maxSize;
          w = maxSize * ar;
        }
      }
      this.scene.update(el.id, {
        x: center.x - w / 2,
        y: center.y - h / 2,
        width: w,
        height: h,
        aspectRatio: ar,
      } as Partial<ImageElement>);
      this.emitChange();
      this.markDirty();
    };
    if (img && img.complete && img.naturalWidth) applySize();
    else if (img) img.addEventListener("load", applySize, { once: true });

    this.emitChange();
    this.markDirty();
    return el.id;
  }

  /**
   * Add an embed (iframe) element for the given URL. Common video providers
   * (YouTube, Vimeo) are auto-converted to their embeddable URL.
   * Returns the new element id.
   */
  addEmbed(
    src: string,
    opts: { position?: Point; width?: number; height?: number } = {},
  ): string {
    this.commitHistory();
    const w = opts.width ?? 480;
    const h = opts.height ?? 270;
    const center = opts.position ?? this.viewportCenterWorld();
    const el = createElement(
      "embed",
      {
        x: center.x - w / 2,
        y: center.y - h / 2,
        width: w,
        height: h,
        src: normalizeEmbedUrl(src),
      },
      this.style,
    ) as EmbedElement;
    this.scene.add(el);
    this.setSelection([el.id]);
    this.emitChange();
    this.markDirty();
    return el.id;
  }

  /** Update the URL of an existing embed element. */
  setEmbedSrc(id: string, src: string): void {
    const el = this.scene.getElement(id);
    if (!el || el.type !== "embed") return;
    this.commitHistory();
    this.scene.update(id, { src: normalizeEmbedUrl(src) } as Partial<EmbedElement>);
    this.emitChange();
    this.markDirty();
  }

  /** Activate an embed so its iframe becomes interactive (pointer events on). */
  activateEmbed(id: string): void {
    const el = this.scene.getElement(id);
    if (!el || el.type !== "embed") return;
    this.setSelection([id]);
    this.embedManager.activate(id);
  }

  /** Deactivate the currently active embed (back to move/select mode). */
  deactivateEmbed(): void {
    this.embedManager.deactivate();
  }

  /** Id of the embed currently activated for interaction, or null. */
  getActiveEmbedId(): string | null {
    return this.embedManager.getActiveEmbedId();
  }

  // ------------------------------------------------- Element mutation API
  // These are the primary hooks for backends / realtime collaboration. Pass
  // `{ record: false }` to skip the undo history (e.g. when applying remote
  // changes you don't want the local user to be able to "undo").

  /** Get a single element by id (undefined if missing or deleted). */
  getElement(id: string): BoardElement | undefined {
    const el = this.scene.getElement(id);
    return el && !el.isDeleted ? el : undefined;
  }

  /**
   * Trigger an element that needs UI outside the canvas (link, note).
   *
   * It only emits the event: navigating between boards and building a modal are
   * decisions of the application. Public so the UI can trigger it from its own
   * menu ("Open").
   */
  activateElement(el: BoardElement, reason: "click" | "create" = "click"): void {
    this.emit({ type: "elementActivate", element: el, reason });
  }

  /** Add a fully-formed element to the scene. */
  addElement(
    element: BoardElement,
    opts: { record?: boolean; select?: boolean } = {},
  ): BoardElement {
    if (opts.record ?? true) this.commitHistory();
    this.scene.add(element);
    if (element.type === "image" && element.src) this.imageManager.ensureImage(element.src);
    if (opts.select) this.setSelection([element.id]);
    this.emitChange();
    this.markDirty();
    return element;
  }

  /** Patch an existing element by id. */
  updateElement(
    id: string,
    patch: Partial<BoardElement>,
    opts: { record?: boolean } = {},
  ): void {
    if (!this.scene.getElement(id)) return;
    if (opts.record ?? true) this.commitHistory();
    this.scene.update(id, patch);
    if (patch.type === undefined && "src" in patch && typeof patch.src === "string") {
      this.imageManager.ensureImage(patch.src);
    }
    this.emitChange();
    this.markDirty();
  }

  /** Remove an element by id. */
  removeElement(id: string, opts: { record?: boolean } = {}): void {
    if (!this.scene.getElement(id)) return;
    if (opts.record ?? true) this.commitHistory();
    this.scene.removeMany([id]);
    this.pruneSelection();
    this.emitChange();
    this.markDirty();
  }

  /**
   * Apply a batch of add/update/remove operations atomically (single undo step
   * and a single change event). Ideal for syncing remote/DB changes.
   */
  applyOperations(
    ops: ElementOperation[],
    opts: { record?: boolean } = {},
  ): void {
    if (ops.length === 0) return;
    if (opts.record ?? true) this.commitHistory();
    for (const op of ops) {
      if (op.op === "add") {
        this.scene.add(op.element);
        if (op.element.type === "image" && op.element.src) {
          this.imageManager.ensureImage(op.element.src);
        }
      } else if (op.op === "update") {
        this.scene.update(op.id, op.patch);
      } else {
        this.scene.removeMany([op.id]);
      }
    }
    this.pruneSelection();
    this.emitChange();
    this.markDirty();
  }


  undo(): void {
    if (this.history.undo(this.scene)) {
      this.pruneSelection();
      this.emitChange();
      this.markDirty();
    }
  }

  redo(): void {
    if (this.history.redo(this.scene)) {
      this.pruneSelection();
      this.emitChange();
      this.markDirty();
    }
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  zoomIn(): void {
    this.camera.zoomBy(1.2, { x: this.renderer.width / 2, y: this.renderer.height / 2 });
    this.emitCamera();
    this.markDirty();
  }

  zoomOut(): void {
    this.camera.zoomBy(1 / 1.2, {
      x: this.renderer.width / 2,
      y: this.renderer.height / 2,
    });
    this.emitCamera();
    this.markDirty();
  }

  resetZoom(): void {
    this.camera.zoomTo(1, { x: this.renderer.width / 2, y: this.renderer.height / 2 });
    this.emitCamera();
    this.markDirty();
  }

  /** Center and fit all elements in the viewport. */
  zoomToFit(padding = 60): void {
    this.zoomToElements(this.scene.getElements(), padding);
  }

  /** Zoom and center the camera to fit the given elements' bounding box. */
  zoomToElements(els: BoardElement[], padding = 60): void {
    if (els.length === 0) return;
    let b = elementBounds(els[0]);
    for (let i = 1; i < els.length; i++) {
      const eb = elementBounds(els[i]);
      b = {
        minX: Math.min(b.minX, eb.minX),
        minY: Math.min(b.minY, eb.minY),
        maxX: Math.max(b.maxX, eb.maxX),
        maxY: Math.max(b.maxY, eb.maxY),
      };
    }
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    const zoom = Math.min(
      (this.renderer.width - padding * 2) / w,
      (this.renderer.height - padding * 2) / h,
    );
    this.camera.setState({ zoom });
    this.camera.scrollX = this.renderer.width / 2 / this.camera.zoom - (b.minX + w / 2);
    this.camera.scrollY = this.renderer.height / 2 / this.camera.zoom - (b.minY + h / 2);
    this.emitCamera();
    this.markDirty();
  }

  toJSON(): BoardSnapshot {
    return {
      version: 1,
      type: "openboard",
      schemaVersion: SCHEMA_VERSION,
      elements: this.scene.getElements(),
      camera: this.camera.getState(),
      appearance: this.getAppearance(),
    };
  }

  exportJSON(): string {
    return JSON.stringify(this.toJSON());
  }

  /** Alias for {@link toJSON} — returns a structured, versioned snapshot. */
  getSnapshot(): BoardSnapshot {
    return this.toJSON();
  }

  /** Alias for {@link loadJSON} — accepts a snapshot object or JSON string. */
  loadSnapshot(data: string | BoardSnapshot): void {
    this.loadJSON(data);
  }

  loadJSON(data: string | BoardSnapshot): void {
    const snap: BoardSnapshot =
      typeof data === "string" ? JSON.parse(data) : data;
    if (snap?.type !== "openboard") {
      throw new Error("OmniBoard: invalid snapshot");
    }
    this.history.clear();
    this.scene.replaceAll(snap.elements ?? []);
    if (snap.camera) this.camera.setState(snap.camera);
    if (snap.appearance) this.appearance = { ...snap.appearance };
    this.selectedIds.clear();
    this.embedManager.deactivate();
    this.syncVersionSnapshot();
    this.emitChange();
    this.emitCamera();
    this.markDirty();
  }

  /** Export the current scene (or given elements) to a PNG blob. */
  async exportPNG(opts: {
    scale?: number;
    padding?: number;
    background?: string;
  } = {}): Promise<Blob> {
    const scale = opts.scale ?? 2;
    const padding = opts.padding ?? 20;
    const els = this.scene.getElements();
    if (els.length === 0) {
      throw new Error("OmniBoard: nothing to export");
    }
    let b = elementBounds(els[0]);
    for (let i = 1; i < els.length; i++) {
      const eb = elementBounds(els[i]);
      b = {
        minX: Math.min(b.minX, eb.minX),
        minY: Math.min(b.minY, eb.minY),
        maxX: Math.max(b.maxX, eb.maxX),
        maxY: Math.max(b.maxY, eb.maxY),
      };
    }
    const w = b.maxX - b.minX + padding * 2;
    const h = b.maxY - b.minY + padding * 2;

    const off = document.createElement("canvas");
    off.width = Math.ceil(w * scale);
    off.height = Math.ceil(h * scale);

    const exportRenderer = new CanvasRenderer(off);
    exportRenderer.resize(w, h, scale);
    const exportCamera = new Camera({
      scrollX: -b.minX + padding,
      scrollY: -b.minY + padding,
      zoom: 1,
    });
    exportRenderer.render({
      scene: this.scene,
      camera: exportCamera,
      selectedIds: new Set(),
      background: opts.background ?? this.getBackground(),
      grid: false,
      palette: this.getPalette(),
    });

    return new Promise((resolve, reject) => {
      off.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("OmniBoard: PNG export failed"));
      }, "image/png");
    });
  }

  /**
   * Subscribes to an event. The listener receives the event **narrowed** by
   * `type`, so `on("change", (e) => e.elements)` compiles with no guard.
   *
   * Returns the unsubscribe function — keeping it is enough to clean up.
   */
  on<T extends BoardEventType>(type: T, listener: (e: BoardEventOf<T>) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    // The map is homogeneous per key, but TypeScript cannot see that the set
    // stored under "change" only ever holds "change" listeners.
    this.listeners.get(type)!.add(listener as Listener);
    return () => this.off(type, listener);
  }

  off<T extends BoardEventType>(type: T, listener: (e: BoardEventOf<T>) => void): void {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.inputManager.destroy();
    this.textEditManager.destroy();
    this.embedManager.destroy();
    this.edgePanManager?.destroy();
    this.contextMenu?.destroy();
    this.selectionToolbar?.destroy();
    this.imageManager.destroy();
    this.canvas.remove();
    this.listeners.clear();
  }

  // ------------------------------------------------------------- Render loop

  private startLoop(): void {
    const loop = () => {
      if (this.destroyed) return;
      if (this.dirty) {
        this.dirty = false;
        this.imageManager.preloadImages();
        this.renderer.render({
          scene: this.scene,
          camera: this.camera,
          selectedIds: this.selectedIds,
          selectionBox: this.selectionBox,
          background: this.getBackground(),
          grid: this.showGrid,
          palette: this.getPalette(),
          editingTextId: this.textEditManager.getEditingTextId(),
          // The frame name being edited is hidden too: the text field sits
          // exactly on top of the label.
          editingLabelId:
            this.textEditManager.getEditingLabelId() ??
            this.textEditManager.getEditingFrameNameId(),
          imageCache: this.imageManager.getCache(),
          handleSize: this.appearance.handleSize,
          handleFill: this.appearance.handleFill,
          gridSpacing: this.appearance.gridSpacing,
          gridPattern: this.appearance.gridPattern,
          focusMode: this.focusMode,
          snapGuides: this.snapGuides,
          snapColor: this.appearance.snapColor,
          connectionIndicator: this.connectionIndicator,
          hoverAnchors: this.hoverAnchors,
        });
        this.embedManager.sync();
        this.updateSelectionToolbarPosition();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height);
    this.markDirty();
  }

  // --------------------------------------------------------- Pointer handlers

  private onPointerDown(e: PointerEvent): void {
    // A pointerdown reaching the canvas means the click was outside any active
    // embed iframe, so deactivate it.
    this.embedManager.deactivate();

    // Lock mode: never edit. Drag pans; a static click on a task toggles it.
    if (this.locked) {
      if (e.button !== 0 && e.button !== 1) return;
      const screen = this.inputManager.getScreenPoint(e);
      let maybeTaskAction: { id: string; hit: TasksHit } | undefined;
      let maybeActivate: BoardElement | undefined;
      const hit = this.hitTest(this.camera.screenToWorld(screen.x, screen.y));
      if (hit && hit.type === "tasks") {
        const h = tasksHitTest(hit as TasksElement, this.inputManager.getWorldPoint(e));
        if (h) maybeTaskAction = { id: hit.id, hit: h };
      }
      // In hand mode a link behaves like a link: a single click is enough.
      if (hit && (hit.type === "link" || hit.type === "note")) maybeActivate = hit;
      this.interaction = {
        kind: "panning",
        lastScreen: screen,
        startScreen: screen,
        maybeTaskAction,
        maybeActivate,
      };
      this.canvas.setPointerCapture(e.pointerId);
      this.updateCursor();
      return;
    }

    // Middle-button pan (universal, regardless of active tool).
    if (e.button === 1) {
      this.hoverAnchors = null;
      this.interaction = { kind: "panning", lastScreen: this.inputManager.getScreenPoint(e) };
      this.canvas.setPointerCapture(e.pointerId);
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;

    // Delegate to the active tool via ToolManager.
    const world = this.inputManager.getWorldPoint(e);
    this.toolManager.dispatchPointerDown(e, world);
  }

  private onPointerMove(e: PointerEvent): void {
    const world = this.inputManager.getWorldPoint(e);

    // Lock-mode panning is handled at Board level.
    if (this.locked && this.interaction.kind === "panning") {
      const s = this.inputManager.getScreenPoint(e);
      const dx = s.x - this.interaction.lastScreen.x;
      const dy = s.y - this.interaction.lastScreen.y;
      this.camera.panBy(dx, dy);
      this.interaction.lastScreen = s;
      this.emitCamera();
      this.markDirty();
      return;
    }

    // Delegate to the active tool.
    this.toolManager.dispatchPointerMove(e, world);
  }

  private onPointerUp(e: PointerEvent): void {
    // Lock-mode: handle panning and task click.
    if (this.locked) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      const it = this.interaction;
      if (it.kind === "panning" && it.startScreen) {
        const s = this.inputManager.getScreenPoint(e);
        const moved = Math.hypot(s.x - it.startScreen.x, s.y - it.startScreen.y);
        // Dragging is pan; a short click is an action (check a task, open a link).
        if (moved < 4) {
          if (it.maybeTaskAction?.hit) {
            this.applyTaskAction(it.maybeTaskAction.id, it.maybeTaskAction.hit, true);
          } else if (it.maybeActivate) {
            const atual = this.scene.getElement(it.maybeActivate.id);
            if (atual) this.activateElement(atual, "click");
          }
        }
      }
      this.interaction = { kind: "idle" };
      this.updateCursor();
      this.markDirty();
      return;
    }

    // Middle-button panning release (Board level).
    if (this.interaction.kind === "panning" && !this.toolManager.getActive()) {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.interaction = { kind: "idle" };
      this.updateCursor();
      this.markDirty();
      return;
    }

    // Delegate to the active tool.
    const world = this.inputManager.getWorldPoint(e);
    this.toolManager.dispatchPointerUp(e, world);
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.locked) return;
    const world = this.inputManager.getWorldPoint(e);
    this.toolManager.dispatchDoubleClick(e as unknown as PointerEvent, world);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.contextMenu?.hide();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.01);
      this.camera.zoomBy(factor, this.inputManager.getScreenPoint(e));
    } else {
      this.camera.panBy(-e.deltaX, -e.deltaY);
    }
    this.emitCamera();
    this.markDirty();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.textEditManager.isEditing()) return; // let textarea handle keys
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    // Lock mode: allow only zoom shortcuts; block all editing keys.
    if (this.locked) {
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        this.zoomIn();
      } else if (mod && e.key === "-") {
        e.preventDefault();
        this.zoomOut();
      }
      return;
    }
    if (e.code === "Space") {
      this.spaceDown = true;
      this.updateCursor();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.setSelection(this.scene.getElements().map((x) => x.id));
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      this.copy();
      return;
    }
    if (mod && e.key.toLowerCase() === "x") {
      e.preventDefault();
      this.copy();
      this.deleteSelected();
      return;
    }
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      this.paste();
      return;
    }
    if (mod && e.key === "]") {
      e.preventDefault();
      this.bringToFront();
      return;
    }
    if (mod && e.key === "[") {
      e.preventDefault();
      this.sendToBack();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    if (e.key === "Escape") {
      this.embedManager.deactivate();
      this.selectedIds.clear();
      this.emit({ type: "selectionChange", ids: [] });
      this.markDirty();
      return;
    }
    // Arrow-key nudge of the current selection (Miro-like). Shift = larger step.
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (nudge[e.key] && this.selectedIds.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (!this.nudging) {
        this.commitHistory();
        this.nudging = true;
      }
      const [dx, dy] = nudge[e.key];
      for (const id of this.selectedIds) {
        const el = this.scene.getElement(id);
        if (el) this.scene.update(id, { x: el.x + dx * step, y: el.y + dy * step });
      }
      this.emitChange();
      this.markDirty();
      return;
    }
    // Tool shortcuts (Excalidraw-like).
    const shortcuts: Record<string, ToolType> = {
      v: "selection",
      "1": "selection",
      h: "hand",
      r: "rectangle",
      "2": "rectangle",
      o: "ellipse",
      "3": "ellipse",
      l: "line",
      a: "arrow",
      "4": "arrow",
      p: "freedraw",
      d: "freedraw",
      t: "text",
    };
    const tool = shortcuts[e.key.toLowerCase()];
    if (tool && !mod) this.setTool(tool);
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.code === "Space") {
      this.spaceDown = false;
      this.updateCursor();
    }
    if (e.key.startsWith("Arrow")) this.nudging = false;
  }

  // --------------------------------------------------------------- Helpers

  private hitTest(world: Point): BoardElement | null {
    const threshold = HIT_THRESHOLD / this.camera.zoom;
    const els = this.scene.getElements();
    for (let i = els.length - 1; i >= 0; i--) {
      if (hitTestElement(els[i], world, threshold)) return els[i];
    }
    return null;
  }

  private applyBoxSelection(box: Bounds): void {
    const ids: string[] = [];
    for (const el of this.scene.getElements()) {
      if (boundsIntersect(elementBounds(el), box)) ids.push(el.id);
    }
    this.setSelection(ids);
  }

  private snapshotSelection(): Map<string, BoardElement> {
    const m = new Map<string, BoardElement>();
    for (const id of this.selectedIds) {
      const el = this.scene.getElement(id);
      if (el) m.set(id, { ...el });
    }
    return m;
  }

  /** Recalculate endpoints of arrows connected to the given element ids. */
  private updateConnectedArrows(movedIds: Set<string>): void {
    for (const el of this.scene.getElements()) {
      if (el.type !== "arrow") continue;
      const arrow = el as LinearElement;
      const srcMoved = arrow.sourceId && movedIds.has(arrow.sourceId);
      const tgtMoved = arrow.targetId && movedIds.has(arrow.targetId);
      if (!srcMoved && !tgtMoved) continue;

      const pts = [...arrow.points];
      if (srcMoved && arrow.sourceId && arrow.sourceAnchor) {
        const srcEl = this.scene.getElement(arrow.sourceId);
        if (srcEl) {
          const p = resolveAnchor(srcEl, arrow.sourceAnchor);
          pts[0] = { x: p.x - arrow.x, y: p.y - arrow.y };
        }
      }
      if (tgtMoved && arrow.targetId && arrow.targetAnchor) {
        const tgtEl = this.scene.getElement(arrow.targetId);
        if (tgtEl) {
          const p = resolveAnchor(tgtEl, arrow.targetAnchor);
          pts[pts.length - 1] = { x: p.x - arrow.x, y: p.y - arrow.y };
        }
      }
      this.scene.update(arrow.id, { points: pts, width: pts[pts.length - 1].x, height: pts[pts.length - 1].y } as Partial<LinearElement>);
    }
  }

  /** Toggle a task's done state or append a new task (from a click/dblclick). */
  private applyTaskAction(id: string, hit: TasksHit, record = false): void {
    const el = this.scene.getElement(id);
    if (!el || el.type !== "tasks" || !hit) return;
    const t = el as TasksElement;
    let items: TaskItem[];
    if (hit.type === "toggle") {
      items = t.items.map((it, i) =>
        i === hit.index ? { ...it, done: !it.done } : it,
      );
    } else {
      items = [...t.items, { text: "New task", done: false, priority: "medium" }];
    }
    this.updateElement(id, { items } as Partial<BoardElement>, { record });
  }

  private applyResize(orig: BoardElement, handle: HandleName, world: Point): void {
    const patch = resizeElement(orig, handle, world);
    if (
      (orig.type === "line" ||
        orig.type === "arrow" ||
        orig.type === "freedraw") &&
      "points" in orig
    ) {
      const sx = orig.width !== 0 ? (patch.width ?? orig.width) / orig.width : 1;
      const sy =
        orig.height !== 0 ? (patch.height ?? orig.height) / orig.height : 1;
      const points = orig.points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
      this.scene.update(orig.id, { ...patch, points } as Partial<BoardElement>);
    } else {
      this.scene.update(orig.id, patch);
    }
  }

  private pruneSelection(): void {
    const valid = new Set(this.scene.getElements().map((e) => e.id));
    for (const id of [...this.selectedIds]) {
      if (!valid.has(id)) this.selectedIds.delete(id);
    }
  }

  private updateTextElementStyle(el: TextElement, style: Partial<TextStyle>): void {
    const patch: Partial<TextElement> = { ...style };
    if (
      style.fontFamily !== undefined ||
      style.fontSize !== undefined ||
      style.fontStyle !== undefined ||
      style.fontWeight !== undefined
    ) {
      const measured = this.textEditManager.measureText(el.text, { ...this.getElementTextStyle(el), ...style });
      patch.width = measured.width;
      patch.height = measured.height;
    }
    this.scene.update(el.id, patch as Partial<BoardElement>);
  }

  private getElementTextStyle(el: TextElement): TextStyle {
    return {
      ...DEFAULT_TEXT_STYLE,
      fontSize: el.fontSize ?? DEFAULT_TEXT_STYLE.fontSize,
      fontFamily: el.fontFamily ?? DEFAULT_TEXT_STYLE.fontFamily,
      fontWeight: el.fontWeight ?? DEFAULT_TEXT_STYLE.fontWeight,
      fontStyle: el.fontStyle ?? DEFAULT_TEXT_STYLE.fontStyle,
      textAlign: el.textAlign ?? DEFAULT_TEXT_STYLE.textAlign,
      verticalAlign: el.verticalAlign ?? DEFAULT_TEXT_STYLE.verticalAlign,
    };
  }

  private getElementLabelStyle(el: BoardElement): TextStyle {
    return {
      ...DEFAULT_LABEL_STYLE,
      fontSize: el.labelFontSize ?? labelFontSize(el),
      fontFamily: el.labelFontFamily ?? DEFAULT_LABEL_STYLE.fontFamily,
      fontWeight: el.labelFontWeight ?? DEFAULT_LABEL_STYLE.fontWeight,
      fontStyle: el.labelFontStyle ?? DEFAULT_LABEL_STYLE.fontStyle,
      textAlign: el.labelTextAlign ?? DEFAULT_LABEL_STYLE.textAlign,
      verticalAlign: el.labelVerticalAlign ?? DEFAULT_LABEL_STYLE.verticalAlign,
    };
  }

  private textStyleToLabelPatch(style: Partial<TextStyle>): Partial<BoardElement> {
    const patch: Partial<BoardElement> = {};
    if (style.fontSize !== undefined) patch.labelFontSize = style.fontSize;
    if (style.fontFamily !== undefined) patch.labelFontFamily = style.fontFamily;
    if (style.fontWeight !== undefined) patch.labelFontWeight = style.fontWeight;
    if (style.fontStyle !== undefined) patch.labelFontStyle = style.fontStyle;
    if (style.textAlign !== undefined) patch.labelTextAlign = style.textAlign;
    if (style.verticalAlign !== undefined) patch.labelVerticalAlign = style.verticalAlign;
    return patch;
  }

  // ------------------------------------------------------ Image/embed impl

  /** Ensure every image element's bitmap is being loaded into the cache. */
  /** Center of the current viewport in world coordinates. */
  private viewportCenterWorld(): Point {
    return this.camera.screenToWorld(
      this.renderer.width / 2,
      this.renderer.height / 2,
    );
  }

  private onDragOver(e: DragEvent): void {
    if (e.dataTransfer) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  private onDrop(e: DragEvent): void {
    if (!e.dataTransfer) return;
    e.preventDefault();
    const world = this.inputManager.getWorldPoint(e);

    const files = Array.from(e.dataTransfer.files ?? []);
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length > 0) {
      images.forEach((f, i) =>
        this.imageManager.addImageFromFile(f, { x: world.x + i * 16, y: world.y + i * 16 }),
      );
      return;
    }

    const uri =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain");
    if (uri && /^https?:\/\//i.test(uri.trim())) {
      const url = uri.trim();
      if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(url)) {
        this.addImage(url, { position: world });
      } else {
        this.addEmbed(url, { position: world });
      }
    }
  }

  private onPaste(e: ClipboardEvent): void {
    if (this.textEditManager.isEditing()) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          this.imageManager.addImageFromFile(file, this.viewportCenterWorld());
          return;
        }
      }
    }
  }

  // -------------------------------------------------------- Overlays (UI)

  private toolbarSig = "";

  private getOverlayTheme(): OverlayTheme {
    const bottom = OVERLAY_THEMES[this.theme];
    return {
      ...bottom,
      accent: this.appearance.selectionColor ?? this.getPalette().selection,
    };
  }

  private onContextMenu(e: MouseEvent): void {
    if (this.locked) {
      e.preventDefault();
      return;
    }
    if (!this.contextMenu) return;
    e.preventDefault();
    this.embedManager.deactivate();
    const world = this.inputManager.getWorldPoint(e);
    const hit = this.hitTest(world);
    if (hit && !this.selectedIds.has(hit.id)) this.setSelection([hit.id]);
    const screen = this.inputManager.getScreenPoint(e);
    this.contextMenu.show(
      screen.x,
      screen.y,
      this.buildContextMenuItems(hit),
      this.getOverlayTheme(),
      this.container,
    );
  }

  private buildContextMenuItems(hit: BoardElement | null): MenuItem[] {
    const hasSelection = this.selectedIds.size > 0;
    const canPaste = this.clipboardManager.hasContent();
    const items: MenuItem[] = [];

    if (hit || hasSelection) {
      const sole =
        this.selectedIds.size === 1
          ? this.scene.getElement([...this.selectedIds][0])
          : null;

      if (sole && sole.type === "embed") {
        items.push({
          label: "Interact",
          icon: ICONS.play,
          onClick: () => this.activateEmbed(sole.id),
        });
      }
      if (sole && sole.type === "text") {
        items.push({
          label: "Edit text",
          icon: ICONS.text,
          onClick: () => this.textEditManager.openTextEditor(sole as TextElement),
        });
      } else if (sole && sole.type === "frame") {
        // A frame has no centered label: what gets edited is the name.
        items.push({
          label: "Rename",
          icon: ICONS.text,
          onClick: () => this.textEditManager.openFrameNameEditor(sole as FrameElement),
        });
      } else if (sole && sole.type !== "image" && sole.type !== "embed") {
        items.push({
          label: "Edit text",
          icon: ICONS.text,
          onClick: () => this.textEditManager.openLabelEditor(sole),
        });
      }
      items.push({
        label: "Duplicate",
        icon: ICONS.copy,
        shortcut: "Ctrl+D",
        onClick: () => this.duplicateSelected(),
      });
      items.push({
        label: "Copy",
        icon: ICONS.clipboard,
        shortcut: "Ctrl+C",
        onClick: () => this.copy(),
      });
      if (canPaste) {
        items.push({
          label: "Paste",
          icon: ICONS.clipboard,
          shortcut: "Ctrl+V",
          onClick: () => this.paste(),
        });
      }
      items.push({ separator: true });
      items.push({
        label: "Bring to front",
        icon: ICONS.bringForward,
        shortcut: "Ctrl+]",
        onClick: () => this.bringToFront(),
      });
      items.push({
        label: "Send to back",
        icon: ICONS.sendBackward,
        shortcut: "Ctrl+[",
        onClick: () => this.sendToBack(),
      });
      items.push({ separator: true });
      items.push({
        label: "Delete",
        icon: ICONS.trash,
        shortcut: "Del",
        danger: true,
        onClick: () => this.deleteSelected(),
      });
    } else {
      if (canPaste) {
        items.push({
          label: "Paste",
          icon: ICONS.clipboard,
          shortcut: "Ctrl+V",
          onClick: () => this.paste(),
        });
      }
      items.push({
        label: "Select all",
        icon: ICONS.maximize,
        shortcut: "Ctrl+A",
        onClick: () =>
          this.setSelection(this.scene.getElements().map((x) => x.id)),
      });
      items.push({ separator: true });
      items.push({
        label: "Fit to screen",
        icon: ICONS.maximize,
        onClick: () => this.zoomToFit(),
      });
      items.push({
        label: this.showGrid ? "Hide grid" : "Show grid",
        icon: ICONS.grid,
        onClick: () => this.setGrid(!this.showGrid),
      });
    }
    return items;
  }

  private buildToolbarButtons(): ToolbarButton[] {
    const ids = [...this.selectedIds];
    const sole = ids.length === 1 ? this.scene.getElement(ids[0]) : null;
    const btns: ToolbarButton[] = [];

    if (sole && sole.type === "embed") {
      const active = this.embedManager.getActiveEmbedId() === sole.id;
      btns.push({
        label: active ? "✕" : "▶",
        icon: active ? ICONS.close : ICONS.play,
        title: active ? "Sair do embed (Esc)" : "Interagir com o embed",
        active,
        onClick: () =>
          active ? this.deactivateEmbed() : this.activateEmbed(sole.id),
      });
    }
    if (sole && sole.type !== "image" && sole.type !== "embed") {
      btns.push({
        label: "T",
        icon: ICONS.text,
        title: sole.type === "frame" ? "Rename frame" : "Edit text",
        onClick: () => {
          if (sole.type === "text") this.textEditManager.openTextEditor(sole as TextElement);
          else if (sole.type === "frame") this.textEditManager.openFrameNameEditor(sole as FrameElement);
          else this.textEditManager.openLabelEditor(sole);
        },
      });
    }
    btns.push({
      label: "⧉",
      icon: ICONS.copy,
      title: "Duplicate (Ctrl+D)",
      onClick: () => this.duplicateSelected(),
    });
    btns.push({
      label: "⬆",
      icon: ICONS.bringForward,
      title: "Bring to front (Ctrl+])",
      onClick: () => this.bringToFront(),
    });
    btns.push({
      label: "⬇",
      icon: ICONS.sendBackward,
      title: "Send to back (Ctrl+[)",
      onClick: () => this.sendToBack(),
    });
    btns.push({
      label: "🗑",
      icon: ICONS.trash,
      title: "Delete (Del)",
      danger: true,
      onClick: () => this.deleteSelected(),
    });
    return btns;
  }

  /** Reposition (and lazily rebuild) the floating selection toolbar. */
  private updateSelectionToolbarPosition(): void {
    const tb = this.selectionToolbar;
    if (!tb) return;

    const editing = this.textEditManager.isEditing();
    const k = this.interaction.kind;
    const busy =
      k === "moving" ||
      k === "resizing" ||
      k === "rotating" ||
      k === "bending" ||
      k === "creating" ||
      k === "boxselect" ||
      k === "freedrawing" ||
      k === "panning";
    if (this.selectedIds.size === 0 || editing || busy) {
      tb.hide();
      return;
    }

    const selected = this.scene
      .getElements()
      .filter((e) => this.selectedIds.has(e.id));
    const bounds = getElementsBounds(selected);
    if (!bounds) {
      tb.hide();
      return;
    }

    const sig = [
      [...this.selectedIds].sort().join(","),
      this.embedManager.getActiveEmbedId(),
      this.theme,
      this.appearance.selectionColor ?? "",
    ].join("|");
    if (sig !== this.toolbarSig) {
      tb.setTheme(this.getOverlayTheme());
      tb.setButtons(this.buildToolbarButtons());
      this.toolbarSig = sig;
    }

    const cx = (bounds.minX + bounds.maxX) / 2;
    const top = this.camera.worldToScreen(cx, bounds.minY);
    tb.setPosition(top.x, top.y - 12);
  }

  // ------------------------------------------------------------- Cursor

  private updateCursor(): void {
    let cursor = "default";
    if (this.locked) {
      cursor = this.interaction.kind === "panning" ? "all-scroll" : "default";
      this.canvas.style.cursor = cursor;
      return;
    }
    if (this.tool === "hand" || this.spaceDown) cursor = "grab";
    else if (this.interaction.kind === "panning") cursor = "grabbing";
    else if (this.tool !== "selection") cursor = "crosshair";
    this.canvas.style.cursor = cursor;
  }

  /** Check if a world point is on a hover anchor and return it. */
  private hitHoverAnchor(world: Point): { elementId: string; anchor: string; point: Point } | null {
    if (!this.hoverAnchors) return null;
    const threshold = ANCHOR_GRAB_RADIUS / this.camera.zoom;
    for (const a of this.hoverAnchors.anchors) {
      if (Math.hypot(a.point.x - world.x, a.point.y - world.y) <= threshold) {
        // The dot is grabbed outside the element, but the arrow starts on the
        // BORDER (`attach`) so the connection stays flush with the outline.
        return {
          elementId: this.hoverAnchors.elementId,
          anchor: a.anchor,
          point: a.attach ?? a.point,
        };
      }
    }
    return null;
  }

  // ------------------------------------------------------------- Events out

  private commitHistory(): void {
    this.history.record(this.scene);
  }

  private emit(e: BoardEvent): void {
    this.listeners.get(e.type)?.forEach((l) => l(e));
  }

  private emitChange(): void {
    const elements = this.scene.getElements();
    const { added, updated, removed } = this.computeDelta(elements);
    this.syncVersionSnapshot(elements);
    this.emit({ type: "change", elements });
    if (added.length || updated.length || removed.length) {
      this.emit({ type: "elementsChange", elements, added, updated, removed });
    }
  }

  /** Diff the current elements against the last emitted snapshot (by version). */
  private computeDelta(elements: BoardElement[]): {
    added: BoardElement[];
    updated: BoardElement[];
    removed: string[];
  } {
    const added: BoardElement[] = [];
    const updated: BoardElement[] = [];
    const currentIds = new Set<string>();
    for (const el of elements) {
      currentIds.add(el.id);
      const prev = this.lastVersions.get(el.id);
      if (prev === undefined) added.push(el);
      else if (prev !== el.version) updated.push(el);
    }
    const removed: string[] = [];
    for (const id of this.lastVersions.keys()) {
      if (!currentIds.has(id)) removed.push(id);
    }
    return { added, updated, removed };
  }

  private syncVersionSnapshot(
    elements: BoardElement[] = this.scene.getElements(),
  ): void {
    this.lastVersions.clear();
    for (const el of elements) this.lastVersions.set(el.id, el.version);
  }

  private emitCamera(): void {
    this.emit({ type: "cameraChange", camera: this.camera.getState() });
  }
}

/** Deep-ish clone of an element (copies nested points/pressures arrays). */
/**
 * Convert a user-provided URL into one suitable for an <iframe> embed.
 * Handles common providers (YouTube, Vimeo); other URLs are returned as-is.
 */

