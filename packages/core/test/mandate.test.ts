import { describe, expect, it } from "vitest";

import { assessPresentation, createJustification, publicJwk } from "../src/index.js";
import { detail, fixture, issued, justify } from "./helpers.js";

function present(
  env: ReturnType<typeof fixture>,
  tokens: { license: string; request?: string; justification?: string },
  action: string,
  location: string,
  extra: { callsSoFar?: number; seen?: Set<string> } = {},
) {
  return assessPresentation({
    licenseJws: tokens.license,
    justificationJws: tokens.justification,
    userRequestJws: tokens.request,
    action,
    location,
    callsSoFar: extra.callsSoFar,
    seenJustifications: extra.seen,
    issuerKey: publicJwk(env.issuer),
    userKeys: env.userKeys,
    agentKeys: env.agentKeys,
    now: env.now,
  });
}

describe("mandate rules", () => {
  const env = fixture();

  it("allows a direct_request only for the exact action", () => {
    const issuedDirect = issued(
      env,
      { type: "direct_request", action: "calendar.read", location: "calendar:primary" },
      detail(["calendar.read"], ["calendar:primary"], 1),
    );
    const ok = present(env, {
      ...issuedDirect,
      justification: justify(env, issuedDirect.claims, "calendar.read", "calendar:primary", "user_request"),
    }, "calendar.read", "calendar:primary");
    expect(ok.ok).toBe(true);
    expect(ok.flags.exact_match).toBe(true);

    const wrongAction = present(env, {
      license: issuedDirect.license,
      justification: justify(env, issuedDirect.claims, "calendar.create", "calendar:primary", "user_request", undefined, {
        jti: "jus_wrong_action_01",
      }),
    }, "calendar.create", "calendar:primary");
    expect(wrongAction.code).toBe("over_scope");

    const wrongBasis = present(env, {
      license: issuedDirect.license,
      justification: createJustification({
        license: issuedDirect.claims,
        agentKey: env.planner,
        action: "calendar.read",
        location: "calendar:primary",
        basis: "agent",
        why: "The agent decided to read the calendar on its own.",
        now: env.now,
        jti: "jus_wrong_basis_0001",
      }),
    }, "calendar.read", "calendar:primary");
    expect(wrongBasis.code).toBe("justification_mismatch");
    expect(wrongBasis.flags.basis_ok).toBe(false);
  });

  it("allows a user_goal inside scope and rejects a mismatched goal or basis", () => {
    const goal = issued(
      env,
      { type: "user_goal", goal: "Summarize the primary calendar" },
      detail(["calendar.create", "calendar.read"], ["calendar:primary"], 5),
    );
    const ok = present(env, {
      license: goal.license,
      request: goal.request,
      justification: justify(env, goal.claims, "calendar.read", "calendar:primary", "user_goal", "Reading events is required to summarize the calendar.", {
        goal: "Summarize the primary calendar",
      }),
    }, "calendar.read", "calendar:primary");
    expect(ok.ok).toBe(true);
    expect(ok.flags.request_match).toBe(true);

    const over = present(env, {
      license: goal.license,
      justification: justify(env, goal.claims, "mail.send", "mail:outbox", "user_goal", "Sending mail was not part of the granted calendar scope.", {
        goal: "Summarize the primary calendar",
        jti: "jus_mail_send_00001",
      }),
    }, "mail.send", "mail:outbox");
    expect(over.code).toBe("over_scope");

    const badGoal = present(env, {
      license: goal.license,
      justification: justify(env, goal.claims, "calendar.read", "calendar:primary", "user_goal", "This cites a different goal than the user signed.", {
        goal: "Delete every event on the calendar",
        jti: "jus_bad_goal_000001",
      }),
    }, "calendar.read", "calendar:primary");
    expect(badGoal.code).toBe("justification_mismatch");

    const claimsUserAsked = present(env, {
      license: goal.license,
      justification: justify(env, goal.claims, "calendar.read", "calendar:primary", "user_request", "The user asked for this exact read.", {
        jti: "jus_claims_exact_001",
      }),
    }, "calendar.read", "calendar:primary");
    expect(claimsUserAsked.code).toBe("justification_mismatch");
  });

  it("keeps agent_initiated inside the narrow ceiling", () => {
    const own = issued(
      env,
      { type: "agent_initiated" },
      detail(["clock.read"], ["clock:local"], 3),
    );
    const ok = present(env, {
      ...own,
      justification: justify(env, own.claims, "clock.read", "clock:local", "agent", "Checking the clock before scheduling a later step."),
    }, "clock.read", "clock:local");
    expect(ok.ok).toBe(true);

    const claimedGoal = present(env, {
      license: own.license,
      justification: createJustification({
        license: own.claims,
        agentKey: env.planner,
        action: "clock.read",
        location: "clock:local",
        basis: "user_goal",
        goal: "Summarize the primary calendar",
        why: "Pretending the user set a goal for this clock read.",
        now: env.now,
        jti: "jus_pretend_goal_001",
      }),
    }, "clock.read", "clock:local");
    expect(claimedGoal.code).toBe("justification_mismatch");
  });

  it("rejects a request hash mismatch, an exhausted budget, and a replayed justification", () => {
    const goal = issued(
      env,
      { type: "user_goal", goal: "Summarize the primary calendar" },
      detail(["calendar.read"], ["calendar:primary"], 1),
    );
    const other = issued(
      env,
      { type: "direct_request", action: "calendar.read", location: "calendar:primary" },
      detail(["calendar.read"], ["calendar:primary"], 1),
    );
    const justification = justify(env, goal.claims, "calendar.read", "calendar:primary", "user_goal", "Reading the calendar serves the signed summary goal.", {
      goal: "Summarize the primary calendar",
      jti: "jus_budget_replay_01",
    });
    const mismatch = present(env, {
      license: goal.license,
      request: other.request,
      justification,
    }, "calendar.read", "calendar:primary");
    expect(mismatch.code).toBe("request_hash_mismatch");

    const first = present(env, { license: goal.license, justification }, "calendar.read", "calendar:primary");
    expect(first.ok).toBe(true);
    const second = present(env, { license: goal.license, justification }, "calendar.read", "calendar:primary", {
      callsSoFar: 1,
    });
    expect(second.code).toBe("budget_exceeded");

    const seen = new Set<string>();
    const once = present(env, { license: goal.license, justification }, "calendar.read", "calendar:primary", { seen });
    expect(once.ok).toBe(true);
    const replay = present(env, { license: goal.license, justification }, "calendar.read", "calendar:primary", { seen });
    expect(replay.code).toBe("justification_replay");
  });

  it("rejects a missing license", () => {
    const result = assessPresentation({
      action: "calendar.read",
      location: "calendar:primary",
      issuerKey: publicJwk(env.issuer),
      userKeys: env.userKeys,
      agentKeys: env.agentKeys,
      now: env.now,
    });
    expect(result.code).toBe("missing_license");
  });
});
