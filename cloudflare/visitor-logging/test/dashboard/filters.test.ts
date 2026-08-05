import { describe, expect, test } from "vitest";

import {
  DashboardFilterError,
  parseDashboardFilters
} from "../../src/dashboard/filters";

const invalidFilterCases: Array<{
  query: Record<string, string>;
  label: string;
}> = [
  { query: { from: "2026-02-30" }, label: "impossible from date" },
  { query: { to: "06-08-2026" }, label: "non-ISO to date" },
  { query: { from: "2026-08-01" }, label: "unbounded from date" },
  { query: { to: "2026-08-06" }, label: "unbounded to date" },
  {
    query: { from: "2026-08-07", to: "2026-08-06" },
    label: "reversed inclusive range"
  },
  {
    query: { from: "2026-01-01", to: "2026-04-01" },
    label: "91-day inclusive range"
  },
  { query: { bots: "sometimes" }, label: "unsupported bot mode" },
  { query: { page: "0" }, label: "zero page" },
  { query: { page: "1.5" }, label: "fractional page" },
  { query: { page: "word" }, label: "non-numeric page" }
];

describe("parseDashboardFilters", () => {
  test("parses literal supported filters and a positive page number", () => {
    const searchParams = new URLSearchParams({
      from: "2026-08-01",
      to: "2026-08-06",
      ip: "203.0.113",
      country: "HK",
      path: "/notes?q=literal",
      bots: "only",
      page: "3"
    });

    expect(parseDashboardFilters(searchParams)).toEqual({
      from: "2026-08-01",
      to: "2026-08-06",
      ip: "203.0.113",
      country: "HK",
      path: "/notes?q=literal",
      bots: "only",
      page: 3
    });
  });

  test("defaults to the first page with suspected bots excluded", () => {
    expect(parseDashboardFilters(new URLSearchParams())).toEqual({
      bots: "exclude",
      page: 1
    });
  });

  test.each([
    ["exclude", "exclude"],
    ["include", "include"],
    ["only", "only"]
  ] as const)("accepts the %s bot mode", (input, expected) => {
    expect(
      parseDashboardFilters(new URLSearchParams({ bots: input })).bots
    ).toBe(expected);
  });

  test.each(invalidFilterCases)("rejects $label with status 400", ({ query }) => {
    expect(() =>
      parseDashboardFilters(new URLSearchParams(query))
    ).toThrowError(DashboardFilterError);

    try {
      parseDashboardFilters(new URLSearchParams(query));
    } catch (error) {
      expect(error).toMatchObject({ status: 400 });
    }
  });

  test("accepts an inclusive date window of exactly 90 Hong Kong dates", () => {
    expect(
      parseDashboardFilters(
        new URLSearchParams({ from: "2026-01-01", to: "2026-03-31" })
      )
    ).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
      bots: "exclude",
      page: 1
    });
  });

  test.each([
    ["ip", "x".repeat(46)],
    ["country", "HKG"],
    ["path", `/${"x".repeat(2048)}`]
  ])("rejects an overlong %s text filter", (name, value) => {
    expect(() =>
      parseDashboardFilters(new URLSearchParams({ [name]: value }))
    ).toThrowError(DashboardFilterError);
  });

  test("preserves SQL-looking filter text as literal data", () => {
    expect(
      parseDashboardFilters(
        new URLSearchParams({
          ip: "203.0.113.7' OR 1=1 --",
          path: "/x%_'); DROP TABLE visits; --"
        })
      )
    ).toEqual({
      ip: "203.0.113.7' OR 1=1 --",
      path: "/x%_'); DROP TABLE visits; --",
      bots: "exclude",
      page: 1
    });
  });
});
