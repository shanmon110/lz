import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

import type { Env } from "../src/env";
import { handlePublicRequest } from "../src/public-handler";

function executionContext(): { ctx: ExecutionContext; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];

  return {
    ctx: {
      waitUntil(promise: Promise<unknown>): void {
        pending.push(promise);
      }
    } as ExecutionContext,
    pending
  };
}

function publicEnv(DB: D1Database): Env {
  return {
    DB,
    PUBLIC_HOSTS: "lizhe.link,www.lizhe.link",
    ADMIN_HOST: "logs.lizhe.link",
    ADMIN_EMAIL: "admin@lizhe.link",
    TEAM_DOMAIN: "lizhe.link",
    POLICY_AUD: "visitor-logging"
  };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM visits").run();
});

test("starts the origin before a document write and stores one privacy-safe visit", async () => {
  let originStarted = false;
  let writeStartedAfterOrigin = false;
  const observedDb = {
    prepare(query: string): D1PreparedStatement {
      writeStartedAfterOrigin = originStarted;
      return env.DB.prepare(query);
    }
  } as unknown as D1Database;
  const { ctx, pending } = executionContext();
  const inbound = new Request("https://lizhe.link/notes/fail-open?from=home", {
    headers: {
      Accept: "text/html",
      Authorization: "Bearer never-store-this",
      "CF-Connecting-IP": "203.0.113.19",
      Cookie: "session=never-store-this"
    }
  });

  const response = await handlePublicRequest(inbound, publicEnv(observedDb), ctx, async () => {
    originStarted = true;
    return new Response("origin document", {
      headers: { "Cache-Control": "private", "X-Origin": "unchanged" },
      status: 201
    });
  });

  expect(writeStartedAfterOrigin).toBe(true);
  expect(pending).toHaveLength(1);
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("private");
  expect(response.headers.get("X-Origin")).toBe("unchanged");
  expect(await response.text()).toBe("origin document");

  await Promise.all(pending);

  const rows = await env.DB.prepare("SELECT * FROM visits").all<Record<string, unknown>>();
  expect(rows.results).toHaveLength(1);
  expect(JSON.stringify(rows.results[0])).not.toContain("never-store-this");
});

test("records available request enrichment without changing the origin response", async () => {
  const { ctx, pending } = executionContext();
  const inbound = new Request("https://lizhe.link/publications?query-sentinel=value", {
    headers: {
      Accept: "text/html",
      "Accept-Language": "en-HK,en;q=0.9",
      "CF-Connecting-IP": "203.0.113.61",
      "Sec-Fetch-Site": "same-origin"
    }
  });
  Object.defineProperty(inbound, "cf", {
    value: {
      asOrganization: "Cloudflare, Inc.", continent: "AS", timezone: "Asia/Hong_Kong",
      httpProtocol: "HTTP/3", tlsVersion: "TLSv1.3", clientTcpRtt: 19,
      botManagement: { score: 99, verifiedBot: false, corporateProxy: true }
    }
  });

  const response = await handlePublicRequest(inbound, publicEnv(env.DB), ctx, async () => {
    return new Response("origin document", { headers: { "X-Origin": "unchanged" }, status: 201 });
  });
  await Promise.all(pending);

  expect(response.status).toBe(201);
  expect(response.headers.get("X-Origin")).toBe("unchanged");
  const row = await env.DB.prepare(
    `SELECT as_organization, continent, timezone, http_protocol, tls_version, client_tcp_rtt_ms,
      accept_language, sec_fetch_site, cf_bot_score, cf_verified_bot, cf_corporate_proxy FROM visits`
  ).first<Record<string, unknown>>();
  expect(row).toEqual({
    as_organization: "Cloudflare, Inc.", continent: "AS", timezone: "Asia/Hong_Kong",
    http_protocol: "HTTP/3", tls_version: "TLSv1.3", client_tcp_rtt_ms: 19,
    accept_language: "en-HK,en;q=0.9", sec_fetch_site: "same-origin",
    cf_bot_score: 99, cf_verified_bot: 0, cf_corporate_proxy: 1
  });
});

test("does not schedule an asset visit", async () => {
  const { ctx, pending } = executionContext();

  const response = await handlePublicRequest(
    new Request("https://lizhe.link/assets/site.css", { headers: { Accept: "text/css" } }),
    publicEnv(env.DB),
    ctx,
    async () => new Response("origin asset", { status: 200 })
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("origin asset");
  expect(pending).toHaveLength(0);

  const rows = await env.DB.prepare("SELECT id FROM visits").all();
  expect(rows.results).toHaveLength(0);
});

test("does not persist URL, form, or referrer credential sentinels", async () => {
  const { ctx, pending } = executionContext();
  const inbound = new Request(
    "https://lizhe.link/notes/privacy?access_token=access-token-sentinel&form_field=form-sentinel",
    {
      headers: {
        Accept: "text/html",
        "CF-Connecting-IP": "203.0.113.55",
        Referer: "https://userinfo-sentinel:password-sentinel@referrer.example/return?query-sentinel=value#fragment-sentinel"
      }
    }
  );

  await handlePublicRequest(inbound, publicEnv(env.DB), ctx, async () => new Response("origin"));
  await Promise.all(pending);

  const row = await env.DB.prepare("SELECT * FROM visits").first<Record<string, unknown>>();
  expect(row).not.toBeNull();
  const storedRow = JSON.stringify(row);
  for (const sentinel of [
    "access-token-sentinel",
    "form-sentinel",
    "userinfo-sentinel",
    "password-sentinel",
    "query-sentinel",
    "fragment-sentinel"
  ]) {
    expect(storedRow).not.toContain(sentinel);
  }
});

test("does not persist an exact Cloudflare internal path", async () => {
  const { ctx, pending } = executionContext();

  await handlePublicRequest(
    new Request("https://lizhe.link/cdn-cgi", {
      headers: { Accept: "text/html", "CF-Connecting-IP": "203.0.113.56" }
    }),
    publicEnv(env.DB),
    ctx,
    async () => new Response("origin")
  );
  await Promise.all(pending);

  const rows = await env.DB.prepare("SELECT id FROM visits").all();
  expect(rows.results).toHaveLength(0);
});

test("returns an unchanged origin response when D1 rejects the visit write", async () => {
  const rejectingDb = {
    prepare(): D1PreparedStatement {
      return {
        bind(): D1PreparedStatement {
          return this;
        },
        run: async () => Promise.reject(new Error("D1 unavailable"))
      } as D1PreparedStatement;
    }
  } as unknown as D1Database;
  const { ctx, pending } = executionContext();

  const response = await handlePublicRequest(
    new Request("https://lizhe.link/notes/fail-open", { headers: { Accept: "text/html" } }),
    publicEnv(rejectingDb),
    ctx,
    async () => new Response("origin survives", {
      headers: { Location: "/still-origin", "X-Origin": "yes" },
      status: 302
    })
  );

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/still-origin");
  expect(response.headers.get("X-Origin")).toBe("yes");
  expect(await response.text()).toBe("origin survives");
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
});

test("forwards a request body without cloning or consuming it", async () => {
  const inbound = new Request("https://lizhe.link/forms/contact", {
    body: "body belongs to origin",
    headers: { "Content-Type": "text/plain" },
    method: "POST"
  });
  Object.defineProperty(inbound, "clone", {
    value: () => {
      throw new Error("public handler must not clone inbound requests");
    }
  });
  const { ctx, pending } = executionContext();

  const response = await handlePublicRequest(inbound, publicEnv(env.DB), ctx, async (forwarded) => {
    return new Response(await forwarded.text(), { status: 202 });
  });

  expect(response.status).toBe(202);
  expect(await response.text()).toBe("body belongs to origin");
  expect(pending).toHaveLength(0);
});
