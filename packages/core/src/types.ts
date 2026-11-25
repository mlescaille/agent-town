export interface OkpPublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  use: "sig";
}

export interface OkpPrivateJwk extends OkpPublicJwk {
  d: string;
}

export type MandateType = "direct_request" | "user_goal" | "agent_initiated";

export type JustificationBasis = "user_request" | "user_goal" | "agent";

/** The user named one exact action. The checkpoint allows only that action. */
export interface DirectRequestMandate {
  type: "direct_request";
  action: string;
  location: string;
}

/** The user set a goal. The agent chooses actions inside the granted scope. */
export interface UserGoalMandate {
  type: "user_goal";
  goal: string;
}

/**
 * The agent is acting on its own goal. Scope cannot exceed
 * {@link AGENT_INITIATED_CEILING}.
 */
export interface AgentInitiatedMandate {
  type: "agent_initiated";
}

export type Mandate = DirectRequestMandate | UserGoalMandate | AgentInitiatedMandate;

/** Call budget. v1 defines a single counter. Omitting it means no call cap. */
export interface Budget {
  max_calls: number;
}

/**
 * One Rich Authorization Request detail (RFC 9396) of type
 * `urn:agent-license:tool`. `locations` are `resourceType:resourceId`.
 */
export interface AuthorizationDetail {
  type: "urn:agent-license:tool";
  actions: string[];
  locations: string[];
  budget?: Budget;
}

/**
 * The accountable party at the end of a delegation chain.
 * `user` is always `user:<name>`. An office names that user as well as the office.
 */
export interface UserPrincipal {
  type: "user";
  user: string;
  name?: string;
}

export interface OrgPrincipal {
  type: "org";
  name: string;
  user: string;
}

export type Principal = UserPrincipal | OrgPrincipal;

/**
 * One hop of an RFC 8693 actor claim. The outermost hop is the agent presenting
 * the license. `on_behalf_of` is the next hop up: another agent hop, or the
 * principal the chain terminates at.
 */
export interface ActClaim {
  sub: string;
  instance: string;
  name: string;
  task: string;
  on_behalf_of: ActClaim | Principal;
}

/** Compact JWS signed by the user. Binds the license to one originating request. */
export interface UserRequestClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  agent: string;
  mandate: Mandate;
  authorization_details: AuthorizationDetail[];
  /** Set when the user named an office, or a concrete run of the root agent. */
  principal?: Principal;
  name?: string;
  instance?: string;
  task?: string;
}

/** License claims. Signed by the issuer, never by the agent. */
export interface LicenseClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  agent: string;
  /** Accountable party. `principal.user` equals `sub`. */
  principal: Principal;
  act: ActClaim;
  mandate: Mandate;
  authorization_details: AuthorizationDetail[];
  /** Originating user-request id. Transaction-Token style transaction id. */
  txn: string;
  /** `sha-256:` + base64url(SHA-256(user-request compact JWS)). */
  req_hash: string;
  /** Set when this license was attenuated from another issuer-signed license. */
  parent_jti?: string;
}

/** Per-call statement signed by the agent that holds the license. */
export interface JustificationClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  license_jti: string;
  txn: string;
  req_hash: string;
  mandate_type: MandateType;
  basis: JustificationBasis;
  action: string;
  location: string;
  why: string;
  /**
   * Canonical sentence the checkpoint renders from the license and this call.
   * The agent must present this exact text.
   */
  statement: string;
  goal?: string;
}

export interface CheckpointFlags {
  justification_ok: boolean;
  in_scope: boolean;
  request_match: boolean;
  within_budget: boolean;
  chain_ok: boolean;
  mandate_ok: boolean;
  basis_ok: boolean;
  exact_match: boolean;
}

export interface Assessment {
  ok: boolean;
  code: string;
  reason: string;
  licenseJti: string;
  justificationJti: string;
  agent: string;
  sub: string;
  mandate: string;
  action: string;
  location: string;
  why: string;
  /** Canonical who-for-whom-what sentence, or empty when the chain could not be rendered. */
  statement: string;
  flags: CheckpointFlags;
  license?: LicenseClaims;
  justification?: JustificationClaims;
}

/** One append-only decision. The canonical JSON of this object is the Merkle leaf. */
export interface DecisionRecord {
  v: 1;
  index: number;
  time: string;
  decision: "allow" | "deny";
  code: string;
  reason: string;
  license_jti: string;
  justification_jti: string;
  justification_hash: string;
  agent: string;
  sub: string;
  mandate: string;
  action: string;
  location: string;
  policy_decision: "allow" | "deny" | "not_evaluated";
  why: string;
  /** Canonical who-for-whom-what sentence. Empty when the checkpoint could not render one. */
  statement: string;
}

export interface SignedTreeHeadClaims {
  v: 1;
  log_id: string;
  tree_size: number;
  root_hash: string;
  timestamp: string;
}
