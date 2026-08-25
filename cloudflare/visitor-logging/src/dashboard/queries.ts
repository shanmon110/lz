import type { DashboardFilters } from "./filters";
import { getHongKongDateRange, getSummaryTimeRanges } from "./time";
import { ALLOWED_VISIT_PATHS } from "../visits/allowed-pages";
import {
  HOSTING_ASNS,
  HOSTING_ORGANIZATION_IGNORED_CHARACTERS,
  HOSTING_ORGANIZATION_TOKENS,
  RISK_WEIGHTS,
  buildVisitDecision
} from "../visits/intelligence";
import type { VisitEvidence } from "../visits/intelligence";
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

function scannerBurstSql(tableName = "visits"): string {
  return `EXISTS (
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
    )`;
}

function effectiveBotSql(tableName = "visits"): string {
  return `(${tableName}.is_suspected_bot = 1
    OR ${unlistedPageSql(`${tableName}.path`)}
    OR ${scannerPathSql(`${tableName}.path`)}
    OR ${scannerBurstSql(tableName)}
    OR ${automatedBrowserSql(tableName)})`;
}

function knownBotSignatureSql(tableName = "visits"): string {
  const userAgent = `LOWER(${tableName}.user_agent)`;
  const paddedUserAgent = `(' ' || ${userAgent} || ' ')`;
  const boundedToken = (token: string): string =>
    `${paddedUserAgent} GLOB '*[^a-z0-9_]${token}[^a-z0-9_]*'`;
  const boundedPrefix = (prefix: string): string =>
    `${paddedUserAgent} GLOB '*[^a-z0-9_]${prefix}*'`;
  return `(${boundedToken("bot")}
    OR ${boundedToken("crawler")}
    OR ${boundedToken("spider")}
    OR ${userAgent} LIKE '%headless%'
    OR ${userAgent} LIKE '%curl/%'
    OR ${userAgent} LIKE '%wget/%'
    OR ${userAgent} LIKE '%httpie/%'
    OR ${userAgent} LIKE '%python-requests/%'
    OR ${userAgent} LIKE '%postmanruntime/%'
    OR ${boundedPrefix("axios/")}
    OR ${boundedPrefix("java/")})`;
}

function sqlCharacterExpression(character: string): string {
  const characterCode = character.charCodeAt(0);
  return characterCode <= 32
    ? `CHAR(${characterCode})`
    : sqlStringLiteral(character);
}

function normalizedOrganizationSql(column: string): string {
  return HOSTING_ORGANIZATION_IGNORED_CHARACTERS.reduce(
    (normalized, character) =>
      `REPLACE(${normalized}, ${sqlCharacterExpression(character)}, '')`,
    `LOWER(${column})`
  );
}

function hostingNetworkSql(tableName = "visits"): string {
  const asns = HOSTING_ASNS.join(", ");
  const organization = normalizedOrganizationSql(`${tableName}.as_organization`);
  const organizationMatches = HOSTING_ORGANIZATION_TOKENS.map((token) =>
    `${organization} LIKE ${sqlStringLiteral(`%${token}%`)}`
  ).join(" OR ");
  return `(${tableName}.asn IN (${asns}) OR ${organizationMatches})`;
}

function recognizedBrowserSql(tableName = "visits"): string {
  const summary = `${tableName}.browser_summary`;
  const browsers = ["Chrome", "Edge", "Firefox", "Safari"];
  const formFactors = ["", "Mobile ", "Tablet "];
  const platforms = ["Android", "iOS", "Windows", "macOS", "Linux", "Unknown"];
  const separatorPosition = `INSTR(${summary}, ' on ')`;
  const browserPart = `SUBSTR(${summary}, 1, ${separatorPosition} - 1)`;
  const platformPart = `SUBSTR(${summary}, ${separatorPosition} + 4)`;
  const names = formFactors.flatMap((formFactor) =>
    browsers.map((browser) => `${formFactor}${browser}`)
  );
  const browserMatches = names.map((name) => {
    const version = `SUBSTR(${browserPart}, ${name.length + 2})`;
    return `(${browserPart} = ${sqlStringLiteral(name)} OR (
      ${browserPart} GLOB ${sqlStringLiteral(`${name} [0-9]*`)}
      AND ${version} NOT GLOB '*[^0-9]*'
    ))`;
  });
  const platformMatches = platforms.map(
    (platform) => `${platformPart} = ${sqlStringLiteral(platform)}`
  );
  return `(${separatorPosition} > 0
    AND (${browserMatches.join(" OR ")})
    AND (${platformMatches.join(" OR ")}))`;
}

function effectiveBotEvidenceSql(tableName: string): string {
  return `(${tableName}.stored_suspected_bot = 1
    OR ${tableName}.scanner_path = 1
    OR ${tableName}.unlisted_page = 1
    OR ${tableName}.scanner_burst = 1
    OR ${tableName}.automated_browser = 1)`;
}

function additiveRiskScoreSql(tableName: string): string {
  return `(CASE
      WHEN ${tableName}.cf_bot_score BETWEEN 1 AND 29
        THEN ${RISK_WEIGHTS.lowCloudflareBotScore}
      WHEN ${tableName}.cf_bot_score BETWEEN 30 AND 49
        THEN ${RISK_WEIGHTS.elevatedCloudflareBotRisk}
      ELSE 0
    END
    + CASE WHEN ${tableName}.hosting_network = 1 THEN ${RISK_WEIGHTS.hostingNetwork} ELSE 0 END
    + CASE WHEN ${tableName}.unknown_browser = 1 THEN ${RISK_WEIGHTS.unknownBrowser} ELSE 0 END
    + CASE WHEN ${tableName}.referrer = '' THEN ${RISK_WEIGHTS.noReferrer} ELSE 0 END
    + CASE WHEN ${tableName}.visits_within_2m >= 2 THEN ${RISK_WEIGHTS.repeatedRequests} ELSE 0 END
    + CASE WHEN ${tableName}.visits_preceding_24h >= 10 THEN ${RISK_WEIGHTS.high24hActivity} ELSE 0 END)`;
}

function riskScoreSql(tableName: string): string {
  const additive = additiveRiskScoreSql(tableName);
  return `(CASE
    WHEN ${tableName}.cf_verified_bot = 1 OR ${tableName}.known_bot_signature = 1
      THEN ${RISK_WEIGHTS.forcedBot}
    ELSE MIN(
      ${RISK_WEIGHTS.forcedBot},
      MAX(
        ${additive},
        CASE WHEN ${effectiveBotEvidenceSql(tableName)}
          THEN ${RISK_WEIGHTS.effectiveBotMinimum}
          ELSE 0
        END
      )
    )
  END)`;
}

function countedSql(tableName = "scored_visits"): string {
  return `${tableName}.risk_score < ${RISK_WEIGHTS.suspiciousAutomationThreshold}`;
}

function visitEvidenceCteSql(): string {
  const preceding24hStart =
    "strftime('%Y-%m-%dT%H:%M:%fZ', visits.visited_at_utc, '-24 hours')";
  const twoMinutesBefore =
    "strftime('%Y-%m-%dT%H:%M:%fZ', visits.visited_at_utc, '-2 minutes')";
  const twoMinutesAfter =
    "strftime('%Y-%m-%dT%H:%M:%fZ', visits.visited_at_utc, '+2 minutes')";
  return `WITH visit_evidence AS (
    SELECT
      visits.id, visits.visited_at_utc, visits.ip_address, visits.method,
      visits.host, visits.path, visits.query_string, visits.referrer,
      visits.user_agent, visits.browser_summary, visits.country, visits.region,
      visits.city, visits.asn, visits.colo, visits.cf_ray,
      visits.as_organization, visits.continent, visits.timezone,
      visits.http_protocol, visits.tls_version, visits.client_tcp_rtt_ms,
      visits.accept_language, visits.sec_fetch_site, visits.cf_bot_score,
      visits.cf_verified_bot, visits.cf_corporate_proxy,
      CASE WHEN visits.is_suspected_bot = 1 THEN 1 ELSE 0 END AS stored_suspected_bot,
      CASE WHEN ${knownBotSignatureSql()} THEN 1 ELSE 0 END AS known_bot_signature,
      CASE WHEN ${scannerPathSql("visits.path")} THEN 1 ELSE 0 END AS scanner_path,
      CASE WHEN ${unlistedPageSql("visits.path")} THEN 1 ELSE 0 END AS unlisted_page,
      CASE WHEN ${scannerBurstSql()} THEN 1 ELSE 0 END AS scanner_burst,
      CASE WHEN ${automatedBrowserSql()} THEN 1 ELSE 0 END AS automated_browser,
      CASE WHEN ${hostingNetworkSql()} THEN 1 ELSE 0 END AS hosting_network,
      CASE WHEN ${recognizedBrowserSql()} THEN 0 ELSE 1 END AS unknown_browser,
      (SELECT MIN(ip_activity.visited_at_utc)
        FROM visits AS ip_activity
        WHERE ip_activity.ip_address = visits.ip_address) AS first_seen_utc,
      (SELECT MAX(ip_activity.visited_at_utc)
        FROM visits AS ip_activity
        WHERE ip_activity.ip_address = visits.ip_address) AS last_seen_utc,
      (SELECT COUNT(*)
        FROM visits AS ip_activity
        WHERE ip_activity.ip_address = visits.ip_address) AS retained_visit_count,
      (SELECT COUNT(*)
        FROM visits AS ip_activity
        WHERE ip_activity.ip_address = visits.ip_address
          AND ip_activity.visited_at_utc >= ${preceding24hStart}
          AND ip_activity.visited_at_utc <= visits.visited_at_utc) AS visits_preceding_24h,
      (SELECT COUNT(*)
        FROM visits AS ip_activity
        WHERE ip_activity.ip_address = visits.ip_address
          AND ip_activity.visited_at_utc >= ${twoMinutesBefore}
          AND ip_activity.visited_at_utc <= ${twoMinutesAfter}) AS visits_within_2m,
      (SELECT COUNT(DISTINCT ip_activity.path)
        FROM visits AS ip_activity
        WHERE ip_activity.ip_address = visits.ip_address) AS distinct_path_count,
      CASE
        WHEN ${unlistedPageSql("visits.path")} THEN 'unlisted-page'
        WHEN ${automatedBrowserSql()} THEN 'automated-browser'
        ELSE NULL
      END AS bot_reason
    FROM visits
  ), scored_visits AS (
    SELECT visit_evidence.*, ${riskScoreSql("visit_evidence")} AS risk_score
    FROM visit_evidence
  )`;
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
  as_organization: string | null;
  continent: string | null;
  timezone: string | null;
  http_protocol: string | null;
  tls_version: string | null;
  client_tcp_rtt_ms: number | null;
  accept_language: string | null;
  sec_fetch_site: string | null;
  cf_bot_score: number | null;
  cf_verified_bot: number | null;
  cf_corporate_proxy: number | null;
  stored_suspected_bot: number;
  known_bot_signature: number;
  scanner_path: number;
  unlisted_page: number;
  scanner_burst: number;
  automated_browser: number;
  first_seen_utc: string;
  last_seen_utc: string;
  retained_visit_count: number;
  visits_preceding_24h: number;
  visits_within_2m: number;
  distinct_path_count: number;
  risk_score: number;
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
  const tableName = "scored_visits";

  if (filters.bots === "exclude") {
    fragments.push(countedSql(tableName));
  } else if (filters.bots === "only") {
    fragments.push(`NOT ${countedSql(tableName)}`);
  }

  if (filters.from) {
    fragments.push(`${tableName}.visited_at_utc >= ?`);
    values.push(getHongKongDateRange(filters.from).startInclusive);
  }
  if (filters.to) {
    fragments.push(`${tableName}.visited_at_utc < ?`);
    values.push(getHongKongDateRange(filters.to).endExclusive);
  }
  if (filters.ip) {
    fragments.push(`${tableName}.ip_address LIKE ? ESCAPE '\\'`);
    values.push(`%${escapeLikeLiteral(filters.ip)}%`);
  }
  if (filters.country) {
    fragments.push(`${tableName}.country = ?`);
    values.push(filters.country);
  }
  if (filters.path) {
    fragments.push(`${tableName}.path LIKE ? ESCAPE '\\'`);
    values.push(`%${escapeLikeLiteral(filters.path)}%`);
  }

  return {
    sql: fragments.length > 0 ? ` WHERE ${fragments.join(" AND ")}` : "",
    values
  };
}

function toVisitRow(row: VisitDatabaseRow): VisitRow {
  const evidence: VisitEvidence = {
    asn: row.asn,
    asOrganization: row.as_organization,
    browserSummary: row.browser_summary,
    referrer: row.referrer,
    cfBotScore: row.cf_bot_score,
    cfVerifiedBot: row.cf_verified_bot === 1,
    knownBotSignature: row.known_bot_signature === 1,
    storedSuspectedBot: row.stored_suspected_bot === 1,
    scannerPath: row.scanner_path === 1,
    unlistedPage: row.unlisted_page === 1,
    scannerBurst: row.scanner_burst === 1,
    automatedBrowser: row.automated_browser === 1,
    visitsWithin2m: Number(row.visits_within_2m),
    visitsPreceding24h: Number(row.visits_preceding_24h)
  };
  const decision = buildVisitDecision(evidence);
  const sqlRiskScore = Number(row.risk_score);
  if (decision.riskScore !== sqlRiskScore) {
    throw new Error(`Risk score mismatch for visit ${row.id}`);
  }

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
    asOrganization: row.as_organization,
    continent: row.continent,
    timezone: row.timezone,
    httpProtocol: row.http_protocol,
    tlsVersion: row.tls_version,
    clientTcpRttMs: row.client_tcp_rtt_ms,
    acceptLanguage: row.accept_language,
    secFetchSite: row.sec_fetch_site,
    cfBotScore: row.cf_bot_score,
    cfVerifiedBot: row.cf_verified_bot === null ? null : row.cf_verified_bot === 1,
    cfCorporateProxy:
      row.cf_corporate_proxy === null ? null : row.cf_corporate_proxy === 1,
    firstSeenUtc: row.first_seen_utc,
    lastSeenUtc: row.last_seen_utc,
    retainedVisitCount: Number(row.retained_visit_count),
    visitsPreceding24h: Number(row.visits_preceding_24h),
    visitsWithin2m: Number(row.visits_within_2m),
    distinctPathCount: Number(row.distinct_path_count),
    ...decision,
    isSuspectedBot: !decision.counted,
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
      `${visitEvidenceCteSql()}
      SELECT *
      FROM scored_visits${where.sql}
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
      `${visitEvidenceCteSql()}
      SELECT *
      FROM scored_visits${where.sql}
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
      `${visitEvidenceCteSql()}
      SELECT
        COUNT(*) AS total_visits,
        COUNT(DISTINCT ip_address) AS distinct_network_addresses
      FROM scored_visits
      WHERE ${countedSql()}
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
