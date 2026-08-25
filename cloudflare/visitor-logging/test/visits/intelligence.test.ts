import { describe, expect, test } from "vitest";

import {
  CLASSIFICATION_VERSION,
  HOSTING_ASNS,
  RISK_WEIGHTS,
  buildVisitDecision,
  classifyRiskScore,
  isHostingNetwork
} from "../../src/visits/intelligence";
import type { VisitEvidence } from "../../src/visits/intelligence";

function baselineEvidence(overrides: Partial<VisitEvidence> = {}): VisitEvidence {
  return {
    asn: 13335,
    asOrganization: "Cloudflare, Inc.",
    browserSummary: "Chrome 124 on macOS",
    referrer: "https://lizhe.link/",
    cfBotScore: null,
    cfVerifiedBot: false,
    knownBotSignature: false,
    storedSuspectedBot: false,
    scannerPath: false,
    unlistedPage: false,
    scannerBurst: false,
    automatedBrowser: false,
    visitsWithin2m: 1,
    visitsPreceding24h: 1,
    ...overrides
  };
}

describe("hosting-network evidence", () => {
  test.each([24940, 16312, 14061, 31898, 132203])(
    "recognizes approved ASN %i",
    (asn) => {
      expect(HOSTING_ASNS).toContain(asn);
      expect(isHostingNetwork(asn, null)).toBe(true);
    }
  );

  test.each([
    "HETZNER Online GmbH",
    "Internet-Vikings International AB",
    "DigitalOcean, LLC",
    "Oracle Cloud Infrastructure",
    "Tencent Cloud Computing"
  ])("recognizes normalized provider name %s", (organization) => {
    expect(isHostingNetwork(null, organization)).toBe(true);
  });

  test("does not treat an unrelated network as hosting evidence", () => {
    expect(isHostingNetwork(13335, "Cloudflare, Inc.")).toBe(false);
  });
});

describe("buildVisitDecision", () => {
  test("returns the versioned zero-risk baseline", () => {
    expect(buildVisitDecision(baselineEvidence())).toEqual({
      visitorType: "Likely human",
      riskScore: 0,
      riskReasons: [],
      counted: true,
      classificationVersion: CLASSIFICATION_VERSION
    });
    expect(CLASSIFICATION_VERSION).toBe("risk-v1");
  });

  test.each([
    ["low Cloudflare bot score", { cfBotScore: 29 }, RISK_WEIGHTS.lowCloudflareBotScore, "Low Cloudflare bot score"],
    ["elevated Cloudflare bot risk", { cfBotScore: 30 }, RISK_WEIGHTS.elevatedCloudflareBotRisk, "Elevated Cloudflare bot risk"],
    ["hosting network", { asn: 24940 }, RISK_WEIGHTS.hostingNetwork, "Hosting network"],
    ["unknown browser", { browserSummary: "Unknown" }, RISK_WEIGHTS.unknownBrowser, "Unknown browser"],
    ["empty browser", { browserSummary: "" }, RISK_WEIGHTS.unknownBrowser, "Unknown browser"],
    ["no referrer", { referrer: "" }, RISK_WEIGHTS.noReferrer, "No referrer"],
    ["repeated requests", { visitsWithin2m: 2 }, RISK_WEIGHTS.repeatedRequests, "Repeated requests"],
    ["high 24h activity", { visitsPreceding24h: 10 }, RISK_WEIGHTS.high24hActivity, "High 24h activity"]
  ] as const)("adds the approved weight for %s", (_name, overrides, score, reason) => {
    expect(buildVisitDecision(baselineEvidence(overrides))).toMatchObject({
      riskScore: score,
      riskReasons: [reason]
    });
  });

  test("uses inclusive Bot Management score boundaries", () => {
    expect(buildVisitDecision(baselineEvidence({ cfBotScore: 49 })).riskScore).toBe(25);
    expect(buildVisitDecision(baselineEvidence({ cfBotScore: 50 })).riskScore).toBe(0);
  });

  test("forces verified bots and known User-Agent signatures to 100", () => {
    expect(buildVisitDecision(baselineEvidence({ cfVerifiedBot: true }))).toMatchObject({
      visitorType: "Known bot signature",
      riskScore: 100,
      riskReasons: ["Cloudflare verified bot"],
      counted: false
    });
    expect(buildVisitDecision(baselineEvidence({ knownBotSignature: true }))).toMatchObject({
      visitorType: "Known bot signature",
      riskScore: 100,
      riskReasons: ["Known bot signature"],
      counted: false
    });
  });

  test.each([
    ["stored suspected-bot flag", { storedSuspectedBot: true }, "Existing suspected-bot signal"],
    ["scanner path", { scannerPath: true }, "Scanner path"],
    ["unlisted page", { unlistedPage: true }, "Unlisted page"],
    ["scanner burst", { scannerBurst: true }, "Scanner burst"],
    ["automated-browser pattern", { automatedBrowser: true }, "Automated browser pattern"]
  ] as const)("sets a minimum score of 90 for %s", (_name, overrides, reason) => {
    expect(buildVisitDecision(baselineEvidence(overrides))).toMatchObject({
      visitorType: "Suspicious automation",
      riskScore: 90,
      riskReasons: [reason],
      counted: false
    });
  });

  test("adds independent signals, clamps at 100, and keeps reasons in approved order", () => {
    expect(
      buildVisitDecision(
        baselineEvidence({
          cfBotScore: 20,
          asn: 24940,
          browserSummary: "Unknown",
          referrer: "",
          visitsWithin2m: 2,
          visitsPreceding24h: 10
        })
      )
    ).toEqual({
      visitorType: "Suspicious automation",
      riskScore: 100,
      riskReasons: [
        "Low Cloudflare bot score",
        "Hosting network",
        "Unknown browser",
        "No referrer",
        "Repeated requests",
        "High 24h activity"
      ],
      counted: false,
      classificationVersion: "risk-v1"
    });
  });

  test("orders forced and existing-rule reasons before additive evidence", () => {
    expect(
      buildVisitDecision(
        baselineEvidence({
          cfVerifiedBot: true,
          knownBotSignature: true,
          storedSuspectedBot: true,
          scannerPath: true,
          unlistedPage: true,
          scannerBurst: true,
          automatedBrowser: true,
          cfBotScore: 20,
          asn: 24940,
          browserSummary: "Unknown",
          referrer: "",
          visitsWithin2m: 2,
          visitsPreceding24h: 10
        })
      ).riskReasons
    ).toEqual([
      "Cloudflare verified bot",
      "Known bot signature",
      "Existing suspected-bot signal",
      "Scanner path",
      "Unlisted page",
      "Scanner burst",
      "Automated browser pattern",
      "Low Cloudflare bot score",
      "Hosting network",
      "Unknown browser",
      "No referrer",
      "Repeated requests",
      "High 24h activity"
    ]);
  });

  test("keeps hosting evidence alone counted", () => {
    expect(buildVisitDecision(baselineEvidence({ asn: 24940 }))).toEqual({
      visitorType: "Likely human",
      riskScore: 30,
      riskReasons: ["Hosting network"],
      counted: true,
      classificationVersion: "risk-v1"
    });
  });

  test("matches all three approved decision examples", () => {
    const hetznerUnknownRepeat = baselineEvidence({
      asn: 24940,
      browserSummary: "Unknown",
      referrer: "",
      visitsWithin2m: 2
    });
    const digitalOceanChromeDirect = baselineEvidence({
      asn: 14061,
      referrer: ""
    });
    const normalBrowserDirect = baselineEvidence({ referrer: "" });

    expect(buildVisitDecision(hetznerUnknownRepeat)).toMatchObject({
      visitorType: "Suspicious automation",
      riskScore: 90,
      counted: false
    });
    expect(buildVisitDecision(digitalOceanChromeDirect)).toMatchObject({
      visitorType: "Uncertain",
      riskScore: 40,
      counted: true
    });
    expect(buildVisitDecision(normalBrowserDirect)).toMatchObject({
      visitorType: "Likely human",
      riskScore: 10,
      counted: true
    });
  });
});

test.each([
  [39, "Likely human", true],
  [40, "Uncertain", true],
  [69, "Uncertain", true],
  [70, "Suspicious automation", false]
] as const)("classifies risk threshold %i exactly", (riskScore, visitorType, counted) => {
  expect(classifyRiskScore(riskScore)).toEqual({ visitorType, counted });
});
