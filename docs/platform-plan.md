# OmniBoard — Strategy: From Canvas to Platform

> **Strategy document, not current state.** It was written to guide the engine's
> evolution from "monolithic canvas" to extensible platform. Part of it happened
> (the tool system, the element registry, events), part did not. To learn how the
> code looks **today**, read [architecture.md](architecture.md).
>
> Kept in the repository because it explains the *why* behind several decisions
> and works as a map for anyone who wants to contribute something large.

> Goal: turn OmniBoard from a monolithic drawing canvas into an **extensible
> platform** (engine + plugins + event-driven + backend-agnostic), positioning it
> as the "Monaco Editor" of the visual world.

---

## Diagnosis of the current state (v0.1)

| Aspect | State | Impact on the migration |
|---------|--------|---------------------|
| `Board.ts` | God object — 2688 lines, controls everything | 🔴 Needs full decomposition |
| Tool system | Inline in pointer handlers, no abstraction | 🔴 Blocks tool plugins |
| Element types | Hard-coded with a switch in 4+ files | 🔴 Blocks custom elements |
| Event system | Output-only, no middleware | 🟡 Works, but needs lifecycle hooks |
| Persistence | Clean adapter pattern | 🟢 Already extensible |
| History | Snapshot-based (O(n) per action) | 🟡 Works, inefficient at scale |
| Renderer | Stateless through a dirty flag + rAF | 🟡 Good design, missing hooks |
| React wrapper | Thin, no core logic | 🟢 No change needed |

### What ALREADY works as a platform
- `attachPersistence(board, adapter)` — backend agnostic ✓
- `applyOperations(ops, { record: false })` — collab integration ✓
- Elements with a monotonic `version` — diffing/merge ✓
- `board.on(event)` — basic event-driven model ✓
- Overlays that can be turned off — replaceable UI ✓

---

## Target architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Applications                          │
│  (Miro-clone, BPMN editor, UML tool, Dashboard, GIS, ...)  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                     Plugin Ecosystem                          │
│  mindmap · kanban · calendar · ai · bpmn · erd · uml · ...  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                       Plugin API                             │
│  registerTool · registerElement · registerCommand · hooks    │
└──────┬───────────────┬────────────────┬────────────────┬────┘
       │               │                │                │
┌──────┴─────┐  ┌──────┴──────┐  ┌─────┴──────┐  ┌─────┴─────┐
│  Rendering │  │  Event Bus  │  │  Commands  │  │  Registry  │
│  Pipeline  │  │ (lifecycle) │  │  (undoable)│  │ (elements, │
│            │  │             │  │            │  │  tools,    │
│ layers,    │  │ before/     │  │ execute,   │  │  widgets)  │
│ hooks,     │  │ after,      │  │ undo,      │  │            │
│ custom     │  │ middleware  │  │ redo       │  │            │
│ renderers  │  │             │  │            │  │            │
└──────┬─────┘  └──────┬──────┘  └─────┬──────┘  └─────┬─────┘
       │               │                │                │
┌──────┴───────────────┴────────────────┴────────────────┴────┐
│                        Board Core (Engine)                    │
│  Scene · Camera · Input · Selection · Spatial Index          │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                      Backend Adapters                         │
│  localStorage · REST · GraphQL · Firebase · Supabase ·       │
│  WebSocket · Yjs · Liveblocks · IndexedDB · Postgres         │
└─────────────────────────────────────────────────────────────┘
```

---

## Execution phases

### PHASE 0 — Foundation (weeks 1–3)
> Stabilize what exists and prepare the test/CI infrastructure.

| # | Task | Deliverable | Dependency |
|---|--------|-----------|-------------|
| 0.1 | Test setup (Vitest) | Config + first unit tests | — |
| 0.2 | CI setup (GitHub Actions) | Build + typecheck + test on push | 0.1 |
| 0.3 | Define the package convention | Monorepo structure (pnpm workspaces) | — |
| 0.4 | Document the current public API | TypeDoc or API extractor | — |
| 0.5 | Define the semver strategy | CHANGELOG + conventional commits | — |

**Proposed package structure:**
```
packages/
  core/           # Board Engine (framework-agnostic)
  react/          # React bindings
  plugin-api/     # Public contracts for plugins
  plugin-tools/   # Built-in tools as plugins (rect, ellipse, etc.)
  plugin-shapes/  # Built-in shapes as plugins
  adapters/       # Persistence adapters
```

---

### PHASE 1 — Core decomposition (weeks 3–8)
> Break up the god object. No behavior change — reorganization only.

| # | Task | Before → After | Risk |
|---|--------|----------------|-------|
| 1.1 | Extract `InputManager` | Pointer/keyboard handlers leave Board.ts | Medium |
| 1.2 | Extract `EmbedManager` | Iframe lifecycle, sync, activation | Low |
| 1.3 | Extract `TextEditManager` | Textarea creation/position/commit | Low |
| 1.4 | Extract `ClipboardManager` | Copy/paste/duplicate/cut | Low |
| 1.5 | Extract `ImageManager` | Cache, preload, image drag-drop | Low |
| 1.6 | Define the `ToolContext` interface | The surface tools need | Medium |
| 1.7 | Extract the Tool interface + built-in tools | Each tool becomes a class | 🔴 High |
| 1.8 | Extract `ElementRegistry` | The switch in `createElement`/`hitTest`/`render` → registry | 🔴 High |
| 1.9 | Board.ts becomes a thin coordinator | Delegates to managers | Medium |

**Success criteria:** every test from Phase 0 still passes. Zero breaking changes in the public API. Board.ts under 500 lines.

#### Detail: Tool interface (1.7)

```typescript
interface Tool {
  id: string;
  label: string;
  icon?: string;
  cursor?: string;
  shortcuts?: string[];

  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  onPointerDown?(ctx: ToolContext, e: PointerEvent): void;
  onPointerMove?(ctx: ToolContext, e: PointerEvent): void;
  onPointerUp?(ctx: ToolContext, e: PointerEvent): void;
  onKeyDown?(ctx: ToolContext, e: KeyboardEvent): void;
  onKeyUp?(ctx: ToolContext, e: KeyboardEvent): void;
  onDoubleClick?(ctx: ToolContext, e: PointerEvent): void;
}

interface ToolContext {
  scene: Scene;
  camera: Camera;
  selection: SelectionManager;
  history: History;
  renderer: RenderScheduler;
  getStyle(): ElementStyle;
  emit(event: BoardEvent): void;
  setCursor(cursor: string): void;
  getCanvasPoint(e: PointerEvent): Point;
}
```

#### Detail: Element registry (1.8)

```typescript
interface ElementDefinition<T extends BoardElement = BoardElement> {
  type: string;
  create(props: Partial<T>, style: ElementStyle): T;
  hitTest(el: T, point: Point, tolerance: number): boolean;
  render(ctx: CanvasRenderingContext2D, el: T, state: ElementRenderState): void;
  normalize?(el: T): T;
  getBounds?(el: T): BoundingBox;
  getAnchors?(el: T): Point[];  // connection points
  serialize?(el: T): unknown;   // custom serialization
  deserialize?(data: unknown): T;
}

// Registration
board.elements.register(rectangleDefinition);
board.elements.register(myCustomCardDefinition);
```

---

### PHASE 2 — Event bus + commands (weeks 8–12)
> Turn the event system into platform infrastructure.

| # | Task | Description | Dep. |
|---|--------|-----------|------|
| 2.1 | Event bus with lifecycle | `before:*`, `after:*`, `cancel()` | 1.9 |
| 2.2 | Middleware system | `board.use(middleware)` to intercept any event | 2.1 |
| 2.3 | Command system | `CommandRegistry` + `execute(cmd)` + undo/redo through commands | 1.7 |
| 2.4 | Move history to operation-based | Every mutation is a reversible `Command` | 2.3 |
| 2.5 | Keyboard shortcut registry | `board.shortcuts.register("ctrl+d", "duplicate")` | 2.3 |
| 2.6 | Granular events | `element:create`, `element:move`, `tool:activate`, etc. | 2.1 |

#### Detail: Event bus (2.1)

```typescript
interface EventBus {
  // Lifecycle: before → handler → after
  on(event: string, handler: EventHandler, options?: { priority?: number }): Unsubscribe;
  before(event: string, handler: BeforeEventHandler): Unsubscribe;  // can cancel
  after(event: string, handler: AfterEventHandler): Unsubscribe;

  emit(event: string, payload: unknown): boolean;  // false if cancelled
}

interface BeforeEventHandler {
  (payload: unknown, control: { cancel(): void; modify(patch: object): void }): void;
}
```

#### Detail: Command system (2.3)

```typescript
interface Command {
  id: string;
  label: string;
  execute(ctx: BoardContext): void;
  undo?(ctx: BoardContext): void;
  redo?(ctx: BoardContext): void;
  merge?(prev: Command): Command | null;  // to compress contiguous actions
}

interface CommandRegistry {
  register(cmd: CommandDefinition): void;
  execute(id: string, args?: unknown): void;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  getHistory(): CommandHistoryEntry[];
}
```

---

### PHASE 3 — Plugin API (weeks 12–16)
> The step that enables the ecosystem.

| # | Task | Description | Dep. |
|---|--------|-----------|------|
| 3.1 | Plugin interface | The formal `BoardPlugin` contract | 2.* |
| 3.2 | Plugin lifecycle | `install → activate → deactivate → uninstall` | 3.1 |
| 3.3 | Plugin context (sandbox) | The controlled API each plugin receives | 3.1 |
| 3.4 | `board.use(plugin)` API | Instantiation and setup | 3.2 |
| 3.5 | Move built-in tools to plugins | Rectangle, Ellipse, etc. become `@omniboard/plugin-shapes` | 3.3 |
| 3.6 | Move overlays to plugins | ContextMenu and Toolbar become optional plugins | 3.3 |
| 3.7 | Render hooks for plugins | `beforeRender`, `afterRender`, custom layers | 3.3 |
| 3.8 | Plugin communication | `board.plugins.get("kanban").api.addCard(...)` | 3.3 |

#### Detail: Plugin interface (3.1)

```typescript
interface BoardPlugin {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];  // other required plugins

  install(ctx: PluginContext): void | PluginAPI;
  activate?(ctx: PluginContext): void;
  deactivate?(ctx: PluginContext): void;
  uninstall?(ctx: PluginContext): void;
}

interface PluginContext {
  // Registrations
  registerTool(tool: Tool): void;
  registerElement(def: ElementDefinition): void;
  registerCommand(cmd: CommandDefinition): void;
  registerShortcut(keys: string, commandId: string): void;
  registerMenuItem(item: MenuItemDefinition): void;
  registerExporter(format: string, exporter: Exporter): void;
  registerRenderLayer(layer: RenderLayer): void;

  // Controlled access
  scene: ReadonlyScene;
  camera: ReadonlyCamera;
  selection: ReadonlySelection;
  events: EventBus;
  commands: CommandRegistry;

  // Mutations (they go through the command system)
  execute(commandId: string, args?: unknown): void;

  // The plugin's private storage
  store: PluginStore;
}

// Usage
function mindMapPlugin(): BoardPlugin {
  return {
    id: "mindmap",
    name: "Mind Map",
    version: "1.0.0",
    install(ctx) {
      ctx.registerElement(mindMapNodeDef);
      ctx.registerElement(mindMapEdgeDef);
      ctx.registerTool(mindMapTool);
      ctx.registerCommand(autoLayoutCmd);
      ctx.registerShortcut("ctrl+shift+m", "mindmap:auto-layout");

      return {
        // The plugin's public API
        addNode(parentId: string, label: string) { ... },
        layout(algorithm: "tree" | "radial") { ... },
      };
    },
  };
}
```

---

### PHASE 4 — Advanced backend agnosticism (weeks 16–20)
> Expand the adapter pattern to cover sync, CRDT and real-time.

| # | Task | Description | Dep. |
|---|--------|-----------|------|
| 4.1 | Refine `StorageAdapter` v2 | Support granular ops (upsert/delete) besides snapshots | 2.4 |
| 4.2 | `SyncAdapter` interface | For bidirectional real-time | 4.1 |
| 4.3 | Adapter: REST | `createRESTAdapter(config)` | 4.1 |
| 4.4 | Adapter: WebSocket | Pub/sub with reconnect | 4.2 |
| 4.5 | Adapter: Yjs (CRDT) | Local-first + conflict-free sync | 4.2 |
| 4.6 | Adapter: Supabase Realtime | Postgres + realtime changes | 4.2 |
| 4.7 | Adapter: IndexedDB | Offline-first persistence | 4.1 |
| 4.8 | Awareness protocol | Remote cursors, presence, selection | 4.5 |
| 4.9 | Conflict resolution strategies | Last-write-wins, merge, manual | 4.2 |

#### Detail: Sync adapter (4.2)

```typescript
interface SyncAdapter {
  // Send local changes to the backend
  push(operations: Operation[]): Promise<void>;

  // Receive remote changes
  subscribe(callback: (ops: Operation[]) => void): Unsubscribe;

  // Awareness (presence, cursors)
  setAwareness?(state: AwarenessState): void;
  onAwareness?(callback: (states: Map<string, AwarenessState>) => void): Unsubscribe;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): void;
  getStatus(): "connected" | "connecting" | "disconnected";
}

interface StorageAdapterV2 {
  // Snapshot (initial load)
  load(): Promise<BoardSnapshot | null>;

  // Granular (incremental saves)
  applyOperations?(ops: Operation[]): Promise<void>;

  // Fallback: snapshot save
  save(snapshot: BoardSnapshot): Promise<void>;
}
```

---

### PHASE 5 — Advanced features (weeks 20–32)
> Where the "genuinely different" ideas come alive. Each one is independent.

| # | Feature | Priority | Complexity | Dep. |
|---|---------|-----------|--------------|------|
| 5.1 | **Headless mode** | 🔴 High | Medium | 1.9 |
| 5.2 | **Spatial query** | 🔴 High | Medium | 1.8 |
| 5.3 | **Render layers** | 🔴 High | Medium | 3.7 |
| 5.4 | **Smart components** (element morphing) | 🟡 Medium | High | 3.5 |
| 5.5 | **Custom renderers** (WebGL, SVG) | 🟡 Medium | High | 3.7 |
| 5.6 | **Infinite layers** (nested boards) | 🟡 Medium | High | 3.* |
| 5.7 | **Data binding** | 🟡 Medium | High | 3.*, 4.* |
| 5.8 | **Scripting API** | 🟡 Medium | Medium | 3.3 |
| 5.9 | **Automations** (trigger → action) | 🟡 Medium | Medium | 2.3, 3.3 |
| 5.10 | **Versioning** (time travel) | 🟡 Medium | High | 2.4 |
| 5.11 | **Live queries** | 🟢 Low | High | 5.2, 5.7 |
| 5.12 | **Smart links** (reactive connections) | 🟢 Low | Medium | 5.7 |
| 5.13 | **AI SDK** | 🟢 Low | Medium | 3.3, 5.8 |
| 5.14 | **Component marketplace** | 🟢 Low | High | 3.* |

#### Detail: Headless mode (5.1)

```typescript
const board = createBoard({ headless: true });

// No DOM, no canvas, no rendering
// Engine only: scene, events, commands, plugins

board.execute("add-element", { type: "rectangle", x: 0, y: 0, width: 100, height: 50 });
const elements = board.query({ type: "rectangle", tag: "backend" });

// Useful for:
// - Server-side rendering / export
// - Automated tests
// - Programmatic diagram generation
// - Batch processing
// - CI/CD (diagram validation)

// Export in headless mode:
const png = await board.export("png", { width: 1920, height: 1080 });
const svg = await board.export("svg");
const json = board.export("json");
```

#### Detail: Spatial query (5.2)

```typescript
interface SpatialIndex {
  query(opts: SpatialQuery): BoardElement[];
  nearest(point: Point, opts?: { limit?: number; type?: string }): BoardElement[];
  within(bounds: BoundingBox, opts?: { type?: string }): BoardElement[];
  intersects(bounds: BoundingBox): BoardElement[];
}

interface SpatialQuery {
  type?: string | string[];
  bounds?: BoundingBox;
  point?: Point;
  radius?: number;
  tags?: string[];
  data?: Record<string, unknown>;  // filter on the element's data
  where?: (el: BoardElement) => boolean;  // custom predicate
}

// Usage
const cards = board.query({ type: "card", tags: ["backend"] });
const nearby = board.nearest({ x: 100, y: 200 }, { limit: 5 });
const visible = board.within(board.getViewport());
```

#### Detail: Infinite layers (5.6)

```typescript
interface BoardNode extends BoardElement {
  children?: BoardScene;  // nested sub-board
  zoomThreshold?: number; // zoom level that "enters" the sub-board
}

// Navigation
board.camera.zoomInto(nodeId);  // smooth transition into the sub-board
board.camera.zoomOut();         // back to the parent level

// Breadcrumbs
board.layers.getPath();  // ["root", "Backend", "API", "Users"]
board.layers.goTo(2);    // navigates to "API"
```

---

## Design principles

### 1. Backward Compatibility First
Every phase keeps the existing public API working. New capabilities are **additive**. Deprecations get at least one minor version of warning.

### 2. Progressively Extensible
```
Level 0: Use it as today — new Board(el, opts)
Level 1: Customize through events and adapters
Level 2: Register custom elements and tools
Level 3: Write complete plugins
Level 4: Build entire applications on top of the engine
```

### 3. Tree-Shakeable
Unused plugins = zero bytes in the bundle. Minimal core under 30KB gzip.

### 4. Type-Safe
The whole plugin API has to be fully typed. Generics for custom element data.

### 5. Testable
Headless mode + command pattern = every behavior testable without a DOM.

### 6. Local-First by Default
Everything works offline. Sync is opt-in through adapters.

---

## Success metrics per phase

| Phase | Metric |
|------|---------|
| 0 | Coverage above 80% on the core functions. Green CI. |
| 1 | Board.ts under 500 lines. Every test passes. Zero breaking changes. |
| 2 | It is possible to add a custom command + shortcut without touching the core. |
| 3 | An external plugin can add an element type + tool + menu item. |
| 4 | A demo with 2+ backends syncing the same board. |
| 5 | At least 3 community plugins using the API. |

---

## Visual timeline

```
Week:    1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21–32
         │───────────│───────────────────────────│───────────────────│───────────────────│───────────
Phase 0:  ████████████│                           │                   │                   │
Phase 1:  │     ██████│███████████████████████████│                   │                   │
Phase 2:  │           │                     ██████│███████████████████│                   │
Phase 3:  │           │                           │     ██████████████│███████████████████│
Phase 4:  │           │                           │                   │     ██████████████│████
Phase 5:  │           │                           │                   │                   │██████████
```

---

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|-------|---------------|---------|-----------|
| The refactoring breaks existing behavior | High | High | Extensive tests before starting. Refactor in micro-PRs. |
| Performance degrades from the plugin system's indirection | Medium | Medium | Benchmark before/after. No virtual dispatch in the hot path. |
| The plugin API keeps changing during development | Medium | High | Phase 3 starts under an `@alpha` tag. It only stabilizes in v0.5+. |
| Complexity drives contributors away | Medium | Medium | Excellent docs. A "getting started" for each level of use. |
| Scope creep in the advanced features | High | Medium | Phase 5 is modular — each feature is an independent plugin. |
| Incompatibility with existing snapshots | Low | High | Schema versioning already exists. Automatic migrations. |

---

## Implementation priority: quick wins

Things that can be done **now**, without the full refactoring:

1. **Set up Vitest + first tests** — protects against regressions
2. **Extract `EmbedManager`** — low risk, big reduction in Board.ts
3. **Extract `TextEditManager`** — same
4. **Extract `ImageManager`** — same
5. **Define the `Tool` interface (types only)** — aligns the vision without breaking anything
6. **Define the `ElementDefinition` interface** — same
7. **Add a basic `board.query()`** (filter over the elements array) — immediate value

---

## Recommended technical stack

| Layer | Choice | Rationale |
|--------|---------|---------------|
| Monorepo | pnpm workspaces + turborepo | Fast, good for libraries published separately |
| Build | tsup (keep) | Already works, ESM+CJS, zero config |
| Test | Vitest | ESM compatible, fast, good DX |
| Docs | TypeDoc + Starlight (Astro) | Automatic API docs + hand-written guides |
| CI | GitHub Actions | Standard |
| Publish | Changesets | Manages versions in a monorepo |
| Benchmark | Vitest bench or tinybench | Prevent performance regressions |

---

## Comparison with the market

| Feature | OmniBoard (target) | Excalidraw | tldraw | Konva |
|---------|-----------------|------------|--------|-------|
| Plugin system | ✅ First-class | ❌ | 🟡 Limited | ❌ |
| Custom element types | ✅ Registry | ❌ Hard-coded | 🟡 Shapes API | ✅ Nodes |
| Backend agnostic | ✅ Adapter pattern | ❌ Firebase | ❌ Own | ✅ |
| Headless mode | ✅ | ❌ | ❌ | ✅ |
| Event-driven | ✅ Lifecycle hooks | 🟡 Basic | 🟡 Basic | ✅ |
| Local-first/CRDT | ✅ Through an adapter | ❌ | ✅ Yjs built-in | ❌ |
| Framework agnostic | ✅ | 🟡 React-first | 🟡 React-first | ✅ |
| Spatial queries | ✅ | ❌ | ❌ | 🟡 |
| Custom tools | ✅ Tool interface | ❌ | 🟡 | ❌ |
| Scripting | ✅ | ❌ | ❌ | ❌ |

**Positioning**: OmniBoard would be the only one combining all the pillars — deep extensibility + backend agnostic + local-first + framework agnostic. The "core for building any visual product".

---

## Immediate next steps

1. **Create the `feat/platform-architecture` branch**
2. Start Phase 0: set up Vitest, write tests for the current public API
3. Begin the low-risk extractions (Embed, TextEdit, Image managers)
4. In parallel: define the `Tool`, `ElementDefinition` and `Command` interfaces (types only, no implementation yet)
5. Publish an RFC in the repository to collect feedback on the vision

---

*Living document — update it as decisions are made.*
