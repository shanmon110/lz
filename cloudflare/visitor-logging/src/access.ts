import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey
} from "jose";

import type { Env } from "./env";

export type AccessConfig = Pick<Env, "ADMIN_EMAIL" | "POLICY_AUD" | "TEAM_DOMAIN">;

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}

function hasRequiredConfig(config: AccessConfig): boolean {
  return Boolean(config.ADMIN_EMAIL && config.POLICY_AUD && config.TEAM_DOMAIN);
}

function remoteKeySet(teamDomain: string): JWTVerifyGetKey {
  const cached = remoteKeySets.get(teamDomain);
  if (cached) {
    return cached;
  }

  const keySet = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  remoteKeySets.set(teamDomain, keySet);
  return keySet;
}

export async function verifyAccessIdentity(
  request: Request,
  config: AccessConfig,
  keySet?: JWTVerifyGetKey
): Promise<string | Response> {
  if (!hasRequiredConfig(config)) {
    return forbidden();
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return forbidden();
  }

  try {
    const { payload } = await jwtVerify(token, keySet ?? remoteKeySet(config.TEAM_DOMAIN), {
      algorithms: ["RS256"],
      audience: config.POLICY_AUD,
      issuer: config.TEAM_DOMAIN
    });
    if (typeof payload.exp !== "number" || typeof payload.email !== "string") {
      return forbidden();
    }

    const email = payload.email.toLowerCase();
    if (email !== config.ADMIN_EMAIL.toLowerCase()) {
      return forbidden();
    }

    return email;
  } catch {
    return forbidden();
  }
}
