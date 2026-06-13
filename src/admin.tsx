import { Hono } from "hono";
import { getFeature, getSettings, type FeatureRow, type FeatureStatus } from "./db";
import { sendWebhook } from "./webhook";
import {
  AdminBoard,
  AdminFeatureRow,
  AdminLayout,
  AdminSettings,
  AdminStats,
  type Stats,
} from "./views/admin-views";

type AdminEnv = {
  Bindings: Env;
  Variables: { adminEmail: string };
};

export const admin = new Hono<AdminEnv>();

/**
 * Auth: this app NEVER does its own login. In production, Cloudflare Access
 * (Zero Trust, free up to 50 users) must protect /admin/* — the edge verifies
 * the user and forwards the identity in Cf-Access-Authenticated-User-Email.
 * Locally, set DEV_ADMIN_EMAIL in .dev.vars to impersonate an admin — it is
 * only honored on localhost, so even if someone sets it as a production
 * secret (e.g. during the Deploy to Cloudflare flow) it cannot open /admin.
 * If neither is present we fail closed.
 */
admin.use("*", async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  const isLocalDev = hostname === "localhost" || hostname === "127.0.0.1";
  const email =
    c.req.header("Cf-Access-Authenticated-User-Email") ??
    (isLocalDev ? (c.env as { DEV_ADMIN_EMAIL?: string }).DEV_ADMIN_EMAIL : undefined);
  if (!email) {
    return c.text(
      "Forbidden. /admin must sit behind Cloudflare Access (or set DEV_ADMIN_EMAIL in .dev.vars for local dev).",
      403,
    );
  }
  c.set("adminEmail", email);
  await next();
});

const SORT_ORDERS = {
  votes: "vote_count DESC, created_at DESC",
  newest: "created_at DESC",
  oldest: "created_at ASC",
} as const;
type SortKey = keyof typeof SORT_ORDERS;

admin.get("/", async (c) => {
  const sort: SortKey = c.req.query("sort") === "newest" ? "newest" : c.req.query("sort") === "oldest" ? "oldest" : "votes";
  const [settings, features] = await Promise.all([
    getSettings(c.env.DB),
    c.env.DB.prepare(
      // The moderation queue always floats to the top; the rest follows the chosen sort.
      `SELECT * FROM features
       ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, ${SORT_ORDERS[sort]}`,
    )
      .all<FeatureRow>()
      .then((r) => r.results),
  ]);
  return c.html(
    <AdminLayout email={c.get("adminEmail")} accent={settings.accent_color}>
      <AdminBoard features={features} sort={sort} />
    </AdminLayout>,
  );
});

const ADMIN_SETTABLE: FeatureStatus[] = ["approved", "in_progress", "done", "rejected"];

admin.post("/features/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.formData();
  const status = String(form.get("status") ?? "") as FeatureStatus;
  const reason = String(form.get("reject_reason") ?? "").trim() || null;
  if (!ADMIN_SETTABLE.includes(status)) return c.text("Invalid status", 400);

  const before = await getFeature(c.env.DB, id);
  if (!before) return c.text("Not found", 404);

  await c.env.DB.prepare(
    `UPDATE features
     SET status = ?1,
         reject_reason = CASE WHEN ?1 = 'rejected' THEN ?2 ELSE NULL END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?3`,
  )
    .bind(status, reason, id)
    .run();

  // Webhooks: approval out of the moderation queue, and shipping a feature.
  const event =
    before.status === "new" && status === "approved"
      ? ("feature.approved" as const)
      : status === "done" && before.status !== "done"
        ? ("feature.done" as const)
        : null;
  if (event) {
    const settings = await getSettings(c.env.DB);
    c.executionCtx.waitUntil(sendWebhook(settings.webhook_url, event, before));
  }

  return c.redirect("/admin", 303);
});

admin.post("/features/:id/private", async (c) => {
  const res = await c.env.DB.prepare(
    "UPDATE features SET private = 1 - private, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
  )
    .bind(Number(c.req.param("id")))
    .run();
  if (res.meta.changes === 0) return c.text("Not found", 404);
  return c.redirect("/admin", 303);
});

/** Edit title/description (tidying up sloppy submissions). Returns the row fragment for htmx. */
admin.patch("/features/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  if (title.length < 3 || title.length > 120 || description.length > 2000) {
    return c.text("Title must be 3–120 chars; description up to 2000.", 400);
  }
  await c.env.DB.prepare(
    "UPDATE features SET title = ?1, description = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?3",
  )
    .bind(title, description, id)
    .run();
  const feature = await getFeature(c.env.DB, id);
  if (!feature) return c.text("Not found", 404);
  return c.html(<AdminFeatureRow feature={feature} />);
});

/** Delete a feature; votes go with it via ON DELETE CASCADE. */
admin.delete("/features/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM features WHERE id = ?1")
    .bind(Number(c.req.param("id")))
    .run();
  return c.body("", 200); // empty body + outerHTML swap removes the row
});

admin.get("/settings", async (c) => {
  const settings = await getSettings(c.env.DB);
  return c.html(
    <AdminLayout email={c.get("adminEmail")} accent={settings.accent_color}>
      <AdminSettings settings={settings} saved={c.req.query("saved") === "1"} />
    </AdminLayout>,
  );
});

admin.post("/settings", async (c) => {
  const form = await c.req.formData();
  const field = (name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);
  await c.env.DB.prepare(
    `UPDATE settings SET title = ?1, logo_url = ?2, website_url = ?3, accent_color = ?4, webhook_url = ?5 WHERE id = 1`,
  )
    .bind(
      field("title", 80) || "Updrift",
      field("logo_url", 500),
      field("website_url", 500),
      field("accent_color", 40) || "#6366f1",
      field("webhook_url", 500),
    )
    .run();
  return c.redirect("/admin/settings?saved=1", 303);
});

admin.get("/stats", async (c) => {
  // Three small aggregate queries in one batch; total votes is derived from
  // the denormalized counters so the votes table is never scanned.
  const cutoff = (days: number) => `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${days} days')`;
  const [byStatus, top, recent] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT status, COUNT(*) AS n, SUM(vote_count) AS votes FROM features GROUP BY status",
    ),
    c.env.DB.prepare(
      "SELECT id, title, vote_count FROM features ORDER BY vote_count DESC, created_at DESC LIMIT 10",
    ),
    c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN created_at >= ${cutoff(7)} THEN 1 ELSE 0 END) AS last7,
         SUM(CASE WHEN created_at >= ${cutoff(30)} THEN 1 ELSE 0 END) AS last30
       FROM features`,
    ),
  ]);

  const statusRows = (byStatus?.results ?? []) as { status: string; n: number; votes: number | null }[];
  const recentRow = (recent?.results?.[0] ?? {}) as { last7: number | null; last30: number | null };
  const stats: Stats = {
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
    totalVotes: statusRows.reduce((sum, r) => sum + (r.votes ?? 0), 0),
    top: (top?.results ?? []) as Stats["top"],
    last7: recentRow.last7 ?? 0,
    last30: recentRow.last30 ?? 0,
  };

  const settings = await getSettings(c.env.DB);
  return c.html(
    <AdminLayout email={c.get("adminEmail")} accent={settings.accent_color}>
      <AdminStats stats={stats} />
    </AdminLayout>,
  );
});
