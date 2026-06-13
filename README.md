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
- **Bot protection** — per-IP rate limits on all write endpoints out of the box, plus optional Cloudflare Turnstile (free): paste your two Turnstile keys in `/admin/settings` and every vote and submission gets verified server-side.
- **Anonymous but stable voter identity** — a signed (HMAC) long-lived cookie; IPs are only ever salted-hashed for rate-limit keys, never stored.

### Tech

The backend is Hono running on Cloudflare Workers, talking to D1 (SQLite) through raw prepared statements — no ORM. Pages are rendered server-side with `hono/jsx`, and the only client-side moving part is HTMX swapping in HTML fragments after a vote; there is no React, no bundler, no build step. The vote counter is denormalized onto the feature row and kept in sync by database triggers in the same transaction as the vote insert, so a page view costs one or two D1 queries and never scans the votes table. Tests run on the real workerd runtime via vitest and `@cloudflare/vitest-pool-workers`.

## Local development

```sh
npm run setup   # npm install + apply D1 migrations locally + seed sample data
npm run dev     # wrangler dev → http://localhost:8787
```

Miniflare simulates D1 locally — zero cloud, zero cost. The public board is at `/`, the admin panel at `/admin` (locally authenticated via `DEV_ADMIN_EMAIL`).

**There are no secrets to configure.** The voter-cookie signing key and the IP-hash salt are random strings nobody should have to invent — the app generates them on the first request and stores them in D1. Turnstile keys live in `/admin/settings`. The only local variable is `DEV_ADMIN_EMAIL` in `.dev.vars` (created from `.dev.vars.example` by `npm run setup`): it fakes the Cloudflare Access identity on `/admin/*`, and is honored **only on localhost**, so it can't open `/admin` in production.

Other scripts: `npm test`, `npm run typecheck`, `npm run db:migrate`, `npm run db:seed`, `npm run types` (regenerate binding types after editing `wrangler.jsonc`).

## Deploying your own Updrift

You **don't fork this repo** to run your own board. Pick one of two paths:

### Option A — Deploy to Cloudflare button (easiest)

Click the button at the top and accept the defaults — there is nothing to fill in. The flow clones the repo **into your own GitHub/GitLab account** (a fresh copy, not a fork), provisions the D1 database, runs the schema migrations as part of the pre-filled deploy command, and wires up Workers Builds so every push to your copy redeploys. If it offers to set `DEV_ADMIN_EMAIL`, skip it — that's a local-dev variable, ignored in production.

**There are no secrets and no default password.** Internal keys generate themselves on first request, and admin access doesn't use passwords at all: until you configure Cloudflare Access (step below), `/admin` returns 403 for everyone — the app fails closed, not open. Finish with the [post-deploy steps](#post-deploy-steps-required).

### Option B — Clone + CLI (no GitHub involved at all)

Deployment is just `wrangler` talking to your Cloudflare account — the git remote is irrelevant:

```sh
git clone git@github.com:Preclowski/updrift.git && cd updrift && npm install
npx wrangler d1 create updrift-db   # paste the returned database_id into wrangler.jsonc
npm run deploy                      # applies migrations remotely + wrangler deploy
```

No secrets to set here either.

### Post-deploy steps (required)

Everything below happens in the Cloudflare dashboard and the app's own admin panel — no files, no CLI.

1. **Cloudflare Access on `/admin/*`** — the app does **no login of its own**; it trusts the `Cf-Access-Authenticated-User-Email` header injected by Access. Until you set this up, `/admin` returns 403 for everyone:
   1. Zero Trust dashboard → **Access → Applications → Add application → Self-hosted** (free up to 50 users).
   2. Domain: your worker's domain, path: `admin` (covers `/admin/*`).
   3. Policy: *Allow* → *Emails* → your email. The default one-time-PIN login works immediately; Google/GitHub IdPs can be added in Zero Trust settings.

   With Access in place the header can't be spoofed (requests can't bypass Cloudflare's edge). The local `DEV_ADMIN_EMAIL` bypass is hard-coded to work only on localhost, so it cannot be abused in production.
2. **Turnstile (recommended)** — Cloudflare dashboard → Turnstile → *Add site* (type "Managed" is fine), then paste the two generated keys into `/admin/settings` on your board. Done — votes and submissions are now bot-checked. Until then the board works fine, but only rate limiting stands between you and bots.
3. **Branding** — also in `/admin/settings`: board title, logo, accent color, and optionally a **webhook URL** to get pinged when a submission waits for moderation.

## Updating your instance

The repo copy the deploy button created is standalone — it has no link back to this repo, so GitHub won't offer a "Sync fork" button. To pull in a new Updrift version:

```sh
git clone git@github.com:YOU/your-updrift-copy.git && cd your-updrift-copy
git remote add upstream https://github.com/Preclowski/updrift.git
git fetch upstream
git merge upstream/main
git push
```

The push triggers Workers Builds, which redeploys and applies any new database migrations automatically (they're part of the deploy command). Your data and settings live in D1 and are untouched by redeploys.

To force a redeploy without any new code — e.g. after changing build settings — either hit **Retry build** on the latest build in the dashboard (Workers & Pages → your worker → Builds), or push an empty commit:

```sh
git commit --allow-empty -m "redeploy" && git push
```

If you deployed via CLI instead, updating is just `git pull && npm run deploy`.

## Free tier: what happens at the limits

Workers Free (100K requests/day, 10 ms CPU), D1 Free (5M row reads / 100K row writes per day), Turnstile, and Cloudflare Access (≤50 users) all have hard quotas: hitting them means requests fail **until the daily reset — not a bill**. You only start paying if you deliberately upgrade to Workers Paid. The app is built to stay inside the quotas: denormalized vote counters (no `COUNT(*)` per page view), 1–2 D1 queries per request, no per-request KV writes, in-memory per-IP rate limits on all write endpoints.

