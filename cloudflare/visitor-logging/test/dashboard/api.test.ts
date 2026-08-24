import { env } from "cloudflare:test";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey
} from "jose";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { handleDashboardRequest } from "../../src/dashboard/api";
import type { Env } from "../../src/env";
import { insertVisit } from "../../src/visits/repository";
import type { VisitInput } from "../../src/visits/types";

const TEAM_DOMAIN = "https://lizhe.cloudflareaccess.com";
const POLICY_AUD = "visitor-logging-dashboard";
const ADMIN_EMAIL = "lizheqlut@gmail.com";
const KEY_ID = "dashboard-api-test-key";
const NOW = new Date("2026-08-06T16:30:00.000Z");

let privateKey: CryptoKey;
let localKeySet: JWTVerifyGetKey;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(keyPair.publicKey);
  privateKey = keyPair.privateKey;
  localKeySet = createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "RS256", kid: KEY_ID, use: "sig" }]
  });
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM visits").run();
});

async function accessToken(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: ADMIN_EMAIL })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(TEAM_DOMAIN)
    .setAudience(POLICY_AUD)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 300)
    .sign(privateKey);
}

function dashboardEnv(DB: D1Database): Env {
  return {
    DB,
    PUBLIC_HOSTS: "lizhe.link,www.lizhe.link",
    ADMIN_HOST: "logs.lizhe.link",
    ADMIN_EMAIL,
    TEAM_DOMAIN,
    POLICY_AUD
  };
}

async function dashboardRequest(
  path: string,
  options: { DB?: D1Database; method?: string; token?: string } = {}
): Promise<Response> {
  const headers = options.token
    ? { "Cf-Access-Jwt-Assertion": options.token }
    : undefined;
  return handleDashboardRequest(
    new Request(`https://logs.lizhe.link${path}`, {
      headers,
      method: options.method
    }),
    dashboardEnv(options.DB ?? env.DB),
    { keySet: localKeySet, now: NOW }
  );
}

function createVisit(overrides: Partial<VisitInput> = {}): VisitInput {
  return {
    visitedAtUtc: "2026-08-06T16:00:00.000Z",
    ipAddress: "203.0.113.7",
    method: "GET",
    host: "lizhe.link",
    path: "/notes/default",
    queryString: "",
    referrer: "https://example.com/from",
    userAgent: "Mozilla/5.0",
    browserSummary: "Chrome on macOS",
    country: "HK",
    region: "Hong Kong",
    city: "Hong Kong",
    asn: 13335,
    colo: "HKG",
    cfRay: null,
    isSuspectedBot: false,
    ...overrides
  };
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
}

describe("Access gate", () => {
  test.each([
    ["GET", "/api/summary"],
    ["GET", "/api/visits"],
    ["GET", "/api/export.csv"],
    ["POST", "/api/visits"],
    ["GET", "/not-a-route"]
  ])("authenticates %s %s before touching D1", async (method, path) => {
    let prepareCalls = 0;
    const poisonDb = {
      prepare(): D1PreparedStatement {
        prepareCalls += 1;
        throw new Error("D1 must remain unreachable before authentication");
      }
    } as unknown as D1Database;

    const response = await dashboardRequest(path, { DB: poisonDb, method });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(prepareCalls).toBe(0);
    expectSecurityHeaders(response);
  });
});

test("returns JSON summary and visit pages from real D1", async () => {
  await insertVisit(env.DB, createVisit({ path: "/publications/" }));
  await insertVisit(
    env.DB,
    createVisit({ country: "US", path: "/talks/", visitedAtUtc: "2026-08-06T16:01:00.000Z" })
  );
  const token = await accessToken();

  const summary = await dashboardRequest("/api/summary", { token });
  expect(summary.status).toBe(200);
  expect(summary.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(await summary.json()).toEqual({
    today: { totalVisits: 2, distinctNetworkAddresses: 1 },
    sevenDays: { totalVisits: 2, distinctNetworkAddresses: 1 },
    thirtyDays: { totalVisits: 2, distinctNetworkAddresses: 1 }
  });
  expectSecurityHeaders(summary);

  const visits = await dashboardRequest("/api/visits?country=HK", { token });
  expect(visits.status).toBe(200);
  expect(visits.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(await visits.json()).toEqual({
    hasNext: false,
    items: [expect.objectContaining({ country: "HK", path: "/publications/" })],
    page: 1,
    pageSize: 50
  });
  expectSecurityHeaders(visits);
});

test("exports real D1 rows using the active filters independently of page", async () => {
  await insertVisit(env.DB, createVisit({ country: "HK", path: "/teaching/" }));
  await insertVisit(
    env.DB,
    createVisit({ country: "HK", isSuspectedBot: true, path: "/markdown/" })
  );
  await insertVisit(env.DB, createVisit({ country: "US", path: "/publications/" }));

  const response = await dashboardRequest(
    "/api/export.csv?country=HK&bots=only&page=2",
    { token: await accessToken() }
  );
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("Content-Disposition")).toBe(
    'attachment; filename="lizhe-visitor-logs-2026-08-07.csv"'
  );
  expect(body).toContain("/markdown/");
  expect(body).not.toContain("/teaching/");
  expect(body).not.toContain("/publications/");
  expectSecurityHeaders(response);
});

test.each(["/api/visits?page=0", "/api/export.csv?bots=invalid"])(
  "maps every dashboard filter error to the same non-sensitive 400 response for %s",
  async (path) => {
    const response = await dashboardRequest(path, { token: await accessToken() });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(await response.text()).toBe('{"error":"Invalid filters"}');
    expectSecurityHeaders(response);
  }
);

test("returns authenticated 405 and 404 responses without querying D1", async () => {
  let prepareCalls = 0;
  const poisonDb = {
    prepare(): D1PreparedStatement {
      prepareCalls += 1;
      throw new Error("routing responses must not query D1");
    }
  } as unknown as D1Database;
  const token = await accessToken();

  const unsupportedMethod = await dashboardRequest("/api/visits", {
    DB: poisonDb,
    method: "POST",
    token
  });
  expect(unsupportedMethod.status).toBe(405);
  expect(unsupportedMethod.headers.get("Allow")).toBe("GET");
  expect(await unsupportedMethod.text()).toBe('{"error":"Method Not Allowed"}');
  expectSecurityHeaders(unsupportedMethod);

  const unknownRoute = await dashboardRequest("/unknown", { DB: poisonDb, token });
  expect(unknownRoute.status).toBe(404);
  expect(await unknownRoute.text()).toBe('{"error":"Not Found"}');
  expectSecurityHeaders(unknownRoute);
  expect(prepareCalls).toBe(0);
});

test("returns a generic JSON 500 without exposing exception or SQL details", async () => {
  const leakingMessage = "SQLITE_ERROR near SELECT secret_token";
  const failingDb = {
    prepare(): D1PreparedStatement {
      throw new Error(leakingMessage);
    }
  } as unknown as D1Database;

  const response = await dashboardRequest("/api/visits", {
    DB: failingDb,
    token: await accessToken()
  });
  const body = await response.text();

  expect(response.status).toBe(500);
  expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
  expect(body).toBe('{"error":"Internal Server Error"}');
  expect(body).not.toContain(leakingMessage);
  expect(body).not.toContain("SELECT");
  expectSecurityHeaders(response);
});
