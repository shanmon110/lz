import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey
} from "jose";
import { beforeAll, expect, test } from "vitest";

import { verifyAccessIdentity, type AccessConfig } from "../src/access";

const TEAM_DOMAIN = "https://lizhe.cloudflareaccess.com";
const POLICY_AUD = "visitor-logging-dashboard";
const ADMIN_EMAIL = "lizheqlut@gmail.com";
const KEY_ID = "access-test-key";

const config: AccessConfig = {
  ADMIN_EMAIL,
  POLICY_AUD,
  TEAM_DOMAIN
};

let trustedPrivateKey: CryptoKey;
let untrustedPrivateKey: CryptoKey;
let localKeySet: JWTVerifyGetKey;

beforeAll(async () => {
  const trusted = await generateKeyPair("RS256", { extractable: true });
  const untrusted = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(trusted.publicKey);

  trustedPrivateKey = trusted.privateKey;
  untrustedPrivateKey = untrusted.privateKey;
  localKeySet = createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "RS256", kid: KEY_ID, use: "sig" }]
  });
});

interface TokenOverrides {
  audience?: string;
  email?: string;
  expiresAt?: number;
  issuer?: string;
  privateKey?: CryptoKey;
}

async function accessToken(overrides: TokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = new SignJWT(
    overrides.email === undefined ? { email: "LizheQlut@Gmail.com" } : { email: overrides.email }
  )
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(overrides.issuer ?? TEAM_DOMAIN)
    .setAudience(overrides.audience ?? POLICY_AUD)
    .setIssuedAt(now)
    .setExpirationTime(overrides.expiresAt ?? now + 300);

  return token.sign(overrides.privateKey ?? trustedPrivateKey);
}

function requestWithToken(token?: string): Request {
  const headers = token === undefined ? undefined : { "Cf-Access-Jwt-Assertion": token };
  return new Request("https://logs.lizhe.link/", { headers });
}

async function expectForbidden(result: string | Response): Promise<void> {
  expect(result).toBeInstanceOf(Response);
  const response = result as Response;
  expect(response.status).toBe(403);
  expect(await response.text()).toBe("Forbidden");
}

test("returns the normalized exact administrator email for a fully verified Access JWT", async () => {
  const result = await verifyAccessIdentity(
    requestWithToken(await accessToken()),
    config,
    localKeySet
  );

  expect(result).toBe(ADMIN_EMAIL);
});

test.each(["ADMIN_EMAIL", "TEAM_DOMAIN", "POLICY_AUD"] as const)(
  "returns the common forbidden result when %s is missing",
  async (field) => {
    const incompleteConfig = { ...config, [field]: "" };

    await expectForbidden(
      await verifyAccessIdentity(
        requestWithToken(await accessToken()),
        incompleteConfig,
        localKeySet
      )
    );
  }
);

test("returns the common forbidden result when the Access assertion is missing", async () => {
  await expectForbidden(await verifyAccessIdentity(requestWithToken(), config, localKeySet));
});

test("returns the common forbidden result for a JWT with an untrusted signature", async () => {
  const token = await accessToken({ privateKey: untrustedPrivateKey });

  await expectForbidden(await verifyAccessIdentity(requestWithToken(token), config, localKeySet));
});

test("returns the common forbidden result for a JWT from the wrong issuer", async () => {
  const token = await accessToken({ issuer: "https://other.cloudflareaccess.com" });

  await expectForbidden(await verifyAccessIdentity(requestWithToken(token), config, localKeySet));
});

test("returns the common forbidden result for a JWT with the wrong audience", async () => {
  const token = await accessToken({ audience: "another-policy" });

  await expectForbidden(await verifyAccessIdentity(requestWithToken(token), config, localKeySet));
});

test("returns the common forbidden result for an expired JWT", async () => {
  const token = await accessToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });

  await expectForbidden(await verifyAccessIdentity(requestWithToken(token), config, localKeySet));
});

test("returns the common forbidden result when the JWT has no email", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(TEAM_DOMAIN)
    .setAudience(POLICY_AUD)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(trustedPrivateKey);

  await expectForbidden(await verifyAccessIdentity(requestWithToken(token), config, localKeySet));
});

test("returns the common forbidden result for another valid Gmail address", async () => {
  const token = await accessToken({ email: "another.valid.user@gmail.com" });

  await expectForbidden(await verifyAccessIdentity(requestWithToken(token), config, localKeySet));
});
