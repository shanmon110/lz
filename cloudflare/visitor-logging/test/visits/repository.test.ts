import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

import { insertVisit } from "../../src/visits/repository";
import type { VisitInput } from "../../src/visits/types";

function createVisit(overrides: Partial<VisitInput> = {}): VisitInput {
  return {
    visitedAtUtc: "2026-08-06T00:00:00.000Z",
    ipAddress: "203.0.113.7",
    method: "GET",
    host: "lizhe.link",
    path: "/about/",
    queryString: "",
    referrer: "",
    userAgent: "Mozilla/5.0",
    browserSummary: "Chrome on macOS",
    country: null,
    region: null,
    city: null,
    asn: null,
    colo: null,
    cfRay: null,
    isSuspectedBot: false,
    ...overrides
  };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM visits").run();
});

test("insertVisit persists a complete visit row", async () => {
  await insertVisit(env.DB, createVisit());

  const row = await env.DB.prepare(
    "SELECT visited_at_utc, ip_address, method, host, path, query_string, referrer, user_agent, browser_summary, is_suspected_bot FROM visits"
  ).first<Record<string, unknown>>();

  expect(row).toEqual({
    visited_at_utc: "2026-08-06T00:00:00.000Z",
    ip_address: "203.0.113.7",
    method: "GET",
    host: "lizhe.link",
    path: "/about/",
    query_string: "",
    referrer: "",
    user_agent: "Mozilla/5.0",
    browser_summary: "Chrome on macOS",
    is_suspected_bot: 0
  });
});

test("insertVisit persists every approved nullable Cloudflare field", async () => {
  await insertVisit(
    env.DB,
    createVisit({
      country: "HK",
      region: "Hong Kong",
      city: "Hong Kong",
      asn: 13335,
      colo: "HKG",
      cfRay: "8abcdef012345678-HKG",
      isSuspectedBot: true
    })
  );

  const row = await env.DB.prepare(
    "SELECT country, region, city, asn, colo, cf_ray, is_suspected_bot FROM visits"
  ).first<Record<string, unknown>>();

  expect(row).toEqual({
    country: "HK",
    region: "Hong Kong",
    city: "Hong Kong",
    asn: 13335,
    colo: "HKG",
    cf_ray: "8abcdef012345678-HKG",
    is_suspected_bot: 1
  });
});

test("insertVisit preserves data containing SQL syntax through bound values", async () => {
  const path = "/quote'); DROP TABLE visits; --";

  await insertVisit(env.DB, createVisit({ path }));

  const row = await env.DB.prepare("SELECT path FROM visits").first<{ path: string }>();
  expect(row).toEqual({ path });
});
