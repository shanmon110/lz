export const CLASSIFICATION_VERSION = "risk-v1" as const;

export const HOSTING_ASNS: readonly number[] = Object.freeze([
  24940,
  16312,
  14061,
  31898,
  132203
]);

export const HOSTING_ORGANIZATION_TOKENS: readonly string[] = Object.freeze([
  "hetzner",
  "internetvikings",
  "digitalocean",
  "oraclecloud",
  "tencentcloud"
]);

export const HOSTING_ORGANIZATION_IGNORED_CHARACTERS: readonly string[] = Object.freeze([
  " ",
  "\t",
  "\n",
  "\r",
  "-",
  "_",
  ".",
  ",",
  "/",
  "&",
  "(",
  ")"
]);

export const RISK_WEIGHTS = Object.freeze({
  forcedBot: 100,
  effectiveBotMinimum: 90,
  lowCloudflareBotScore: 50,
  elevatedCloudflareBotRisk: 25,
  hostingNetwork: 30,
  unknownBrowser: 25,
  noReferrer: 10,
  repeatedRequests: 25,
  high24hActivity: 10,
  suspiciousAutomationThreshold: 70,
  uncertainThreshold: 40
} as const);

export type VisitorType =
  | "Known bot signature"
  | "Suspicious automation"
  | "Uncertain"
  | "Likely human";

export interface VisitEvidence {
  asn: number | null;
  asOrganization: string | null;
  hostingNetwork?: boolean;
  browserSummary: string;
  referrer: string;
  cfBotScore: number | null;
  cfVerifiedBot: boolean;
  knownBotSignature: boolean;
  storedSuspectedBot: boolean;
  scannerPath: boolean;
  unlistedPage: boolean;
  scannerBurst: boolean;
  automatedBrowser: boolean;
  visitsWithin2m: number;
  visitsPreceding24h: number;
}

export interface VisitDecision {
  visitorType: VisitorType;
  riskScore: number;
  riskReasons: string[];
  counted: boolean;
  classificationVersion: typeof CLASSIFICATION_VERSION;
}

function normalizedOrganization(value: string): string {
  return HOSTING_ORGANIZATION_IGNORED_CHARACTERS.reduce(
    (normalized, character) => normalized.split(character).join(""),
    value.toLowerCase()
  );
}

export function isHostingNetwork(
  asn: number | null,
  asOrganization: string | null
): boolean {
  if (asn !== null && HOSTING_ASNS.includes(asn)) return true;
  if (asOrganization === null) return false;

  const organization = normalizedOrganization(asOrganization);
  return HOSTING_ORGANIZATION_TOKENS.some((token) =>
    organization.includes(token)
  );
}

function isRecognizedBrowser(browserSummary: string): boolean {
  return /^(?:(?:Mobile|Tablet) )?(?:Chrome|Edge|Firefox|Safari)(?: \d+)? on (?:Android|iOS|Windows|macOS|Linux|Unknown)$/.test(
    browserSummary
  );
}

export function classifyRiskScore(riskScore: number): {
  visitorType: Exclude<VisitorType, "Known bot signature">;
  counted: boolean;
} {
  if (riskScore >= RISK_WEIGHTS.suspiciousAutomationThreshold) {
    return { visitorType: "Suspicious automation", counted: false };
  }
  if (riskScore >= RISK_WEIGHTS.uncertainThreshold) {
    return { visitorType: "Uncertain", counted: true };
  }
  return { visitorType: "Likely human", counted: true };
}

export function buildVisitDecision(evidence: VisitEvidence): VisitDecision {
  const riskReasons: string[] = [];
  let riskScore = 0;

  if (evidence.cfVerifiedBot) riskReasons.push("Cloudflare verified bot");
  if (evidence.knownBotSignature) riskReasons.push("Known bot signature");
  if (evidence.storedSuspectedBot) {
    riskReasons.push("Existing suspected-bot signal");
  }
  if (evidence.scannerPath) riskReasons.push("Scanner path");
  if (evidence.unlistedPage) riskReasons.push("Unlisted page");
  if (evidence.scannerBurst) riskReasons.push("Scanner burst");
  if (evidence.automatedBrowser) riskReasons.push("Automated browser pattern");

  if (evidence.cfBotScore !== null && evidence.cfBotScore <= 29) {
    riskScore += RISK_WEIGHTS.lowCloudflareBotScore;
    riskReasons.push("Low Cloudflare bot score");
  } else if (evidence.cfBotScore !== null && evidence.cfBotScore <= 49) {
    riskScore += RISK_WEIGHTS.elevatedCloudflareBotRisk;
    riskReasons.push("Elevated Cloudflare bot risk");
  }

  const hostingNetwork = evidence.hostingNetwork ?? isHostingNetwork(
    evidence.asn,
    evidence.asOrganization
  );
  if (hostingNetwork) {
    riskScore += RISK_WEIGHTS.hostingNetwork;
    riskReasons.push("Hosting network");
  }
  if (!isRecognizedBrowser(evidence.browserSummary)) {
    riskScore += RISK_WEIGHTS.unknownBrowser;
    riskReasons.push("Unknown browser");
  }
  if (evidence.referrer.length === 0) {
    riskScore += RISK_WEIGHTS.noReferrer;
    riskReasons.push("No referrer");
  }
  if (evidence.visitsWithin2m >= 2) {
    riskScore += RISK_WEIGHTS.repeatedRequests;
    riskReasons.push("Repeated requests");
  }
  if (evidence.visitsPreceding24h >= 10) {
    riskScore += RISK_WEIGHTS.high24hActivity;
    riskReasons.push("High 24h activity");
  }

  const hasForcedBotSignal =
    evidence.cfVerifiedBot || evidence.knownBotSignature;
  const hasEffectiveBotSignal =
    evidence.storedSuspectedBot ||
    evidence.scannerPath ||
    evidence.unlistedPage ||
    evidence.scannerBurst ||
    evidence.automatedBrowser;

  if (hasForcedBotSignal) {
    riskScore = RISK_WEIGHTS.forcedBot;
  } else if (hasEffectiveBotSignal) {
    riskScore = Math.max(riskScore, RISK_WEIGHTS.effectiveBotMinimum);
  }
  riskScore = Math.min(riskScore, 100);

  const classification = hasForcedBotSignal
    ? { visitorType: "Known bot signature" as const, counted: false }
    : classifyRiskScore(riskScore);

  return {
    ...classification,
    riskScore,
    riskReasons,
    classificationVersion: CLASSIFICATION_VERSION
  };
}
