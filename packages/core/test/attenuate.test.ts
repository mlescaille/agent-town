import { describe, expect, it } from "vitest";

import { LicenseError, attenuateLicense, delegationChain, publicJwk, verifyLicense } from "../src/index.js";
import { detail, fixture, issued } from "./helpers.js";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof LicenseError) return error.code;
    throw error;
  }
  return "did_not_throw";
}

describe("attenuation", () => {
  const env = fixture();
  const parent = issued(
    env,
    { type: "user_goal", goal: "Summarize the primary calendar" },
    detail(["calendar.create", "calendar.read"], ["calendar:primary", "calendar:shared"], 10),
  );

  function narrow(overrides: Record<string, unknown> = {}) {
    return attenuateLicense({
      parentJws: parent.license,
      issuerKey: env.issuer,
      issuerPublicKey: publicJwk(env.issuer),
      agentKeys: env.agentKeys,
      childAgent: env.researcherId,
      authorizationDetails: [detail(["calendar.read"], ["calendar:primary"], 4)],
      exp: parent.claims.exp - 60,
      now: env.now,
      jti: "lic_child_0001",
      ...overrides,
    });
  }

  it("issues a strictly narrower license and extends the act chain", () => {
    const child = narrow();
    const verified = verifyLicense(child.license, env.issuer, env.now);
    expect(verified.agent).toBe(env.researcherId);
    expect(verified.parent_jti).toBe(parent.claims.jti);
    expect(verified.mandate).toEqual(parent.claims.mandate);
    expect(verified.txn).toBe(parent.claims.txn);
    expect(verified.req_hash).toBe(parent.claims.req_hash);
    expect(verified.sub).toBe(parent.claims.sub);
    expect(verified.authorization_details[0]?.actions).toEqual(["calendar.read"]);
    expect(verified.authorization_details[0]?.budget?.max_calls).toBe(4);
    expect(delegationChain(verified)).toEqual(["user:alice", env.plannerId, env.researcherId]);
  });

  it("refuses a wider action, location, budget, expiry, or an equal copy", () => {
    expect(codeOf(() => narrow({
      authorizationDetails: [detail(["calendar.read", "mail.send"], ["calendar:primary"], 4)],
    }))).toBe("scope_widen");
    expect(codeOf(() => narrow({
      authorizationDetails: [detail(["calendar.read"], ["calendar:primary", "mail:outbox"], 4)],
    }))).toBe("scope_widen");
    expect(codeOf(() => narrow({
      authorizationDetails: [detail(["calendar.read"], ["calendar:primary"], 11)],
    }))).toBe("budget_widen");
    expect(codeOf(() => narrow({
      authorizationDetails: [detail(["calendar.read"], ["calendar:primary"])],
    }))).toBe("budget_widen");
    expect(codeOf(() => narrow({ exp: parent.claims.exp + 60 }))).toBe("expiry_widen");
    expect(codeOf(() => narrow({
      authorizationDetails: [detail(["calendar.create", "calendar.read"], ["calendar:primary", "calendar:shared"], 10)],
      exp: parent.claims.exp,
    }))).toBe("not_narrowed");
  });

  it("refuses to put an ancestor back on the chain", () => {
    const child = narrow();
    expect(codeOf(() => attenuateLicense({
      parentJws: child.license,
      issuerKey: env.issuer,
      issuerPublicKey: publicJwk(env.issuer),
      agentKeys: env.agentKeys,
      childAgent: env.plannerId,
      authorizationDetails: [detail(["calendar.read"], ["calendar:primary"], 2)],
      exp: parent.claims.exp - 120,
      now: env.now,
    }))).toBe("chain_cycle");
  });

  it("can shrink a direct_request license only by budget or expiry", () => {
    const exact = issued(
      env,
      { type: "direct_request", action: "calendar.read", location: "calendar:primary" },
      detail(["calendar.read"], ["calendar:primary"], 2),
    );
    const child = attenuateLicense({
      parentJws: exact.license,
      issuerKey: env.issuer,
      issuerPublicKey: publicJwk(env.issuer),
      agentKeys: env.agentKeys,
      childAgent: env.researcherId,
      authorizationDetails: [detail(["calendar.read"], ["calendar:primary"], 1)],
      exp: exact.claims.exp,
      now: env.now,
    });
    expect(verifyLicense(child.license, env.issuer, env.now).mandate.type).toBe("direct_request");
    expect(codeOf(() => attenuateLicense({
      parentJws: exact.license,
      issuerKey: env.issuer,
      issuerPublicKey: publicJwk(env.issuer),
      agentKeys: env.agentKeys,
      childAgent: env.researcherId,
      authorizationDetails: [detail(["calendar.read", "calendar.create"], ["calendar:primary"], 1)],
      exp: exact.claims.exp - 1,
      now: env.now,
    }))).toBe("scope_widen");
  });
});
