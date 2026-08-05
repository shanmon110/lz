import type { JWTVerifyGetKey } from "jose";

import { verifyAccessIdentity } from "../access";
import type { Env } from "../env";
import { withDashboardSecurityHeaders } from "../security-headers";
import { hongKongDateStamp, serializeVisitsCsv } from "./csv";
import {
  DashboardFilterError,
  parseDashboardFilters
} from "./filters";
import {
  getDashboardSummary,
  getVisitsForExport,
  getVisitPage
} from "./queries";

export interface DashboardRequestOptions {
  keySet?: JWTVerifyGetKey;
  now?: Date;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function csvResponse(body: string, now: Date): Response {
  const filename = `lizhe-visitor-logs-${hongKongDateStamp(now)}.csv`;
  return new Response(body, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8"
    }
  });
}

async function routeAuthenticatedRequest(
  request: Request,
  env: Env,
  now: Date
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse(
      { error: "Method Not Allowed" },
      405,
      { Allow: "GET" }
    );
  }

  const url = new URL(request.url);
  if (url.pathname === "/api/summary") {
    return jsonResponse(await getDashboardSummary(env.DB, now));
  }
  if (url.pathname === "/api/visits") {
    const filters = parseDashboardFilters(url.searchParams);
    return jsonResponse(await getVisitPage(env.DB, filters));
  }
  if (url.pathname === "/api/export.csv") {
    const filters = parseDashboardFilters(url.searchParams);
    const rows = await getVisitsForExport(env.DB, filters);
    return csvResponse(serializeVisitsCsv(rows), now);
  }

  return jsonResponse({ error: "Not Found" }, 404);
}

export async function handleDashboardRequest(
  request: Request,
  env: Env,
  options: DashboardRequestOptions = {}
): Promise<Response> {
  const identity = await verifyAccessIdentity(request, env, options.keySet);
  if (identity instanceof Response) {
    return withDashboardSecurityHeaders(identity);
  }

  try {
    const response = await routeAuthenticatedRequest(
      request,
      env,
      options.now ?? new Date()
    );
    return withDashboardSecurityHeaders(response);
  } catch (error) {
    const response = error instanceof DashboardFilterError
      ? jsonResponse({ error: "Invalid filters" }, 400)
      : jsonResponse({ error: "Internal Server Error" }, 500);
    return withDashboardSecurityHeaders(response);
  }
}
