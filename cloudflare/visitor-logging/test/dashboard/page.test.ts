import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey
} from "jose";
import { beforeAll, describe, expect, test, vi } from "vitest";

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

interface HarnessEvent {
  preventDefault(): void;
}

type HarnessListener = (event: HarnessEvent) => unknown;

class HarnessElement {
  readonly children: HarnessElement[] = [];
  checked = false;
  className = "";
  colSpan = 1;
  hidden = false;
  href = "";
  textContent = "";
  value = "";

  private readonly listeners = new Map<string, HarnessListener[]>();

  constructor(readonly tagName: string, readonly id = "") {}

  set innerHTML(_value: string) {
    throw new Error("The delivered dashboard must not write innerHTML");
  }

  append(...elements: HarnessElement[]): void {
    this.children.push(...elements);
  }

  replaceChildren(...elements: HarnessElement[]): void {
    this.children.splice(0, this.children.length, ...elements);
  }

  addEventListener(type: string, listener: HarnessListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type: string): Promise<boolean> {
    let defaultPrevented = false;
    const event: HarnessEvent = {
      preventDefault(): void {
        defaultPrevented = true;
      }
    };
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
    return defaultPrevented;
  }
}

class HarnessDocument {
  readonly createdTags: string[] = [];
  private readonly elements = new Map<string, HarnessElement>();

  constructor(html: string) {
    const elementPattern = /<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi;
    for (const match of html.matchAll(elementPattern)) {
      const [, tagName, attributes, id] = match;
      const element = new HarnessElement(tagName.toLowerCase(), id);
      element.hidden = /(?:^|\s)hidden(?:\s|=|$)/i.test(attributes);
      const href = /\bhref="([^"]*)"/i.exec(attributes)?.[1];
      if (href !== undefined) element.href = href;
      if (this.elements.has(id)) throw new Error(`Duplicate dashboard id: ${id}`);
      this.elements.set(id, element);
    }
  }

  getElementById(id: string): HarnessElement | null {
    return this.elements.get(id) ?? null;
  }

  element(id: string): HarnessElement {
    const element = this.getElementById(id);
    if (!element) throw new Error(`Missing dashboard element: ${id}`);
    return element;
  }

  createElement(tagName: string): HarnessElement {
    this.createdTags.push(tagName.toLowerCase());
    return new HarnessElement(tagName.toLowerCase());
  }
}

interface BrowserFetchCall {
  url: string;
  init: {
    credentials?: string;
    headers?: Record<string, string>;
  };
}

interface BrowserRuntime {
  assignedUrls: string[];
  document: HarnessDocument;
  fetchCalls: BrowserFetchCall[];
}

type BrowserResponder = (
  url: string,
  callIndex: number
) => Response | Promise<Response>;

async function executeServedDashboard(
  search: string,
  responder: BrowserResponder
): Promise<BrowserRuntime> {
  const [pageResponse, scriptResponse] = await Promise.all([
    dashboardRequest("/"),
    dashboardRequest("/app.js")
  ]);
  const document = new HarnessDocument(await pageResponse.text());
  const script = await scriptResponse.text();
  const assignedUrls: string[] = [];
  const fetchCalls: BrowserFetchCall[] = [];
  const window = {
    location: {
      search,
      assign(url: string): void {
        assignedUrls.push(url);
      }
    }
  };
  const browserFetch = async (
    url: string,
    init: BrowserFetchCall["init"] = {}
  ): Promise<Response> => {
    fetchCalls.push({ url, init });
    return responder(url, fetchCalls.length - 1);
  };

  const execute = new Function("window", "document", "fetch", script);
  execute(window, document, browserFetch);

  return { assignedUrls, document, fetchCalls };
}

const SUMMARY_RESPONSE = {
  today: { totalVisits: 3, distinctNetworkAddresses: 2 },
  sevenDays: { totalVisits: 17, distinctNetworkAddresses: 9 },
  thirtyDays: { totalVisits: 51, distinctNetworkAddresses: 23 }
};

const VISITS_RESPONSE = {
  hasNext: true,
  items: [
    {
      id: 91,
      visitedAtUtc: "2026-08-06T16:30:05.000Z",
      ipAddress: '<img src=x onerror="alert(1)">',
      method: "GET",
      host: "lizhe.link",
      path: "/notes/<script>alert(1)</script>",
      queryString: "q=<svg onload=alert(1)>",
      referrer: "https://example.com/<img>",
      userAgent: "Mozilla/5.0",
      browserSummary: "Browser <iframe>",
      country: "HK",
      region: "Hong Kong",
      city: "<b>Hong Kong</b>",
      asn: 13335,
      colo: "HKG",
      cfRay: "ray-91",
      isSuspectedBot: true
    }
  ],
  page: 3,
  pageSize: 50
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function successfulDashboardResponse(url: string): Response {
  return url === "/api/summary"
    ? jsonResponse(SUMMARY_RESPONSE)
    : jsonResponse(VISITS_RESPONSE);
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

describe("delivered browser program", () => {
  test("parses, starts against the delivered DOM, and renders complete API shapes safely", async () => {
    const runtime = await executeServedDashboard(
      "?from=2026-08-01&to=2026-08-06&ip=203.0.113&country=HK&path=%2Fnotes&bots=include&page=3&debug=true",
      successfulDashboardResponse
    );

    await vi.waitFor(() => {
      expect(runtime.document.element("visit-rows").children).toHaveLength(1);
    });

    expect(runtime.fetchCalls).toEqual([
      {
        url: "/api/summary",
        init: {
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        }
      },
      {
        url: "/api/visits?from=2026-08-01&to=2026-08-06&ip=203.0.113&country=HK&path=%2Fnotes&bots=include&page=3",
        init: {
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        }
      }
    ]);
    expect(runtime.document.element("today-total").textContent).toBe("3");
    expect(runtime.document.element("today-distinct").textContent).toBe("2");
    expect(runtime.document.element("seven-days-total").textContent).toBe("17");
    expect(runtime.document.element("thirty-days-distinct").textContent).toBe("23");

    const cells = runtime.document.element("visit-rows").children[0].children;
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "2026-08-07 00:30:05 HKT",
      '<img src=x onerror="alert(1)">',
      "HK · <b>Hong Kong</b>",
      "/notes/<script>alert(1)</script>?q=<svg onload=alert(1)>",
      "https://example.com/<img>",
      "Browser <iframe>",
      "Suspected bot"
    ]);
    expect(runtime.document.createdTags).toEqual(["tr", "td", "td", "td", "td", "td", "td", "td"]);
    expect(cells[6].className).toBe("bot-marker");
  });

  test("wires filters, pagination, and CSV URLs to the active browser query", async () => {
    const runtime = await executeServedDashboard(
      "?from=2026-08-01&to=2026-08-06&ip=203.0.113&country=HK&path=%2Fnotes&bots=include&page=3&debug=true",
      successfulDashboardResponse
    );
    await vi.waitFor(() => {
      expect(runtime.document.element("page-status").textContent).toBe("Page 3");
    });

    expect(runtime.document.element("from-filter").value).toBe("2026-08-01");
    expect(runtime.document.element("to-filter").value).toBe("2026-08-06");
    expect(runtime.document.element("ip-filter").value).toBe("203.0.113");
    expect(runtime.document.element("country-filter").value).toBe("HK");
    expect(runtime.document.element("path-filter").value).toBe("/notes");
    expect(runtime.document.element("bots-filter").checked).toBe(true);
    expect(runtime.document.element("export-link").href).toBe(
      "/api/export.csv?from=2026-08-01&to=2026-08-06&ip=203.0.113&country=HK&path=%2Fnotes&bots=include"
    );
    expect(runtime.document.element("previous-page")).toMatchObject({
      hidden: false,
      href: "/?from=2026-08-01&to=2026-08-06&ip=203.0.113&country=HK&path=%2Fnotes&bots=include&page=2"
    });
    expect(runtime.document.element("next-page")).toMatchObject({
      hidden: false,
      href: "/?from=2026-08-01&to=2026-08-06&ip=203.0.113&country=HK&path=%2Fnotes&bots=include&page=4"
    });

    runtime.document.element("from-filter").value = "2026-07-01";
    runtime.document.element("to-filter").value = "2026-07-31";
    runtime.document.element("ip-filter").value = " 2001:db8::1 ";
    runtime.document.element("country-filter").value = " US ";
    runtime.document.element("path-filter").value = " /new path ";
    runtime.document.element("bots-filter").checked = false;

    expect(await runtime.document.element("filters-form").dispatch("submit")).toBe(true);
    expect(runtime.assignedUrls).toEqual([
      "/?from=2026-07-01&to=2026-07-31&ip=2001%3Adb8%3A%3A1&country=US&path=%2Fnew+path&bots=exclude&page=1"
    ]);
  });

  test("shows only a generic error and retries through the delivered click handler", async () => {
    let visitsFail = true;
    const runtime = await executeServedDashboard("", (url) => {
      if (url === "/api/visits?bots=exclude&page=1" && visitsFail) {
        return new Response("secret SQL stack", { status: 500 });
      }
      return successfulDashboardResponse(url);
    });

    await vi.waitFor(() => {
      expect(runtime.document.element("error-state").hidden).toBe(false);
    });
    expect(
      runtime.document.element("visit-rows").children[0].children[0].textContent
    ).toBe("Visitor data is temporarily unavailable.");
    expect(
      runtime.document.element("visit-rows").children[0].children[0].textContent
    ).not.toContain("secret SQL stack");

    visitsFail = false;
    await runtime.document.element("retry-button").dispatch("click");

    expect(runtime.document.element("error-state").hidden).toBe(true);
    expect(runtime.document.element("visit-rows").children).toHaveLength(1);
    expect(runtime.fetchCalls).toHaveLength(4);
  });
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
