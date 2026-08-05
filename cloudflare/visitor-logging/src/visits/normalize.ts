import type { VisitInput } from "./types";
import { parseUserAgent } from "./user-agent";

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function optionalString(value: unknown, maximum: number): string | null {
  return typeof value === "string" ? truncateCodePoints(value, maximum) : null;
}

export function buildVisit(request: Request, now: Date): VisitInput {
  const url = new URL(request.url);
  const cf = request.cf as Record<string, unknown> | undefined;
  const userAgent = truncateCodePoints(request.headers.get("User-Agent") ?? "", 1_024);
  const agent = parseUserAgent(userAgent);

  return {
    visitedAtUtc: now.toISOString(),
    ipAddress: request.headers.get("CF-Connecting-IP") ?? "",
    method: request.method,
    host: truncateCodePoints(url.host, 253),
    path: truncateCodePoints(url.pathname, 2_048),
    queryString: truncateCodePoints(url.search.startsWith("?") ? url.search.slice(1) : url.search, 2_048),
    referrer: truncateCodePoints(request.headers.get("Referer") ?? "", 2_048),
    userAgent,
    browserSummary: truncateCodePoints(agent.browserSummary, 160),
    country: typeof cf?.country === "string" ? cf.country : null,
    region: optionalString(cf?.region, 128),
    city: optionalString(cf?.city, 128),
    asn: typeof cf?.asn === "number" ? cf.asn : null,
    colo: optionalString(cf?.colo, 3),
    cfRay: optionalString(request.headers.get("CF-Ray"), 64),
    isSuspectedBot: agent.isSuspectedBot
  };
}
