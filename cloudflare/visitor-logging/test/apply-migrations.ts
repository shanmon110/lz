import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    migrations: D1Migration[];
  }
}

export async function applyMigrations(): Promise<void> {
  await applyD1Migrations(env.DB, inject("migrations"));
}

await applyMigrations();
