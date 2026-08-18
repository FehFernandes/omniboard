<!--
Thanks for the PR. Fill in what applies and delete the rest — no need to answer
everything if the change is small and obvious.
-->

## What changes

<!-- Describe the effect for whoever uses it, not the list of files (the diff shows that). -->

## Why

<!-- Related issue (`Fixes #123`) or the reason, if there is no issue. -->

## How I verified it

<!--
What you ran and what you observed. For example:
- `pnpm check` passes
- Manual test: created a note, closed with Esc, reloaded — the text is still there
- New test: apps/web/src/components/board-note-modal.test.tsx ("saves on close")
-->

## Before / after

<!-- Visual changes only: screenshot or video. We cannot see your screen. -->

---

- [ ] `pnpm check` passes (typecheck + lint + tests)
- [ ] Behavioral changes have a test that fails without the patch
- [ ] If I touched `packages/core`, I ran `pnpm build:lib` and checked it in the app
- [ ] If I touched the API, I added or adjusted a test in `apps/api/internal/server`
- [ ] If I changed the saved format, old data still opens
- [ ] No secrets, `.env` files or credentials in the diff
