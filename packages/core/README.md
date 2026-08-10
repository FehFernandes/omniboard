# @omniboard/core

An infinite-canvas engine in TypeScript. No runtime dependencies, no framework: it
takes a DOM element and draws into a 2D `<canvas>`.

```bash
npm i @omniboard/core      # or: pnpm add / yarn add
```

```ts
import { Board } from "@omniboard/core";

const board = new Board(document.getElementById("app")!, { grid: true });
board.setTool("rectangle");
```

`Board` is the only thing you need to instantiate. It creates the canvas inside the
container, listens to pointer/keyboard/wheel input, keeps the scene and redraws
when something changes.

**The container needs its own size.** The canvas is absolutely positioned inside it
(`position: relative` is set on the container for you), so a `<div>` with no height
produces a 1×1 canvas — a board that looks blank. Give it dimensions in CSS:

```html
<div id="app" style="position: fixed; inset: 0"></div>
```

## Contents

- [Creating and configuring](#creating-and-configuring)
- [Tools](#tools)
- [Elements](#elements)
- [Events](#events)
- [Style of what gets created](#style-of-what-gets-created)
- [Selection, camera and view](#selection-camera-and-view)
- [Saving and loading](#saving-and-loading)
- [Multiple boards (BoardManager)](#multiple-boards-boardmanager)
- [Images and uploads](#images-and-uploads)
- [Appearance and theme](#appearance-and-theme)
- [Navigation mode (read-only)](#navigation-mode-read-only)
- [Plugins: custom elements and tools](#plugins-custom-elements-and-tools)
- [Exporting](#exporting)
- [Lifecycle](#lifecycle)

## Creating and configuring

```ts
const board = new Board(container, {
  elements: [],                 // initial scene
  camera: { zoom: 1 },          // scrollX, scrollY, zoom
  theme: "light",               // "light" | "dark"
  background: "#fff",           // overrides the theme color
  grid: true,
  defaultStyle: { strokeColor: "#1e1e1e", strokeWidth: 2 },
  defaultTextStyle: { fontSize: 20 },
  minZoom: 0.1,
  maxZoom: 8,
  appearance: { gridPattern: "dots", selectionColor: "#6965db" },
  contextMenu: true,            // built-in right-click menu
  selectionToolbar: true,       // floating toolbar above the selection
  edgePan: true,                // pans the view when the pointer hits the edge
  uploadImage: async (file) => "https://cdn/…",  // see Images
});
```

Turn off `contextMenu` and `selectionToolbar` if you are building your own UI —
that is what the app in this repository does.

## Tools

```ts
board.setTool("rectangle");
board.getTool();   // ToolType
```

`selection`, `hand`, `rectangle`, `ellipse`, `line`, `arrow`, `freedraw`, `text`,
`image`, `embed`, `tasks`, `shape`, `sticky`, `frame`, `link`, `note`.

Keyboard shortcuts are wired by default (`v`, `r`, `o`, `l`, `a`, `p`, `t`, `h`…),
and they are ignored while focus is in an `input`/`textarea` of your own UI.

For `shape`, pick the shape before drawing:

```ts
board.setShapeKind("cylinder");
// diamond, triangle, hexagon, parallelogram, cylinder, cloud, document, star,
// pill, person, cube, browser, folder, callout, cross, arrowBlock
```

`board.setCurveType("curve")` makes the next arrows curved;
`board.setStickyColor("#FFF9B1")` sets the color of the next sticky note (the
suggested palette is in `STICKY_COLORS`).

## Elements

An element is a plain JSON object (no class, no methods), which keeps the scene
serializable and comparable:

```ts
{
  id: "abc", type: "rectangle", x: 100, y: 80, width: 200, height: 120,
  angle: 0, version: 3,
  strokeColor: "#1e1e1e", backgroundColor: "transparent",
  fillStyle: "solid", strokeWidth: 2, opacity: 1,
  label: "Service A",           // centered label (optional)
}
```

`version` is monotonic per element: it increments on every change. It exists for
diffing and for resolving collaboration merges without comparing whole objects.

```ts
board.getElements();                       // current scene (deleted ones excluded)
board.getElement(id);
board.addElement(el, { select: true });
board.updateElement(id, { x: 10 });        // opts.record: false skips the undo step
board.removeElement(id);
board.setElements(list);                   // replaces everything
board.clear();
```

To apply several changes as **one** undo step and **one** event — the recommended
path for backend sync:

```ts
board.applyOperations([
  { op: "add", element: newOne },
  { op: "update", id: "abc", patch: { x: 20 } },
  { op: "remove", id: "def" },
], { record: false });
```

## Events

```ts
const off = board.on("change", (e) => save(e.elements));
off();  // removes the listener
```

| Event | When |
| --- | --- |
| `change` | Any change to the scene |
| `elementsChange` | Same as `change`, but with `added`, `updated`, `removed` (delta) |
| `selectionChange` | Selection changed (`ids`) |
| `toolChange` | Active tool changed |
| `themeChange` | Theme changed |
| `appearanceChange` | Appearance changed |
| `cameraChange` | Pan/zoom (useful to position overlays in world coordinates) |
| `lockChange` | Navigation mode turned on/off |
| `embedActiveChange` | An embedded iframe gained/lost interaction |
| `elementActivate` | The user triggered a `link` or `note` — your UI decides what to do |
| `imageUploadError` | Upload failed; the image was embedded instead |

`elementActivate` exists because the canvas cannot navigate or open modals: it
reports, and the application resolves.

## Style of what gets created

`setStyle` changes the selection when there is one; otherwise it sets the default
for the next elements:

```ts
board.setStyle({ strokeColor: "#e03131", strokeWidth: 4, opacity: 0.8 });
board.getStyle();

board.setTextStyle({ fontSize: 24, fontWeight: "bold" });   // text elements
board.setLabelStyle({ textAlign: "center" });               // labels inside shapes
board.setLabel(id, "New text");
```

## Selection, camera and view

```ts
board.setSelection([id1, id2]);
board.getSelectedIds();
board.deleteSelected();
board.duplicateSelected();
board.bringToFront();  board.sendToBack();
board.copy();          board.paste();
board.undo();          board.redo();       // canUndo() / canRedo()

board.zoomIn();  board.zoomOut();  board.resetZoom();
board.zoomToFit();                  // the whole scene
board.zoomToElements([id1, id2]);
board.centerOn(x, y);               // world coordinates
board.camera.worldToScreen(x, y);   // and screenToWorld: to position your overlays
```

Extras: `board.search(text)` returns matching ids; `searchAndFocus` also frames
them. `autoLayout("grid" | "horizontal" | "vertical" | "circle")` rearranges the
selection (or everything). `toggleFocusMode()` dims whatever is not selected.

## Saving and loading

```ts
const snap = board.getSnapshot();   // { version, type, elements, camera, appearance }
board.loadSnapshot(snap);           // accepts an object or a JSON string
```

Autosave against any backend, through an adapter:

```ts
import { attachPersistence, localStorageAdapter } from "@omniboard/core";

const detach = attachPersistence(board, localStorageAdapter("my-board"), {
  debounceMs: 800,
  loadOnStart: true,
  onSave: (snap) => showSaved(),
  onError: (err) => report(err),
});
```

An adapter is `{ save(snapshot), load?() }` — it can be REST, IndexedDB, Firestore,
whatever. `memoryAdapter()` exists for tests.

> The snapshot's `type` field is `"openboard"` for historical reasons. It is a
> format identifier, not a brand: changing it would invalidate every file already
> saved out there.

## Multiple boards (BoardManager)

One canvas, several documents (like tabs):

```ts
import { BoardManager, attachWorkspacePersistence, workspaceLocalStorageAdapter } from "@omniboard/core";

const boards = new BoardManager(board, { defaultName: "Board 1" });
boards.create("Architecture");    // creates and switches
boards.switch(id);
boards.rename(id, "New name");
boards.duplicate(id);
boards.remove(id);                // the last one is cleared, not removed
boards.list();                    // [{ id, name }] to render your own tabs
boards.on("documentsChange", ({ documents, activeId }) => renderTabs(documents, activeId));

attachWorkspacePersistence(boards, workspaceLocalStorageAdapter(), { loadOnStart: true });
```

`boards.toJSON()` / `loadJSON()` serialize the whole workspace.

## Images and uploads

With no configuration, a pasted or dropped image becomes a **data URL** inside the
element — simple, but the binary then travels on every save. To send it to storage
instead:

```ts
new Board(container, {
  uploadImage: async (file) => {
    const url = await myUpload(file);   // return the public URL
    return url;
  },
});
```

If the promise rejects, the engine embeds the image (nobody loses what they pasted)
and emits `imageUploadError`.

```ts
board.addImage(src, { position });   // programmatically
board.addEmbed("https://youtube.com/watch?v=…");   // normalized to an embeddable URL
```

## Appearance and theme

```ts
board.setTheme("dark");   board.toggleTheme();
board.setBackground("#faf9f6");
board.setGrid(true);
board.setAppearance({
  gridPattern: "dots",      // dots | crosses | lines | grid | none
  gridSpacing: 24,
  selectionColor: "#6965db",
  handleSize: 8,
  snapColor: "#e03131",
});
```

## Navigation mode (read-only)

```ts
board.setLocked(true);
```

Pan, zoom and interaction with task cards keep working; creating, moving and
editing do not. This is the mode used on the public page of a shared board.

## Plugins: custom elements and tools

```ts
const elements = board.getElementRegistry();
elements.register({
  type: "myType",
  create: (props, style) => ({ ...props, type: "myType", /* … */ }),
  hitTest: (el, point, tolerance) => /* … */ true,
  render: (el, ctx) => { /* draw on the 2D context */ },
});

const tools = board.getToolRegistry();
tools.register(myTool);   // implements the Tool interface
```

Built-in types are drawn directly by the renderer (for performance); registered
ones go through the definition's `render`.

## Exporting

```ts
const blob = await board.exportPNG({ scale: 2, background: "#fff" });
const json = board.exportJSON();
```

## Lifecycle

```ts
board.destroy();   // removes listeners, the canvas and the overlays
```

Always call it when unmounting (the `@omniboard/react` wrapper does it for you).

## Where to look in the code

`src/Board.ts` orchestrates; `src/CanvasRenderer.ts` draws; `src/tools/` has one
tool per file; `src/elements.ts` creates and hit-tests; `src/geometry.ts`
concentrates the math. Tests live in `tests/`.
