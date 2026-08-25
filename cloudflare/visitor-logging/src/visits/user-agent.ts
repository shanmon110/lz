export interface UserAgentDetails {
  browserSummary: string;
  isSuspectedBot: boolean;
}

export interface CanonicalBotSignature {
  readonly value: string;
  readonly boundary: "token" | "prefix";
}

function frozenSignature(
  value: string,
  boundary: CanonicalBotSignature["boundary"]
): CanonicalBotSignature {
  return Object.freeze({ value, boundary });
}

// This is a best-effort suspected-bot heuristic, not Cloudflare Bot Management.
// Values are lowercase ASCII and require a safe left boundary. Token signatures
// also require a safe right boundary; prefixes intentionally cover versioned clients.
export const CANONICAL_BOT_SIGNATURES: readonly CanonicalBotSignature[] = Object.freeze([
  frozenSignature("bot", "token"),
  frozenSignature("crawler", "token"),
  frozenSignature("spider", "token"),
  frozenSignature("googlebot", "token"),
  frozenSignature("bingbot", "token"),
  frozenSignature("gptbot", "token"),
  frozenSignature("headless", "prefix"),
  frozenSignature("curl/", "prefix"),
  frozenSignature("wget/", "prefix"),
  frozenSignature("httpie/", "prefix"),
  frozenSignature("python-requests/", "prefix"),
  frozenSignature("postmanruntime/", "prefix"),
  frozenSignature("axios/", "prefix"),
  frozenSignature("java/", "prefix")
]);

export const CANONICAL_BOT_BROWSER_SUMMARIES: readonly string[] = Object.freeze([
  "Googlebot"
]);

function isAsciiWord(character: string | undefined): boolean {
  return character !== undefined && /[a-z0-9_]/.test(character);
}

function hasBoundedSignature(
  userAgent: string,
  signature: CanonicalBotSignature
): boolean {
  let fromIndex = 0;
  while (fromIndex <= userAgent.length - signature.value.length) {
    const index = userAgent.indexOf(signature.value, fromIndex);
    if (index === -1) return false;
    const before = index === 0 ? undefined : userAgent[index - 1];
    const after = userAgent[index + signature.value.length];
    if (!isAsciiWord(before) && (
      signature.boundary === "prefix" || !isAsciiWord(after)
    )) return true;
    fromIndex = index + 1;
  }
  return false;
}

export function hasKnownBotSignature(userAgent: string): boolean {
  const normalized = userAgent.toLowerCase();
  return CANONICAL_BOT_SIGNATURES.some((signature) =>
    hasBoundedSignature(normalized, signature)
  );
}

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
  const formFactor = /iPad|Tablet/i.test(userAgent) ? "Tablet " : /Mobile/i.test(userAgent) ? "Mobile " : "";
  const candidates: Array<[string, RegExp]> = [
    ["Edge", /Edg\/([\d]+)/i],
    ["Chrome", /(?:Chrome|CriOS)\/([\d]+)/i],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d]+)/i],
    ["Safari", /Version\/([\d]+).*Safari\//i]
  ];
  for (const [browser, pattern] of candidates) {
    const version = majorVersion(userAgent, pattern);
    if (version !== undefined) return `${formFactor}${browser} ${version} on ${device}`;
  }
  return "Unknown";
}

export function parseUserAgent(userAgent: string): UserAgentDetails {
  return {
    browserSummary: browserSummary(userAgent),
    isSuspectedBot: hasKnownBotSignature(userAgent)
  };
}
