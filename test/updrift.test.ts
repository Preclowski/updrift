import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVoterId } from "../src/identity";
import { resetRateLimits } from "../src/rate-limit";
import { ensureSecrets } from "../src/secrets";
import { getSettings } from "../src/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(async () => {
  resetRateLimits();
  // Turnstile is configured at runtime via settings; enable it for the suite.
  await env.DB.prepare(
    "UPDATE settings SET turnstile_site_key = 'test-site-key', turnstile_secret = 'test-turnstile-secret' WHERE id = 1",
  ).run();
  // The worker runs in the same isolate as the tests, so mocking the global
  // fetch intercepts its outbound subrequests (Turnstile siteverify).
  // Convention: token "good" verifies, anything else fails.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.origin === "https://challenges.cloudflare.com" && url.pathname === "/turnstile/v0/siteverify") {
      const body = new URLSearchParams(await request.text());
      return Response.json({ success: body.get("response") === "good" });
    }
    throw new Error(`Unexpected outbound fetch in test: ${request.url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

let ipCounter = 0;

/** Mint a signed anonymous voter cookie, exactly like the worker does. */
async function mintVoter(): Promise<{ cookie: string; voterId: string }> {
  const { voterId, setCookie } = await getVoterId(new Request("http://test/"), {
    COOKIE_SECRET: "test-cookie-secret",
  });
  return { cookie: setCookie!.split(";")[0]!, voterId };
}

async function createFeature(
  status: string,
  opts: { title?: string; submitterId?: string; isPrivate?: boolean } = {},
): Promise<number> {
  const res = await env.DB.prepare(
    "INSERT INTO features (title, description, status, submitter_id, private) VALUES (?1, 'desc', ?2, ?3, ?4) RETURNING id",
  )
    .bind(opts.title ?? `Feature ${status}`, status, opts.submitterId ?? "someone", opts.isPrivate ? 1 : 0)
    .first<{ id: number }>();
  return res!.id;
}

function vote(
  id: number,
  cookie: string,
  { token = "good", ip, method = "POST" }: { token?: string | null; ip?: string; method?: string } = {},
): Promise<Response> {
  return SELF.fetch(`http://test/api/features/${id}/vote`, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": ip ?? `10.0.0.${++ipCounter % 250}`,
    },
    body: token ? new URLSearchParams({ "cf-turnstile-response": token }) : undefined,
  });
}

function submit(
  cookie: string,
  fields: Record<string, string>,
  ip?: string,
): Promise<Response> {
  return SELF.fetch("http://test/api/features", {
    method: "POST",
    redirect: "manual",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": ip ?? `10.1.0.${++ipCounter % 250}`,
    },
    body: new URLSearchParams({ "cf-turnstile-response": "good", ...fields }),
  });
}

async function voteCountInDb(id: number): Promise<{ denormalized: number; actual: number }> {
  const row = await env.DB.prepare(
    "SELECT vote_count AS denormalized, (SELECT COUNT(*) FROM votes WHERE feature_id = ?1) AS actual FROM features WHERE id = ?1",
  )
    .bind(id)
    .first<{ denormalized: number; actual: number }>();
  return row!;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

describe("voting", () => {
  it("counts the first vote, ignores a duplicate from the same voter", async () => {
    const id = await createFeature("approved");
    const voter = await mintVoter();

    const first = await vote(id, voter.cookie);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("<strong>1</strong>");

    const second = await vote(id, voter.cookie);
    expect(second.status).toBe(409);
    expect(await second.text()).toContain("<strong>1</strong>");

    const counts = await voteCountInDb(id);
    expect(counts.denormalized).toBe(1);
    expect(counts.actual).toBe(1);
  });

  it("keeps vote_count consistent with the votes table across vote/unvote", async () => {
    const id = await createFeature("in_progress");
    const a = await mintVoter();
    const b = await mintVoter();

    await vote(id, a.cookie);
    await vote(id, b.cookie);
    await vote(id, b.cookie); // duplicate, must not inflate the counter
    expect(await voteCountInDb(id)).toEqual({ denormalized: 2, actual: 2 });

    const unvote = await vote(id, a.cookie, { method: "DELETE", token: null });
    expect(unvote.status).toBe(200);
    expect(await voteCountInDb(id)).toEqual({ denormalized: 1, actual: 1 });
  });

  it.each(["new", "done", "rejected"])("rejects votes on %s features", async (status) => {
    const id = await createFeature(status);
    const voter = await mintVoter();
    const res = await vote(id, voter.cookie);
    expect(res.status).toBe(403);
    expect((await voteCountInDb(id)).actual).toBe(0);
  });

  it("rejects votes on private features", async () => {
    const id = await createFeature("approved", { isPrivate: true });
    const voter = await mintVoter();
    expect((await vote(id, voter.cookie)).status).toBe(404);
  });

  it("rejects a missing or invalid Turnstile token", async () => {
    const id = await createFeature("approved");
    const voter = await mintVoter();

    const missing = await vote(id, voter.cookie, { token: null });
    expect(missing.status).toBe(400);

    const invalid = await vote(id, voter.cookie, { token: "forged" });
    expect(invalid.status).toBe(400);

    expect((await voteCountInDb(id)).actual).toBe(0);
  });

  it("accepts votes without a token when Turnstile is not configured", async () => {
    await env.DB.prepare(
      "UPDATE settings SET turnstile_site_key = '', turnstile_secret = '' WHERE id = 1",
    ).run();
    const id = await createFeature("approved");
    const voter = await mintVoter();
    const res = await vote(id, voter.cookie, { token: null });
    expect(res.status).toBe(200);
    expect((await voteCountInDb(id)).actual).toBe(1);
  });

  it("rate limits repeated votes from one IP", async () => {
    const id = await createFeature("approved");
    const ip = "192.0.2.77";
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      const voter = await mintVoter(); // fresh voter each time → no 409s
      const res = await vote(id, voter.cookie, { ip });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0); // limit is 12/min
  });
});

// ---------------------------------------------------------------------------
// Submission & moderation
// ---------------------------------------------------------------------------

describe("submission", () => {
  it("creates a pending feature with the author's auto +1 vote", async () => {
    const author = await mintVoter();
    const res = await submit(author.cookie, { title: "My new idea", description: "details" });
    expect(res.status).toBe(303);

    const row = await env.DB.prepare(
      "SELECT id, status, submitter_id, vote_count FROM features WHERE title = 'My new idea'",
    ).first<{ id: number; status: string; submitter_id: string; vote_count: number }>();
    expect(row).toMatchObject({ status: "new", submitter_id: author.voterId, vote_count: 1 });
    expect((await voteCountInDb(row!.id)).actual).toBe(1);
  });

  it("shows the pending item to its author but not to others", async () => {
    const author = await mintVoter();
    const stranger = await mintVoter();
    await submit(author.cookie, { title: "Secret pending idea" });

    const authorView = await SELF.fetch("http://test/", { headers: { Cookie: author.cookie } });
    expect(await authorView.text()).toContain("Secret pending idea");

    const strangerView = await SELF.fetch("http://test/", { headers: { Cookie: stranger.cookie } });
    expect(await strangerView.text()).not.toContain("Secret pending idea");
  });

  it("rejects an invalid Turnstile token on submission", async () => {
    const author = await mintVoter();
    const res = await submit(author.cookie, { title: "Bot idea", "cf-turnstile-response": "bad" });
    expect(res.status).toBe(400);
  });

  it("validates title length", async () => {
    const author = await mintVoter();
    expect((await submit(author.cookie, { title: "ab" })).status).toBe(400);
    expect((await submit(author.cookie, { title: "x".repeat(121) })).status).toBe(400);
  });

  it("rate limits submissions from one IP", async () => {
    const ip = "192.0.2.99";
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const author = await mintVoter();
      statuses.push((await submit(author.cookie, { title: `Spam idea ${i}` }, ip)).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0); // limit is 3/min
  });
});

describe("runtime secrets", () => {
  it("generates and persists the cookie key and IP salt on first use", async () => {
    const first = await ensureSecrets(env.DB, await getSettings(env.DB), {});
    expect(first.cookieSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(first.ipSalt).toMatch(/^[0-9a-f]{64}$/);
    // Stable on subsequent requests — read back from D1, not regenerated.
    const again = await ensureSecrets(env.DB, await getSettings(env.DB), {});
    expect(again).toEqual(first);
  });

  it("prefers explicit env overrides", async () => {
    const s = await ensureSecrets(env.DB, await getSettings(env.DB), {
      COOKIE_SECRET: "env-cookie",
      IP_SALT: "env-salt",
    });
    expect(s).toEqual({ cookieSecret: "env-cookie", ipSalt: "env-salt" });
  });
});

describe("moderation", () => {
  const adminHeaders = { "Cf-Access-Authenticated-User-Email": "admin@example.com" };

  it("requires an authenticated admin identity", async () => {
    const res = await SELF.fetch("http://test/admin");
    expect(res.status).toBe(403);
  });

  it("approve keeps the author's vote and makes the feature public", async () => {
    const author = await mintVoter();
    await submit(author.cookie, { title: "Approve me please" });
    const row = await env.DB.prepare("SELECT id FROM features WHERE title = 'Approve me please'").first<{ id: number }>();

    const res = await SELF.fetch(`http://test/admin/features/${row!.id}/status`, {
      method: "POST",
      redirect: "manual",
      headers: { ...adminHeaders, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: "approved" }),
    });
    expect(res.status).toBe(303);

    const after = await env.DB.prepare("SELECT status, vote_count FROM features WHERE id = ?1")
      .bind(row!.id)
      .first<{ status: string; vote_count: number }>();
    expect(after).toEqual({ status: "approved", vote_count: 1 });

    const publicView = await SELF.fetch("http://test/");
    expect(await publicView.text()).toContain("Approve me please");
  });

  it("reject stores the reason; the item leaves the board and shows up in /closed", async () => {
    const author = await mintVoter();
    await submit(author.cookie, { title: "Reject me kindly" });
    const row = await env.DB.prepare("SELECT id FROM features WHERE title = 'Reject me kindly'").first<{ id: number }>();

    await SELF.fetch(`http://test/admin/features/${row!.id}/status`, {
      method: "POST",
      redirect: "manual",
      headers: { ...adminHeaders, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: "rejected", reject_reason: "Out of scope, sorry" }),
    });

    const stranger = await mintVoter();
    const board = await SELF.fetch("http://test/", { headers: { Cookie: stranger.cookie } });
    expect(await board.text()).not.toContain("Reject me kindly");

    const closed = await SELF.fetch("http://test/closed");
    const closedHtml = await closed.text();
    expect(closedHtml).toContain("Reject me kindly");
    expect(closedHtml).toContain("Out of scope, sorry");
  });

  it("delete removes the feature and its votes", async () => {
    const id = await createFeature("approved");
    const voter = await mintVoter();
    await vote(id, voter.cookie);

    const res = await SELF.fetch(`http://test/admin/features/${id}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    expect(res.status).toBe(200);

    const votesLeft = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE feature_id = ?1")
      .bind(id)
      .first<{ n: number }>();
    expect(votesLeft!.n).toBe(0);
  });
});
