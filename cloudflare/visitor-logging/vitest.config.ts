import {
  cloudflareTest,
  readD1Migrations
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc"
      },
      miniflare: {
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
});
