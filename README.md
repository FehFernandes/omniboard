# OmniBoard

Open source infinite canvas / whiteboard — in the spirit of Excalidraw and Miro,
but in two layers: an **embeddable engine** for any project, and a **complete app**
built on top of it.

```
packages/core   TypeScript engine on Canvas 2D, no runtime dependencies
packages/react  optional React wrapper
apps/web        application (React SPA) that uses the engine
apps/api        Go backend (Fiber + Postgres): accounts, workspace, uploads, links
examples/       static engine demo, no app build required
```

Two ways to use this repository: install just the engine in your application, or
run the whole product.

## What exists today

**Canvas.** Infinite pan and zoom, rectangle, ellipse, line, arrow, freehand
drawing, text, 16 diagram shapes (diamond, cylinder, cloud, stick figure…),
sticky note, frame, task card, image, iframe embed, note with a modal editor, and
a shortcut element that navigates to another board.

**Editing.** Selection, move, resize, rotate, snapping with guides, arrows that
bind to elements and follow them, undo/redo, copy/paste, z-order, light/dark
themes, appearance customization.

**Asynchronous collaboration.** Comments pinned to the canvas with replies and
resolution, plus a public read-only link per board.

**Persistence.** Versioned snapshot, per-element deltas, pluggable autosave,
multiple boards per workspace. In the app: saved to the user's account with
concurrent-write detection, images in an S3-compatible bucket (R2), and automatic
migration of images that were previously embedded.

The roadmap and what is still missing live in [docs/roadmap.md](docs/roadmap.md).

## Running the project

Requirements: **Node 20+**, **pnpm 9+**, **Go 1.24+** (API only) and **Docker**
(Postgres only).

```bash
git clone https://github.com/cachyosso/omniboard.git
cd omniboard
pnpm setup          # installs dependencies and builds the engine
pnpm dev            # web app at http://localhost:5173
```

The app works **without a backend**: with no login, boards live in
`localStorage`. For accounts, cloud sync, image upload and share links:

```bash
pnpm db:up                               # Postgres via Docker
cp apps/api/.env.example apps/api/.env   # then fill in what you need
pnpm dev:api                             # API at http://localhost:4000
```

Every variable in `.env.example` explains what it does and what happens when it
is left empty — nothing is mandatory beyond the database and the JWT secret.
Google login, Stripe and the image bucket are optional and degrade gracefully
when absent.

Configuration details: [docs/setup.md](docs/setup.md).

## Using the engine alone

```bash
npm i @omniboard/core           # not on npm yet — see docs/releasing.md
```

```ts
import { Board } from "@omniboard/core";

const board = new Board(document.getElementById("app")!, { grid: true });
board.setTool("rectangle");

board.on("change", (e) => console.log("elements:", e.elements));

const snapshot = board.getSnapshot();   // plain, serializable JSON
board.loadSnapshot(snapshot);
```

With React:

```tsx
import { OmniBoard, useBoard } from "@omniboard/react";

function App() {
  const b = useBoard();
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <button onClick={() => b.setTool("rectangle")}>Rectangle</button>
      <OmniBoard onReady={b.ready} onChange={b.onChange} grid />
    </div>
  );
}
```

The complete engine API is documented in
[packages/core/README.md](packages/core/README.md): tools, events,
customization, backend integration, multiple boards and the plugin system (custom
elements and tools).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm setup` | Installs everything and builds the engine (run this after cloning) |
| `pnpm dev` | Web app in development mode |
| `pnpm dev:api` | Go API |
| `pnpm dev:lib` | Rebuilds the engine in watch mode (to work on the lib and see it in the app) |
| `pnpm test` | Engine, app and API tests |
| `pnpm e2e` | End-to-end tests in a real browser (Playwright) |
| `pnpm check` | Typecheck + lint + tests — what CI runs |
| `pnpm build` | Production build of the engine and the app |

## A note on language

Everything is in **English**: code, comments, documentation and the user
interface. The strings are still hardcoded, so translating the UI means adding an
i18n layer first — that is on the [roadmap](docs/roadmap.md) and is a good first
contribution.

## Contributing

Contributions are welcome: a fix, an idea, a question or code.
Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it explains the repository
layout, how to run the tests, the expected code style, and how to open a pull
request that is easy to review.

To report a security issue, do not open a public issue:
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
