import {
  AGENT_INITIATED_CEILING,
  AUTH_DETAIL_TYPE,
  CHECKPOINT_AUD,
  ISSUER_ID,
  MAX_CHAIN_DEPTH,
} from "./constants.js";
import { canonicalize } from "./encoding.js";
import { LicenseError } from "./errors.js";
import { isProfileSpiffe } from "./keys.js";
import { agentHops, isPrincipal, taskNarrows, terminalPrincipal } from "./statement.js";
import type {
  ActClaim,
  AuthorizationDetail,
  JustificationBasis,
  JustificationClaims,
  LicenseClaims,
  Mandate,
  MandateType,
  Principal,
  UserRequestClaims,
} from "./types.js";

const ACTION = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;
const LOCATION = /^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/;
const ID = /^[A-Za-z0-9_-]{8,80}$/;
const USER = /^user:[a-z][a-z0-9-]{0,62}$/;
const REQ_HASH = /^sha-256:[A-Za-z0-9_-]{43}$/;
const INSTANCE = /^[A-Za-z][A-Za-z0-9_-]{0,80}$/;
const ROLE_NAME = /^[A-Za-z][A-Za-z0-9 .'-]{0,79}$/;
const ORG_NAME = /^[A-Za-z0-9][A-Za-z0-9 .,'()&-]{0,198}$/;
const TASK_MAX = 1000;
const STATEMENT_MAX = 4000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new LicenseError("malformed", `${label} has unknown field ${key}`);
    }
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LicenseError("malformed", `${label} must be a non-empty string`);
  }
  return value;
}

function expectInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new LicenseError("malformed", `${label} must be an integer`);
  }
  return value;
}

function expectId(value: unknown, label: string): string {
  const text = expectString(value, label);
  if (!ID.test(text)) throw new LicenseError("malformed", `${label} is not a token id`);
  return text;
}

export function parseAction(value: unknown): string {
  const action = expectString(value, "action");
  if (!ACTION.test(action)) throw new LicenseError("malformed", `bad action ${action}`);
  return action;
}

export function parseLocation(value: unknown): string {
  const location = expectString(value, "location");
  if (!LOCATION.test(location)) throw new LicenseError("malformed", `bad location ${location}`);
  return location;
}

export function effectOf(action: string): "read" | "write" {
  const verb = action.split(".").at(-1) ?? "";
  if (verb === "read" || verb === "list" || verb === "get") return "read";
  return "write";
}

function sortedUnique(values: unknown, label: string, check: (value: unknown) => string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new LicenseError("malformed", `${label} must be a non-empty array`);
  }
  const parsed = values.map((value) => check(value));
  if (new Set(parsed).size !== parsed.length) {
    throw new LicenseError("malformed", `${label} contains duplicates`);
  }
  return [...parsed].sort();
}

export function parseAuthorizationDetail(value: unknown): AuthorizationDetail {
  if (!isRecord(value)) throw new LicenseError("malformed", "authorization detail must be an object");
  assertExactKeys(value, ["type", "actions", "locations", "budget"], "authorization_details");
  if (value.type !== AUTH_DETAIL_TYPE) {
    throw new LicenseError("malformed", `authorization detail type must be ${AUTH_DETAIL_TYPE}`);
  }
  const detail: AuthorizationDetail = {
    type: AUTH_DETAIL_TYPE,
    actions: sortedUnique(value.actions, "actions", parseAction),
    locations: sortedUnique(value.locations, "locations", parseLocation),
  };
  if (value.budget !== undefined) {
    if (!isRecord(value.budget)) throw new LicenseError("malformed", "budget must be an object");
    assertExactKeys(value.budget, ["max_calls"], "budget");
    const maxCalls = expectInt(value.budget.max_calls, "budget.max_calls");
    if (maxCalls < 1 || maxCalls > 1_000_000) {
      throw new LicenseError("malformed", "budget.max_calls is out of range");
    }
    detail.budget = { max_calls: maxCalls };
  }
  return detail;
}

export function parseAuthorizationDetails(value: unknown): AuthorizationDetail[] {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new LicenseError("malformed", "authorization_details must contain exactly one detail");
  }
  return [parseAuthorizationDetail(value[0])];
}

export function parseMandate(value: unknown): Mandate {
  if (!isRecord(value)) throw new LicenseError("malformed", "mandate must be an object");
  const type = value.type;
  if (type === "direct_request") {
    assertExactKeys(value, ["type", "action", "location"], "mandate");
    return {
      type,
      action: parseAction(value.action),
      location: parseLocation(value.location),
    };
  }
  if (type === "user_goal") {
    assertExactKeys(value, ["type", "goal"], "mandate");
    const goal = expectString(value.goal, "mandate.goal");
    if (goal.length > 300) throw new LicenseError("malformed", "mandate.goal is too long");
    return { type, goal };
  }
  if (type === "agent_initiated") {
    assertExactKeys(value, ["type"], "mandate");
    return { type };
  }
  throw new LicenseError("malformed", "mandate.type must be direct_request, user_goal, or agent_initiated");
}

export function parsePrincipal(value: unknown, label: string): Principal {
  if (!isRecord(value)) throw new LicenseError("malformed", `${label} must be an object`);
  if (value.type === "user") {
    assertExactKeys(value, ["type", "user", "name"], label);
    const user = expectString(value.user, `${label}.user`);
    if (!USER.test(user)) throw new LicenseError("malformed", `${label}.user must be a user id`);
    const principal: Principal = { type: "user", user };
    if (value.name !== undefined) principal.name = parseRoleName(value.name, `${label}.name`);
    return principal;
  }
  if (value.type === "org") {
    assertExactKeys(value, ["type", "name", "user"], label);
    const user = expectString(value.user, `${label}.user`);
    if (!USER.test(user)) throw new LicenseError("malformed", `${label}.user must be a user id`);
    return { type: "org", name: parseOrgName(value.name), user };
  }
  throw new LicenseError("malformed", `${label}.type must be user or org`);
}

export function parseInstance(value: unknown, label = "instance"): string {
  const instance = expectString(value, label);
  if (!INSTANCE.test(instance)) throw new LicenseError("malformed", `${label} is not a run id`);
  return instance;
}

export function parseRoleName(value: unknown, label = "name"): string {
  const name = expectString(value, label);
  if (!ROLE_NAME.test(name)) throw new LicenseError("malformed", `${label} is not a role name`);
  return name;
}

export function parseOrgName(value: unknown): string {
  const name = expectString(value, "principal.name");
  if (!ORG_NAME.test(name)) throw new LicenseError("malformed", "principal.name is not an office name");
  return name;
}

export function parseTask(value: unknown, label = "task"): string {
  const task = expectString(value, label);
  if (task.length > TASK_MAX || /[\u0000-\u001f]/.test(task)) {
    throw new LicenseError("malformed", `${label} must be 1 to ${TASK_MAX} characters`);
  }
  return task;
}

export function parseAct(value: unknown, depth = 1): ActClaim {
  if (depth > MAX_CHAIN_DEPTH) {
    throw new LicenseError("act_chain", `delegation chain exceeds ${MAX_CHAIN_DEPTH}`);
  }
  if (!isRecord(value)) throw new LicenseError("act_chain", "act claim must be an object");
  assertExactKeys(value, ["sub", "instance", "name", "task", "on_behalf_of"], "act");
  const sub = expectString(value.sub, "act.sub");
  if (!isProfileSpiffe(sub)) throw new LicenseError("bad_agent_id", `act.sub is not a profile SPIFFE id: ${sub}`);
  if (value.instance === undefined || value.instance === "") {
    throw new LicenseError("chain_incomplete", "act hop lacks instance");
  }
  if (value.name === undefined || value.name === "") {
    throw new LicenseError("chain_incomplete", "act hop lacks name");
  }
  if (value.task === undefined || value.task === "") {
    throw new LicenseError("chain_incomplete", "act hop lacks task");
  }
  if (value.on_behalf_of === undefined) {
    throw new LicenseError("chain_incomplete", "act hop lacks on_behalf_of");
  }
  const onBehalfOf = parseOnBehalfOf(value.on_behalf_of, depth + 1);
  return {
    sub,
    instance: parseInstance(value.instance, "act.instance"),
    name: parseRoleName(value.name, "act.name"),
    task: parseTask(value.task, "act.task"),
    on_behalf_of: onBehalfOf,
  };
}

function parseOnBehalfOf(value: unknown, depth: number): ActClaim | Principal {
  if (!isRecord(value)) throw new LicenseError("chain_incomplete", "act hop lacks on_behalf_of");
  if (value.type === "user" || value.type === "org") return parsePrincipal(value, "on_behalf_of");
  if (typeof value.sub === "string") return parseAct(value, depth);
  throw new LicenseError("chain_incomplete", "act chain does not terminate at the license principal");
}

function canonicalizePrincipal(principal: Principal): string {
  return canonicalize(principal);
}

function assertTasksNarrow(act: ActClaim): void {
  if (isPrincipal(act.on_behalf_of)) return;
  if (!taskNarrows(act.on_behalf_of.task, act.task)) {
    throw new LicenseError(
      "task_widened",
      `act task of ${act.name} is not a narrowing of ${act.on_behalf_of.name}`,
    );
  }
  assertTasksNarrow(act.on_behalf_of);
}

/** Outermost actor first, then prior actors, original actor last. */
export function actorIds(act: ActClaim): string[] {
  return agentHops(act).map((hop) => hop.sub);
}

/** User, then original actor, then each later delegate. The last id is current. */
export function delegationChain(claims: Pick<LicenseClaims, "sub" | "act">): string[] {
  return [claims.sub, ...actorIds(claims.act).reverse()];
}

export function assertMandateMatchesScope(mandate: Mandate, detail: AuthorizationDetail): void {
  if (mandate.type === "direct_request") {
    if (detail.actions.length !== 1 || detail.locations.length !== 1) {
      throw new LicenseError("mandate_invalid", "direct_request scope must contain exactly one action and one location");
    }
    if (detail.actions[0] !== mandate.action || detail.locations[0] !== mandate.location) {
      throw new LicenseError("mandate_invalid", "direct_request scope does not match the named action");
    }
    return;
  }
  if (mandate.type === "agent_initiated") {
    const ceilingActions = new Set<string>(AGENT_INITIATED_CEILING.actions);
    const ceilingLocations = new Set<string>(AGENT_INITIATED_CEILING.locations);
    if (detail.actions.some((action) => !ceilingActions.has(action))) {
      throw new LicenseError("mandate_invalid", "agent_initiated action exceeds the default ceiling");
    }
    if (detail.locations.some((location) => !ceilingLocations.has(location))) {
      throw new LicenseError("mandate_invalid", "agent_initiated location exceeds the default ceiling");
    }
    if (!detail.budget || detail.budget.max_calls > AGENT_INITIATED_CEILING.max_calls) {
      throw new LicenseError("mandate_invalid", "agent_initiated budget exceeds the default ceiling");
    }
  }
}

function assertTimes(iat: number, exp: number, nbf?: number): void {
  if (exp <= iat) throw new LicenseError("malformed", "exp must be after iat");
  if (nbf !== undefined && (nbf < iat || nbf >= exp)) {
    throw new LicenseError("malformed", "nbf must be within [iat, exp)");
  }
}

export function parseUserRequestClaims(payload: Record<string, unknown>): UserRequestClaims {
  assertExactKeys(
    payload,
    [
      "iss",
      "sub",
      "aud",
      "iat",
      "exp",
      "jti",
      "agent",
      "mandate",
      "authorization_details",
      "principal",
      "name",
      "instance",
      "task",
    ],
    "user request",
  );
  const iss = expectString(payload.iss, "iss");
  const sub = expectString(payload.sub, "sub");
  if (!USER.test(iss) || iss !== sub) {
    throw new LicenseError("malformed", "user request iss and sub must be the same user id");
  }
  if (payload.aud !== ISSUER_ID) throw new LicenseError("malformed", "user request aud must be the issuer");
  const agent = expectString(payload.agent, "agent");
  if (!isProfileSpiffe(agent)) throw new LicenseError("bad_agent_id", "user request agent is not a profile SPIFFE id");
  const claims: UserRequestClaims = {
    iss,
    sub,
    aud: ISSUER_ID,
    iat: expectInt(payload.iat, "iat"),
    exp: expectInt(payload.exp, "exp"),
    jti: expectId(payload.jti, "jti"),
    agent,
    mandate: parseMandate(payload.mandate),
    authorization_details: parseAuthorizationDetails(payload.authorization_details),
  };
  if (payload.principal !== undefined) claims.principal = parsePrincipal(payload.principal, "principal");
  if (payload.name !== undefined) claims.name = parseRoleName(payload.name, "name");
  if (payload.instance !== undefined) claims.instance = parseInstance(payload.instance, "instance");
  if (payload.task !== undefined) claims.task = parseTask(payload.task, "task");
  if (claims.principal && claims.principal.user !== claims.sub) {
    throw new LicenseError("chain_incomplete", "act chain does not terminate at the license principal");
  }
  assertTimes(claims.iat, claims.exp);
  assertMandateMatchesScope(claims.mandate, claims.authorization_details[0]!);
  return claims;
}

export function parseLicenseClaims(payload: Record<string, unknown>): LicenseClaims {
  assertExactKeys(
    payload,
    [
      "iss",
      "sub",
      "aud",
      "exp",
      "nbf",
      "iat",
      "jti",
      "agent",
      "principal",
      "act",
      "mandate",
      "authorization_details",
      "txn",
      "req_hash",
      "parent_jti",
    ],
    "license",
  );
  if (payload.iss !== ISSUER_ID) throw new LicenseError("bad_issuer", "license iss is not the profile issuer");
  if (payload.aud !== CHECKPOINT_AUD) throw new LicenseError("malformed", "license aud is not the checkpoint");
  const sub = expectString(payload.sub, "sub");
  if (!USER.test(sub)) throw new LicenseError("malformed", "license sub must be a user id");
  const agent = expectString(payload.agent, "agent");
  if (!isProfileSpiffe(agent)) throw new LicenseError("bad_agent_id", "license agent is not a profile SPIFFE id");
  if (payload.principal === undefined) {
    throw new LicenseError("chain_incomplete", "act chain does not terminate at the license principal");
  }
  const principal = parsePrincipal(payload.principal, "principal");
  const act = parseAct(payload.act);
  const ids = actorIds(act);
  if (ids[0] !== agent) throw new LicenseError("act_chain", "outermost act.sub must be the licensed agent");
  if (new Set(ids).size !== ids.length) throw new LicenseError("act_chain", "delegation chain repeats an actor");
  const parent = payload.parent_jti === undefined ? undefined : expectId(payload.parent_jti, "parent_jti");
  if (parent && ids.length < 2) {
    throw new LicenseError("act_chain", "an attenuated license needs a prior actor in act");
  }
  if (!parent && ids.length !== 1) {
    throw new LicenseError("act_chain", "a root license must not include a prior actor");
  }
  if (principal.user !== sub || canonicalizePrincipal(terminalPrincipal(act)) !== canonicalizePrincipal(principal)) {
    throw new LicenseError("chain_incomplete", "act chain does not terminate at the license principal");
  }
  assertTasksNarrow(act);
  const claims: LicenseClaims = {
    iss: ISSUER_ID,
    sub,
    aud: CHECKPOINT_AUD,
    exp: expectInt(payload.exp, "exp"),
    nbf: expectInt(payload.nbf, "nbf"),
    iat: expectInt(payload.iat, "iat"),
    jti: expectId(payload.jti, "jti"),
    agent,
    principal,
    act,
    mandate: parseMandate(payload.mandate),
    authorization_details: parseAuthorizationDetails(payload.authorization_details),
    txn: expectId(payload.txn, "txn"),
    req_hash: expectString(payload.req_hash, "req_hash"),
  };
  if (!REQ_HASH.test(claims.req_hash)) throw new LicenseError("malformed", "req_hash must be sha-256:<base64url>");
  if (parent) claims.parent_jti = parent;
  assertTimes(claims.iat, claims.exp, claims.nbf);
  assertMandateMatchesScope(claims.mandate, claims.authorization_details[0]!);
  return claims;
}

export function parseJustificationClaims(payload: Record<string, unknown>): JustificationClaims {
  assertExactKeys(
    payload,
    [
      "iss",
      "sub",
      "aud",
      "iat",
      "exp",
      "jti",
      "license_jti",
      "txn",
      "req_hash",
      "mandate_type",
      "basis",
      "action",
      "location",
      "why",
      "statement",
      "goal",
    ],
    "justification",
  );
  const iss = expectString(payload.iss, "iss");
  if (!isProfileSpiffe(iss)) throw new LicenseError("bad_agent_id", "justification iss is not a profile SPIFFE id");
  const sub = expectString(payload.sub, "sub");
  if (!USER.test(sub)) throw new LicenseError("malformed", "justification sub must be a user id");
  if (payload.aud !== CHECKPOINT_AUD) throw new LicenseError("malformed", "justification aud is not the checkpoint");
  const mandateType = payload.mandate_type;
  if (mandateType !== "direct_request" && mandateType !== "user_goal" && mandateType !== "agent_initiated") {
    throw new LicenseError("malformed", "justification mandate_type is invalid");
  }
  const basis = payload.basis;
  if (basis !== "user_request" && basis !== "user_goal" && basis !== "agent") {
    throw new LicenseError("malformed", "justification basis is invalid");
  }
  const why = expectString(payload.why, "why");
  if (why.length < 12 || why.length > 500) {
    throw new LicenseError("malformed", "justification why must be 12 to 500 characters");
  }
  const statement = payload.statement;
  if (typeof statement !== "string" || statement.length === 0) {
    throw new LicenseError("identity_mismatch", "justification statement does not match the signed delegation chain");
  }
  if (statement.length > STATEMENT_MAX) {
    throw new LicenseError("malformed", "justification statement is too long");
  }
  const claims: JustificationClaims = {
    iss,
    sub,
    aud: CHECKPOINT_AUD,
    iat: expectInt(payload.iat, "iat"),
    exp: expectInt(payload.exp, "exp"),
    jti: expectId(payload.jti, "jti"),
    license_jti: expectId(payload.license_jti, "license_jti"),
    txn: expectId(payload.txn, "txn"),
    req_hash: expectString(payload.req_hash, "req_hash"),
    mandate_type: mandateType,
    basis: basis as JustificationBasis,
    action: parseAction(payload.action),
    location: parseLocation(payload.location),
    why,
    statement,
  };
  if (!REQ_HASH.test(claims.req_hash)) throw new LicenseError("malformed", "justification req_hash is invalid");
  if (payload.goal !== undefined) {
    const goal = expectString(payload.goal, "goal");
    if (goal.length > 300) throw new LicenseError("malformed", "justification goal is too long");
    claims.goal = goal;
  }
  assertTimes(claims.iat, claims.exp);
  return claims;
}

export function expectedBasis(mandate: MandateType): JustificationBasis {
  if (mandate === "direct_request") return "user_request";
  if (mandate === "user_goal") return "user_goal";
  return "agent";
}

export function checkTimeWindow(now: number, nbf: number, exp: number, skew: number): void {
  if (now + skew < nbf) throw new LicenseError("not_yet_valid", "token is not yet valid");
  if (now - skew >= exp) throw new LicenseError("expired", "token is expired");
}
