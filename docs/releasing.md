# Releasing

The two library packages are published to npm:

| Package | Install |
| --- | --- |
| `@omniboard/core` | `npm i @omniboard/core` |
| `@omniboard/react` | `npm i @omniboard/react` (pulls core in) |

`apps/web` and `apps/api` are not published — they are the product, not the
library.

## One-time setup

1. An npm account with the `@omniboard` scope. Scoped packages are private by
   default, which is why both manifests carry `publishConfig.access: "public"`.
2. An npm **automation** token (Access Tokens → Generate → Automation), stored as
   the `NPM_TOKEN` repository secret. Automation tokens bypass 2FA prompts, which
   an unattended workflow cannot answer.

## Publishing

```bash
# 1. bump both packages to the same version
#    (they are released together; a split would make the peer range guesswork)
npm version 0.2.0 --workspace packages/core --workspace packages/react --no-git-tag-version

# 2. commit, tag, push
git commit -am "release: v0.2.0"
git tag v0.2.0
git push origin main --tags
```

The tag triggers `.github/workflows/release.yml`, which refuses to publish if the
tag and the manifests disagree, runs typecheck + tests + build, inspects the
tarballs, and then publishes with npm provenance.

To rehearse without publishing: Actions → Release → Run workflow, leaving
`dry_run` checked.

## Why pnpm and not npm

`@omniboard/react` depends on `@omniboard/core` through the workspace protocol:

```json
"dependencies": { "@omniboard/core": "workspace:*" }
```

`pnpm publish` rewrites that to the real version (`"0.1.0"`) when packing.
`npm publish` does not — it ships `workspace:*` verbatim, and npm cannot install
it:

```
npm error Unsupported URL Type "workspace:": workspace:*
```

The published package would be broken for everyone, and npm only allows
unpublishing within 72 hours. The release workflow therefore uses pnpm and asserts
that no `workspace:` string survives in the packed manifests.

## Checking a release candidate by hand

Nothing beats installing the tarball the way a user would:

```bash
pnpm --filter "./packages/*" exec pnpm pack --pack-destination /tmp/packs

mkdir /tmp/try && cd /tmp/try && npm init -y
npm i /tmp/packs/omniboard-core-*.tgz /tmp/packs/omniboard-react-*.tgz
```

Then import it from ESM, `require()` it from CJS, and typecheck a file that uses
it under `moduleResolution: node16` — the three ways a consumer can consume the
package, and the three ways a broken `exports` map shows up.

## After the first publish

Drop the "not published to npm yet" note from the root `README.md` quickstart.

## Versioning

Both packages move together, starting from `0.1.0`. While the major is `0`, a
breaking change bumps the minor — and belongs in the release notes, since anyone
who embedded the engine reads those to decide whether to upgrade.
