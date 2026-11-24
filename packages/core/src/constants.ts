/** Logical issuer identifier. Not a network address. */
export const ISSUER_ID = "https://issuer.agent-license.example";

/** Audience of licenses and justifications: the checkpoint. */
export const CHECKPOINT_AUD = "https://checkpoint.agent-license.example";

/** SPIFFE trust domain used by this prototype profile. */
export const TRUST_DOMAIN = "agent-license.example";

/** RAR `authorization_details[].type` for a tool mandate. */
export const AUTH_DETAIL_TYPE = "urn:agent-license:tool";

/** Clock skew accepted when checking `nbf` and `exp`. */
export const SKEW_SECONDS = 5;

/** A per-call justification may live at most this long. */
export const MAX_JUSTIFICATION_TTL_SECONDS = 300;

/** Delegation chains longer than this are rejected. */
export const MAX_CHAIN_DEPTH = 8;

/**
 * Ceiling for `agent_initiated` licenses. The issuer and the verifier both
 * reject a scope outside this set. It is the narrow default: read-only
 * catalog, clock, and the agent's own memory.
 */
export const AGENT_INITIATED_CEILING = {
  actions: ["catalog.list", "clock.read", "memory.read"],
  locations: ["catalog:public", "clock:local", "memory:self"],
  max_calls: 5,
} as const;

export const LICENSE_TYP = "agent-license+jwt";
export const REQUEST_TYP = "agent-request+jwt";
export const JUSTIFICATION_TYP = "agent-justification+jwt";
export const STH_TYP = "agent-log-sth+jwt";
