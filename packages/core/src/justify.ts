import { CHECKPOINT_AUD, JUSTIFICATION_TYP, MAX_JUSTIFICATION_TTL_SECONDS, SKEW_SECONDS } from "./constants.js";
import { sha256Prefixed } from "./encoding.js";
import { LicenseError } from "./errors.js";
import { signJws, verifyJws } from "./jws.js";
import { newId } from "./keys.js";
import { canonicalStatement } from "./statement.js";
import type { JustificationClaims, LicenseClaims, OkpPrivateJwk, OkpPublicJwk } from "./types.js";
import { checkTimeWindow, parseJustificationClaims } from "./validate.js";

export interface CreateJustificationInput {
  license: LicenseClaims;
  agentKey: OkpPrivateJwk;
  action: string;
  location: string;
  why: string;
  basis: JustificationClaims["basis"];
  goal?: string;
  /** Exact sentence. Omitted means the canonical sentence for this license and call. */
  statement?: string;
  ttlSeconds?: number;
  now?: number;
  jti?: string;
}

export function createJustification(input: CreateJustificationInput): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 60;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_JUSTIFICATION_TTL_SECONDS) {
    throw new LicenseError("justification_lifetime", "justification ttl must be 1 to 300 seconds");
  }
  const payload: Record<string, unknown> = {
    iss: input.license.agent,
    sub: input.license.sub,
    aud: CHECKPOINT_AUD,
    iat: now,
    exp: now + ttl,
    jti: input.jti ?? newId("jus_"),
    license_jti: input.license.jti,
    txn: input.license.txn,
    req_hash: input.license.req_hash,
    mandate_type: input.license.mandate.type,
    basis: input.basis,
    action: input.action,
    location: input.location,
    why: input.why,
    statement:
      input.statement ??
      canonicalStatement({
        license: input.license,
        action: input.action,
        resource: input.location,
        reason: input.why,
      }),
  };
  if (input.goal !== undefined) payload.goal = input.goal;
  const claims = parseJustificationClaims(payload);
  return signJws(claims as unknown as Record<string, unknown>, input.agentKey, JUSTIFICATION_TYP);
}

export function justificationHash(compactJws: string): string {
  return sha256Prefixed(compactJws);
}

export function verifyJustification(
  token: string,
  agentKey: OkpPublicJwk,
  now = Math.floor(Date.now() / 1000),
): JustificationClaims {
  const verified = verifyJws(token, agentKey, JUSTIFICATION_TYP);
  const claims = parseJustificationClaims(verified.payload);
  if (claims.exp - claims.iat > MAX_JUSTIFICATION_TTL_SECONDS) {
    throw new LicenseError("justification_lifetime", "justification lifetime exceeds 300 seconds");
  }
  checkTimeWindow(now, claims.iat, claims.exp, SKEW_SECONDS);
  return claims;
}
