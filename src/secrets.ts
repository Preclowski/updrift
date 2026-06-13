import type { SettingsRow } from "./db";

/**
 * Runtime secrets that nobody should have to configure.
 *
 * The voter-cookie HMAC key and the IP-hash salt are random strings with no
 * meaning to the operator, so requiring them at deploy time is pure friction
 * (and a guaranteed 500 when skipped). Instead they are generated once on the
 * first request and persisted in the settings row. Env vars COOKIE_SECRET /
 * IP_SALT still win if present, for anyone who wants explicit control.
 */
export interface RuntimeSecrets {
  cookieSecret: string;
  ipSalt: string;
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureSecrets(
  db: D1Database,
  settings: SettingsRow,
  env: { COOKIE_SECRET?: string; IP_SALT?: string },
): Promise<RuntimeSecrets> {
  if (env.COOKIE_SECRET && env.IP_SALT) {
    return { cookieSecret: env.COOKIE_SECRET, ipSalt: env.IP_SALT };
  }
  if (settings.cookie_secret && settings.ip_salt) {
    return { cookieSecret: settings.cookie_secret, ipSalt: settings.ip_salt };
  }
  // First request ever: mint both and persist. COALESCE keeps whichever value
  // a concurrent request may have written first, then we read the winner back.
  await db
    .prepare(
      "UPDATE settings SET cookie_secret = COALESCE(cookie_secret, ?1), ip_salt = COALESCE(ip_salt, ?2) WHERE id = 1",
    )
    .bind(randomSecret(), randomSecret())
    .run();
  const row = await db
    .prepare("SELECT cookie_secret, ip_salt FROM settings WHERE id = 1")
    .first<{ cookie_secret: string; ip_salt: string }>();
  if (!row?.cookie_secret || !row.ip_salt) throw new Error("failed to persist runtime secrets");
  settings.cookie_secret = row.cookie_secret;
  settings.ip_salt = row.ip_salt;
  return { cookieSecret: row.cookie_secret, ipSalt: row.ip_salt };
}
