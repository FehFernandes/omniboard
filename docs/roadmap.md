# Roadmap

An honest picture of the project: what is done, what is missing, and where it is
good to start contributing. No dates — this is volunteer work.

## Done

**Engine**: infinite pan/zoom, 8 element types plus 16 diagram shapes,
select/move/resize/rotate, snapping with guides, bound arrows that follow their
elements, undo/redo, copy/paste, z-order, themes, configurable appearance, element
and tool plugins, serializable snapshots, adapter-based autosave, multiple boards.

**App**: Google accounts, cloud sync with concurrent-write detection, image upload
to an S3-compatible bucket, comments pinned to the canvas, notes in a modal,
shortcuts between boards, public read-only links, templates (registry ready, no
content), legal pages.

**API**: authentication, sessions, 2FA, billing (Stripe or a fake provider in dev),
versioned workspace, upload signing, share links, audit trail, maintenance jobs,
OpenAPI, integration tests against a real Postgres.

## Missing, in order of impact

### Real-time collaboration
The biggest gap. The engine already has what it needs (`applyOperations`, a
monotonic version per element); what is missing is transport (WebSocket) and
conflict resolution — probably a CRDT (Yjs) rather than manual merging. It also
needs cursors and presence.
*Large, architectural. Open an issue before starting.*

### Per-board persistence
Today the whole workspace is saved on every change: the payload grows with the
account, not with the board being edited. The per-board API (`/boards`) already
exists and is unused. Migrating fixes the payload, isolates conflicts, and is a
prerequisite for shared editing.
*Medium, changes a contract and needs a data migration path.*

### Grouping elements
Select several and treat them as one (move, resize, copy). Missing in the core.
*Medium, a good first contact with the engine.*

### Hand-drawn style
Rendering with irregular strokes, in the spirit of Excalidraw. Isolated in
`CanvasRenderer`, no data model changes.
*Medium, very visible.*

### Mobile and touch
Pinch and pan work, but the island-based UI was designed for a mouse. Touch
targets, the virtual keyboard and two-finger gestures need review.

### Canvas accessibility
Shortcuts exist, but there is no keyboard navigation between elements and no screen
reader support. Needs a design decision before code.

### Internationalization
The UI is in English, but the strings are hardcoded in the components. Extract
them and pick a lightweight library — then adding a language becomes a data
change.
*Mechanical, a good first contribution.*

## Good places to start

Small tasks with visible results and little chance of conflict:

- **New diagram shapes.** Add to `ShapeKind`, draw in `drawShape`, include in the
  palette. An invariant test guarantees nothing spills outside the bounding box.
- **Templates.** The registry is ready and empty in
  `apps/web/src/lib/boards/templates.ts`: add one object and the panel fills itself.
- **Missing keyboard shortcuts** (e.g. duplicate with Alt+drag).
- **Better error messages** where today there is only a generic toast.
- **Tests for uncovered paths** — especially in `board-app.tsx`, which is large and
  barely tested. Extracting a rule from it into `lib/` with tests is a
  high-value contribution.

## Accepted technical debt

These are not bugs; they are choices with a known cost, documented so nobody has to
"discover" them:

- **Snapshot-based undo** (O(n) per step) instead of invertible commands.
- **Full redraw** on every dirty frame, with no region invalidation.
- **`board-app.tsx` is large and imperative**, with `any` inherited from the
  original demo. The strategy is to extract rules into `lib/`, not to rewrite it in
  one go.
- **Images in a public-read bucket** under random keys (see
  [SECURITY.md](../SECURITY.md)).
- **`type: "openboard"`** in the saved format: a historical name kept so existing
  data stays readable.

## Before a 1.0

- Real-time collaboration, or an explicit decision that 1.0 is single-player.
- A stable engine API (today it can change without notice).
- Packages published to npm with a changelog.
- E2E coverage beyond the critical path.
