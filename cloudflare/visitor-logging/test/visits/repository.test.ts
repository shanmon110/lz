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
    asOrganization: null,
    continent: null,
    timezone: null,
    httpProtocol: null,
    tlsVersion: null,
    clientTcpRttMs: null,
    acceptLanguage: null,
    secFetchSite: null,
    cfBotScore: null,
    cfVerifiedBot: null,
    cfCorporateProxy: null,
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

test("insertVisit persists every approved nullable Cloudflare intelligence field", async () => {
  await insertVisit(
    env.DB,
    createVisit({
      country: "HK",
      region: "Hong Kong",
      city: "Hong Kong",
      asn: 13335,
      colo: "HKG",
      cfRay: "8abcdef012345678-HKG",
      asOrganization: "Cloudflare, Inc.",
      continent: "AS",
      timezone: "Asia/Hong_Kong",
      httpProtocol: "HTTP/3",
      tlsVersion: "TLSv1.3",
      clientTcpRttMs: 24,
      acceptLanguage: "en-HK,en;q=0.9",
      secFetchSite: "same-origin",
      cfBotScore: 98,
      cfVerifiedBot: false,
      cfCorporateProxy: true,
      isSuspectedBot: true
    })
  );

  const row = await env.DB.prepare(
    `SELECT country, region, city, asn, colo, cf_ray, as_organization, continent, timezone,
      http_protocol, tls_version, client_tcp_rtt_ms, accept_language, sec_fetch_site,
      cf_bot_score, cf_verified_bot, cf_corporate_proxy, is_suspected_bot FROM visits`
  ).first<Record<string, unknown>>();

  expect(row).toEqual({
    country: "HK",
    region: "Hong Kong",
    city: "Hong Kong",
    asn: 13335,
    colo: "HKG",
    cf_ray: "8abcdef012345678-HKG",
    as_organization: "Cloudflare, Inc.",
    continent: "AS",
    timezone: "Asia/Hong_Kong",
    http_protocol: "HTTP/3",
    tls_version: "TLSv1.3",
    client_tcp_rtt_ms: 24,
    accept_language: "en-HK,en;q=0.9",
    sec_fetch_site: "same-origin",
    cf_bot_score: 98,
    cf_verified_bot: 0,
    cf_corporate_proxy: 1,
    is_suspected_bot: 1
  });
});

test("insertVisit binds null intelligence fields", async () => {
  await insertVisit(env.DB, createVisit());

  const row = await env.DB.prepare(
    `SELECT as_organization, continent, timezone, http_protocol, tls_version, client_tcp_rtt_ms,
      accept_language, sec_fetch_site, cf_bot_score, cf_verified_bot, cf_corporate_proxy FROM visits`
  ).first<Record<string, unknown>>();

  expect(row).toEqual({
    as_organization: null,
    continent: null,
    timezone: null,
    http_protocol: null,
    tls_version: null,
    client_tcp_rtt_ms: null,
    accept_language: null,
    sec_fetch_site: null,
    cf_bot_score: null,
    cf_verified_bot: null,
    cf_corporate_proxy: null
  });
});

test("insertVisit preserves data containing SQL syntax through bound values", async () => {
  const path = "/quote'); DROP TABLE visits; --";

  await insertVisit(env.DB, createVisit({ path }));

  const row = await env.DB.prepare("SELECT path FROM visits").first<{ path: string }>();
  expect(row).toEqual({ path });
});
