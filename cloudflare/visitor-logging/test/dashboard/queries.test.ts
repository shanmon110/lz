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

    const first = await getVisitPage(env.DB, filters());
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(50);
    expect(first.hasNext).toBe(true);
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.path).toBe("/visit-50");
    expect(first.items[49]?.path).toBe("/visit-1");

    const second = await getVisitPage(env.DB, filters({ page: "2" }));
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

    const result = await getVisitPage(env.DB, filters());
    expect(result.items.map((item) => item.path)).toEqual([
      "/inserted-second",
      "/inserted-first"
    ]);
  });

  test("excludes suspected bots by default and supports include and only modes", async () => {
    await insertVisit(
      env.DB,
      createVisit({ path: "/human", visitedAtUtc: "2026-08-05T16:00:00.000Z" })
    );
    await insertVisit(
      env.DB,
      createVisit({
        path: "/bot",
        visitedAtUtc: "2026-08-05T16:01:00.000Z",
        isSuspectedBot: true
      })
    );

    expect(
      (await getVisitPage(env.DB, filters())).items.map((item) => item.path)
    ).toEqual(["/human"]);
    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "include" }))
      ).items.map((item) => item.path)
    ).toEqual(["/bot", "/human"]);
    expect(
      (await getVisitPage(env.DB, filters({ bots: "only" }))).items.map(
        (item) => item.path
      )
    ).toEqual(["/bot"]);
  });

  test("treats historical scanner paths as suspected bots in every bot mode", async () => {
    await insertVisit(
      env.DB,
      createVisit({
        path: "/notes/human",
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
    ).toEqual(["/notes/human"]);
    expect(
      (
        await getVisitPage(env.DB, filters({ bots: "include" }))
      ).items.map((item) => [item.path, item.isSuspectedBot])
    ).toEqual([
      ["/notes/human", false],
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
        path: "/notes/real-visitor",
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
    ).toEqual(["/notes/real-visitor"]);
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
      "/about/",
      "/publications/",
      "/notes/visitor-logging/"
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
        await getVisitPage(env.DB, filters({ ip: "203.0.113.7" }))
      ).items.map((item) => item.path)
    ).toEqual(["/notes/first"]);
    expect(
      (await getVisitPage(env.DB, filters({ ip: "203.0" }))).items.map(
        (item) => item.path
      )
    ).toEqual(["/notes/second", "/notes/first"]);
    expect(
      (await getVisitPage(env.DB, filters({ country: "HK" }))).items.map(
        (item) => item.path
      )
    ).toEqual(["/about", "/notes/first"]);
    expect(
      (await getVisitPage(env.DB, filters({ path: "/notes" }))).items.map(
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
          filters({ from: "2026-08-06", to: "2026-08-06" })
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
      filters({ ip: suspiciousIp, country: "'?", path: "%_'); DROP" })
    );
    expect(result.items.map((item) => item.path)).toEqual([suspiciousPath]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM visits").first()
    ).toEqual({ count: 2 });
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
      path: "/notes/real-visitor",
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
