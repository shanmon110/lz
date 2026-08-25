import { expect, test } from "vitest";

import { buildVisit } from "../../src/visits/normalize";
import { isAllowedVisitPath } from "../../src/visits/allowed-pages";

function requestWithCf(
  url: string,
  headers: HeadersInit,
  cf: Pick<IncomingRequestCfProperties, "asn" | "city" | "colo" | "country" | "region"> = {
    asn: 13335,
    city: "Hong Kong",
    colo: "HKG",
    country: "HK",
    region: "Hong Kong"
  }
): Request {
  const inbound = new Request(url, { headers });
  Object.defineProperty(inbound, "cf", { value: cf });
  return inbound;
}

test("buildVisit maps a real inbound Request into the visit schema", () => {
  const inbound = requestWithCf("https://www.lizhe.link/publications/?tag=web&lang=en", {
    "CF-Connecting-IP": "203.0.113.42",
    "CF-Ray": "8abcdef012345678-HKG",
    Referer: "https://example.com/article",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });

  expect(buildVisit(inbound, new Date("2026-08-06T12:34:56.789Z"))).toEqual({
    visitedAtUtc: "2026-08-06T12:34:56.789Z",
    ipAddress: "203.0.113.42",
    method: "GET",
    host: "www.lizhe.link",
    path: "/publications/",
    queryString: "",
    referrer: "https://example.com/article",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    browserSummary: "Chrome 124 on macOS",
    country: "HK",
    region: "Hong Kong",
    city: "Hong Kong",
    asn: 13335,
    colo: "HKG",
    cfRay: "8abcdef012345678-HKG",
    isSuspectedBot: false
  });
});

test.each([
  "/",
  "/publications",
  "/publications/",
  "/tutorials",
  "/tutorials/",
  "/talks",
  "/talks/",
  "/academic-service",
  "/academic-service/",
  "/teaching",
  "/teaching/"
])("buildVisit retains homepage navigation path %s as a possible human visit", (path) => {
  const inbound = requestWithCf(`https://lizhe.link${path}`, {
    "CF-Connecting-IP": "203.0.113.42",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36"
  });

  expect(
    buildVisit(inbound, new Date("2026-08-24T22:54:28.000Z")).isSuspectedBot
  ).toBe(false);
});

test.each([
  "/markdown",
  "/markdown/",
  "/markdown_generator/",
  "/posts/2012/08/blog-post-1/",
  "/portfolio/portfolio-2/",
  "/sitemap/",
  "/robots.txt",
  "//",
  "/talks//"
])("buildVisit marks non-navigation page %s as a suspected bot", (path) => {
  const inbound = requestWithCf(`https://lizhe.link${path}`, {
    "CF-Connecting-IP": "203.0.113.42",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36"
  });

  expect(
    buildVisit(inbound, new Date("2026-08-24T22:54:28.000Z")).isSuspectedBot
  ).toBe(true);
});

test.each([
  "/publications?x=1",
  "/tutorials/?x=1"
])("isAllowedVisitPath rejects query-like path %s", (path) => {
  expect(isAllowedVisitPath(path)).toBe(false);
});

test("buildVisit truncates every bounded string at complete Unicode code points", () => {
  const emoji = "😀";
  const inbound = requestWithCf(`https://${"h".repeat(254)}/${"p".repeat(2049)}?${"q".repeat(2049)}`, {
    "CF-Connecting-IP": "198.51.100.8",
    "CF-Ray": "c".repeat(65),
    Referer: "r".repeat(2049),
    "User-Agent": "u".repeat(1025)
  }, {
      asn: 64512,
      city: emoji.repeat(129),
      colo: `${emoji}HKG`,
      country: "US",
      region: emoji.repeat(129)
    } satisfies Pick<IncomingRequestCfProperties, "asn" | "city" | "colo" | "country" | "region">);

  const result = buildVisit(inbound, new Date("2026-08-06T00:00:00.000Z"));

  expect({
    host: result.host,
    path: result.path,
    queryString: result.queryString,
    referrer: result.referrer,
    userAgent: result.userAgent,
    browserSummary: result.browserSummary,
    region: result.region,
    city: result.city,
    colo: result.colo,
    cfRay: result.cfRay
  }).toEqual({
    host: "h".repeat(253),
    path: `/${"p".repeat(2047)}`,
    queryString: "",
    referrer: "",
    userAgent: "u".repeat(1024),
    browserSummary: "Unknown",
    region: emoji.repeat(128),
    city: emoji.repeat(128),
    colo: `${emoji}HK`,
    cfRay: "c".repeat(64)
  });
});

test("buildVisit retains only a referrer origin and path", () => {
  const inbound = requestWithCf("https://lizhe.link/notes/privacy?access_token=request-token", {
    "CF-Connecting-IP": "203.0.113.57",
    Referer: "https://username:password@referrer.example:8443/return/path?token=referrer-token#fragment"
  });

  const result = buildVisit(inbound, new Date("2026-08-06T00:00:00.000Z"));

  expect(result.queryString).toBe("");
  expect(result.referrer).toBe("https://referrer.example:8443/return/path");
});

test("buildVisit drops a malformed referrer", () => {
  const inbound = requestWithCf("https://lizhe.link/notes/privacy", {
    "CF-Connecting-IP": "203.0.113.58",
    Referer: "not a URL"
  });

  expect(buildVisit(inbound, new Date("2026-08-06T00:00:00.000Z")).referrer).toBe("");
});

test.each([
  "/wp-trackback.php",
  "/wp-includes/",
  "/wp-content/plugins/core-plugin/include.php",
  "/tinyfilemanager.php",
  "/.env",
  "/robots.txt"
])("buildVisit marks scanner path %s as a suspected bot despite a browser user agent", (path) => {
  const inbound = requestWithCf(`https://lizhe.link${path}`, {
    "CF-Connecting-IP": "20.240.128.207",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  });

  expect(
    buildVisit(inbound, new Date("2026-08-24T14:08:57.000Z")).isSuspectedBot
  ).toBe(true);
});
