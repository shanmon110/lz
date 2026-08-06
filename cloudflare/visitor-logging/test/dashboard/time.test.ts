import { expect, test } from "vitest";

import {
  getHongKongDateRange,
  getSummaryTimeRanges
} from "../../src/dashboard/time";

test("converts a Hong Kong calendar date to fixed UTC+08:00 boundaries", () => {
  expect(getHongKongDateRange("2026-08-06")).toEqual({
    startInclusive: "2026-08-05T16:00:00.000Z",
    endExclusive: "2026-08-06T16:00:00.000Z"
  });
});

test("keeps the fixed UTC+08:00 boundary across seasons without DST", () => {
  expect(getHongKongDateRange("2026-01-15")).toEqual({
    startInclusive: "2026-01-14T16:00:00.000Z",
    endExclusive: "2026-01-15T16:00:00.000Z"
  });
  expect(getHongKongDateRange("2026-07-15")).toEqual({
    startInclusive: "2026-07-14T16:00:00.000Z",
    endExclusive: "2026-07-15T16:00:00.000Z"
  });
});

test("uses Hong Kong midnight for today and exact rolling 7- and 30-day windows", () => {
  const now = new Date("2026-08-05T16:30:00.000Z");

  expect(getSummaryTimeRanges(now)).toEqual({
    today: {
      startInclusive: "2026-08-05T16:00:00.000Z",
      endInclusive: "2026-08-05T16:30:00.000Z"
    },
    sevenDays: {
      startInclusive: "2026-07-29T16:30:00.000Z",
      endInclusive: "2026-08-05T16:30:00.000Z"
    },
    thirtyDays: {
      startInclusive: "2026-07-06T16:30:00.000Z",
      endInclusive: "2026-08-05T16:30:00.000Z"
    }
  });
});
