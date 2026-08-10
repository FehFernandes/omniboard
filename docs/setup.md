# Detailed setup

The [README](../README.md) has the short path. This document covers what to do
when you want the full product running: accounts, cloud sync, image uploads and
share links.

## The minimum

```bash
pnpm setup   # install and build the engine
pnpm dev     # http://localhost:5173
```

Without a backend the app works: boards live in the browser's `localStorage`. You
lose cross-device sync, image upload and sharing — everything else is the same.

## Database

```bash
pnpm db:up
```

Starts Postgres on port **5434** (not 5432, to avoid clashing with a native
Postgres) and Redis on 6380. On the first start it creates the `omniboard_dev` and
`omniboard_test` databases.

Redis is optional: without `REDIS_URL` the API counts rate limits in memory, per
instance. It only matters if you run multiple replicas.

```bash
pnpm db:down                          # stop
cd apps/api && make db-reset          # drop the volume and recreate the databases
```

## API variables

```bash
cp apps/api/.env.example apps/api/.env
```

The file is commented variable by variable. The essentials:

| Variable | Required? | Without it |
| --- | --- | --- |
| `DB_*` | Yes | The API does not start |
| `JWT_SECRET_KEY`, `JWT_REFRESH_SECRET_KEY` | Yes | The API does not start (generate with `openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | Login disabled; the app stays in anonymous mode |
| `R2_*` | No | Uploads disabled; images are embedded in the snapshot |
| `STRIPE_*` | No | Uses the fake payment provider (dev) |
| `REDIS_URL` | No | Rate limiting in memory |

```bash
pnpm dev:api   # http://localhost:4000/api  (docs at /docs)
```

Migrations: in development GORM creates and adjusts tables on startup. In
production use `DB_MIGRATE=versioned`, which applies the versioned SQL from
`apps/api/internal/migrations` (embedded in the binary).

## Google login

The only authentication path — there are no passwords in the database.

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services**.
2. **OAuth consent screen**: type *External*. While the app is in *Testing*, add
   your email under **Test users** (without it even the owner is blocked) and the
   cap is 100 accounts.
3. **Credentials** → *Create credentials* → *OAuth client ID* → *Web application*.
   Under **Authorized redirect URIs** put, byte for byte:
   `http://localhost:4000/api/auth/google/callback`
4. Copy the Client ID and Client secret into `.env`.

To publish, the consent screen requires a publicly reachable **privacy policy** and
**terms** — the app already serves them at `/privacidade` and `/termos`. Point
Google at your domain's URLs and replace the contact email in those documents
(`apps/web/src/pages/legal.tsx`).

## Image uploads (Cloudflare R2)

Without this, a pasted image becomes base64 inside the snapshot: it works, but the
binary travels on every save and blows past the API body limit (10MB).

1. **R2 → Create bucket** (e.g. `omniboard`).
2. **R2 → Manage API tokens → Create API token**: permission *Object Read &
   Write*, scoped to that bucket only. Save the Access Key ID and Secret (the
   secret is shown once).
3. **Bucket → Settings → Public access**: enable it. Use a custom domain in
   production; `pub-*.r2.dev` is rate-limited and meant for testing.
4. **Bucket → Settings → CORS policy** — required, because the PUT comes from the
   browser:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://your-domain.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

5. Fill in `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY` and `R2_PUBLIC_BASE_URL` in `.env`.

Validate without opening the app:

```bash
cd apps/api
R2_LIVE_TEST=1 go test ./internal/storage -run AoVivo -v
```

The test signs a URL, uploads a 1x1 PNG, reads it back through the public URL and
deletes the object. The error messages say what to fix: **403** is usually a token
without *Object Read & Write* or scoped to another bucket; **404**, a wrong bucket
name; a failure on the public read means *Public access* is off. CORS is not
covered by that test (curl does not do CORS) — if the upload works there but fails
in the browser with a CORS error in the console, it is the bucket policy.

**How it works.** The API never receives the file: it signs a PUT URL (SigV4, valid
for 5 minutes) and the browser uploads straight to the bucket. The board stores
only the public URL in the element. Images removed from a board are collected later
by a job (`apps/api/internal/jobs/orphans.go`), which only deletes objects that are
unreferenced and older than 48 hours.

## Secrets

`.env` is git-ignored at any level, except for the `.env.example` files. Before
committing, check that no real value slipped in:

```bash
git diff --cached | grep -iE "secret|token|password|_key" | head
```

A committed secret stays in history even after removal — in that case, rotate the
credential instead of just deleting the file.

## Publishing the packages to npm

The packages are not published yet. When they are:

```bash
pnpm build:lib
cd packages/core && npm publish --access public
cd ../react && npm publish --access public
```

The app in this repository keeps consuming the packages through the local path
(`apps/web/vite.config.ts`) on purpose: a change in the engine shows up in the app
without going through a release.

## Production

There is a `Dockerfile` for the API (static binary in a distroless image) and for
the web app (build served by nginx, with `nginx.conf` already set up for an SPA).
The compose file at the root is development-only — do not use it in production
without reviewing passwords and volumes.

Before exposing it:

- `ENV=production` (enables rate limiting and HSTS, disables the fake payment
  provider).
- Distinct JWT secrets, 32+ characters each.
- `DB_SSLMODE=require` or stricter.
- `DB_MIGRATE=versioned`.
- The API's CORS pointing at the real frontend domain, and the bucket's
  `AllowedOrigins` too.
