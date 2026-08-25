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
  value = "";

  private ownTextContent = "";
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, HarnessListener[]>();

  constructor(readonly tagName: string, readonly id = "") {}

  set innerHTML(_value: string) {
    throw new Error("The delivered dashboard must not write innerHTML");
  }

  set textContent(value: string) {
    this.ownTextContent = value;
  }

  get textContent(): string {
    return this.ownTextContent + this.children.map((child) => child.textContent).join("");
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

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
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
      asn: 24940,
      colo: "HKG",
      cfRay: "ray-91",
      asOrganization: "Hetzner Online GmbH",
      continent: "AS",
      timezone: "Asia/Hong_Kong",
      httpProtocol: "HTTP/2",
      tlsVersion: "TLSv1.3",
      clientTcpRttMs: 14,
      acceptLanguage: "en-HK,en;q=0.9",
      secFetchSite: "same-origin",
      cfBotScore: null,
      cfVerifiedBot: null,
      cfCorporateProxy: null,
      firstSeenUtc: "2026-08-06T15:00:00.000Z",
      lastSeenUtc: "2026-08-06T16:30:05.000Z",
      retainedVisitCount: 4,
      visitsPreceding24h: 2,
      visitsWithin2m: 2,
      distinctPathCount: 2,
      visitorType: "Suspicious automation",
      riskScore: 90,
      riskReasons: ["Hosting network", "Unknown browser", "No referrer", "Repeated requests"],
      counted: false,
      classificationVersion: "risk-v1",
      isSuspectedBot: true
    },
    {
      id: 92,
      visitedAtUtc: "",
      ipAddress: "",
      method: "GET",
      host: "lizhe.link",
      path: "",
      queryString: "",
      referrer: "",
      userAgent: "",
      browserSummary: "",
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
      cfVerifiedBot: false,
      cfCorporateProxy: true,
      firstSeenUtc: null,
      lastSeenUtc: null,
      retainedVisitCount: 0,
      visitsPreceding24h: 0,
      visitsWithin2m: 0,
      distinctPathCount: 0,
      visitorType: "Likely human",
      riskScore: 0,
      riskReasons: [],
      counted: true,
      classificationVersion: "risk-v1",
      isSuspectedBot: false
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

function textContent(element: HarnessElement): string[] {
  return [
    element.textContent,
    ...element.children.flatMap((child) => textContent(child))
  ].filter((value) => value !== "");
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
    "Include excluded automation"
  ]) {
    expect(html).toContain(label);
  }
  const expectedHeaders = [
    "Time (Hong Kong)",
    "IP address",
    "Location",
    "Network",
    "Path",
    "Referrer",
    "Browser / device",
    "IP activity",
    "Visitor type",
    "Risk",
    "Reasons",
    "Counted",
    "Details"
  ];
  expect(
    Array.from(html.matchAll(/<th scope="col">([^<]+)<\/th>/g), (match) => match[1])
  ).toEqual(expectedHeaders);
  expect(html).toContain('<td colspan="13">Loading visits…</td>');

  expect(html).toContain('aria-label="Visit pagination"');
  expect(html).toContain('id="previous-page"');
  expect(html).toContain('id="next-page"');
  expect(html).toContain('id="export-link" href="/api/export.csv?bots=exclude"');
});

test("serves focused details styles with visible controls and a one-column mobile layout", async () => {
  const response = await dashboardRequest("/app.css");
  const css = await response.text();

  expect(css).toContain(".details-row");
  expect(css).toContain(".details-panel");
  expect(css).toContain(".risk-badge");
  expect(css).toContain(".details-toggle:focus");
  expect(css).toMatch(/@media \(max-width: 44rem\)[\s\S]*\.detail-list \{ grid-template-columns: 1fr; \}/);
  expect(css).toContain(".table-scroll { overflow-x: auto; }");
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
  test("renders visitor intelligence rows and safe accessible details from complete API records", async () => {
    const runtime = await executeServedDashboard(
      "?from=2026-08-01&to=2026-08-06&ip=203.0.113&country=HK&path=%2Fnotes&bots=include&page=3&debug=true",
      successfulDashboardResponse
    );

    await vi.waitFor(() => {
      expect(runtime.document.element("visit-rows").children).toHaveLength(4);
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

    const [row, detailsRow, emptyRow, emptyDetailsRow] = runtime.document.element("visit-rows").children;
    const cells = row.children;
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "2026-08-07 00:30:05 HKT",
      '<img src=x onerror="alert(1)">',
      "HK · <b>Hong Kong</b>",
      "AS24940 · Hetzner Online GmbH",
      "/notes/<script>alert(1)</script>",
      "https://example.com/<img>",
      "Browser <iframe>",
      "24h: 2",
      "Suspicious automation",
      "Risk 90",
      "Hosting network · Unknown browser · No referrer · Repeated requests",
      "Excluded",
      "Details"
    ]);
    expect(cells).toHaveLength(13);
    const detailsButton = cells[12].children[0];
    expect(detailsButton.tagName).toBe("button");
    expect(detailsButton.getAttribute("aria-expanded")).toBe("false");
    expect(detailsButton.getAttribute("aria-controls")).toBe("visit-details-91");
    expect(emptyRow.children[12].children[0].getAttribute("aria-controls")).toBe("visit-details-92");
    expect(detailsRow.hidden).toBe(true);
    expect(detailsRow.children[0].colSpan).toBe(13);
    expect(detailsRow.children[0].children[0].getAttribute("id")).toBe("visit-details-91");
    const detailGroups = detailsRow.children[0].children[0].children;
    expect(detailGroups).toHaveLength(6);
    expect(detailGroups.map((group) => group.children[0].textContent)).toEqual([
      "Request",
      "Network",
      "Client",
      "Cloudflare signals",
      "Activity",
      "Decision"
    ]);
    expect(detailGroups.map((group) => {
      const entries = group.children[1].children;
      return Array.from({ length: entries.length / 2 }, (_, index) => [
        entries[index * 2].textContent,
        entries[index * 2 + 1].textContent
      ]);
    })).toEqual([
      [
        ["Visit ID", "91"],
        ["Method", "GET"],
        ["Host", "lizhe.link"],
        ["Path", "/notes/<script>alert(1)</script>"],
        ["Sanitized referrer", "https://example.com/<img>"],
        ["Timestamp", "2026-08-07 00:30:05 HKT"],
        ["Ray ID", "ray-91"]
      ],
      [
        ["IP address", '<img src=x onerror="alert(1)">'],
        ["Country", "HK"],
        ["Region", "Hong Kong"],
        ["City", "<b>Hong Kong</b>"],
        ["Continent", "AS"],
        ["Timezone", "Asia/Hong_Kong"],
        ["ASN", "AS24940"],
        ["Organization", "Hetzner Online GmbH"],
        ["Colo", "HKG"],
        ["HTTP protocol", "HTTP/2"],
        ["TLS version", "TLSv1.3"],
        ["TCP RTT", "14 ms"]
      ],
      [
        ["Browser summary", "Browser <iframe>"],
        ["Raw User-Agent", "Mozilla/5.0"],
        ["Accept-Language", "en-HK,en;q=0.9"],
        ["Sec-Fetch-Site", "same-origin"]
      ],
      [
        ["Bot score", "Not available"],
        ["Verified bot", "Not available"],
        ["Corporate proxy", "Not available"]
      ],
      [
        ["First seen", "2026-08-06 23:00:00 HKT"],
        ["Last seen", "2026-08-07 00:30:05 HKT"],
        ["Retained total", "4"],
        ["Preceding 24-hour total", "2"],
        ["Two-minute total", "2"],
        ["Distinct paths", "2"]
      ],
      [
        ["Visitor type", "Suspicious automation"],
        ["Risk score", "90"],
        ["Reasons", "Hosting network · Unknown browser · No referrer · Repeated requests"],
        ["Counted", "Excluded"],
        ["Classification version", "risk-v1"]
      ]
    ]);
    expect(textContent(detailsRow)).toContain('<img src=x onerror="alert(1)">');
    expect(textContent(detailsRow)).toContain("/notes/<script>alert(1)</script>");

    await detailsButton.dispatch("click");
    expect(detailsButton.getAttribute("aria-expanded")).toBe("true");
    expect(detailsRow.hidden).toBe(false);
    await detailsButton.dispatch("click");
    expect(detailsButton.getAttribute("aria-expanded")).toBe("false");
    expect(detailsRow.hidden).toBe(true);

    const emptyCells = emptyRow.children;
    expect(emptyCells.map((cell) => cell.textContent)).toEqual([
      "Unknown", "Unknown", "Unknown", "Unknown", "Unknown", "Unknown", "Unknown",
      "24h: 0", "Likely human", "Risk 0", "No recorded reasons", "Counted", "Details"
    ]);
    expect(emptyDetailsRow.hidden).toBe(true);
    const nullableSignals = emptyDetailsRow.children[0].children[0].children[3].children[1].children;
    expect(Array.from({ length: nullableSignals.length / 2 }, (_, index) => [
      nullableSignals[index * 2].textContent,
      nullableSignals[index * 2 + 1].textContent
    ])).toEqual([
      ["Bot score", "Not available"],
      ["Verified bot", "No"],
      ["Corporate proxy", "Yes"]
    ]);
    expect(runtime.document.createdTags).toEqual(expect.arrayContaining([
      "button", "section", "h3", "dl", "dt", "dd", "span"
    ]));
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

  test("spans all visitor intelligence columns when no visits match", async () => {
    const runtime = await executeServedDashboard("", (url) => {
      if (url === "/api/summary") return jsonResponse(SUMMARY_RESPONSE);
      return jsonResponse({ ...VISITS_RESPONSE, hasNext: false, items: [] });
    });

    await vi.waitFor(() => {
      expect(runtime.document.element("visit-rows").children).toHaveLength(1);
    });
    const cell = runtime.document.element("visit-rows").children[0].children[0];
    expect(cell.textContent).toBe("No visits match these filters.");
    expect(cell.colSpan).toBe(13);
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
    expect(runtime.document.element("visit-rows").children[0].children[0].colSpan).toBe(13);

    visitsFail = false;
    await runtime.document.element("retry-button").dispatch("click");

    expect(runtime.document.element("error-state").hidden).toBe(true);
    expect(runtime.document.element("visit-rows").children).toHaveLength(4);
    expect(runtime.fetchCalls).toHaveLength(4);
  });
});
