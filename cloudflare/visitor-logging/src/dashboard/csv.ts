import { MAX_EXPORT_ROWS } from "./queries";
import type { VisitRow } from "../visits/types";

const HEADERS = [
  "id",
  "visited_at_utc",
  "ip_address",
  "method",
  "host",
  "path",
  "query_string",
  "referrer",
  "user_agent",
  "browser_summary",
  "country",
  "region",
  "city",
  "asn",
  "colo",
  "cf_ray",
  "is_suspected_bot",
  "bot_reason"
] as const;

function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | boolean | null): string {
  const safe = neutralizeFormula(value === null ? "" : String(value));
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function rowValues(row: VisitRow): Array<string | number | boolean | null> {
  return [
    row.id,
    row.visitedAtUtc,
    row.ipAddress,
    row.method,
    row.host,
    row.path,
    row.queryString,
    row.referrer,
    row.userAgent,
    row.browserSummary,
    row.country,
    row.region,
    row.city,
    row.asn,
    row.colo,
    row.cfRay,
    row.isSuspectedBot,
    row.botReason
  ];
}

export function serializeVisitsCsv(rows: VisitRow[]): string {
  const records = [
    HEADERS.join(","),
    ...rows.slice(0, MAX_EXPORT_ROWS).map((row) =>
      rowValues(row).map(csvCell).join(",")
    )
  ];
  return records.join("\r\n");
}

export function hongKongDateStamp(now: Date): string {
  const hongKongOffsetMs = 8 * 60 * 60 * 1000;
  return new Date(now.getTime() + hongKongOffsetMs).toISOString().slice(0, 10);
}
