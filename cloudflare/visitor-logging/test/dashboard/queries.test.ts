import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { parseDashboardFilters } from "../../src/dashboard/filters";
import {
  getDashboardSummary,
  getVisitPage,
  getVisitsForExport
} from "../../src/dashboard/queries";
import { insertVisit } from "../../src/visits/repository";
import type { VisitInput } from "../../src/visits/types";

function createVisit(overrides: Partial<VisitInput> = {}): VisitInput {
  return {
    visitedAtUtc: "2026-08-05T16:00:00.000Z",
    ipAddress: "203.0.113.7",
    method: "GET",
    host: "lizhe.link",
    path: "/",
    queryString: "",
    referrer: "",
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

function filters(query: Record<string, string> = {}) {
  return parseDashboardFilters(new URLSearchParams(query));
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM visits").run();
});

describe("getVisitPage", () => {
  test("returns newest-first 50-row pages with a 51-row next-page probe", async () => {
    const start = Date.parse("2026-08-05T00:00:00.000Z");
    for (let index = 0; index < 51; index += 1) {
      await insertVisit(
        env.DB,
        createVisit({
          visitedAtUtc: new Date(start + index * 1000).toISOString(),
          path: `/visit-${index}`
        })
      );
    }

    const first = await getVisitPage(env.DB, filters({ bots: "include" }));
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(50);
    expect(first.hasNext).toBe(true);
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.path).toBe("/visit-50");
    expect(first.items[49]?.path).toBe("/visit-1");
    expect(first.items[0]).toMatchObject({
      firstSeenUtc: "2026-08-05T00:00:00.000Z",
      lastSeenUtc: "2026-08-05T00:00:50.000Z",
      retainedVisitCount: 51,
      visitsPreceding24h: 51,
      visitsWithin2m: 51,
      distinctPathCount: 51,
      visitorType: "Suspicious automation",
      riskScore: 90,
      riskReasons: [
        "Unlisted page",
        "No referrer",
        "Repeated requests",
        "High 24h activity"
      ],
      counted: false,
      classificationVersion: "risk-v1"
    });

    const second = await getVisitPage(
      env.DB,
      filters({ bots: "include", page: "2" })
    );
    expect(second).toEqual({
      items: [
        expect.objectContaining({
          path: "/visit-0",
          visitedAtUtc: "2026-08-05T00:00:00.000Z"
        })
      ],
      page: 2,
      pageSize: 50,
      hasNext: false
    });
  });

  test("breaks equal timestamp ties by newest id first", async () => {
    await insertVisit(env.DB, createVisit({ path: "/inserted-first" }));
    await insertVisit(env.DB, createVisit({ path: "/inserted-second" }));

    const result = await getVisitPage(env.DB, filters({ bots: "include" }));
    expect(result.items.map((item) => item.path)).toEqual([
      "/inserted-second",
      "/inserted-first"
    ]);
  });

  test("excludes suspected bots by default and supports include and only modes", async () => {
    await insertVisit(
      env.DB,
      createVisit({ path: "/", visitedAtUtc: "2026-08-05T16:00:00.000Z" })
    );
    await insertVisit(
      env.DB,
      createVisit({
        path: "/publications/",
        visitedAtUtc: "2026-08-05T16:01:00.000Z",
        isSuspectedBot: true
      })
    );

    expect(
      (await getVisitPage(env.DB, filters())).items.map((item) => item.path)
    ).toEqual(["/"]);
    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "include" }))
      ).items.map((item) => item.path)
    ).toEqual(["/publications/", "/"]);
    expect(
      (await getVisitPage(env.DB, filters({ bots: "only" }))).items.map(
        (item) => item.path
      )
    ).toEqual(["/publications/"]);
  });

  test("treats historical scanner paths as suspected bots in every bot mode", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        path: "/publications/",
        visitedAtUtc: "2026-08-24T14:08:58.000Z"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        path: "/wp-content/plugins/core-plugin/include.php",
        visitedAtUtc: "2026-08-24T14:08:57.000Z",
        userAgent: "Mozilla/5.0 Chrome/120.0.0.0",
        isSuspectedBot: false
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        path: "/robots.txt",
        visitedAtUtc: "2026-08-24T14:08:56.000Z",
        userAgent: "Mozilla/5.0 Chrome/120.0.0.0",
        isSuspectedBot: false
      })
    );

    expect(
      (await getVisitPage(env.DB, filters())).items.map((item) => item.path)
    ).toEqual(["/publications/"]);
    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "include" }))
      ).items.map((item) => [item.path, item.isSuspectedBot])
    ).toEqual([
      ["/publications/", false],
      ["/wp-content/plugins/core-plugin/include.php", true],
      ["/robots.txt", true]
    ]);
    expect(
      (await getVisitPage(env.DB, filters({ bots: "only" }))).items.map(
        (item) => item.path
      )
    ).toEqual([
      "/wp-content/plugins/core-plugin/include.php",
      "/robots.txt"
    ]);
  });

  test("classifies an entire same-IP probe burst so incidental paths do not leak through", async () => {
    const scannerIp = "20.240.128.207";
    const burst: Array<[string, string]> = [
      ["2026-08-24T14:08:57.000Z", "/wp-trackback.php"],
      ["2026-08-24T14:08:56.000Z", "/wp-includes/"],
      ["2026-08-24T14:08:55.000Z", "/tinyfilemanager.php"],
      ["2026-08-24T14:08:54.000Z", "/.env"],
      ["2026-08-24T14:08:53.000Z", "/assets/"]
    ];

    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "203.0.113.42",
        path: "/talks/",
        visitedAtUtc: "2026-08-24T14:08:58.000Z"
      })
    );
    for (const [visitedAtUtc, path] of burst) {
      await insertVisit(
        env.DB,
        createVisit({
          ipAddress: scannerIp,
          path,
          visitedAtUtc,
          userAgent: "Mozilla/5.0 Chrome/120.0.0.0",
          isSuspectedBot: false
        })
      );
    }

    expect(
      (await getVisitPage(env.DB, filters())).items.map((item) => item.path)
    ).toEqual(["/talks/"]);
    expect(
      (
        await getVisitPage(
          env.DB,
          filters({ bots: "include", ip: scannerIp })
        )
      ).items.map((item) => [item.path, item.isSuspectedBot])
    ).toEqual(burst.map(([, path]) => [path, true]));
    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "only", ip: scannerIp }))
      ).items.map((item) => item.path)
    ).toEqual(burst.map(([, path]) => path));
  });

  test("does not classify rapid browsing of ordinary pages as a scanner burst", async () => {
    const ordinaryPaths = [
      "/",
      "/publications/",
      "/talks/",
      "/teaching/"
    ];
    for (const [index, path] of ordinaryPaths.entries()) {
      await insertVisit(
        env.DB,
        createVisit({
          path,
          visitedAtUtc: new Date(
            Date.parse("2026-08-24T14:10:00.000Z") - index * 1000
          ).toISOString()
        })
      );
    }

    expect(
      (await getVisitPage(env.DB, filters())).items.map((item) => item.path)
    ).toEqual(ordinaryPaths);
  });

  test("classifies matching Oracle Cloud duplicate navigations as automated browsing", async () => {
    const automatedIp = "129.146.61.66";
    const timestamp = "2026-08-25T01:59:15.000Z";
    for (const [path, referrer] of [
      ["/publications", ""],
      ["/publications/", "https://shanmon110.github.io/lz/publications/"]
    ]) {
      await insertVisit(
        env.DB,
        createVisit({
          ipAddress: automatedIp,
          path,
          referrer,
          asn: 31898,
          browserSummary: "Chrome 139 on Linux",
          visitedAtUtc: timestamp,
          isSuspectedBot: false
        })
      );
    }

    expect(
      (await getVisitPage(env.DB, filters({ ip: automatedIp }))).items
    ).toEqual([]);
    expect(
      (
        await getVisitPage(
          env.DB,
          filters({ bots: "include", ip: automatedIp })
        )
      ).items.map((item) => [item.isSuspectedBot, item.botReason])
    ).toEqual([
      [true, "automated-browser"],
      [true, "automated-browser"]
    ]);
  });

  test("does not classify Oracle navigations more than one real second apart", async () => {
    for (const [visitedAtUtc, path, referrer] of [
      ["2026-08-25T01:59:15.001Z", "/publications", ""],
      [
        "2026-08-25T01:59:16.002Z",
        "/publications/",
        "https://shanmon110.github.io/lz/publications/"
      ]
    ]) {
      await insertVisit(
        env.DB,
        createVisit({
          ipAddress: "129.146.61.67",
          path,
          referrer,
          asn: 31898,
          browserSummary: "Chrome 139 on Linux",
          visitedAtUtc,
          isSuspectedBot: false
        })
      );
    }

    expect(
      (
        await getVisitPage(
          env.DB,
          filters({ ip: "129.146.61.67" })
        )
      ).items
    ).toHaveLength(2);
  });

  test("classifies Oracle navigations exactly one real second apart", async () => {
    for (const [visitedAtUtc, path, referrer] of [
      ["2026-08-25T01:59:15.001Z", "/publications", ""],
      [
        "2026-08-25T01:59:16.001Z",
        "/publications/",
        "https://shanmon110.github.io/lz/publications/"
      ]
    ]) {
      await insertVisit(
        env.DB,
        createVisit({
          ipAddress: "129.146.61.68",
          path,
          referrer,
          asn: 31898,
          browserSummary: "Chrome 139 on Linux",
          visitedAtUtc,
          isSuspectedBot: false
        })
      );
    }

    expect(
      (
        await getVisitPage(
          env.DB,
          filters({ ip: "129.146.61.68" })
        )
      ).items
    ).toEqual([]);
  });

  test("classifies the observed Tencent Cloud browser fingerprints as automated browsing", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "43.161.233.190",
        path: "/",
        referrer: "https://shanmon110.github.io/lz/",
        asn: 132203,
        browserSummary: "Mobile Safari 13 on iOS",
        isSuspectedBot: false
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "43.172.195.7",
        path: "/",
        referrer: "",
        asn: 132203,
        browserSummary: "Chrome 106 on Windows",
        isSuspectedBot: false
      })
    );

    expect((await getVisitPage(env.DB, filters())).items).toEqual([]);
    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "only" }))
      ).items.map((item) => [item.ipAddress, item.botReason])
    ).toEqual([
      ["43.172.195.7", "automated-browser"],
      ["43.161.233.190", "automated-browser"]
    ]);
  });

  test("does not classify duplicate browser visits outside the Oracle link-checker pattern", async () => {
    const timestamp = "2026-08-25T01:59:15.000Z";
    for (const referrer of [
      "https://lizhe.link/markdown_generator",
      "https://shanmon110.github.io/lz/markdown_generator"
    ]) {
      await insertVisit(
        env.DB,
        createVisit({
          ipAddress: "203.0.113.9",
          path: "/publications/",
          referrer,
          asn: 13335,
          visitedAtUtc: timestamp
        })
      );
    }

    expect(
      (await getVisitPage(env.DB, filters({ ip: "203.0.113.9" }))).items
    ).toHaveLength(2);
  });

  test("excludes historical visits outside the homepage navigation allowlist", async () => {
    for (const path of [
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
      "/teaching/",
      "/markdown",
      "/markdown/",
      "/publications?x=1",
      "/tutorials/?x=1",
      "/markdown_generator/",
      "/posts/2012/08/blog-post-1/",
      "/portfolio/portfolio-2/",
      "/sitemap/",
      "/talks//"
    ]) {
      await insertVisit(
        env.DB,
        createVisit({
          path,
          visitedAtUtc: "2026-08-25T01:00:00.000Z",
          isSuspectedBot: false
        })
      );
    }

    expect(
      (await getVisitPage(env.DB, filters())).items.map((item) => item.path)
    ).toEqual([
      "/teaching/",
      "/teaching",
      "/academic-service/",
      "/academic-service",
      "/talks/",
      "/talks",
      "/tutorials/",
      "/tutorials",
      "/publications/",
      "/publications",
      "/"
    ]);
    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "only" }))
      ).items.map((item) => [item.path, item.botReason])
    ).toEqual([
      ["/talks//", "unlisted-page"],
      ["/sitemap/", "unlisted-page"],
      ["/portfolio/portfolio-2/", "unlisted-page"],
      ["/posts/2012/08/blog-post-1/", "unlisted-page"],
      ["/markdown_generator/", "unlisted-page"],
      ["/tutorials/?x=1", "unlisted-page"],
      ["/publications?x=1", "unlisted-page"],
      ["/markdown/", "unlisted-page"],
      ["/markdown", "unlisted-page"]
    ]);
  });

  test("filters literal exact and partial IP, country, and path values", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "203.0.113.7",
        country: "HK",
        path: "/notes/first"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "203.0.114.8",
        country: "US",
        path: "/notes/second"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "198.51.100.9",
        country: "HK",
        path: "/about"
      })
    );

    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "include", ip: "203.0.113.7" }))
      ).items.map((item) => item.path)
    ).toEqual(["/notes/first"]);
    expect(
      (await getVisitPage(env.DB, filters({ bots: "include", ip: "203.0" }))).items.map(
        (item) => item.path
      )
    ).toEqual(["/notes/second", "/notes/first"]);
    expect(
      (await getVisitPage(env.DB, filters({ bots: "include", country: "HK" }))).items.map(
        (item) => item.path
      )
    ).toEqual(["/about", "/notes/first"]);
    expect(
      (await getVisitPage(env.DB, filters({ bots: "include", path: "/notes" }))).items.map(
        (item) => item.path
      )
    ).toEqual(["/notes/second", "/notes/first"]);
  });

  test("treats from as inclusive and to as inclusive Hong Kong calendar dates", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        path: "/before",
        visitedAtUtc: "2026-08-05T15:59:59.999Z"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        path: "/at-start",
        visitedAtUtc: "2026-08-05T16:00:00.000Z"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        path: "/at-last-millisecond",
        visitedAtUtc: "2026-08-06T15:59:59.999Z"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({ path: "/after", visitedAtUtc: "2026-08-06T16:00:00.000Z" })
    );

    expect(
      (
        await getVisitPage(
          env.DB,
          filters({ bots: "include", from: "2026-08-06", to: "2026-08-06" })
        )
      ).items.map((item) => item.path)
    ).toEqual(["/at-last-millisecond", "/at-start"]);
  });

  test("binds SQL-looking and LIKE wildcard characters as literal filter data", async () => {
    const suspiciousIp = "203.0.113.7' OR 1=1 --";
    const suspiciousPath = "/x%_'); DROP TABLE visits; --";
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: suspiciousIp,
        country: "'?",
        path: suspiciousPath
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "198.51.100.9",
        country: "HK",
        path: "/xAB-safe"
      })
    );

    const result = await getVisitPage(
      env.DB,
      filters({ bots: "include", ip: suspiciousIp, country: "'?", path: "%_'); DROP" })
    );
    expect(result.items.map((item) => item.path)).toEqual([suspiciousPath]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM visits").first()
    ).toEqual({ count: 2 });
  });

  test("keeps legacy NULL enrichment rows valid and derives complete activity", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        path: "/",
        referrer: "https://lizhe.link/",
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
    );

    expect((await getVisitPage(env.DB, filters())).items).toEqual([
      expect.objectContaining({
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
        firstSeenUtc: "2026-08-05T16:00:00.000Z",
        lastSeenUtc: "2026-08-05T16:00:00.000Z",
        retainedVisitCount: 1,
        visitsPreceding24h: 1,
        visitsWithin2m: 1,
        distinctPathCount: 1,
        visitorType: "Likely human",
        riskScore: 0,
        riskReasons: [],
        counted: true,
        classificationVersion: "risk-v1"
      })
    ]);
  });

  test("uses exact current-row boundaries for preceding-24h and two-minute activity", async () => {
    const ipAddress = "198.51.100.24";
    const rows: Array<[string, string]> = [
      ["2026-08-04T15:59:59.999Z", "/talks/"],
      ["2026-08-04T16:00:00.000Z", "/publications/"],
      ["2026-08-05T15:57:59.999Z", "/teaching/"],
      ["2026-08-05T15:58:00.000Z", "/academic-service/"],
      ["2026-08-05T16:00:00.000Z", "/"],
      ["2026-08-05T16:02:00.000Z", "/tutorials/"],
      ["2026-08-05T16:02:00.001Z", "/talks/"]
    ];
    for (const [visitedAtUtc, path] of rows) {
      await insertVisit(
        env.DB,
        createVisit({ ipAddress, visitedAtUtc, path, referrer: "https://lizhe.link/" })
      );
    }

    const current = (
      await getVisitPage(
        env.DB,
        filters({ bots: "include", ip: ipAddress, path: "/" })
      )
    ).items.find((item) => item.visitedAtUtc === "2026-08-05T16:00:00.000Z");

    expect(current).toMatchObject({
      firstSeenUtc: "2026-08-04T15:59:59.999Z",
      lastSeenUtc: "2026-08-05T16:02:00.001Z",
      retainedVisitCount: 7,
      visitsPreceding24h: 4,
      visitsWithin2m: 3,
      distinctPathCount: 6
    });
  });

  test("adds high-activity risk at the tenth preceding-24h visit", async () => {
    const ipAddress = "198.51.100.25";
    const start = Date.parse("2026-08-05T15:00:00.000Z");
    for (let index = 0; index < 10; index += 1) {
      await insertVisit(
        env.DB,
        createVisit({
          ipAddress,
          visitedAtUtc: new Date(start + index * 5 * 60_000).toISOString(),
          path: "/",
          referrer: "https://lizhe.link/"
        })
      );
    }

    const newest = (await getVisitPage(env.DB, filters({ ip: ipAddress }))).items[0];
    expect(newest).toMatchObject({
      visitsPreceding24h: 10,
      visitsWithin2m: 1,
      riskScore: 10,
      riskReasons: ["High 24h activity"],
      counted: true
    });
  });

  test("recognizes approved hosting ASNs and normalized organization-name evidence", async () => {
    const rows = [
      createVisit({ ipAddress: "192.0.2.1", asn: 24940, path: "/", referrer: "https://lizhe.link/" }),
      createVisit({ ipAddress: "192.0.2.2", asn: 16312, path: "/", referrer: "https://lizhe.link/" }),
      createVisit({ ipAddress: "192.0.2.3", asn: 14061, path: "/", referrer: "https://lizhe.link/" }),
      createVisit({ ipAddress: "192.0.2.4", asn: 13335, asOrganization: "HETZNER-Online GmbH", path: "/", referrer: "https://lizhe.link/" }),
      createVisit({ ipAddress: "192.0.2.5", asn: 13335, asOrganization: "Internet Vikings International AB", path: "/", referrer: "https://lizhe.link/" }),
      createVisit({ ipAddress: "192.0.2.6", asn: 13335, asOrganization: "DigitalOcean, LLC", path: "/", referrer: "https://lizhe.link/" })
    ];
    for (const row of rows) await insertVisit(env.DB, row);

    const result = await getVisitPage(env.DB, filters());
    expect(result.items).toHaveLength(rows.length);
    expect(
      result.items.map((item) => [item.riskScore, item.riskReasons, item.counted])
    ).toEqual(
      rows.map(() => [30, ["Hosting network"], true])
    );
  });

  test("does not force benign bot substrings while preserving word-boundary signatures", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "192.0.2.7",
        path: "/",
        userAgent: "Abbott/1.0",
        referrer: "https://lizhe.link/"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "192.0.2.8",
        path: "/",
        userAgent: "Example client bot/1.0",
        browserSummary: "Unknown",
        referrer: "https://lizhe.link/"
      })
    );

    const result = await getVisitPage(env.DB, filters({ bots: "include" }));
    const byIp = new Map(result.items.map((item) => [item.ipAddress, item]));
    expect(byIp.get("192.0.2.7")).toMatchObject({
      visitorType: "Likely human",
      riskScore: 0,
      riskReasons: [],
      counted: true
    });
    expect(byIp.get("192.0.2.8")).toMatchObject({
      visitorType: "Known bot signature",
      riskScore: 100,
      riskReasons: ["Known bot signature", "Unknown browser"],
      counted: false
    });
  });

  test("recognizes canonical compound bot signatures and legacy Googlebot summaries", async () => {
    const rows = [
      createVisit({ ipAddress: "192.0.2.21", userAgent: "Googlebot/2.1", browserSummary: "Googlebot" }),
      createVisit({ ipAddress: "192.0.2.22", userAgent: "bingbot/2.0", browserSummary: "Unknown" }),
      createVisit({ ipAddress: "192.0.2.23", userAgent: "GPTBot/1.2", browserSummary: "Unknown" }),
      createVisit({
        ipAddress: "192.0.2.24",
        userAgent: "Mozilla/5.0",
        browserSummary: "Googlebot",
        isSuspectedBot: false
      }),
      createVisit({ ipAddress: "192.0.2.25", userAgent: "Abbott/1.0", browserSummary: "Chrome on macOS" })
    ];
    for (const row of rows) await insertVisit(env.DB, row);

    const result = await getVisitPage(env.DB, filters({ bots: "include" }));
    const byIp = new Map(result.items.map((item) => [item.ipAddress, item]));
    for (const ipAddress of ["192.0.2.21", "192.0.2.22", "192.0.2.23", "192.0.2.24"]) {
      expect(byIp.get(ipAddress)).toMatchObject({
        visitorType: "Known bot signature",
        riskScore: 100,
        counted: false
      });
    }
    expect(byIp.get("192.0.2.25")).toMatchObject({
      visitorType: "Likely human",
      riskScore: 10,
      counted: true
    });
  });

  test("keeps SQL and TypeScript hosting normalization identical for repeated separators", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "192.0.2.9",
        path: "/",
        asOrganization: "Internet--  Vikings International AB",
        referrer: "https://lizhe.link/"
      })
    );

    const page = await getVisitPage(env.DB, filters({ bots: "include" }));
    const exported = await getVisitsForExport(
      env.DB,
      filters({ bots: "include" })
    );
    expect(page.items[0]).toMatchObject({
      riskScore: 30,
      riskReasons: ["Hosting network"],
      counted: true
    });
    expect(exported).toEqual(page.items);
  });

  test("keeps SQL-selected hosting evidence authoritative for adversarial organizations", async () => {
    const cases: Array<[string, string | null, boolean]> = [
      ["192.0.2.31", "Internet ViKings International AB", false],
      ["192.0.2.32", "Internet\0Vikings International AB", false],
      ["192.0.2.33", "Internet--  Vikings International AB", true],
      ["192.0.2.34", "100%_Internet_Vikings", true],
      ["192.0.2.35", "Hetz%ner Online GmbH", false],
      ["192.0.2.36", "", false],
      ["192.0.2.37", null, false]
    ];
    for (const [ipAddress, asOrganization] of cases) {
      await insertVisit(env.DB, createVisit({
        ipAddress,
        asOrganization,
        referrer: "https://lizhe.link/"
      }));
    }

    const page = await getVisitPage(env.DB, filters({ bots: "include" }));
    const exported = await getVisitsForExport(env.DB, filters({ bots: "include" }));
    const byIp = new Map(page.items.map((item) => [item.ipAddress, item]));
    for (const [ipAddress, , hosting] of cases) {
      expect(byIp.get(ipAddress)).toMatchObject({
        riskScore: hosting ? 30 : 0,
        riskReasons: hosting ? ["Hosting network"] : [],
        counted: true
      });
    }
    expect(exported).toEqual(page.items);
  });

  test("keeps SQL and TypeScript browser syntax identical for invalid version suffixes", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "192.0.2.17",
        path: "/",
        browserSummary: "Chrome 1beta on Linux",
        referrer: "https://lizhe.link/"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "192.0.2.18",
        path: "/",
        browserSummary: "Chrome 1 on Linux",
        referrer: "https://lizhe.link/"
      })
    );
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "192.0.2.19",
        path: "/",
        browserSummary: "\tChrome 1 on Linux",
        referrer: "https://lizhe.link/"
      })
    );

    const page = await getVisitPage(env.DB, filters({ bots: "include" }));
    const exported = await getVisitsForExport(
      env.DB,
      filters({ bots: "include" })
    );
    const byIp = new Map(page.items.map((item) => [item.ipAddress, item]));
    expect(byIp.get("192.0.2.17")).toMatchObject({
      riskScore: 25,
      riskReasons: ["Unknown browser"],
      counted: true
    });
    expect(byIp.get("192.0.2.18")).toMatchObject({
      riskScore: 0,
      riskReasons: [],
      counted: true
    });
    expect(byIp.get("192.0.2.19")).toMatchObject({
      riskScore: 25,
      riskReasons: ["Unknown browser"],
      counted: true
    });
    expect(exported).toEqual(page.items);
  });

  test("uses the composite IP/time index for both activity range windows", async () => {
    let pageSql = "";
    const recordingDb = {
      prepare(query: string) {
        pageSql = query;
        return env.DB.prepare(query);
      }
    } as D1Database;

    await getVisitPage(recordingDb, filters({ bots: "include" }));
    const plan = await env.DB
      .prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
      .bind(51, 0)
      .all<{ detail: string }>();
    const indexedRanges = plan.results.filter((row) =>
      /visits_ip_address_visited_at_utc_idx \(ip_address=\? AND visited_at_utc>[?] AND visited_at_utc<[?]\)/.test(
        row.detail
      )
    );

    expect(
      pageSql.match(/AND ip_activity\.visited_at_utc >=/g)
    ).toHaveLength(2);
    expect(indexedRanges.length).toBeGreaterThanOrEqual(2);
  });

  test("derives forced, effective, Bot Management, and counted-score decisions consistently", async () => {
    const decisionRows: VisitInput[] = [
      createVisit({
        ipAddress: "192.0.2.10",
        path: "/",
        userAgent:
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        browserSummary: "Googlebot",
        referrer: "https://lizhe.link/"
      }),
      createVisit({
        ipAddress: "192.0.2.11",
        path: "/",
        cfVerifiedBot: true,
        referrer: "https://lizhe.link/"
      }),
      createVisit({
        ipAddress: "192.0.2.12",
        path: "/wp-login.php",
        referrer: "https://lizhe.link/"
      }),
      createVisit({
        ipAddress: "192.0.2.13",
        path: "/not-allowed/",
        referrer: "https://lizhe.link/"
      }),
      createVisit({
        ipAddress: "192.0.2.14",
        path: "/",
        cfBotScore: 20,
        referrer: "https://lizhe.link/"
      }),
      createVisit({
        ipAddress: "192.0.2.15",
        path: "/",
        asn: 14061,
        referrer: ""
      }),
      createVisit({
        ipAddress: "192.0.2.16",
        path: "/",
        browserSummary: "Unknown",
        cfBotScore: 20,
        referrer: "https://lizhe.link/"
      })
    ];
    for (const row of decisionRows) await insertVisit(env.DB, row);

    const included = await getVisitPage(env.DB, filters({ bots: "include" }));
    const byIp = new Map(included.items.map((item) => [item.ipAddress, item]));
    expect(byIp.get("192.0.2.10")).toMatchObject({
      visitorType: "Known bot signature",
      riskScore: 100,
      counted: false
    });
    expect(byIp.get("192.0.2.11")).toMatchObject({
      visitorType: "Known bot signature",
      riskScore: 100,
      counted: false
    });
    expect(byIp.get("192.0.2.12")).toMatchObject({
      visitorType: "Suspicious automation",
      riskScore: 90,
      riskReasons: ["Scanner path", "Unlisted page"],
      counted: false
    });
    expect(byIp.get("192.0.2.13")).toMatchObject({
      visitorType: "Suspicious automation",
      riskScore: 90,
      riskReasons: ["Unlisted page"],
      counted: false
    });
    expect(byIp.get("192.0.2.14")).toMatchObject({
      visitorType: "Uncertain",
      riskScore: 50,
      riskReasons: ["Low Cloudflare bot score"],
      counted: true
    });
    expect(byIp.get("192.0.2.15")).toMatchObject({
      visitorType: "Uncertain",
      riskScore: 40,
      riskReasons: ["Hosting network", "No referrer"],
      counted: true
    });
    expect(byIp.get("192.0.2.16")).toMatchObject({
      visitorType: "Suspicious automation",
      riskScore: 75,
      riskReasons: ["Low Cloudflare bot score", "Unknown browser"],
      counted: false,
      isSuspectedBot: false,
      botReason: null
    });

    expect((await getVisitPage(env.DB, filters())).items.map((item) => item.ipAddress)).toEqual([
      "192.0.2.15",
      "192.0.2.14"
    ]);
    expect(
      (await getVisitPage(env.DB, filters({ bots: "only" }))).items.map(
        (item) => item.ipAddress
      )
    ).toEqual([
      "192.0.2.16",
      "192.0.2.13",
      "192.0.2.12",
      "192.0.2.11",
      "192.0.2.10"
    ]);
  });

  test("keeps page and export decisions identical", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "192.0.2.20",
        path: "/",
        asOrganization: "DigitalOcean LLC",
        referrer: ""
      })
    );

    const pageItem = (await getVisitPage(env.DB, filters({ bots: "include" }))).items[0];
    const exportItem = (await getVisitsForExport(env.DB, filters({ bots: "include" })))[0];
    expect(exportItem).toEqual(pageItem);
  });
});

test("getDashboardSummary counts visits and distinct network addresses in each window", async () => {
  const rows: Array<[string, string, boolean?]> = [
    ["2026-08-05T16:00:00.000Z", "203.0.113.1"],
    ["2026-08-05T16:30:00.000Z", "203.0.113.1"],
    ["2026-08-05T15:59:59.999Z", "203.0.113.2"],
    ["2026-07-29T16:30:00.000Z", "203.0.113.2"],
    ["2026-07-29T16:29:59.999Z", "203.0.113.3"],
    ["2026-07-06T16:30:00.000Z", "203.0.113.3"],
    ["2026-07-06T16:29:59.999Z", "203.0.113.4"],
    ["2026-08-05T16:30:00.001Z", "203.0.113.5"],
    ["2026-08-05T16:15:00.000Z", "192.0.2.10", true]
  ];
  for (const [visitedAtUtc, ipAddress, isSuspectedBot = false] of rows) {
    await insertVisit(
      env.DB,
      createVisit({ visitedAtUtc, ipAddress, isSuspectedBot })
    );
  }

  expect(
    await getDashboardSummary(env.DB, new Date("2026-08-05T16:30:00.000Z"))
  ).toEqual({
    today: { totalVisits: 2, distinctNetworkAddresses: 1 },
    sevenDays: { totalVisits: 4, distinctNetworkAddresses: 2 },
    thirtyDays: { totalVisits: 6, distinctNetworkAddresses: 3 }
  });
});

test("getDashboardSummary excludes historical scanner bursts from visit totals", async () => {
  await insertVisit(
    env.DB,
    createVisit({
      ipAddress: "203.0.113.42",
      path: "/talks/",
      visitedAtUtc: "2026-08-24T14:09:00.000Z"
    })
  );
  for (const [index, path] of [
    "/wp-trackback.php",
    "/wp-includes/",
    "/tinyfilemanager.php",
    "/.env",
    "/assets/"
  ].entries()) {
    await insertVisit(
      env.DB,
      createVisit({
        ipAddress: "20.240.128.207",
        path,
        visitedAtUtc: new Date(
          Date.parse("2026-08-24T14:08:57.000Z") - index * 1000
        ).toISOString(),
        isSuspectedBot: false
      })
    );
  }

  expect(
    await getDashboardSummary(env.DB, new Date("2026-08-24T15:00:00.000Z"))
  ).toEqual({
    today: { totalVisits: 1, distinctNetworkAddresses: 1 },
    sevenDays: { totalVisits: 1, distinctNetworkAddresses: 1 },
    thirtyDays: { totalVisits: 1, distinctNetworkAddresses: 1 }
  });
});

test("getDashboardSummary counts exactly the decisions marked counted", async () => {
  for (const row of [
    createVisit({ ipAddress: "198.51.100.1", path: "/", referrer: "https://lizhe.link/" }),
    createVisit({ ipAddress: "198.51.100.2", path: "/", asn: 14061, referrer: "" }),
    createVisit({ ipAddress: "198.51.100.3", path: "/", cfBotScore: 20, referrer: "https://lizhe.link/" }),
    createVisit({ ipAddress: "198.51.100.4", path: "/", cfVerifiedBot: true, referrer: "https://lizhe.link/" })
  ]) {
    await insertVisit(env.DB, row);
  }

  const page = await getVisitPage(env.DB, filters({ bots: "include" }));
  const counted = page.items.filter((item) => item.counted);
  expect(counted).toHaveLength(3);
  expect(
    await getDashboardSummary(env.DB, new Date("2026-08-05T16:30:00.000Z"))
  ).toEqual({
    today: { totalVisits: 3, distinctNetworkAddresses: 3 },
    sevenDays: { totalVisits: 3, distinctNetworkAddresses: 3 },
    thirtyDays: { totalVisits: 3, distinctNetworkAddresses: 3 }
  });
});

test("getVisitsForExport exposes the effective bot flag for historical scanners", async () => {
  await insertVisit(
    env.DB,
    createVisit({
      path: "/xmlrpc.php",
      userAgent: "Mozilla/5.0 Chrome/120.0.0.0",
      isSuspectedBot: false
    })
  );

  expect(
    (
      await getVisitsForExport(env.DB, filters({ bots: "include" }))
    ).map((item) => [item.path, item.isSuspectedBot])
  ).toEqual([["/xmlrpc.php", true]]);
});
