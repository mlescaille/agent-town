import { CHECKPOINT_AUD, ISSUER_ID, LICENSE_TYP, SKEW_SECONDS } from "./constants.js";
import { LicenseError } from "./errors.js";
import { signJws, verifyJws } from "./jws.js";
import { newId, publicJwk } from "./keys.js";
import { requestHash, verifyUserRequest } from "./request.js";
import { defaultIdentity } from "./statement.js";
import type { LicenseClaims, OkpPrivateJwk, OkpPublicJwk, Principal } from "./types.js";
import { checkTimeWindow, parseLicenseClaims } from "./validate.js";

export interface IssueLicenseInput {
  userRequestJws: string;
  issuerKey: OkpPrivateJwk;
  userKeys: Record<string, OkpPublicJwk>;
  agentKeys: Record<string, OkpPublicJwk>;
  ttlSeconds?: number;
  now?: number;
  jti?: string;
}

/**
 * Verify a user-signed request and mint a license. The issuer key signs the
 * license. The agent key is not a signing key here; it must merely be enrolled
 * so a later justification can be checked.
 */
export function issueLicense(input: IssueLicenseInput): { license: string; claims: LicenseClaims } {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const request = verifyUserRequest(input.userRequestJws, input.userKeys, now);
  if (!input.agentKeys[request.agent]) {
    throw new LicenseError("unknown_agent", `issuer has no key for ${request.agent}`);
  }
  const ttl = input.ttlSeconds ?? request.exp - now;
  if (!Number.isSafeInteger(ttl) || ttl < 1) {
    throw new LicenseError("malformed", "license ttl must be a positive integer");
  }
  const exp = Math.min(request.exp, now + ttl);
  if (exp <= now) throw new LicenseError("expired", "user request leaves no validity window");
  const identity = defaultIdentity(request.agent, request.mandate);
  const principal: Principal = request.principal ?? { type: "user", user: request.sub };
  const claims: LicenseClaims = {
    iss: ISSUER_ID,
    sub: request.sub,
    aud: CHECKPOINT_AUD,
    iat: now,
    nbf: now,
    exp,
    jti: input.jti ?? newId("lic_"),
    agent: request.agent,
    principal,
    act: {
      sub: request.agent,
      instance: request.instance ?? identity.instance,
      name: request.name ?? identity.name,
      task: request.task ?? identity.task,
      on_behalf_of: principal,
    },
    mandate: request.mandate,
    authorization_details: request.authorization_details,
    txn: request.jti,
    req_hash: requestHash(input.userRequestJws),
  };
  const normalized = parseLicenseClaims(claims as unknown as Record<string, unknown>);
  const license = signJws(normalized as unknown as Record<string, unknown>, input.issuerKey, LICENSE_TYP);
  return { license, claims: normalized };
}

export function verifyLicense(
  token: string,
  issuerKey: OkpPublicJwk,
  now = Math.floor(Date.now() / 1000),
): LicenseClaims {
  const verified = verifyJws(token, issuerKey, LICENSE_TYP);
  const claims = parseLicenseClaims(verified.payload);
  if (verified.header.kid !== publicJwk(issuerKey).kid) {
    throw new LicenseError("bad_signature", "license kid does not match the issuer");
  }
  checkTimeWindow(now, claims.nbf, claims.exp, SKEW_SECONDS);
  return claims;
}
