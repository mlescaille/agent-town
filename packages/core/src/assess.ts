import { asLicenseError } from "./errors.js";
import { justificationHash, verifyJustification } from "./justify.js";
import { verifyLicense } from "./license.js";
import { requestHash, verifyUserRequest } from "./request.js";
import type {
  Assessment,
  CheckpointFlags,
  LicenseClaims,
  OkpPublicJwk,
  UserRequestClaims,
} from "./types.js";
import { canonicalStatement } from "./statement.js";
import { expectedBasis } from "./validate.js";

export interface AssessInput {
  licenseJws?: string;
  justificationJws?: string;
  action: string;
  location: string;
  userRequestJws?: string;
  callsSoFar?: number;
  seenJustifications?: Set<string>;
  issuerKey: OkpPublicJwk;
  userKeys: Record<string, OkpPublicJwk>;
  agentKeys: Record<string, OkpPublicJwk>;
  now?: number;
}

const EMPTY_FLAGS = (): CheckpointFlags => ({
  justification_ok: false,
  in_scope: false,
  request_match: false,
  within_budget: false,
  chain_ok: false,
  mandate_ok: false,
  basis_ok: false,
  exact_match: false,
});

/**
 * Checkpoint rules that do not depend on Cedar: signature, lifetime, delegation
 * chain, mandate, scope, budget, and agreement between the justification and
 * the originating request. Returns a result instead of throwing.
 */
export function assessPresentation(input: AssessInput): Assessment {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const flags = EMPTY_FLAGS();
  const base = {
    licenseJti: "",
    justificationJti: "",
    agent: "",
    sub: "",
    mandate: "",
    action: input.action,
    location: input.location,
    why: "",
    statement: "",
    flags,
  };

  if (!input.licenseJws) {
    return fail(base, "missing_license", "the call did not present a license");
  }
  if (!input.justificationJws) {
    return fail(base, "missing_justification", "the call did not present a justification");
  }

  let license: LicenseClaims;
  try {
    license = verifyLicense(input.licenseJws, input.issuerKey, now);
  } catch (error) {
    const wrapped = asLicenseError(error);
    return fail(base, wrapped.code, wrapped.message);
  }
  flags.chain_ok = true;
  flags.mandate_ok = true;
  base.licenseJti = license.jti;
  base.agent = license.agent;
  base.sub = license.sub;
  base.mandate = license.mandate.type;

  const agentKey = input.agentKeys[license.agent];
  if (!agentKey) {
    return fail(base, "unknown_agent", `no enrolled key for ${license.agent}`);
  }

  let justification;
  try {
    justification = verifyJustification(input.justificationJws, agentKey, now);
  } catch (error) {
    const wrapped = asLicenseError(error);
    return fail(base, wrapped.code === "malformed" ? "justification_mismatch" : wrapped.code, wrapped.message);
  }

  base.justificationJti = justification.jti;
  base.why = justification.why;
  if (input.seenJustifications?.has(justification.jti)) {
    return fail(base, "justification_replay", "this justification was already presented");
  }

  if (
    justification.iss !== license.agent ||
    justification.sub !== license.sub ||
    justification.license_jti !== license.jti ||
    justification.txn !== license.txn ||
    justification.req_hash !== license.req_hash ||
    justification.mandate_type !== license.mandate.type ||
    justification.action !== input.action ||
    justification.location !== input.location
  ) {
    return fail(
      base,
      "justification_mismatch",
      "justification does not match the license, the originating request, or this call",
    );
  }
  flags.request_match = true;

  const statement = canonicalStatement({
    license,
    action: input.action,
    resource: input.location,
    reason: justification.why,
  });
  base.statement = statement;
  if (justification.statement !== statement) {
    return fail(base, "identity_mismatch", "justification statement does not match the signed delegation chain");
  }
  flags.justification_ok = true;

  const basis = expectedBasis(license.mandate.type);
  const goalOk =
    license.mandate.type !== "user_goal" ||
    (justification.goal !== undefined && justification.goal === license.mandate.goal);
  const noForeignGoal = license.mandate.type === "user_goal" || justification.goal === undefined;
  if (justification.basis !== basis || !goalOk || !noForeignGoal) {
    return fail(base, "justification_mismatch", "justification basis does not match the license mandate");
  }
  flags.basis_ok = true;

  let request: UserRequestClaims | undefined;
  if (input.userRequestJws) {
    try {
      request = verifyUserRequest(input.userRequestJws, input.userKeys, now);
    } catch (error) {
      const wrapped = asLicenseError(error);
      flags.request_match = false;
      return fail(base, wrapped.code === "malformed" ? "request_hash_mismatch" : wrapped.code, wrapped.message);
    }
    if (requestHash(input.userRequestJws) !== license.req_hash || request.jti !== license.txn) {
      flags.request_match = false;
      return fail(base, "request_hash_mismatch", "user request does not match the license binding");
    }
    if (request.sub !== license.sub || request.mandate.type !== license.mandate.type) {
      flags.request_match = false;
      return fail(base, "justification_mismatch", "user request mandate does not match the license");
    }
    if (license.mandate.type === "user_goal" && request.mandate.type === "user_goal" && request.mandate.goal !== license.mandate.goal) {
      flags.request_match = false;
      return fail(base, "justification_mismatch", "user request goal does not match the license");
    }
  }

  const detail = license.authorization_details[0]!;
  const inScope = detail.actions.includes(input.action) && detail.locations.includes(input.location);
  const exact =
    license.mandate.type === "direct_request" &&
    input.action === license.mandate.action &&
    input.location === license.mandate.location;
  flags.exact_match = license.mandate.type === "direct_request" ? exact : true;
  if (!inScope || (license.mandate.type === "direct_request" && !exact)) {
    return fail(base, "over_scope", "the action is outside the license scope");
  }
  flags.in_scope = true;

  const cap = detail.budget?.max_calls;
  const used = input.callsSoFar ?? 0;
  if (cap !== undefined && used >= cap) {
    return fail(base, "budget_exceeded", `license budget max_calls=${cap} is exhausted`);
  }
  flags.within_budget = true;

  if (input.seenJustifications) input.seenJustifications.add(justification.jti);
  return {
    ok: true,
    code: "allow",
    reason: "signature, lifetime, scope, mandate, and originating request all match",
    ...base,
    flags,
    license,
    justification,
  };
}

function fail(
  base: Omit<Assessment, "ok" | "code" | "reason" | "license" | "justification">,
  code: string,
  reason: string,
): Assessment {
  return { ok: false, code, reason, ...base };
}

export function hashPresentedJustification(token: string | undefined): string {
  if (!token) return "";
  try {
    return justificationHash(token);
  } catch {
    return "";
  }
}
