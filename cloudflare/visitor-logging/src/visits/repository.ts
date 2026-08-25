import type { InsertVisitResult, VisitInput } from "./types";

export async function insertVisit(
  db: D1Database,
  visit: VisitInput
): Promise<InsertVisitResult> {
  const result = await db
    .prepare(
      `INSERT INTO visits (
        visited_at_utc, ip_address, method, host, path, query_string, referrer,
        user_agent, browser_summary, country, region, city, asn, colo, cf_ray,
        as_organization, continent, timezone, http_protocol, tls_version, client_tcp_rtt_ms,
        accept_language, sec_fetch_site, cf_bot_score, cf_verified_bot, cf_corporate_proxy,
        is_suspected_bot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      visit.visitedAtUtc,
      visit.ipAddress,
      visit.method,
      visit.host,
      visit.path,
      visit.queryString,
      visit.referrer,
      visit.userAgent,
      visit.browserSummary,
      visit.country,
      visit.region,
      visit.city,
      visit.asn,
      visit.colo,
      visit.cfRay,
      visit.asOrganization ?? null,
      visit.continent ?? null,
      visit.timezone ?? null,
      visit.httpProtocol ?? null,
      visit.tlsVersion ?? null,
      visit.clientTcpRttMs ?? null,
      visit.acceptLanguage ?? null,
      visit.secFetchSite ?? null,
      visit.cfBotScore ?? null,
      visit.cfVerifiedBot == null ? null : visit.cfVerifiedBot ? 1 : 0,
      visit.cfCorporateProxy == null ? null : visit.cfCorporateProxy ? 1 : 0,
      visit.isSuspectedBot ? 1 : 0
    )
    .run();

  return { id: Number(result.meta.last_row_id) };
}
