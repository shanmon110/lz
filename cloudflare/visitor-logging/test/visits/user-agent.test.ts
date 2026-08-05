import { expect, test } from "vitest";

import { parseUserAgent } from "../../src/visits/user-agent";

test.each([
  ["Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36", { browserSummary: "Chrome 124 on macOS", isSuspectedBot: false }],
  ["Edge", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/123.0.0.0 Safari/537.36", { browserSummary: "Edge 123 on Windows", isSuspectedBot: false }],
  ["Firefox", "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0", { browserSummary: "Firefox 125 on Linux", isSuspectedBot: false }],
  ["Safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15", { browserSummary: "Safari 17 on macOS", isSuspectedBot: false }],
  ["mobile Chrome", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36", { browserSummary: "Mobile Chrome 124 on Android", isSuspectedBot: false }],
  ["curl", "curl/8.7.1", { browserSummary: "curl", isSuspectedBot: true }],
  ["crawler", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", { browserSummary: "Googlebot", isSuspectedBot: true }],
  ["unknown", "", { browserSummary: "Unknown", isSuspectedBot: false }]
] as const)("parses %s agents", (_name, userAgent, expected) => {
  expect(parseUserAgent(userAgent)).toEqual(expected);
});
