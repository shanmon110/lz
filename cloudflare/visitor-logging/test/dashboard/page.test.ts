import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey
} from "jose";
import { beforeAll, describe, expect, test } from "vitest";

import { handleDashboardRequest } from "../../src/dashboard/api";
import type { Env } from "../../src/env";

const TEAM_DOMAIN = "https://lizhe.cloudflareaccess.com";
const POLICY_AUD = "visitor-logging-dashboard";
const ADMIN_EMAIL = "lizheqlut@gmail.com";
const KEY_ID = "dashboard-page-test-key";
const EXPECTED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'";

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

function dashboardEnv(): Env {
  return {
    DB: {} as D1Database,
    PUBLIC_HOSTS: "lizhe.link,www.lizhe.link",
    ADMIN_HOST: "logs.lizhe.link",
    ADMIN_EMAIL,
    TEAM_DOMAIN,
    POLICY_AUD
  };
}

async function accessToken(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  return new SignJWT({ email: ADMIN_EMAIL })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(TEAM_DOMAIN)
    .setAudience(POLICY_AUD)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 300)
    .sign(privateKey);
}

async function dashboardRequest(path: string): Promise<Response> {
  return handleDashboardRequest(
    new Request(`https://logs.lizhe.link${path}`, {
      headers: { "Cf-Access-Jwt-Assertion": await accessToken() }
    }),
    dashboardEnv(),
    { keySet: localKeySet }
  );
}

test("serves an accessible dashboard shell with external assets and all controls", async () => {
  const response = await dashboardRequest("/");
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(html).toContain('<link rel="stylesheet" href="/app.css">');
  expect(html).toContain('<script src="/app.js" defer></script>');
  expect(html).not.toMatch(/<style(?:\s|>)/i);
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);

  expect(html).toContain('<main id="main-content">');
  expect(html).toContain("Visitor logs");
  expect(html).toContain("Today");
  expect(html).toContain("Last 7 days");
  expect(html).toContain("Last 30 days");
  expect(html.match(/Distinct network addresses/g)).toHaveLength(3);

  for (const label of [
    "From date",
    "To date",
    "IP address",
    "Country code",
    "Path contains",
    "Include suspected bots"
  ]) {
    expect(html).toContain(label);
  }
  for (const heading of [
    "Time (Hong Kong)",
    "IP address",
    "Location",
    "Path",
    "Referrer",
    "Browser / device",
    "Bot"
  ]) {
    expect(html).toContain(`<th scope="col">${heading}</th>`);
  }

  expect(html).toContain('aria-label="Visit pagination"');
  expect(html).toContain('id="previous-page"');
  expect(html).toContain('id="next-page"');
  expect(html).toContain('id="export-link" href="/api/export.csv?bots=exclude"');
});

test("uses a strict same-origin CSP and disables storage for the dashboard shell", async () => {
  const response = await dashboardRequest("/");
  const csp = response.headers.get("Content-Security-Policy");

  expect(csp).toBe(EXPECTED_CSP);
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toMatch(/https?:/);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test.each([
  ["/app.css", "text/css; charset=utf-8"],
  ["/app.js", "text/javascript; charset=utf-8"]
])("serves %s with its exact type, strict CSP, and no-store", async (path, contentType) => {
  const response = await dashboardRequest(path);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe(contentType);
  expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("the browser asset fetches same-origin APIs and renders visit values through textContent", async () => {
  const response = await dashboardRequest("/app.js");
  const script = await response.text();

  expect(script).toContain('credentials: "same-origin"');
  expect(script).toContain("document.createElement");
  expect(script).toContain("textContent");
  expect(script).not.toContain("innerHTML");
  expect(script).toContain("/api/summary");
  expect(script).toContain("/api/visits");
});

describe("dashboard presentation helpers", () => {
  test("formats an instant as a fixed Hong Kong timestamp", async () => {
    const { formatHongKongTimestamp } = await import("../../src/dashboard/page");

    expect(formatHongKongTimestamp("2026-08-06T16:30:05.000Z")).toBe(
      "2026-08-07 00:30:05 HKT"
    );
  });

  test.each([null, undefined, ""])(
    "renders the empty value %s as an em dash",
    async (value) => {
      const { formatDashboardValue } = await import("../../src/dashboard/page");

      expect(formatDashboardValue(value)).toBe("—");
    }
  );

  test("changes page while preserving active filters", async () => {
    const { buildPaginationUrl } = await import("../../src/dashboard/page");

    expect(
      buildPaginationUrl(
        "?from=2026-08-01&to=2026-08-06&country=HK&path=%2Fnotes&bots=include&page=3",
        2
      )
    ).toBe(
      "/?from=2026-08-01&to=2026-08-06&country=HK&path=%2Fnotes&bots=include&page=2"
    );
  });

  test("turns suspected bots on or off and returns to the first page", async () => {
    const { buildBotToggleUrl } = await import("../../src/dashboard/page");

    expect(buildBotToggleUrl("?country=HK&page=8", true)).toBe(
      "/?country=HK&bots=include&page=1"
    );
    expect(
      buildBotToggleUrl("?country=HK&bots=include&page=8", false)
    ).toBe("/?country=HK&bots=exclude&page=1");
  });

  test("builds a CSV URL from filters without carrying pagination or unknown parameters", async () => {
    const { buildCsvUrl } = await import("../../src/dashboard/page");

    expect(
      buildCsvUrl(
        "?from=2026-08-01&to=2026-08-06&ip=203.0.113.7&country=HK&path=%2Fnotes&bots=only&page=9&debug=true"
      )
    ).toBe(
      "/api/export.csv?from=2026-08-01&to=2026-08-06&ip=203.0.113.7&country=HK&path=%2Fnotes&bots=only"
    );
  });
});
