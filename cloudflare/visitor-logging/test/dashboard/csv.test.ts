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
    asOrganization: "Cloudflare, Inc.",
    continent: "AS",
    timezone: "Asia/Hong_Kong",
    httpProtocol: "HTTP/3",
    tlsVersion: "TLSv1.3",
    clientTcpRttMs: 17,
    acceptLanguage: "en-HK,en;q=0.9",
    secFetchSite: "same-origin",
    cfBotScore: 42,
    cfVerifiedBot: false,
    cfCorporateProxy: false,
    firstSeenUtc: "2026-08-06T15:00:00.000Z",
    lastSeenUtc: "2026-08-06T16:00:00.000Z",
    retainedVisitCount: 3,
    visitsPreceding24h: 3,
    visitsWithin2m: 2,
    distinctPathCount: 2,
    visitorType: "Uncertain",
    riskScore: 42,
    riskReasons: ["Hosting network", "Repeated requests"],
    counted: true,
    classificationVersion: "risk-v1",
    isSuspectedBot: false,
    botReason: null,
    ...overrides
  };
}

test("preserves the existing CSV prefix and appends the intelligence contract in order", () => {
  expect(serializeVisitsCsv([])).toBe(
    "id,visited_at_utc,ip_address,method,host,path,query_string,referrer,user_agent,browser_summary,country,region,city,asn,colo,cf_ray,is_suspected_bot,bot_reason,as_organization,continent,timezone,http_protocol,tls_version,client_tcp_rtt_ms,accept_language,sec_fetch_site,cf_bot_score,cf_verified_bot,cf_corporate_proxy,first_seen_utc,last_seen_utc,retained_visit_count,visits_preceding_24h,visits_within_2m,distinct_path_count,visitor_type,risk_score,risk_reasons,counted,classification_version"
  );
});

test("exports intelligence values, stable booleans, and readable reasons", () => {
  const csv = serializeVisitsCsv([visit()]);

  expect(csv).toContain(
    ',"Cloudflare, Inc.",AS,Asia/Hong_Kong,HTTP/3,TLSv1.3,17,"en-HK,en;q=0.9",same-origin,42,false,false,2026-08-06T15:00:00.000Z,2026-08-06T16:00:00.000Z,3,3,2,2,Uncertain,42,Hosting network; Repeated requests,true,risk-v1'
  );
});

test("keeps legacy suspected-bot false independently of a risk-only exclusion", () => {
  const csv = serializeVisitsCsv([visit({
    asOrganization: "Cloudflare",
    acceptLanguage: "en",
    riskReasons: [],
    isSuspectedBot: false,
    counted: false
  })]);
  const values = csv.split("\r\n")[1]?.split(",");

  expect(values?.[16]).toBe("false");
  expect(values?.[38]).toBe("false");
});

test("uses empty cells for unavailable nullable intelligence metadata", () => {
  const csv = serializeVisitsCsv([
    visit({
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
      cfCorporateProxy: null
    })
  ]);

  expect(csv).toContain(",,,,,,,,,,,,2026-08-06T15:00:00.000Z");
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

test("neutralizes formula initiators in every appended string field", () => {
  const csv = serializeVisitsCsv([
    visit({
      asOrganization: "=organization",
      continent: "+AS",
      timezone: "-timezone",
      httpProtocol: "@protocol",
      tlsVersion: "\tversion",
      acceptLanguage: "\rlanguage",
      secFetchSite: "\nsite",
      firstSeenUtc: "=first",
      lastSeenUtc: "+last",
      visitorType: "-visitor" as VisitRow["visitorType"],
      riskReasons: ["@reason"],
      classificationVersion: "\tclassification" as VisitRow["classificationVersion"]
    })
  ]);

  for (const value of [
    "'=organization",
    "'+AS",
    "'-timezone",
    "'@protocol",
    "'\tversion",
    "'\rlanguage",
    "'\nsite",
    "'=first",
    "'+last",
    "'-visitor",
    "'@reason",
    "'\tclassification"
  ]) {
    expect(csv).toContain(value);
  }
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
