import type { DashboardFilters } from "./filters";
import { getHongKongDateRange, getSummaryTimeRanges } from "./time";
import type { VisitRow } from "../visits/types";

const PAGE_SIZE = 50;
export const MAX_EXPORT_ROWS = 5_000;

interface VisitDatabaseRow {
  id: number;
  visited_at_utc: string;
  ip_address: string;
  method: string;
  host: string;
  path: string;
  query_string: string;
  referrer: string;
  user_agent: string;
  browser_summary: string;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  colo: string | null;
  cf_ray: string | null;
  is_suspected_bot: number;
}

export interface VisitPage {
  items: VisitRow[];
  page: number;
  pageSize: 50;
  hasNext: boolean;
}

export interface SummaryCount {
  totalVisits: number;
  distinctNetworkAddresses: number;
}

export interface DashboardSummary {
  today: SummaryCount;
  sevenDays: SummaryCount;
  thirtyDays: SummaryCount;
}

interface AggregateRow {
  total_visits: number;
  distinct_network_addresses: number;
}

function escapeLikeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildWhere(filters: DashboardFilters): {
  sql: string;
  values: Array<string | number>;
} {
  const fragments: string[] = [];
  const values: Array<string | number> = [];

  if (filters.bots === "exclude") {
    fragments.push("is_suspected_bot = 0");
  } else if (filters.bots === "only") {
    fragments.push("is_suspected_bot = 1");
  }

  if (filters.from) {
    fragments.push("visited_at_utc >= ?");
    values.push(getHongKongDateRange(filters.from).startInclusive);
  }
  if (filters.to) {
    fragments.push("visited_at_utc < ?");
    values.push(getHongKongDateRange(filters.to).endExclusive);
  }
  if (filters.ip) {
    fragments.push("ip_address LIKE ? ESCAPE '\\'");
    values.push(`%${escapeLikeLiteral(filters.ip)}%`);
  }
  if (filters.country) {
    fragments.push("country = ?");
    values.push(filters.country);
  }
  if (filters.path) {
    fragments.push("path LIKE ? ESCAPE '\\'");
    values.push(`%${escapeLikeLiteral(filters.path)}%`);
  }

  return {
    sql: fragments.length > 0 ? ` WHERE ${fragments.join(" AND ")}` : "",
    values
  };
}

function toVisitRow(row: VisitDatabaseRow): VisitRow {
  return {
    id: row.id,
    visitedAtUtc: row.visited_at_utc,
    ipAddress: row.ip_address,
    method: row.method,
    host: row.host,
    path: row.path,
    queryString: row.query_string,
    referrer: row.referrer,
    userAgent: row.user_agent,
    browserSummary: row.browser_summary,
    country: row.country,
    region: row.region,
    city: row.city,
    asn: row.asn,
    colo: row.colo,
    cfRay: row.cf_ray,
    isSuspectedBot: row.is_suspected_bot === 1
  };
}

export async function getVisitPage(
  db: D1Database,
  filters: DashboardFilters
): Promise<VisitPage> {
  const where = buildWhere(filters);
  const offset = (filters.page - 1) * PAGE_SIZE;
  const result = await db
    .prepare(
      `SELECT
        id, visited_at_utc, ip_address, method, host, path, query_string,
        referrer, user_agent, browser_summary, country, region, city, asn,
        colo, cf_ray, is_suspected_bot
      FROM visits${where.sql}
      ORDER BY visited_at_utc DESC, id DESC
      LIMIT ? OFFSET ?`
    )
    .bind(...where.values, PAGE_SIZE + 1, offset)
    .all<VisitDatabaseRow>();

  return {
    items: result.results.slice(0, PAGE_SIZE).map(toVisitRow),
    page: filters.page,
    pageSize: PAGE_SIZE,
    hasNext: result.results.length > PAGE_SIZE
  };
}

export async function getVisitsForExport(
  db: D1Database,
  filters: DashboardFilters
): Promise<VisitRow[]> {
  const where = buildWhere(filters);
  const result = await db
    .prepare(
      `SELECT
        id, visited_at_utc, ip_address, method, host, path, query_string,
        referrer, user_agent, browser_summary, country, region, city, asn,
        colo, cf_ray, is_suspected_bot
      FROM visits${where.sql}
      ORDER BY visited_at_utc DESC, id DESC
      LIMIT ?`
    )
    .bind(...where.values, MAX_EXPORT_ROWS)
    .all<VisitDatabaseRow>();

  return result.results.map(toVisitRow);
}

async function countRange(
  db: D1Database,
  startInclusive: string,
  endInclusive: string
): Promise<SummaryCount> {
  const row = await db
    .prepare(
      `SELECT
        COUNT(*) AS total_visits,
        COUNT(DISTINCT ip_address) AS distinct_network_addresses
      FROM visits
      WHERE is_suspected_bot = 0
        AND visited_at_utc >= ?
        AND visited_at_utc <= ?`
    )
    .bind(startInclusive, endInclusive)
    .first<AggregateRow>();

  return {
    totalVisits: Number(row?.total_visits ?? 0),
    distinctNetworkAddresses: Number(row?.distinct_network_addresses ?? 0)
  };
}

export async function getDashboardSummary(
  db: D1Database,
  now: Date
): Promise<DashboardSummary> {
  const ranges = getSummaryTimeRanges(now);

  return {
    today: await countRange(
      db,
      ranges.today.startInclusive,
      ranges.today.endInclusive
    ),
    sevenDays: await countRange(
      db,
      ranges.sevenDays.startInclusive,
      ranges.sevenDays.endInclusive
    ),
    thirtyDays: await countRange(
      db,
      ranges.thirtyDays.startInclusive,
      ranges.thirtyDays.endInclusive
    )
  };
}
