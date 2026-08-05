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
        is_suspected_bot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      visit.isSuspectedBot ? 1 : 0
    )
    .run();

  return { id: Number(result.meta.last_row_id) };
}
