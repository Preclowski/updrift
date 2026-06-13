/**
 * Pluggable voter identity.
 *
 * Default implementation: anonymous, no login.
 * - A random 128-bit id stored in a long-lived cookie, signed with HMAC-SHA256
 *   (COOKIE_SECRET) so clients cannot forge or mint ids by hand-editing.
 * - Raw IPs are never stored anywhere; the IP is only hashed (with IP_SALT)
 *   for rate-limiting keys — see hashIp().
 * - Uniqueness is enforced in D1 via UNIQUE(voter_id, feature_id); hiding the
 *   vote button client-side is pure UX, the server never trusts it.
 *
 * ── How to swap this for OAuth (GitHub/Google) for a strong one-vote-per-account ──
 * Replace the body of getVoterId() so that it:
 *   1. Reads your session (e.g. a session cookie issued after the OAuth callback,
 *      or — if you put the whole site behind Cloudflare Access — simply the
 *      `Cf-Access-Authenticated-User-Email` header).
 *   2. Returns a stable id derived from the account, e.g. `github:1234567`
 *      or `email:<sha256(email)>`. Keep it stable across logins.
 *   3. Returns `null` cookie (no anonymous cookie needed) and have callers
 *      redirect unauthenticated users to the login flow instead of voting.
 * Nothing else changes: votes/features only ever see the opaque voter_id string.
 */

const COOKIE_NAME = "updrift_voter";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2; // 2 years

export interface VoterIdentity {
  voterId: string;
  /** Set-Cookie header value to attach to the response, if a new id was minted. */
  setCookie: string | null;
}

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return base64url(new Uint8Array(sig));
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function getVoterId(
  request: Request,
  env: { COOKIE_SECRET: string },
): Promise<VoterIdentity> {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (match?.[1]) {
    const [id, sig] = decodeURIComponent(match[1]).split(".");
    if (id && sig && timingSafeEqual(await hmac(env.COOKIE_SECRET, id), sig)) {
      return { voterId: id, setCookie: null };
    }
  }
  // Mint a fresh anonymous id and sign it.
  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  const id = base64url(raw);
  const sig = await hmac(env.COOKIE_SECRET, id);
  const setCookie =
    `${COOKIE_NAME}=${encodeURIComponent(`${id}.${sig}`)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax; Secure`;
  return { voterId: id, setCookie };
}

/** Salted SHA-256 of the client IP — used only as a rate-limit key, never stored. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${ip}`));
  return base64url(new Uint8Array(digest));
}
