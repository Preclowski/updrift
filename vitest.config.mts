import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Env overrides so tests can mint voter cookies with a known key.
            COOKIE_SECRET: "test-cookie-secret",
            IP_SALT: "test-ip-salt",
            // Neutralize the .dev.vars admin bypass so auth tests fail closed.
            DEV_ADMIN_EMAIL: "",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
