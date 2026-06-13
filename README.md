# Updrift

A lightweight, self-hosted **feature-voting board** that runs entirely on the **Cloudflare free tier** — and stays there. Visitors browse feature ideas, vote on them, and submit new ones; a maintainer moderates everything from a panel protected by Cloudflare Access. If you ever exceed the free limits, the app pauses until the daily reset — **you never get a bill** unless you consciously switch your account to Workers Paid.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Preclowski/updrift)

## Features

- **Public board** — a single flat list sorted by votes; in-progress and done items carry a colored badge, finished items sink to the bottom with a frozen vote counter.
- **Voting** — one click to vote, click again to retract. One vote per visitor per feature, enforced in the database (`UNIQUE(voter_id, feature_id)`), not in the UI.
- **Pre-moderation** — new submissions are invisible to the public until approved. The author sees their own card with an "awaiting approval" badge (and their automatic +1 vote); the admin gets a webhook ping that something is waiting.
- **Closed loop on rejections** — rejected ideas land in a collapsed, public, read-only "Closed / rejected" section together with the reject reason, so people see what was declined and why (and don't resubmit it).
- **Admin panel** (`/admin`) — moderation queue, status changes by buttons (planned → in progress → done, reject with reason), edit sloppy titles/descriptions, hide/show items without changing status, delete, sortable list (votes / newest / oldest), stats, settings.
- **Stats** (`/admin/stats`) — moderation queue size, features by status, total votes, top 10 by votes, submissions over the last 7/30 days. (Page-view analytics belong in free [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/), not in D1.)
- **Branding** (`/admin/settings`) — board title, logo URL, website link, accent color (with a color picker), webhook URL.
- **Webhook notifications** — plain JSON POSTs on `feature.submitted` / `feature.approved` / `feature.done`. No email anywhere. Failures are swallowed, a dead webhook never breaks a request.
- **Bot protection** — Cloudflare Turnstile (free) verified server-side on every submission and vote, plus per-IP rate limits on all write endpoints.
- **Anonymous but stable voter identity** — a signed (HMAC) long-lived cookie; IPs are only ever salted-hashed for rate-limit keys, never stored. Pluggable: see [Swapping anonymous identity for OAuth](#swapping-anonymous-identity-for-oauth).

### Tech

Hono on Cloudflare Workers · server-side rendered `hono/jsx` + HTMX (no React, no build step, no client framework) · D1 (SQLite) with raw prepared statements (no ORM) · `vote_count` denormalized and kept in sync by DB triggers in the same transaction as the vote insert · 1–2 D1 queries per request · vitest + `@cloudflare/vitest-pool-workers` running tests on real workerd.

## Local development

```sh
npm run setup   # npm install + apply D1 migrations locally + seed sample data
npm run dev     # wrangler dev → http://localhost:8787
```

Miniflare simulates D1 locally — zero cloud, zero cost. The public board is at `/`, the admin panel at `/admin` (locally authenticated via `DEV_ADMIN_EMAIL`).

`.dev.vars` holds local secrets (git-ignored; see `.dev.vars.example`):

| Variable | Purpose |
| --- | --- |
| `COOKIE_SECRET` | HMAC key signing the anonymous voter cookie |
| `IP_SALT` | Salt for hashing client IPs for rate-limit keys (raw IPs are never stored) |
| `TURNSTILE_SECRET` | Turnstile secret key (default: Cloudflare's always-pass test key) |
| `DEV_ADMIN_EMAIL` | Pretends Cloudflare Access authenticated this email on `/admin/*`. Honored **only on localhost** — setting it in production does nothing. |

`npm run setup` creates `.dev.vars` from the example automatically if it doesn't exist.

Other scripts: `npm test`, `npm run typecheck`, `npm run db:migrate`, `npm run db:seed`, `npm run types` (regenerate binding types after editing `wrangler.jsonc`).

## Deploying your own Updrift

You **don't fork this repo** to run your own board. Pick one of three paths:

### Option A — Deploy to Cloudflare button (easiest)

Click the button at the top. The setup flow:

1. **Clones the repo into your own GitHub/GitLab account** — a fresh copy, not a fork — and wires up Workers Builds, so every push to your copy redeploys automatically.
2. **Provisions the D1 database** declared in `wrangler.jsonc` and injects the generated `database_id` for you.
3. **Asks for configuration before deploying.** You'll be prompted for the public `TURNSTILE_SITE_KEY` var and the secrets listed in [.dev.vars.example](.dev.vars.example):
   - `COOKIE_SECRET`, `IP_SALT` — paste any long random strings (e.g. `openssl rand -hex 32`),
   - `TURNSTILE_SECRET` — your Turnstile secret key, or temporarily keep the always-pass test value and swap it later in the dashboard (Workers → Settings → Variables and Secrets),
   - `DEV_ADMIN_EMAIL` — **skip it.** It's a local-dev convenience and is ignored outside localhost anyway.
4. **Runs migrations on deploy** — the deploy command is pre-populated from this repo's `deploy:remote` script (`wrangler d1 migrations apply DB --remote && wrangler deploy`); just accept it.

**There is no default password.** Admin access doesn't use passwords at all: until you configure Cloudflare Access (step below), `/admin` simply returns 403 for everyone — the app fails closed, not open. Finish with the [post-deploy steps](#post-deploy-steps-required).

### Option B — Clone + CLI (no GitHub involved at all)

Deployment is just `wrangler` talking to your Cloudflare account — the git remote is irrelevant:

```sh
git clone git@github.com:Preclowski/updrift.git && cd updrift && npm install
npx wrangler d1 create updrift-db        # paste the returned database_id into wrangler.jsonc
npx wrangler secret put COOKIE_SECRET    # long random string
npx wrangler secret put IP_SALT          # long random string
npx wrangler secret put TURNSTILE_SECRET # from the Turnstile dashboard, see below
npm run deploy:remote                    # applies migrations remotely + wrangler deploy
```

### Option C — GitHub Actions auto-deploy (for your own copy)

The repo ships two workflows:

- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — typecheck + tests on every push/PR. Works out of the box.
- **Deploy** ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) — deploys to Cloudflare on every push to `main`. It is **dormant by default**: without credentials it skips gracefully, so contributors' pushes don't fail. To activate it on your copy, set in repo settings:
  - secret `CLOUDFLARE_API_TOKEN` — API token with the *Edit Cloudflare Workers* template plus D1 edit permission,
  - secret `CLOUDFLARE_ACCOUNT_ID`,
  - variable `D1_DATABASE_ID` — from `npx wrangler d1 create updrift-db` (the workflow injects it into `wrangler.jsonc` at deploy time, so the committed file keeps a placeholder).

  The workflow applies D1 migrations and then deploys.

### Post-deploy steps (required)

1. **Turnstile** — Cloudflare dashboard → Turnstile → *Add site* (type "Managed" is fine). Put the **site key** into `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY` and set the **secret key** via `npx wrangler secret put TURNSTILE_SECRET`. Until you do, the shipped test keys accept everyone (fine for trying it out, useless against bots).
2. **Cloudflare Access on `/admin/*`** — the app does **no login of its own**; it trusts the `Cf-Access-Authenticated-User-Email` header injected by Access. Without it, `/admin` is wide open:
   1. Zero Trust dashboard → **Access → Applications → Add application → Self-hosted** (free up to 50 users).
   2. Domain: your worker's domain, path: `admin` (covers `/admin/*`).
   3. Policy: *Allow* → *Emails* → your email. The default one-time-PIN login works immediately; Google/GitHub IdPs can be added in Zero Trust settings.

   With Access in place the header can't be spoofed (requests can't bypass Cloudflare's edge). The local `DEV_ADMIN_EMAIL` bypass is hard-coded to work only on localhost, so it cannot be abused in production.
3. **Settings** — open `/admin/settings`: board title, logo, accent color, and optionally a **webhook URL** to get pinged when a submission waits for moderation.

## Free tier: what happens at the limits

Workers Free (100K requests/day, 10 ms CPU), D1 Free (5M row reads / 100K row writes per day), Turnstile, and Cloudflare Access (≤50 users) all have hard quotas: hitting them means requests fail **until the daily reset — not a bill**. You only start paying if you deliberately upgrade to Workers Paid. The app is built to stay inside the quotas: denormalized vote counters (no `COUNT(*)` per page view), 1–2 D1 queries per request, no per-request KV writes, in-memory per-IP rate limits on all write endpoints.

## Swapping anonymous identity for OAuth

Voter identity is one pluggable function — `getVoterId(request, env)` in [src/identity.ts](src/identity.ts) — returning an opaque, stable `voter_id` string; nothing else in the app knows how identity works. For strong "one vote per account":

1. Add an OAuth flow (GitHub/Google), or put the whole site behind Cloudflare Access and read `Cf-Access-Authenticated-User-Email`.
2. In `getVoterId`, return a stable account-derived id (e.g. `github:<user-id>`) instead of the cookie id, and redirect unauthenticated users to login instead of letting them vote.
3. Existing anonymous votes keep working — they're just different `voter_id` values.

A step-by-step comment lives at the top of `src/identity.ts`.

## Project layout

```
.github/workflows/    CI (typecheck + tests) and optional auto-deploy
migrations/           D1 schema (incl. triggers keeping vote_count in sync)
seed.sql              sample data for local dev
src/index.tsx         public routes: board, closed list, submit + vote API
src/admin.tsx         /admin routes (behind Cloudflare Access)
src/identity.ts       pluggable voter identity (signed cookie; OAuth notes)
src/turnstile.ts      server-side Turnstile verification
src/rate-limit.ts     in-memory per-IP sliding window
src/webhook.ts        fire-and-forget webhook notifications
src/views/            hono/jsx SSR views (public board, admin, fragments)
test/                 vitest + @cloudflare/vitest-pool-workers (real workerd)
```
