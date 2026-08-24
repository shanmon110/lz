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
  botReason: "automated-browser" | null;
}
