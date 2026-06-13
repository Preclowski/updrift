import { Hono } from "hono";
import { getVoterId, hashIp, type VoterIdentity } from "./identity";
import { verifyTurnstile } from "./turnstile";
import { rateLimit } from "./rate-limit";
import { sendWebhook } from "./webhook";
import {
  getBoardFeatures,
  getFeature,
  getRejectedFeatures,
  getSettings,
  VOTABLE_STATUSES,
} from "./db";
import { Layout } from "./views/layout";
import { Board, ClosedList, VoteControl } from "./views/board";
import { admin } from "./admin";

type AppEnv = {
  Bindings: Env;
  Variables: { voter: VoterIdentity };
};

const app = new Hono<AppEnv>();

/** Resolve the (anonymous) voter identity and persist a fresh cookie if minted. */
app.use("*", async (c, next) => {
  const voter = await getVoterId(c.req.raw, c.env);
  c.set("voter", voter);
  await next();
  if (voter.setCookie) c.header("Set-Cookie", voter.setCookie);
});

app.route("/admin", admin);

// ---------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------

app.get("/", async (c) => {
  // Two D1 reads total: settings + board features (free-tier friendly).
  const [settings, features] = await Promise.all([
    getSettings(c.env.DB),
    getBoardFeatures(c.env.DB, c.get("voter").voterId),
  ]);
  return c.html(
    <Layout settings={settings} siteKey={c.env.TURNSTILE_SITE_KEY}>
      <Board features={features} submitted={c.req.query("submitted") === "1"} />
    </Layout>,
  );
});

/** Lazy-loaded fragment for the collapsed "Closed / rejected" section. */
app.get("/closed", async (c) => {
  const features = await getRejectedFeatures(c.env.DB);
  return c.html(<ClosedList features={features} />);
});

// ---------------------------------------------------------------------------
// Write API (Turnstile + per-IP rate limits on everything that writes)
// ---------------------------------------------------------------------------

const clientIp = (c: { req: { header(name: string): string | undefined } }) =>
  c.req.header("CF-Connecting-IP") ?? "0.0.0.0";

app.post("/api/features", async (c) => {
  const ip = await hashIp(clientIp(c), c.env.IP_SALT);
  if (!rateLimit(`submit:${ip}`, 3, 60_000)) {
    return c.text("Too many submissions — try again in a minute.", 429);
  }

  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  if (title.length < 3 || title.length > 120 || description.length > 2000) {
    return c.text("Title must be 3–120 chars; description up to 2000.", 400);
  }

  const token = form.get("cf-turnstile-response");
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, typeof token === "string" ? token : null, clientIp(c)))) {
    return c.text("Bot check failed — please retry.", 400);
  }

  const voterId = c.get("voter").voterId;
  // Insert the feature and the author's automatic +1 vote atomically.
  // The votes trigger bumps vote_count, so the pending card shows 1 vote.
  const [inserted] = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO features (title, description, status, submitter_id) VALUES (?1, ?2, 'new', ?3) RETURNING id, title, vote_count",
    ).bind(title, description, voterId),
    c.env.DB.prepare(
      "INSERT INTO votes (feature_id, voter_id) VALUES (last_insert_rowid(), ?1)",
    ).bind(voterId),
  ]);
  const feature = inserted?.results?.[0] as { id: number; title: string; vote_count: number };

  // Notify the maintainer there is something to moderate (fire-and-forget).
  const settings = await getSettings(c.env.DB);
  c.executionCtx.waitUntil(
    sendWebhook(settings.webhook_url, "feature.submitted", { ...feature, vote_count: 1 }),
  );

  return c.redirect("/?submitted=1", 303);
});

app.post("/api/features/:id/vote", async (c) => {
  const ip = await hashIp(clientIp(c), c.env.IP_SALT);
  if (!rateLimit(`vote:${ip}`, 12, 60_000)) {
    return c.text("Slow down — too many votes per minute.", 429);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Not found", 404);

  const form = await c.req.formData().catch(() => null);
  const token = form?.get("cf-turnstile-response");
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, typeof token === "string" ? token : null, clientIp(c)))) {
    return c.text("Bot check failed — please retry.", 400);
  }

  // Query 1: load + validate the target feature.
  const feature = await getFeature(c.env.DB, id);
  if (!feature || feature.private === 1) return c.text("Not found", 404);
  if (!VOTABLE_STATUSES.includes(feature.status)) {
    // Voting is frozen for new/done/rejected — render the frozen counter.
    return c.html(<VoteControl feature={feature} hasVoted={false} />, 403);
  }

  // Query 2: the insert. The DB trigger increments vote_count in the same
  // transaction; ON CONFLICT DO NOTHING makes duplicates a clean no-op.
  const voterId = c.get("voter").voterId;
  const res = await c.env.DB.prepare(
    "INSERT INTO votes (feature_id, voter_id) VALUES (?1, ?2) ON CONFLICT (voter_id, feature_id) DO NOTHING",
  )
    .bind(id, voterId)
    .run();

  const voted = res.meta.changes > 0;
  const count = feature.vote_count + (voted ? 1 : 0);
  return c.html(
    <VoteControl feature={{ ...feature, vote_count: count }} hasVoted={true} />,
    voted ? 200 : 409, // 409 = this voter already voted
  );
});

app.delete("/api/features/:id/vote", async (c) => {
  const ip = await hashIp(clientIp(c), c.env.IP_SALT);
  if (!rateLimit(`vote:${ip}`, 12, 60_000)) {
    return c.text("Slow down — too many votes per minute.", 429);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Not found", 404);

  const feature = await getFeature(c.env.DB, id);
  if (!feature || feature.private === 1) return c.text("Not found", 404);
  if (!VOTABLE_STATUSES.includes(feature.status)) {
    // Counters on done/rejected items are frozen — no retracting either.
    return c.html(<VoteControl feature={feature} hasVoted={false} />, 403);
  }

  const res = await c.env.DB.prepare(
    "DELETE FROM votes WHERE feature_id = ?1 AND voter_id = ?2",
  )
    .bind(id, c.get("voter").voterId)
    .run();

  const removed = res.meta.changes > 0;
  const count = feature.vote_count - (removed ? 1 : 0);
  return c.html(
    <VoteControl feature={{ ...feature, vote_count: count }} hasVoted={false} />,
    removed ? 200 : 409,
  );
});

export default app;
