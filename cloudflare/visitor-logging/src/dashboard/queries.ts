import type { DashboardFilters } from "./filters";
import { getHongKongDateRange, getSummaryTimeRanges } from "./time";
import { ALLOWED_VISIT_PATHS } from "../visits/allowed-pages";
import type { VisitRow } from "../visits/types";

const PAGE_SIZE = 50;
export const MAX_EXPORT_ROWS = 5_000;

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function canonicalPathSql(pathColumn: string): string {
  return `(CASE
    WHEN ${pathColumn} <> '/' AND SUBSTR(${pathColumn}, -1) = '/'
      THEN SUBSTR(${pathColumn}, 1, LENGTH(${pathColumn}) - 1)
    ELSE ${pathColumn}
  END)`;
}

function unlistedPageSql(pathColumn: string): string {
  const allowedPaths = ALLOWED_VISIT_PATHS.flatMap((path) =>
    path === "/" ? [path] : [path, `${path}/`]
  ).map(sqlStringLiteral).join(", ");
  return `${pathColumn} NOT IN (${allowedPaths})`;
}

function scannerPathSql(pathColumn: string): string {
  return `(LOWER(${pathColumn}) LIKE '/wp-%'
    OR LOWER(${pathColumn}) LIKE '/wp/%'
    OR LOWER(${pathColumn}) LIKE '%.php'
    OR LOWER(${pathColumn}) LIKE '%.php/%'
    OR LOWER(${pathColumn}) = '/.env'
    OR LOWER(${pathColumn}) LIKE '/.env.%'
    OR LOWER(${pathColumn}) = '/.git'
    OR LOWER(${pathColumn}) LIKE '/.git/%'
    OR LOWER(${pathColumn}) = '/robots.txt')`;
}

function knownSiteReferrerSql(referrerColumn: string): string {
  return `(LOWER(${referrerColumn}) LIKE 'https://lizhe.link/%'
    OR LOWER(${referrerColumn}) LIKE 'http://lizhe.link/%'
    OR LOWER(${referrerColumn}) LIKE 'https://www.lizhe.link/%'
    OR LOWER(${referrerColumn}) LIKE 'http://www.lizhe.link/%'
    OR LOWER(${referrerColumn}) LIKE 'https://shanmon110.github.io/lz/%')`;
}

function oracleAutomatedBrowserSql(tableName: string): string {
  return `(${tableName}.asn = 31898
    AND ${tableName}.browser_summary = 'Chrome 139 on Linux'
    AND EXISTS (
      SELECT 1
      FROM visits AS automated_browser_pair
      WHERE automated_browser_pair.id <> ${tableName}.id
        AND automated_browser_pair.ip_address = ${tableName}.ip_address
        AND ${canonicalPathSql("automated_browser_pair.path")} = ${canonicalPathSql(`${tableName}.path`)}
        AND automated_browser_pair.asn = 31898
        AND automated_browser_pair.browser_summary = 'Chrome 139 on Linux'
        AND (
          ${knownSiteReferrerSql(`${tableName}.referrer`)}
          OR ${knownSiteReferrerSql("automated_browser_pair.referrer")}
        )
        AND ABS(
          ROUND(julianday(automated_browser_pair.visited_at_utc) * 86400000.0) -
          ROUND(julianday(${tableName}.visited_at_utc) * 86400000.0)
        ) <= 1000
    ))`;
}

function tencentAutomatedBrowserSql(tableName: string): string {
  return `(${tableName}.asn = 132203
    AND (
      (
        ${tableName}.browser_summary = 'Mobile Safari 13 on iOS'
        AND (
          ${knownSiteReferrerSql(`${tableName}.referrer`)}
          OR (
            ${canonicalPathSql(`${tableName}.path`)} = '/'
            AND ${tableName}.referrer = ''
          )
        )
      )
      OR (
        ${tableName}.browser_summary = 'Chrome 106 on Windows'
        AND ${canonicalPathSql(`${tableName}.path`)} = '/'
        AND ${tableName}.referrer = ''
      )
    ))`;
}

function automatedBrowserSql(tableName = "visits"): string {
  return `(${oracleAutomatedBrowserSql(tableName)}
    OR ${tencentAutomatedBrowserSql(tableName)})`;
}

function effectiveBotSql(tableName = "visits"): string {
  return `(${tableName}.is_suspected_bot = 1
    OR ${unlistedPageSql(`${tableName}.path`)}
    OR ${scannerPathSql(`${tableName}.path`)}
    OR EXISTS (
      SELECT 1
      FROM visits AS scanner_probe
      WHERE scanner_probe.ip_address = ${tableName}.ip_address
        AND ABS(
          unixepoch(scanner_probe.visited_at_utc) -
          unixepoch(${tableName}.visited_at_utc)
        ) <= 60
        AND ${scannerPathSql("scanner_probe.path")}
      GROUP BY scanner_probe.ip_address
      HAVING COUNT(DISTINCT LOWER(scanner_probe.path)) >= 4
    )
    OR ${automatedBrowserSql(tableName)})`;
}

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
  bot_reason: "automated-browser" | "unlisted-page" | null;
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
    fragments.push(`NOT ${effectiveBotSql()}`);
  } else if (filters.bots === "only") {
    fragments.push(effectiveBotSql());
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
    isSuspectedBot: row.is_suspected_bot === 1,
    botReason: row.bot_reason
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
        colo, cf_ray,
        CASE WHEN ${effectiveBotSql()} THEN 1 ELSE 0 END AS is_suspected_bot,
        CASE
          WHEN ${unlistedPageSql("visits.path")} THEN 'unlisted-page'
          WHEN ${automatedBrowserSql()} THEN 'automated-browser'
          ELSE NULL
        END AS bot_reason
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
        colo, cf_ray,
        CASE WHEN ${effectiveBotSql()} THEN 1 ELSE 0 END AS is_suspected_bot,
        CASE
          WHEN ${unlistedPageSql("visits.path")} THEN 'unlisted-page'
          WHEN ${automatedBrowserSql()} THEN 'automated-browser'
          ELSE NULL
        END AS bot_reason
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
      WHERE NOT ${effectiveBotSql()}
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
