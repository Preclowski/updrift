# Updrift

A lightweight, self-hosted **feature-voting board**. Visitors browse feature ideas, vote on them, and submit new ones; submissions go through a moderation queue before they appear publicly, and a maintainer manages everything from an admin panel protected by Cloudflare Access.

The whole thing is built to run on the **Cloudflare free tier** — and stay there. Hosting your own board costs nothing, and if you ever exceed the free limits, the app simply pauses until the daily reset: **you never get a bill** unless you consciously switch your account to Workers Paid.

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
- **Anonymous but stable voter identity** — a signed (HMAC) long-lived cookie; IPs are only ever salted-hashed for rate-limit keys, never stored.

### Tech

The backend is Hono running on Cloudflare Workers, talking to D1 (SQLite) through raw prepared statements — no ORM. Pages are rendered server-side with `hono/jsx`, and the only client-side moving part is HTMX swapping in HTML fragments after a vote; there is no React, no bundler, no build step. The vote counter is denormalized onto the feature row and kept in sync by database triggers in the same transaction as the vote insert, so a page view costs one or two D1 queries and never scans the votes table. Tests run on the real workerd runtime via vitest and `@cloudflare/vitest-pool-workers`.

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

You **don't fork this repo** to run your own board. Pick one of two paths:

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
npx wrangler secret put TURNSTILE_SECRET # real key, or the test value from .dev.vars.example for now
npm run deploy:remote                    # applies migrations remotely + wrangler deploy
```

Same deal as the button flow: the always-pass Turnstile test secret works fine for trying things out, just swap in a real key before sharing the board (see post-deploy steps).

### Post-deploy steps (required)

1. **Turnstile** — Cloudflare dashboard → Turnstile → *Add site* (type "Managed" is fine). You get two keys; where to put them depends on how you deployed:
   - **Deploy button:** you set both during the setup flow. To change them later: the **secret key** lives in the dashboard (Workers & Pages → your worker → Settings → Variables and Secrets), and the **site key** in `wrangler.jsonc` in the repo copy Cloudflare created for you — edit it on GitHub, the push redeploys.
   - **CLI:** put the site key in `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY`, run `npx wrangler secret put TURNSTILE_SECRET`, deploy again.

   Until you use real keys, the shipped test keys accept everyone (fine for trying it out, useless against bots).
2. **Cloudflare Access on `/admin/*`** — the app does **no login of its own**; it trusts the `Cf-Access-Authenticated-User-Email` header injected by Access. Without it, `/admin` is wide open:
   1. Zero Trust dashboard → **Access → Applications → Add application → Self-hosted** (free up to 50 users).
   2. Domain: your worker's domain, path: `admin` (covers `/admin/*`).
   3. Policy: *Allow* → *Emails* → your email. The default one-time-PIN login works immediately; Google/GitHub IdPs can be added in Zero Trust settings.

   With Access in place the header can't be spoofed (requests can't bypass Cloudflare's edge). The local `DEV_ADMIN_EMAIL` bypass is hard-coded to work only on localhost, so it cannot be abused in production.
3. **Settings** — open `/admin/settings`: board title, logo, accent color, and optionally a **webhook URL** to get pinged when a submission waits for moderation.

## Free tier: what happens at the limits

Workers Free (100K requests/day, 10 ms CPU), D1 Free (5M row reads / 100K row writes per day), Turnstile, and Cloudflare Access (≤50 users) all have hard quotas: hitting them means requests fail **until the daily reset — not a bill**. You only start paying if you deliberately upgrade to Workers Paid. The app is built to stay inside the quotas: denormalized vote counters (no `COUNT(*)` per page view), 1–2 D1 queries per request, no per-request KV writes, in-memory per-IP rate limits on all write endpoints.

