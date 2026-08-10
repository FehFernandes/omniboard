/**
 * Plugin system type interfaces for OmniBoard.
 *
 * These are contracts only — no implementation. They define the extension points
 * that will guide the refactoring toward a plugin-based architecture.
 */

import type { BoardElement, ElementStyle, Point } from './types';

// ─── Tool System ────────────────────────────────────────────────────────────

export interface ToolContext {
  // Scene access
  getElements(): BoardElement[];
  getElement(id: string): BoardElement | undefined;
  addElement(el: BoardElement): void;
  updateElement(id: string, patch: Partial<BoardElement>): void;
  removeElement(id: string): void;

  // Camera
  screenToWorld(sx: number, sy: number): Point;
  worldToScreen(wx: number, wy: number): Point;
  getZoom(): number;

  // Selection
  getSelectedIds(): string[];
  setSelection(ids: string[]): void;
  clearSelection(): void;

  // History
  commitHistory(): void;

  // Rendering
  markDirty(): void;
  setCursor(cursor: string): void;

  // Style
  getStyle(): ElementStyle;

  // Utilities
  getCanvasPoint(e: PointerEvent): Point;
}

export interface Tool {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly cursor?: string;
  readonly shortcuts?: string[];

  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  onPointerDown?(ctx: ToolContext, e: PointerEvent, worldPoint: Point): void;
  onPointerMove?(ctx: ToolContext, e: PointerEvent, worldPoint: Point): void;
  onPointerUp?(ctx: ToolContext, e: PointerEvent, worldPoint: Point): void;
  onKeyDown?(ctx: ToolContext, e: KeyboardEvent): boolean | void;
  onKeyUp?(ctx: ToolContext, e: KeyboardEvent): void;
  onDoubleClick?(ctx: ToolContext, e: PointerEvent, worldPoint: Point): void;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(toolId: string): void;
  get(toolId: string): Tool | undefined;
  getAll(): Tool[];
  getActive(): Tool | undefined;
  setActive(toolId: string): void;
}

// ─── Element Definition System ──────────────────────────────────────────────

export interface ElementRenderContext {
  ctx: CanvasRenderingContext2D;
  zoom: number;
  selected: boolean;
  // palette colors etc
}

export interface ElementDefinition<T extends BoardElement = BoardElement> {
  readonly type: string;
  readonly label: string;
  readonly icon?: string;

  create(props: Partial<T> & { x: number; y: number }, style: Partial<ElementStyle>): T;
  hitTest(el: T, point: Point, threshold: number): boolean;
  render(el: T, ctx: ElementRenderContext): void;
  normalize?(el: T): T;
  getBounds?(el: T): { minX: number; minY: number; maxX: number; maxY: number };
  getAnchors?(el: T): Point[];
  serialize?(el: T): unknown;
  deserialize?(data: unknown): T;
}

export interface ElementRegistry {
  register<T extends BoardElement>(def: ElementDefinition<T>): void;
  unregister(type: string): void;
  get(type: string): ElementDefinition | undefined;
  getAll(): ElementDefinition[];
  create(type: string, props: Partial<BoardElement> & { x: number; y: number }, style: Partial<ElementStyle>): BoardElement;
  hitTest(el: BoardElement, point: Point, threshold: number): boolean;
  render(el: BoardElement, ctx: ElementRenderContext): void;
  normalize(el: BoardElement): BoardElement;
}

// ─── Command System ─────────────────────────────────────────────────────────

export interface CommandContext {
  getElements(): BoardElement[];
  getElement(id: string): BoardElement | undefined;
  addElement(el: BoardElement): void;
  updateElement(id: string, patch: Partial<BoardElement>): void;
  removeElement(id: string): void;
  getSelectedIds(): string[];
  setSelection(ids: string[]): void;
  markDirty(): void;
}

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly shortcuts?: string[];

  execute(ctx: CommandContext, args?: unknown): void;
  undo?(ctx: CommandContext): void;
  redo?(ctx: CommandContext): void;
  canMerge?(prev: Command): boolean;
  merge?(prev: Command): Command;
}

export interface CommandRegistry {
  register(cmd: Command): void;
  unregister(cmdId: string): void;
  get(cmdId: string): Command | undefined;
  getAll(): Command[];
  execute(cmdId: string, args?: unknown): void;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
}

// ─── Plugin System ──────────────────────────────────────────────────────────

export interface PluginContext {
  // Registries
  tools: ToolRegistry;
  elements: ElementRegistry;
  commands: CommandRegistry;

  // Shortcuts
  registerShortcut(keys: string, commandId: string): () => void;

  // Events
  on(event: string, handler: (...args: any[]) => void): () => void;
  emit(event: string, ...args: any[]): void;

  // Plugin-private storage
  store: Map<string, unknown>;
}

export interface BoardPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly dependencies?: string[];

  install(ctx: PluginContext): void | PluginAPI;
  activate?(ctx: PluginContext): void;
  deactivate?(ctx: PluginContext): void;
  uninstall?(ctx: PluginContext): void;
}

export type PluginAPI = Record<string, (...args: any[]) => any>;
