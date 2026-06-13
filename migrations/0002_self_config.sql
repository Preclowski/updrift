-- Self-configuration: no deploy-time secrets required.
-- cookie_secret / ip_salt are auto-generated and persisted on first request;
-- Turnstile keys are pasted in /admin/settings (empty = bot protection off).
ALTER TABLE settings ADD COLUMN cookie_secret TEXT;
ALTER TABLE settings ADD COLUMN ip_salt TEXT;
ALTER TABLE settings ADD COLUMN turnstile_site_key TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN turnstile_secret TEXT NOT NULL DEFAULT '';
