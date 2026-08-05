import { expect, test } from "vitest";

import { isDocumentVisit } from "../../src/visits/classify";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://lizhe.link${path}`, init);
}

test.each([
  ["uses Sec-Fetch-Dest document for a GET page", request("/about", { headers: { "Sec-Fetch-Dest": "document" } }), true],
  ["uses an HTML Accept header when Sec-Fetch-Dest is absent", request("/about", { headers: { Accept: "text/html,application/xhtml+xml" } }), true],
  ["rejects dashboard documents by exact host", new Request("https://logs.lizhe.link/visits", { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html" } }), false],
  ["rejects non-GET methods", request("/about", { method: "POST", headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects case-insensitive script extensions", request("/assets/main.JS", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects image extensions", request("/assets/hero.webp", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects style extensions", request("/assets/site.css", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects source map extensions", request("/assets/site.js.map", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects font extensions", request("/assets/site.woff2", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects media extensions", request("/assets/movie.webm", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects archive extensions", request("/assets/archive.zip", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects office and PDF extensions", request("/assets/report.docx", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects feed extensions", request("/feed.rss", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects manifest assets", request("/site.webmanifest", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects extensionless service-worker resources", request("/service-worker", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects Cloudflare internal paths", request("/cdn-cgi/trace", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects health checks", request("/healthz", { headers: { "Sec-Fetch-Dest": "document" } }), false],
  ["rejects non-HTML Accept headers", request("/api/feed", { headers: { Accept: "application/json" } }), false]
] as const)("%s", (_name, inbound, expected) => {
  expect(isDocumentVisit(inbound)).toBe(expected);
});
