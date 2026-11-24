import { LICENSE_TYP } from "./constants.js";
import { LicenseError } from "./errors.js";
import { signJws } from "./jws.js";
import { newId } from "./keys.js";
import { verifyLicense } from "./license.js";
import type { AuthorizationDetail, LicenseClaims, OkpPrivateJwk, OkpPublicJwk } from "./types.js";
import { actorIds, parseAuthorizationDetails, parseLicenseClaims } from "./validate.js";

export interface AttenuateInput {
  parentJws: string;
  issuerKey: OkpPrivateJwk;
  issuerPublicKey: OkpPublicJwk;
  agentKeys: Record<string, OkpPublicJwk>;
  childAgent: string;
  authorizationDetails: unknown;
  exp: number;
  now?: number;
  jti?: string;
}

function asSet(values: string[]): Set<string> {
  return new Set(values);
}

function isSubset(child: string[], parent: string[]): boolean {
  const allowed = asSet(parent);
  return child.every((value) => allowed.has(value));
}

/**
 * Mint a license for a sub-agent. Scope, budget, and expiry can only shrink.
 * The mandate, user, transaction id, and request hash are copied. The `act`
 * chain gains the child as the current actor.
 */
export function attenuateLicense(input: AttenuateInput): { license: string; claims: LicenseClaims } {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const parent = verifyLicense(input.parentJws, input.issuerPublicKey, now);
  if (!input.agentKeys[input.childAgent]) {
    throw new LicenseError("unknown_agent", `issuer has no key for ${input.childAgent}`);
  }
  const prior = actorIds(parent.act);
  if (prior.includes(input.childAgent)) {
    throw new LicenseError("chain_cycle", "child agent is already in the delegation chain");
  }
  const [detail] = parseAuthorizationDetails(input.authorizationDetails);
  const parentDetail = parent.authorization_details[0]!;
  assertNarrowed(parent, parentDetail, detail!, input.exp);
  if (!Number.isSafeInteger(input.exp)) throw new LicenseError("malformed", "exp must be an integer");
  const nbf = Math.max(parent.nbf, now);
  if (input.exp <= nbf) throw new LicenseError("expired", "attenuated license expiry is not in the future");
  const claims: LicenseClaims = {
    iss: parent.iss,
    sub: parent.sub,
    aud: parent.aud,
    iat: nbf,
    nbf,
    exp: input.exp,
    jti: input.jti ?? newId("lic_"),
    agent: input.childAgent,
    act: { sub: input.childAgent, act: parent.act },
    mandate: parent.mandate,
    authorization_details: [detail!],
    txn: parent.txn,
    req_hash: parent.req_hash,
    parent_jti: parent.jti,
  };
  const normalized = parseLicenseClaims(claims as unknown as Record<string, unknown>);
  const license = signJws(normalized as unknown as Record<string, unknown>, input.issuerKey, LICENSE_TYP);
  return { license, claims: normalized };
}

function assertNarrowed(parent: LicenseClaims, parentDetail: AuthorizationDetail, child: AuthorizationDetail, exp: number): void {
  if (!isSubset(child.actions, parentDetail.actions) || !isSubset(child.locations, parentDetail.locations)) {
    throw new LicenseError("scope_widen", "attenuated scope adds an action or location the parent license does not grant");
  }
  const parentCap = parentDetail.budget?.max_calls;
  const childCap = child.budget?.max_calls;
  if (parentCap !== undefined && (childCap === undefined || childCap > parentCap)) {
    throw new LicenseError("budget_widen", "attenuated budget removes or raises the parent call cap");
  }
  if (exp > parent.exp) throw new LicenseError("expiry_widen", "attenuated license expires after its parent");
  if (exp <= parent.nbf) throw new LicenseError("expired", "attenuated expiry is not after the parent nbf");

  const fewerActions = child.actions.length < parentDetail.actions.length;
  const fewerLocations = child.locations.length < parentDetail.locations.length;
  const tighterBudget =
    (parentCap === undefined && childCap !== undefined) ||
    (parentCap !== undefined && childCap !== undefined && childCap < parentCap);
  const earlierExpiry = exp < parent.exp;
  if (!fewerActions && !fewerLocations && !tighterBudget && !earlierExpiry) {
    throw new LicenseError("not_narrowed", "a sub-agent license must be strictly narrower than its parent");
  }
}
