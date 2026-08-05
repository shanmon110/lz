import { SELF, createExecutionContext } from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";

function dispatchEnv(DB: D1Database): Env {
  return {
    DB,
    PUBLIC_HOSTS: "lizhe.link,www.lizhe.link",
    ADMIN_HOST: "logs.lizhe.link",
    ADMIN_EMAIL: "lizheqlut@gmail.com",
    TEAM_DOMAIN: "https://lizhe.cloudflareaccess.com",
    POLICY_AUD: "visitor-logging-dashboard"
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("returns 404 for an unknown host", async () => {
  const response = await SELF.fetch("https://unknown.example");

  expect(response.status).toBe(404);
});

test.each(["lizhe.link", "www.lizhe.link"])(
  "dispatches %s through the public origin path",
  async (host) => {
    const originFetch = vi.fn(async () => new Response(`origin:${host}`, { status: 202 }));
    vi.stubGlobal("fetch", originFetch);

    const response = await worker.fetch(
      new Request(`https://${host}/asset.txt`, { headers: { Accept: "text/plain" } }),
      dispatchEnv({} as D1Database),
      createExecutionContext()
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe(`origin:${host}`);
    expect(originFetch).toHaveBeenCalledOnce();
  }
);

test("dispatches logs.lizhe.link through authentication before D1", async () => {
  let prepareCalls = 0;
  const poisonDb = {
    prepare(): D1PreparedStatement {
      prepareCalls += 1;
      throw new Error("admin dispatch touched D1 before authentication");
    }
  } as unknown as D1Database;

  const response = await worker.fetch(
    new Request("https://logs.lizhe.link/unknown"),
    dispatchEnv(poisonDb),
    createExecutionContext()
  );

  expect(response.status).toBe(403);
  expect(await response.text()).toBe("Forbidden");
  expect(prepareCalls).toBe(0);
});
