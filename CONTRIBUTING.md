# Contributing to OmniBoard

Thanks for your interest. This document explains where things live, how to run
them, what is expected from a patch, and how to open a pull request that is easy
to review.

Before writing code for a large change, **open an issue** describing the problem.
It keeps you from investing hours in a direction that will not land — and the
conversation often shortens the solution.

## Contents

- [Repository layout](#repository-layout)
- [Setting up](#setting-up)
- [Running and testing](#running-and-testing)
- [Code style](#code-style)
- [Tests: what we expect](#tests-what-we-expect)
- [Commits and pull requests](#commits-and-pull-requests)
- [Where to change what](#where-to-change-what)

## Repository layout

```
packages/core       The engine. Plain TypeScript on Canvas 2D, zero runtime deps.
  src/Board.ts        Orchestrator: input, state, events, public API
  src/CanvasRenderer  Drawing (every pixel comes from here)
  src/tools/          One tool per file (selection, draw, text…)
  src/elements.ts     Element creation, hit-testing and normalization
  tests/              Engine tests (vitest, node environment)

packages/react      Optional wrapper: <OmniBoard> component and useBoard hook.

apps/web            React SPA that consumes the engine through its `dist` build.
  src/pages/board-app.tsx   Mounts the UI islands and wires everything (large, imperative)
  src/components/           React overlays: comments, note, shortcut, share
  src/lib/                  Isolated, testable rules (sync, uploads, share, telemetry)
  e2e/                      Playwright: real browser

apps/api            Go (Fiber + GORM + Postgres).
  internal/handlers/  One file per resource; validation and response
  internal/models/    GORM entities
  internal/migrations/ Versioned SQL (golang-migrate), embedded in the binary
  internal/storage/   S3-compatible bucket (R2): signing, upload, cleanup
  internal/jobs/      Background maintenance
  internal/server/    Routes, middleware and integration tests

examples/           Static engine demo: opens the `dist` in a browser, no build.
docs/               Detailed setup, architecture and release process.
```

The rule that explains the split: **the canvas does not know about the product**.
The engine has no notion of "the user's board", accounts or APIs — it emits events
and accepts commands. Connecting that to boards, accounts and the cloud is
`apps/web`'s job. If you are about to put `fetch` inside `packages/core`, the code
probably belongs somewhere else.

## Setting up

Requirements: Node 22+, pnpm 9+, Go 1.24+ (API only), Docker (Postgres only).

```bash
pnpm setup    # installs dependencies and builds the engine
```

The app imports the engine from its **build** (`packages/*/dist`), not from
source. That is deliberate: a packaging mistake (a missing export, a type that
never made it into the `.d.ts`) shows up during development instead of after
publishing. When working on the lib, keep `pnpm dev:lib` running in another
terminal — it rebuilds in watch mode.

For the backend:

```bash
pnpm db:up                                # Postgres in Docker (port 5434)
cp apps/api/.env.example apps/api/.env    # read the comments in the file
pnpm dev:api
```

`JWT_SECRET_KEY` and `JWT_REFRESH_SECRET_KEY` are required (the file shows how to
generate them). Google, Stripe and R2 are optional: without them, login, billing
and uploads are disabled and everything else works.

## Running and testing

```bash
pnpm dev            # web app
pnpm test           # engine + app + API
pnpm test:lib       # engine only (fast, no DB, no browser)
pnpm test:web       # app only (vitest + jsdom)
pnpm test:api       # API only (needs Postgres running)
pnpm e2e            # real browser (Playwright); it starts the dev server itself
pnpm check          # typecheck + lint + tests — the same thing CI enforces
```

Run `pnpm check` before opening a PR. If e2e fails locally, inspect the trace with
`pnpm --filter omniboard-web exec playwright show-trace apps/web/test-results/<case>/trace.zip`.

## Code style

**Language.** Everything is in **English**: code, comments, documentation, UI
strings and API error messages. The UI text is hardcoded — adding other languages
means introducing an i18n layer first.

Two deliberate exceptions, both documented where they appear: the legacy task
priorities (`alta`/`média`/`baixa`) kept as aliases in `PRIORITY_COLOR` so boards
saved before the rename still render, and the `/privacidade` and `/termos` routes
kept as redirects because those addresses were already submitted to Google's
OAuth form.

**Comments explain why, not what.** The code already says what it does.

```ts
// Bad: Increment the counter
counter += 1;

// Good: Only the second attempt triggers the backoff: the first failure is usually
// a network timeout, and waiting there delays the common case for nothing.
if (attempt > 1) wait(backoff);
```

**Formatting.** Prettier and ESLint for JS/TS (`pnpm lint`), `gofmt` for Go (CI
rejects unformatted files). No style debates in review: the tool decides.

**TypeScript.** `strict` is on. Avoid `any` in new code; use `unknown` and narrow
it. `board-app.tsx` has `any` because it is legacy imperative DOM code — it is not
the pattern to follow, and the ESLint config documents that exception.

**Go.** Errors are handled or returned, never swallowed into `_`. Every query is
scoped by the `user_id` from the token (ownership isolation); a handler that
forgets that becomes an IDOR.

**No secrets in the repository.** `.env` is ignored; if you need a new variable,
document it in `.env.example`, explaining what happens when it is missing.

## Tests: what we expect

Every behavioral PR comes with a test. Not as bureaucracy: this project persists
people's work, and the most common failure mode here is **silent data loss**. A
good test here is one that fails when the regression comes back.

- **Engine** (`packages/core/tests`): geometry, hit-testing, history,
  serialization. `node` environment, no DOM — if you need DOM, it is probably an
  app-level concern.
- **App** (`apps/web/src/**/*.test.ts(x)`): isolated rules and components with
  Testing Library. Prefer querying by role or accessible label (`getByRole`,
  `getByLabelText`) over CSS classes.
- **API** (`apps/api/internal/**/_test.go`): handlers against a real Postgres.
  Always include the "user A cannot see or change user B's data" case.
- **E2E** (`apps/web/e2e`): the critical user path only. It is the slowest layer;
  do not use it for unit-level detail.

When fixing a bug, write the test first: make it fail for the actual cause, then
fix it. If the test passes on both versions, it protects nothing.

## Commits and pull requests

Messages in the imperative, describing the effect:

```
fix comment loss when closing the popover

The draft was only stored on submit: closing with Esc discarded the text and
deleted the newly created pin.
```

We do not require Conventional Commits; we do require a readable history.

In the PR, say **what changes for the user** and **how you verified it**. For
visual changes, attach before/after — we cannot see your screen. A small PR gets
reviewed in hours; a 2000-line PR sleeps for weeks. If the change is large, split
it into a sequence of PRs that make sense on their own.

CI runs the lib, the web app, the API and e2e. A PR with red CI does not get
reviewed — if it broke on something that looks environmental rather than caused by
your patch, say so in the PR.

## Where to change what

| I want to… | I change |
| --- | --- |
| Add a diagram shape | `ShapeKind` in `packages/core/src/types.ts` + `drawShape` in the renderer + the palette in `apps/web/src/pages/board-app.tsx` |
| Add an element type | `types.ts`, `elements.ts` (create/hit-test), `CanvasRenderer`, `ElementRegistry` and a tool in `tools/` |
| Add a tool | `packages/core/src/tools/` + registration in `tools/index.ts` |
| Change how the canvas looks | `packages/core/src/CanvasRenderer.ts` (and `themes.ts` for color) |
| Add an endpoint | `apps/api/internal/handlers/` + route in `internal/server/routes.go` + test in `internal/server/` + `internal/docs/openapi.yaml` |
| Change the saved format | `BoardSnapshot`/`SCHEMA_VERSION` plus a migration path — old data must keep opening |
| Change app UI | `apps/web/src/components/` (React) or `board-app.tsx` (imperative islands) |

Not sure where something belongs? Open the issue and ask. Answering is cheaper
than reviewing a PR built in the wrong place.
