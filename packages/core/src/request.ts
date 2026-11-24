import { ISSUER_ID, REQUEST_TYP, SKEW_SECONDS } from "./constants.js";
import { sha256Prefixed } from "./encoding.js";
import { LicenseError } from "./errors.js";
import { signJws, verifyJws } from "./jws.js";
import { newId } from "./keys.js";
import type { OkpPrivateJwk, OkpPublicJwk, UserRequestClaims } from "./types.js";
import { checkTimeWindow, parseUserRequestClaims } from "./validate.js";

export interface CreateUserRequestInput {
  userId: string;
  userKey: OkpPrivateJwk;
  agent: string;
  mandate: UserRequestClaims["mandate"];
  authorizationDetails: UserRequestClaims["authorization_details"];
  ttlSeconds: number;
  now?: number;
  jti?: string;
}

/** Sign the originating user request. The license binds to this exact compact JWS. */
export function createUserRequest(input: CreateUserRequestInput): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new LicenseError("malformed", "ttlSeconds must be a positive integer");
  }
  const claims = parseUserRequestClaims({
    iss: input.userId,
    sub: input.userId,
    aud: ISSUER_ID,
    iat: now,
    exp: now + input.ttlSeconds,
    jti: input.jti ?? newId("req_"),
    agent: input.agent,
    mandate: input.mandate,
    authorization_details: input.authorizationDetails,
  });
  return signJws(claims as unknown as Record<string, unknown>, input.userKey, REQUEST_TYP);
}

export function requestHash(compactJws: string): string {
  return sha256Prefixed(compactJws);
}

export function verifyUserRequest(
  token: string,
  userKeys: Record<string, OkpPublicJwk>,
  now = Math.floor(Date.now() / 1000),
): UserRequestClaims {
  const decoded = verifyJwsPeek(token, userKeys, now);
  return decoded;
}

function verifyJwsPeek(
  token: string,
  userKeys: Record<string, OkpPublicJwk>,
  now: number,
): UserRequestClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new LicenseError("malformed", "user request is not a JWS");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new LicenseError("malformed", "user request payload is not JSON");
  }
  const iss = typeof payload.iss === "string" ? payload.iss : "";
  const key = userKeys[iss];
  if (!key) throw new LicenseError("unknown_user", `no key for user ${iss || "(missing)"}`);
  const verified = verifyJws(token, key, REQUEST_TYP);
  const claims = parseUserRequestClaims(verified.payload);
  checkTimeWindow(now, claims.iat, claims.exp, SKEW_SECONDS);
  return claims;
}
