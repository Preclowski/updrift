import type { Child } from "hono/jsx";
import type { SettingsRow } from "../db";

const CSS = `
:root { --accent: #6366f1; }
* { box-sizing: border-box; }
body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 0; background: #f6f7f9; color: #1a1d23; }
a { color: var(--accent); }
.topbar { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 0.8rem 1.2rem; display: flex; align-items: center; gap: 0.7rem; }
.topbar img.logo { height: 28px; }
.topbar h1 { font-size: 1.1rem; margin: 0; }
.topbar .spacer { flex: 1; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 1.2rem; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 0.8rem 0.9rem; margin-bottom: 0.7rem; display: flex; gap: 0.8rem; }
.card .body { flex: 1; min-width: 0; }
.card h3 { margin: 0 0 0.25rem; font-size: 0.95rem; }
.card p { margin: 0; font-size: 0.85rem; color: #4b5563; white-space: pre-wrap; }
.badge { display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: #fef3c7; color: #92400e; margin-left: 0.4rem; vertical-align: middle; }
.badge.rejected { background: #fee2e2; color: #991b1b; }
.badge.progress { background: #dbeafe; color: #1e40af; }
.badge.done { background: #d1fae5; color: #065f46; }
.vote-btn, .vote-frozen { min-width: 3rem; height: fit-content; display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0.5rem; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; font-size: 0.8rem; }
.vote-btn { cursor: pointer; }
.vote-btn:hover { border-color: var(--accent); }
.vote-btn[data-voted="1"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.vote-frozen { background: #f3f4f6; color: #6b7280; }
.vote-arrow { font-size: 0.7rem; }
.submit-box, .closed-box { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1rem; margin-bottom: 1.2rem; }
.submit-box input[type=text], .submit-box textarea, .reject-form input { width: 100%; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; margin-bottom: 0.6rem; }
button.primary { background: var(--accent); color: #fff; border: 0; padding: 0.5rem 1rem; border-radius: 6px; font: inherit; cursor: pointer; }
.flash { background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; padding: 0.6rem 0.9rem; border-radius: 8px; margin-bottom: 1rem; }
details.closed-toggle > summary { cursor: pointer; color: #6b7280; font-size: 0.9rem; }
.muted { color: #6b7280; font-size: 0.8rem; }
.reject-reason { font-size: 0.8rem; color: #991b1b; margin-top: 0.3rem; }
`;

export function Layout(props: {
  settings: SettingsRow;
  siteKey: string;
  children: Child;
}) {
  const { settings, siteKey } = props;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{settings.title}</title>
        <style>{CSS}</style>
        {settings.accent_color ? (
          <style>{`:root { --accent: ${sanitizeColor(settings.accent_color)}; }`}</style>
        ) : null}
        <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=tsInit&render=explicit"
          async
          defer
        ></script>
      </head>
      <body>
        <header class="topbar">
          {settings.logo_url ? <img class="logo" src={settings.logo_url} alt="" /> : null}
          <h1>
            {settings.website_url ? (
              <a href={settings.website_url} style="text-decoration:none;color:inherit">
                {settings.title}
              </a>
            ) : (
              settings.title
            )}
          </h1>
          <div class="spacer"></div>
        </header>
        <main class="wrap">{props.children}</main>
        {/* Invisible Turnstile widget, executed on demand before each vote. */}
        <div id="ts-vote"></div>
        <script
          dangerouslySetInnerHTML={{ __html: clientJs(siteKey) }}
        ></script>
      </body>
    </html>
  );
}

/** Allow only safe CSS color literals from settings (it ends up inside a <style> tag). */
export function sanitizeColor(value: string): string {
  return /^[#a-zA-Z0-9(),.% -]{1,40}$/.test(value) ? value : "#6366f1";
}

function clientJs(siteKey: string): string {
  return `
var tsWidget = null, tsToken = null, tsWaiting = null;
function tsInit() {
  tsWidget = turnstile.render('#ts-vote', {
    sitekey: ${JSON.stringify(siteKey)},
    execution: 'execute',
    appearance: 'interaction-only',
    callback: function (token) {
      tsToken = token;
      if (tsWaiting) { var go = tsWaiting; tsWaiting = null; go(); }
    }
  });
  // Visible widget inside the submission form (adds its own hidden response field).
  var formSlot = document.getElementById('ts-form');
  if (formSlot) turnstile.render(formSlot, { sitekey: ${JSON.stringify(siteKey)} });
}
// Gate vote POSTs on a fresh Turnstile token (htmx async-confirm pattern).
document.body.addEventListener('htmx:confirm', function (e) {
  var el = e.detail.elt;
  if (!el.matches || !el.matches('[data-needs-token]')) return;
  if (tsToken) return; // already have an unused token
  e.preventDefault();
  tsWaiting = function () { e.detail.issueRequest(true); };
  if (tsWidget !== null) turnstile.execute(tsWidget);
});
document.body.addEventListener('htmx:configRequest', function (e) {
  if (e.detail.elt.matches && e.detail.elt.matches('[data-needs-token]') && tsToken) {
    e.detail.parameters['cf-turnstile-response'] = tsToken;
    tsToken = null; // tokens are single-use
    if (tsWidget !== null) turnstile.reset(tsWidget);
  }
});
// Swap server-rendered fragments even on 4xx (already voted, frozen, rate limited).
document.body.addEventListener('htmx:beforeSwap', function (e) {
  if (e.detail.xhr.status >= 400 && e.detail.xhr.status < 500) e.detail.shouldSwap = true;
});
`;
}
