import type { Assessment } from "@agentlicense/core";

export interface PolicyAnswer {
  decision: boolean;
  context?: {
    reason?: string;
    determining_policies?: string[];
  };
}

export interface CombinedDecision {
  decision: "allow" | "deny";
  code: string;
  reason: string;
  policy_decision: "allow" | "deny" | "not_evaluated";
  determining_policies: string[];
}

/** Structural failure wins. A passing structure still needs a Cedar permit. */
export function combineDecision(assessment: Assessment, policy: PolicyAnswer | null): CombinedDecision {
  if (!policy) {
    if (!assessment.ok) {
      return {
        decision: "deny",
        code: assessment.code,
        reason: assessment.reason,
        policy_decision: "not_evaluated",
        determining_policies: [],
      };
    }
    return {
      decision: "deny",
      code: "pdp_unreachable",
      reason: "the policy decision point did not answer",
      policy_decision: "not_evaluated",
      determining_policies: [],
    };
  }
  const determining = policy.context?.determining_policies ?? [];
  if (!assessment.ok) {
    return {
      decision: "deny",
      code: assessment.code,
      reason: assessment.reason,
      policy_decision: policy.decision ? "allow" : "deny",
      determining_policies: determining,
    };
  }
  if (!policy.decision) {
    return {
      decision: "deny",
      code: "policy_deny",
      reason: policy.context?.reason ?? "cedar denied the call",
      policy_decision: "deny",
      determining_policies: determining,
    };
  }
  return {
    decision: "allow",
    code: "allow",
    reason: assessment.reason,
    policy_decision: "allow",
    determining_policies: determining,
  };
}
