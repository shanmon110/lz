export interface UserAgentDetails {
  browserSummary: string;
  isSuspectedBot: boolean;
}

// This is a best-effort suspected-bot heuristic, not Cloudflare Bot Management.
// It covers common bot/crawler/spider, headless, and command-line client tokens.
const SUSPECTED_BOT_PATTERN = /(?:\bbot\b|\bcrawler\b|\bspider\b|headless|curl\/|wget\/|httpie\/|python-requests\/|postmanruntime\/|\baxios\/|\bjava\/)/i;

function majorVersion(userAgent: string, pattern: RegExp): string | undefined {
  return pattern.exec(userAgent)?.[1];
}

function platform(userAgent: string): string {
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Windows NT/i.test(userAgent)) return "Windows";
  if (/Macintosh/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Unknown";
}

function browserSummary(userAgent: string): string {
  if (userAgent.length === 0) return "Unknown";
  if (/Googlebot/i.test(userAgent)) return "Googlebot";
  if (/curl\//i.test(userAgent)) return "curl";

  const device = platform(userAgent);
  const mobile = /Mobile/i.test(userAgent) ? "Mobile " : "";
  const candidates: Array<[string, RegExp]> = [
    ["Edge", /Edg\/([\d]+)/i],
    ["Chrome", /(?:Chrome|CriOS)\/([\d]+)/i],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d]+)/i],
    ["Safari", /Version\/([\d]+).*Safari\//i]
  ];
  for (const [browser, pattern] of candidates) {
    const version = majorVersion(userAgent, pattern);
    if (version !== undefined) return `${mobile}${browser} ${version} on ${device}`;
  }
  return "Unknown";
}

export function parseUserAgent(userAgent: string): UserAgentDetails {
  return {
    browserSummary: browserSummary(userAgent),
    isSuspectedBot: SUSPECTED_BOT_PATTERN.test(userAgent)
  };
}
