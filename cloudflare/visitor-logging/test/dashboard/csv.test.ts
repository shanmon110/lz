import { describe, expect, test } from "vitest";

import { serializeVisitsCsv } from "../../src/dashboard/csv";
import type { VisitRow } from "../../src/visits/types";

function visit(overrides: Partial<VisitRow> = {}): VisitRow {
  return {
    id: 1,
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

test("writes the stable CSV header in visit-field order", () => {
  expect(serializeVisitsCsv([])).toBe(
    "id,visited_at_utc,ip_address,method,host,path,query_string,referrer,user_agent,browser_summary,country,region,city,asn,colo,cf_ray,is_suspected_bot"
  );
});

test("uses RFC 4180 CRLF records and escapes quotes, commas, and embedded newlines", () => {
  const csv = serializeVisitsCsv([
    visit({
      path: '/notes/"quoted",entry',
      referrer: "https://example.com/first\r\nsecond"
    })
  ]);

  expect(csv).toContain(',"/notes/""quoted"",entry",');
  expect(csv).toContain(',"https://example.com/first\r\nsecond",');
  expect(csv.split("\r\n")).toHaveLength(3);
  expect(csv.endsWith("\r\n")).toBe(false);
});

test("preserves UTF-8 visit values", () => {
  const csv = serializeVisitsCsv([
    visit({ browserSummary: "Safari — 手機", city: "香港", path: "/café/你好" })
  ]);

  expect(new TextDecoder().decode(new TextEncoder().encode(csv))).toContain(
    "/café/你好"
  );
  expect(csv).toContain("香港");
  expect(csv).toContain("Safari — 手機");
});

describe("spreadsheet formula neutralization", () => {
  test.each([
    ["equals", "=1", ",'=1,"],
    ["plus", "+1", ",'+1,"],
    ["minus", "-1", ",'-1,"],
    ["at", "@name", ",'@name,"],
    ["tab", "\tvalue", ",'\tvalue,"],
    ["carriage return", "\rvalue", ',"\'\rvalue",'],
    ["line feed", "\nvalue", ',"\'\nvalue",']
  ])("prefixes a leading %s character with an apostrophe", (_name, value, expected) => {
    const csv = serializeVisitsCsv([visit({ path: value })]);

    expect(csv).toContain(expected);
  });
});

test("caps exports at exactly 5,000 rows", () => {
  const rows = Array.from({ length: 5_001 }, (_, index) =>
    visit({ id: index + 1, path: `/row-${index + 1}` })
  );

  const csv = serializeVisitsCsv(rows);

  expect(csv.split("\r\n")).toHaveLength(5_001);
  expect(csv).toContain("/row-5000");
  expect(csv).not.toContain("/row-5001");
});
