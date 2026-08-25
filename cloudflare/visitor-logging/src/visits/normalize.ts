import type { VisitInput } from "./types";
import { isAllowedVisitPath } from "./allowed-pages";
import { isScannerPath } from "./scanner";
import { parseUserAgent } from "./user-agent";

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function optionalString(value: unknown, maximum: number): string | null {
  return typeof value === "string" ? truncateCodePoints(value, maximum) : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function botScore(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99
    ? value
    : null;
}

function tcpRtt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 600_000
    ? value
    : null;
}

function secFetchSite(value: string | null): string | null {
  return value === "none" || value === "same-origin" || value === "same-site" || value === "cross-site"
    ? value
    : null;
}

function sanitizeReferrer(value: string | null): string {
  if (value === null) return "";

  try {
    const url = new URL(value);
    if (url.hostname.length === 0) return "";
    return truncateCodePoints(`${url.protocol}//${url.host}${url.pathname}`, 2_048);
  } catch {
    return "";
  }
}

export function buildVisit(request: Request, now: Date): VisitInput {
  const url = new URL(request.url);
  const cf = request.cf as Record<string, unknown> | undefined;
  const botManagement = cf?.botManagement as Record<string, unknown> | undefined;
  const userAgent = truncateCodePoints(request.headers.get("User-Agent") ?? "", 1_024);
  const agent = parseUserAgent(userAgent);

  return {
    visitedAtUtc: now.toISOString(),
    ipAddress: request.headers.get("CF-Connecting-IP") ?? "",
    method: request.method,
    host: truncateCodePoints(url.host, 253),
    path: truncateCodePoints(url.pathname, 2_048),
    queryString: "",
    referrer: sanitizeReferrer(request.headers.get("Referer")),
    userAgent,
    browserSummary: truncateCodePoints(agent.browserSummary, 160),
    country: typeof cf?.country === "string" ? cf.country : null,
    region: optionalString(cf?.region, 128),
    city: optionalString(cf?.city, 128),
    asn: typeof cf?.asn === "number" ? cf.asn : null,
    colo: optionalString(cf?.colo, 3),
    cfRay: optionalString(request.headers.get("CF-Ray"), 64),
    asOrganization: optionalString(cf?.asOrganization, 256),
    continent: optionalString(cf?.continent, 2),
    timezone: optionalString(cf?.timezone, 64),
    httpProtocol: optionalString(cf?.httpProtocol, 32),
    tlsVersion: optionalString(cf?.tlsVersion, 32),
    clientTcpRttMs: tcpRtt(cf?.clientTcpRtt),
    acceptLanguage: optionalString(request.headers.get("Accept-Language"), 256),
    secFetchSite: secFetchSite(request.headers.get("Sec-Fetch-Site")),
    cfBotScore: botScore(botManagement?.score),
    cfVerifiedBot: nullableBoolean(botManagement?.verifiedBot),
    cfCorporateProxy: nullableBoolean(botManagement?.corporateProxy),
    isSuspectedBot:
      agent.isSuspectedBot ||
      isScannerPath(url.pathname) ||
      !isAllowedVisitPath(url.pathname)
  };
}
