import {
  agentSpiffe,
  createJustification,
  createUserRequest,
  generateEd25519Keypair,
  issueLicense,
  publicJwk,
  userIdOf,
  type AuthorizationDetail,
  type LicenseClaims,
  type Mandate,
  type OkpPrivateJwk,
  type OkpPublicJwk,
} from "../src/index.js";

export const NOW = 1_700_000_000;

export interface Fixture {
  now: number;
  issuer: OkpPrivateJwk;
  alice: OkpPrivateJwk;
  planner: OkpPrivateJwk;
  researcher: OkpPrivateJwk;
  userKeys: Record<string, OkpPublicJwk>;
  agentKeys: Record<string, OkpPublicJwk>;
  plannerId: string;
  researcherId: string;
  aliceId: string;
}

export function fixture(): Fixture {
  const issuer = generateEd25519Keypair();
  const alice = generateEd25519Keypair();
  const planner = generateEd25519Keypair();
  const researcher = generateEd25519Keypair();
  const aliceId = userIdOf("alice");
  const plannerId = agentSpiffe("planner");
  const researcherId = agentSpiffe("researcher");
  return {
    now: NOW,
    issuer,
    alice,
    planner,
    researcher,
    aliceId,
    plannerId,
    researcherId,
    userKeys: { [aliceId]: publicJwk(alice) },
    agentKeys: {
      [plannerId]: publicJwk(planner),
      [researcherId]: publicJwk(researcher),
    },
  };
}

export function detail(
  actions: string[],
  locations: string[],
  maxCalls?: number,
): AuthorizationDetail {
  const value: AuthorizationDetail = {
    type: "urn:agent-license:tool",
    actions,
    locations,
  };
  if (maxCalls !== undefined) value.budget = { max_calls: maxCalls };
  return value;
}

export function issued(
  env: Fixture,
  mandate: Mandate,
  scope: AuthorizationDetail,
  agent = env.plannerId,
): { request: string; license: string; claims: LicenseClaims } {
  const request = createUserRequest({
    userId: env.aliceId,
    userKey: env.alice,
    agent,
    mandate,
    authorizationDetails: [scope],
    ttlSeconds: 3600,
    now: env.now,
    jti: `req_${mandate.type}_0001`,
  });
  const { license, claims } = issueLicense({
    userRequestJws: request,
    issuerKey: env.issuer,
    userKeys: env.userKeys,
    agentKeys: env.agentKeys,
    now: env.now,
    ttlSeconds: 3600,
    jti: `lic_${mandate.type}_0001`,
  });
  return { request, license, claims };
}

export function justify(
  env: Fixture,
  claims: LicenseClaims,
  action: string,
  location: string,
  basis: "user_request" | "user_goal" | "agent",
  why?: string,
  extra: { goal?: string; jti?: string } = {},
): string {
  return createJustification({
    license: claims,
    agentKey: claims.agent === env.researcherId ? env.researcher : env.planner,
    action,
    location,
    why: why ?? "This call is the next step that the license permits.",
    basis,
    goal: extra.goal,
    now: env.now,
    jti: extra.jti ?? `jus_${action.replace(".", "_")}_0001`,
  });
}
