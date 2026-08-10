# Architecture

This document describes how the project is organized **today** and, above all, the
*why* behind each split. For a view of the future, see
[platform-plan.md](platform-plan.md) (a strategy document, not the current
state).

## The rule that explains everything

**The canvas does not know about the product.**

The engine (`packages/core`) has no notion of accounts, "the user's board", the
cloud or comments. It keeps elements, draws them, interprets pointer and keyboard
input, and **emits events**. Connecting that to boards, accounts and an API is the
app's job (`apps/web`).

Practical consequences:

- `packages/core` makes no network requests. Persistence comes in through an
  *adapter* (`{ save, load }`), uploads through a *hook* (`uploadImage`).
- When the user triggers something that needs UI outside the canvas (a shortcut to
  another board, a long note), the engine emits `elementActivate` and the
  application decides what to do. The alternative — the engine opening a modal —
  would tie the library to a framework.
- The app consumes the engine through its **build** (`packages/*/dist`), like an
  external user would. Packaging mistakes surface during development, not after
  publishing.

## The path of a stroke on screen

```
pointerdown on the canvas
  → InputManager converts screen → world coordinates
  → ToolManager hands it to the active tool (e.g. DrawTool)
  → the tool creates/updates an element in the Scene and marks it dirty
  → animation loop: if dirty, CanvasRenderer redraws everything
  → Board.emitChange() → listeners (autosave, UI, delta to the backend)
```

Redrawing is **complete** on every dirty frame, not incremental. That simplifies a
lot (no region invalidation state) and the cost is acceptable for the orders of
magnitude of a human-made board. When that stops being true, the answer is canvas
layers or WebGL — not manual invalidation.

## Engine modules

| File | Responsibility |
| --- | --- |
| `Board.ts` | Orchestrator: state, input, events, public API |
| `Scene.ts` | Holds the elements and versions every mutation |
| `CanvasRenderer.ts` | All drawing. No other file touches the 2D context |
| `Camera.ts` | Pan/zoom and screen ↔ world conversion |
| `tools/` | One tool per file, behind the `Tool` interface |
| `elements.ts` | Create, hit-test and normalize elements |
| `geometry.ts` | Pure math: bounds, rotation, distance, frame-name geometry |
| `selection.ts` | Resize and rotate handles |
| `snapping.ts` | Alignment guides |
| `connections.ts` | Anchors: arrows that bind to elements and follow them |
| `History.ts` | Snapshot-based undo/redo |
| `persistence.ts` | Debounced autosave on top of an adapter |
| `BoardManager.ts` | Several documents over a single canvas |
| `TextEditManager.ts` | Text editing (textarea overlaid on the canvas) |
| `EmbedManager.ts` | Iframes positioned over the canvas |
| `ImageManager.ts` | Bitmap cache and file input (with the upload hook) |
| `ElementRegistry.ts` / `plugin-types.ts` | Extension: custom types and tools |

Two decisions that usually raise questions:

**An element is plain JSON, with no class.** Serializing, comparing versions and
sending deltas over the wire become trivial. The price is having no methods on the
element — behavior lives in functions (`hitTestElement(el, point)`).

**Undo is snapshot-based, not command-based.** Simple and correct; the cost is O(n)
per step. Switching to invertible commands is a valid optimization, but only when
board size justifies it.

## Overlays: canvas plus DOM

Comments, notes, shortcuts, text editing and embeds are **DOM on top of the
canvas**, not pixels. The reason: they need focus, text selection, scrolling and
accessibility, which the canvas does not provide for free. Their position comes
from **world** coordinates converted on every `cameraChange`, so they follow pan
and zoom.

The comments layer (`apps/web/src/components/board-comments.tsx`) has
`pointer-events: none`; only the pins and the popover capture clicks. That way
drawing underneath keeps working.

## The app (apps/web)

```
pages/board-app.tsx     Mounts the UI islands (innerHTML) and wires everything. Imperative.
components/             React overlays: comments, note, shortcut, share
lib/boards/             Isolated rules: workspace sync, metadata, share, templates
lib/uploads/            Upload signing and migration of embedded images
lib/telemetry/          Error reporting (with a hook for Sentry)
```

`board-app.tsx` is large and imperative for historical reasons: it grew out of the
static demo. The ongoing strategy is to **extract rules into `lib/` with tests**
and leave only DOM assembly there. `workspace-sync.ts` and `share.ts` are examples
of the result.

### Workspace persistence

A single envelope per user:

```json
{
  "type": "omniboard-workspace-envelope",
  "workspace": { "documents": [{ "id", "name", "snapshot" }], "activeId": "…" },
  "meta":     { "<boardId>": { "starred", "updatedAt", "folderId", "position" } },
  "folders":  [ { "id", "name", "parentId", "position" } ],
  "comments": { "<boardId>": [ { "id", "x", "y", "text", "author", "replies" } ] }
}
```

Metadata, folders and comments live **outside** the drawing snapshot: they are not
graphical content (they must not enter the PNG export nor the canvas undo stack)
and the engine's `BoardManager` knows nothing about those concepts. The envelope
carries them together without requiring a backend change — the column is free-form
JSONB.

`lib/boards/workspace-sync.ts` is the only place that decides *when* to write,
*what* to write and *what to do when it fails*. The rules that hold there:

1. Nothing is written before the load finishes (otherwise it overwrites what is
   stored).
2. Pruning metadata and comments only runs after the load — the document that
   `BoardManager` creates in its constructor is throwaway and would take data with
   it.
3. A write failure is never silent: it becomes an error state, the data stays
   pending, and there is retry with backoff.
4. A version conflict reloads the server state instead of overwriting it.

That file exists because the previous version had two sources of truth about "what
is saved" — and a comment created at the wrong moment would disappear.

## The API (apps/api)

Go with Fiber and GORM. One handler per resource, routes in
`internal/server/routes.go`.

**Ownership isolation is an invariant.** Every query is scoped by the `user_id`
from the token; a handler that forgets that becomes an IDOR. The integration tests
always include the "user A cannot see or change user B's data" case.

Points worth knowing:

- **The workspace** is a singleton per user, saved whole, with a `version` for
  optimistic concurrency. The `UPDATE` is conditioned on the version (not just the
  `SELECT`), because there is a window between reading and writing; without that,
  two tabs erase each other.
- **The public link** (`/api/public/shares/:token`) is the only unauthenticated
  route: the token is the credential. It extracts **only** the shared document from
  the owner's workspace — a bug there would leak every board of whoever shared one.
- **Uploads** never pass through the API: it signs a URL (SigV4 implemented in
  `internal/storage`, no SDK) and the browser uploads straight to the bucket.
- **Jobs** in `internal/jobs`: purging sessions and tokens, and collecting orphaned
  images. The collection is conservative — it only deletes objects that are
  unreferenced and older than 48 hours, because the error is asymmetric (storage is
  cheap, a live image is lost work).

## Tests: which layer covers what

| Layer | Where | Environment | Covers |
| --- | --- | --- | --- |
| Engine | `packages/core/tests` | node | Geometry, hit-testing, history, serialization, drawing invariants |
| App | `apps/web/src/**/*.test.ts(x)` | jsdom | Isolated rules and component behavior |
| API | `apps/api/internal/**/_test.go` | Real Postgres | HTTP contract, isolation between accounts, conflicts |
| E2E | `apps/web/e2e` | Chromium | The critical path: draw → reload → still there |

The renderer is tested by **invariant**, not by image: a fake 2D context records
every coordinate and the test requires, for example, that nothing is drawn outside
the element. That is how a visibly crooked icon became a test.

## Known limitations

- **No real-time collaboration.** The engine already has what it needs
  (`applyOperations`, per-element versions), but there is no transport nor CRDT.
- **The workspace is saved whole.** The payload is proportional to the account, not
  to the board being edited. A per-board API (`/boards`) exists and is unused.
- **Undo is O(n) per step** (snapshot-based).
- **Images in a public bucket** under random keys. A conscious decision, documented
  in the privacy policy and in `SECURITY.md`.
