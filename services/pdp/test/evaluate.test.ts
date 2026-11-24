import { describe, expect, it } from "vitest";

import { evaluateAccess, evaluateBatch } from "../src/evaluate.js";

const flags = {
  justification_ok: true,
  in_scope: true,
  request_match: true,
  within_budget: true,
  chain_ok: true,
  mandate_ok: true,
  basis_ok: true,
  exact_match: true,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    subject: {
      type: "agent",
      id: "spiffe://agent-license.example/agent/planner",
      properties: { user: "user:alice", mandate: "user_goal" },
    },
    action: { name: "calendar.read" },
    resource: { type: "calendar", id: "primary" },
    context: { ...flags, mandate: "user_goal" },
    ...overrides,
  };
}

describe("AuthZEN evaluation", () => {
  it("permits a bound in-scope call and names the permit policy", () => {
    const decision = evaluateAccess(request());
    expect(decision.decision).toBe(true);
    expect(decision.context.cedar_decision).toBe("allow");
    expect(decision.context.determining_policies).toEqual(["permit-bound-call"]);
  });

  it("denies an agent-initiated write even if the PEP claims it is in scope", () => {
    const decision = evaluateAccess(
      request({
        subject: {
          type: "agent",
          id: "spiffe://agent-license.example/agent/planner",
          properties: { mandate: "agent_initiated" },
        },
        action: { name: "mail.send" },
        resource: { type: "mail", id: "outbox" },
        context: { ...flags, mandate: "agent_initiated", effect: "read" },
      }),
    );
    expect(decision.decision).toBe(false);
    expect(decision.context.determining_policies).toContain("forbid-agent-initiated-writes");
  });

  it("denies an inexact direct_request", () => {
    const decision = evaluateAccess(
      request({
        subject: {
          type: "agent",
          id: "spiffe://agent-license.example/agent/planner",
          properties: { mandate: "direct_request" },
        },
        context: { ...flags, mandate: "direct_request", exact_match: false },
      }),
    );
    expect(decision.decision).toBe(false);
    expect(decision.context.determining_policies).toContain("forbid-direct-request-inexact");
  });

  it("evaluates a batch with a shared subject", () => {
    const batch = evaluateBatch({
      subject: {
        type: "agent",
        id: "spiffe://agent-license.example/agent/planner",
        properties: { mandate: "user_goal" },
      },
      context: flags,
      evaluations: [
        { action: { name: "calendar.read" }, resource: { type: "calendar", id: "primary" } },
        {
          action: { name: "calendar.read" },
          resource: { type: "calendar", id: "primary" },
          context: { in_scope: false },
        },
      ],
    });
    expect(batch.evaluations.map((item) => item.decision)).toEqual([true, false]);
  });
});
