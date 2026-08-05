const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DateRange {
  startInclusive: string;
  endExclusive: string;
}

export interface SummaryTimeRange {
  startInclusive: string;
  endInclusive: string;
}

export interface SummaryTimeRanges {
  today: SummaryTimeRange;
  sevenDays: SummaryTimeRange;
  thirtyDays: SummaryTimeRange;
}

function hongKongMidnightUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - HONG_KONG_OFFSET_MS;
}

export function getHongKongDateRange(date: string): DateRange {
  const [year, month, day] = date.split("-").map(Number);
  const start = hongKongMidnightUtc(year, month, day);

  return {
    startInclusive: new Date(start).toISOString(),
    endExclusive: new Date(start + DAY_MS).toISOString()
  };
}

export function getSummaryTimeRanges(now: Date): SummaryTimeRanges {
  const nowMs = now.getTime();
  const hongKongNow = new Date(nowMs + HONG_KONG_OFFSET_MS);
  const todayStart = hongKongMidnightUtc(
    hongKongNow.getUTCFullYear(),
    hongKongNow.getUTCMonth() + 1,
    hongKongNow.getUTCDate()
  );
  const endInclusive = now.toISOString();

  return {
    today: {
      startInclusive: new Date(todayStart).toISOString(),
      endInclusive
    },
    sevenDays: {
      startInclusive: new Date(nowMs - 7 * DAY_MS).toISOString(),
      endInclusive
    },
    thirtyDays: {
      startInclusive: new Date(nowMs - 30 * DAY_MS).toISOString(),
      endInclusive
    }
  };
}
