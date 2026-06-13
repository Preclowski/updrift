import type { Child } from "hono/jsx";
import type { FeatureRow, SettingsRow } from "../db";
import { STATUS_LABELS } from "./board";
import { sanitizeColor } from "./layout";

const CSS = `
:root { --accent: #6366f1; }
* { box-sizing: border-box; }
body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1a1d23; }
.topbar { background: #111827; color: #fff; padding: 0.7rem 1.2rem; display: flex; gap: 1.2rem; align-items: center; }
.topbar a { color: #d1d5db; text-decoration: none; font-size: 0.9rem; }
.topbar a:hover { color: #fff; }
.topbar .who { margin-left: auto; font-size: 0.8rem; color: #9ca3af; }
.wrap { max-width: 950px; margin: 0 auto; padding: 1.2rem; }
h2 { font-size: 1rem; margin: 1.6rem 0 0.6rem; }
.admin-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.8rem 1rem; margin-bottom: 0.6rem; }
.admin-card.hidden-item { opacity: 0.55; border-style: dashed; }
.admin-card h3 { margin: 0; font-size: 0.95rem; display: flex; align-items: center; gap: 0.5rem; }
.admin-card .desc { font-size: 0.85rem; color: #4b5563; margin: 0.3rem 0 0.5rem; white-space: pre-wrap; }
.admin-card .meta { font-size: 0.75rem; color: #6b7280; margin-bottom: 0.5rem; }
.actions { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
.actions form { display: inline-flex; gap: 0.3rem; margin: 0; }
button { font: inherit; font-size: 0.8rem; padding: 0.3rem 0.7rem; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: #b91c1c; border-color: #fca5a5; }
input[type=text], input[type=url], textarea { font: inherit; font-size: 0.85rem; padding: 0.35rem 0.5rem; border: 1px solid #d1d5db; border-radius: 6px; }
.pill { font-size: 0.7rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: #e5e7eb; color: #374151; }
.votes { font-weight: 600; font-size: 0.85rem; }
.settings-form label, .edit-form label { display: block; font-size: 0.8rem; color: #4b5563; margin: 0.7rem 0 0.2rem; }
.settings-form input, .settings-form textarea, .edit-form input, .edit-form textarea { width: 100%; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.8rem; }
.stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.9rem; }
.stat .n { font-size: 1.6rem; font-weight: 700; }
.stat .label { font-size: 0.8rem; color: #6b7280; }
table.compact { border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; min-width: 320px; }
table.compact td { text-align: left; padding: 0.45rem 0.9rem; border-bottom: 1px solid #f3f4f6; font-size: 0.85rem; }
table.compact td.num { width: 1%; white-space: nowrap; text-align: right; color: #374151; }
.muted { color: #6b7280; font-size: 0.85rem; }
.sortbar { font-size: 0.85rem; color: #6b7280; margin-bottom: 0.4rem; }
.sortbar a { color: #6b7280; text-decoration: none; margin-left: 0.5rem; padding: 0.15rem 0.5rem; border-radius: 6px; }
.sortbar a.active { background: var(--accent); color: #fff; }
.reject-form { margin-left: auto; padding-left: 0.6rem; border-left: 1px solid #e5e7eb; }
`;

export function AdminLayout(props: { email: string; accent: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Updrift admin</title>
        <style>{CSS}</style>
        <style>{`:root { --accent: ${sanitizeColor(props.accent)}; }`}</style>
        <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
      </head>
      <body>
        <header class="topbar">
          <strong>Updrift admin</strong>
          <a href="/admin">Moderation</a>
          <a href="/admin/stats">Stats</a>
          <a href="/admin/settings">Settings</a>
          <a href="/">Public board ↗</a>
          <span class="who">{props.email}</span>
        </header>
        <main class="wrap">{props.children}</main>
      </body>
    </html>
  );
}

function StatusForm(props: { id: number; status: string; label: string; primary?: boolean }) {
  return (
    <form method="post" action={`/admin/features/${props.id}/status`}>
      <input type="hidden" name="status" value={props.status} />
      <button class={props.primary ? "primary" : ""} type="submit">
        {props.label}
      </button>
    </form>
  );
}

export function AdminFeatureRow(props: { feature: FeatureRow }) {
  const f = props.feature;
  return (
    <div class={`admin-card${f.private ? " hidden-item" : ""}`} id={`feature-${f.id}`}>
      <h3>
        {f.title}
        <span class="pill">{STATUS_LABELS[f.status]}</span>
        {f.private ? <span class="pill">hidden</span> : null}
        <span class="votes" style="margin-left:auto">
          ▲ {f.vote_count}
        </span>
      </h3>
      {f.description ? <p class="desc">{f.description}</p> : null}
      <div class="meta">
        #{f.id} · submitted {f.created_at.slice(0, 10)} · updated {f.updated_at.slice(0, 10)}
        {f.reject_reason ? <> · reject reason: “{f.reject_reason}”</> : null}
      </div>
      <div class="actions">
        {f.status === "new" ? <StatusForm id={f.id} status="approved" label="Approve" primary /> : null}
        {f.status === "approved" ? <StatusForm id={f.id} status="in_progress" label="Start progress" /> : null}
        {f.status === "in_progress" ? <StatusForm id={f.id} status="done" label="Mark done" primary /> : null}
        {f.status === "in_progress" ? <StatusForm id={f.id} status="approved" label="Back to planned" /> : null}
        {f.status === "done" ? <StatusForm id={f.id} status="approved" label="Reopen" /> : null}
        {f.status === "rejected" ? <StatusForm id={f.id} status="approved" label="Approve after all" /> : null}
        {f.status !== "rejected" && f.status !== "done" ? (
          <form method="post" action={`/admin/features/${f.id}/status`} class="reject-form">
            <input type="hidden" name="status" value="rejected" />
            <input type="text" name="reject_reason" placeholder="Reason (optional)" maxlength={500} />
            <button class="danger" type="submit">
              Reject
            </button>
          </form>
        ) : null}
        <form method="post" action={`/admin/features/${f.id}/private`}>
          <button type="submit">{f.private ? "Unhide" : "Hide"}</button>
        </form>
        <button
          class="danger"
          hx-delete={`/admin/features/${f.id}`}
          hx-target={`#feature-${f.id}`}
          hx-swap="outerHTML"
          hx-confirm={`Delete “${f.title}” and all its votes?`}
        >
          Delete
        </button>
      </div>
      <details style="margin-top:0.5rem">
        <summary class="muted" style="cursor:pointer">
          Edit title / description
        </summary>
        <form
          class="edit-form"
          hx-patch={`/admin/features/${f.id}`}
          hx-target={`#feature-${f.id}`}
          hx-swap="outerHTML"
        >
          <label>Title</label>
          <input type="text" name="title" value={f.title} required minlength={3} maxlength={120} />
          <label>Description</label>
          <textarea name="description" rows={3} maxlength={2000}>
            {f.description}
          </textarea>
          <div style="margin-top:0.5rem">
            <button class="primary" type="submit">
              Save
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

export function AdminBoard(props: { features: FeatureRow[]; sort: "votes" | "newest" | "oldest" }) {
  const queue = props.features.filter((f) => f.status === "new");
  const groups = (["approved", "in_progress", "done", "rejected"] as const).map((status) => ({
    status,
    items: props.features.filter((f) => f.status === status),
  }));
  return (
    <>
      <div class="sortbar">
        Sort:{" "}
        {(["votes", "newest", "oldest"] as const).map((key) => (
          <a href={`/admin?sort=${key}`} class={props.sort === key ? "active" : ""}>
            {key}
          </a>
        ))}
      </div>
      <h2>
        Moderation queue {queue.length > 0 ? <span class="pill">{queue.length} waiting</span> : null}
      </h2>
      {queue.length === 0 ? <p class="muted">Nothing waiting for review. ✨</p> : null}
      {queue.map((f) => (
        <AdminFeatureRow feature={f} />
      ))}
      {groups.map(({ status, items }) =>
        items.length === 0 ? null : (
          <>
            <h2>{STATUS_LABELS[status]}</h2>
            {items.map((f) => (
              <AdminFeatureRow feature={f} />
            ))}
          </>
        ),
      )}
    </>
  );
}

export function AdminSettings(props: { settings: SettingsRow; saved: boolean }) {
  const s = props.settings;
  return (
    <>
      <h2>Settings</h2>
      {props.saved ? <p style="color:#065f46">Saved.</p> : null}
      <form class="settings-form admin-card" method="post" action="/admin/settings">
        <label>Board title</label>
        <input type="text" name="title" value={s.title} required maxlength={80} />
        <label>Logo URL (plain URL, no upload)</label>
        <input type="url" name="logo_url" value={s.logo_url} maxlength={500} placeholder="https://…/logo.png" />
        <label>Website URL (title links here)</label>
        <input type="url" name="website_url" value={s.website_url} maxlength={500} />
        <label>Accent color</label>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <input
            type="color"
            id="accent-picker"
            value={/^#[0-9a-fA-F]{6}$/.test(s.accent_color) ? s.accent_color : "#6366f1"}
            style="width:2.6rem;height:2rem;padding:0.1rem;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer"
            oninput="document.getElementById('accent-text').value = this.value"
          />
          <input
            type="text"
            id="accent-text"
            name="accent_color"
            value={s.accent_color}
            maxlength={40}
            style="flex:1;margin:0"
            oninput="if (/^#[0-9a-fA-F]{6}$/.test(this.value)) document.getElementById('accent-picker').value = this.value"
          />
        </div>
        <label>Webhook URL (POSTed JSON on new submissions / approvals; empty = off)</label>
        <input type="url" name="webhook_url" value={s.webhook_url} maxlength={500} />
        <div style="margin-top:0.8rem">
          <button class="primary" type="submit">
            Save settings
          </button>
        </div>
      </form>
    </>
  );
}

export interface Stats {
  byStatus: Record<string, number>;
  totalVotes: number;
  top: { id: number; title: string; vote_count: number }[];
  last7: number;
  last30: number;
}

export function AdminStats(props: { stats: Stats }) {
  const s = props.stats;
  const pending = s.byStatus["new"] ?? 0;
  return (
    <>
      <h2>Stats</h2>
      <div class="stats-grid">
        <div class="stat">
          <div class="n">{pending}</div>
          <div class="label">waiting for moderation</div>
        </div>
        <div class="stat">
          <div class="n">{s.totalVotes}</div>
          <div class="label">total votes</div>
        </div>
        <div class="stat">
          <div class="n">{s.last7}</div>
          <div class="label">submissions, last 7 days</div>
        </div>
        <div class="stat">
          <div class="n">{s.last30}</div>
          <div class="label">submissions, last 30 days</div>
        </div>
      </div>
      <h2>Features by status</h2>
      <table class="compact">
        {Object.entries(s.byStatus).map(([status, n]) => (
          <tr>
            <td>{STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}</td>
            <td class="num">{n}</td>
          </tr>
        ))}
      </table>
      <h2>Top features by votes</h2>
      <table class="compact">
        {s.top.map((f, i) => (
          <tr>
            <td class="num">{i + 1}.</td>
            <td>{f.title}</td>
            <td class="num">▲ {f.vote_count}</td>
          </tr>
        ))}
      </table>
      <p class="muted">
        Page-view traffic is not tracked here — enable free Cloudflare Web Analytics for that.
      </p>
    </>
  );
}
