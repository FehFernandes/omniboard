# Security policy

## Reporting a vulnerability

**Do not open a public issue** for a security flaw. An issue is visible to
everyone, including whoever would rather exploit the problem before it is fixed.

Use one of these private channels:

- **GitHub Security Advisories** (preferred): *Security* tab → *Report a
  vulnerability*. It stays private until a fix ships.
- **Email**: `seguranca@omniboard.app`

It helps a lot to include: what the flaw allows, how to reproduce it (steps or a
script), the version or commit you tested, and a suggested fix if you have one.

You get a reply within **72 hours** telling you whether we could reproduce it and
what the plan is. Fixing an exploitable flaw takes priority over any feature. When
the fix ships we credit you in the advisory — tell us if you prefer to stay
anonymous.

This project is maintained by volunteers: there is no bug bounty, and we are
equally grateful for responsible disclosure.

## Scope

We are especially interested in:

- **Isolation between accounts.** Any path that reads or modifies another user's
  data (IDOR). Every API query is scoped by the `user_id` from the token; a hole
  there is critical.
- **Public board links.** `GET /api/public/shares/:token` must return **only** the
  board for that token. Leaking another board, the owner's name or their email is a
  serious flaw.
- **Authentication and sessions.** Tokens, refresh, session revocation, 2FA.
- **Image uploads.** The API signs URLs for the bucket; a signature that allows
  writing outside the user's prefix (`u/<id>/`) is a serious flaw.
- **XSS in the canvas or the overlays.** Board content is user data: if any path
  executes script from it, we want to know.
- **Privilege escalation through billing.** Getting a paid plan without a matching
  payment.

Out of scope (but mention it if you think it matters):

- Missing rate limiting in a development environment — it is disabled on purpose
  when `ENV != production`.
- Automated scanner output with no demonstrated impact.
- Social engineering, volumetric DoS, and third-party infrastructure issues
  (Google, Stripe, Cloudflare).

## Known and accepted

Things that are **not** vulnerabilities because they are conscious, documented
decisions:

- **Images live in a public-read bucket**, under random keys
  (`u/<userId>/<uuid>.png`). Anyone with the exact URL can see the image. That is
  the price of a stable URL that the canvas `<img>` can load, since it cannot send
  an authentication header. The app's privacy policy states this.
- **A share link is a credential**: whoever has the address sees the board, with no
  account. The owner can revoke it at any time.
- **Anonymous boards live in the browser's `localStorage`**, unencrypted. Anyone
  with access to the machine can read them.

## Versions

The project is at `0.x`: fixes ship on `main`. There is no support branch for older
versions yet.
