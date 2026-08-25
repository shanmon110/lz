export interface VisitInput {
  visitedAtUtc: string;
  ipAddress: string;
  method: string;
  host: string;
  path: string;
  queryString: string;
  referrer: string;
  userAgent: string;
  browserSummary: string;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  colo: string | null;
  cfRay: string | null;
  asOrganization?: string | null;
  continent?: string | null;
  timezone?: string | null;
  httpProtocol?: string | null;
  tlsVersion?: string | null;
  clientTcpRttMs?: number | null;
  acceptLanguage?: string | null;
  secFetchSite?: string | null;
  cfBotScore?: number | null;
  cfVerifiedBot?: boolean | null;
  cfCorporateProxy?: boolean | null;
  isSuspectedBot: boolean;
}

export interface InsertVisitResult {
  id: number;
}

export interface VisitRow {
  id: number;
  visitedAtUtc: string;
  ipAddress: string;
  method: string;
  host: string;
  path: string;
  queryString: string;
  referrer: string;
  userAgent: string;
  browserSummary: string;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  colo: string | null;
  cfRay: string | null;
  isSuspectedBot: boolean;
  botReason: "automated-browser" | "unlisted-page" | null;
}
