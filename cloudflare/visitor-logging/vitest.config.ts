import {
  cloudflareTest,
  readD1Migrations
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");

  return {
    plugins: [
      cloudflareTest({
        wrangler: {
          configPath: "./wrangler.jsonc"
        },
        miniflare: {
          compatibilityDate: "2026-08-05",
          d1Databases: {
            DB: "visitor-logging-test"
          }
        }
      })
    ],
    test: {
      provide: {
        migrations
      },
      setupFiles: ["./test/apply-migrations.ts"]
    }
  };
});
