import { describe, expect, it } from "vitest";

import {
  LICENSE_TYP,
  assessPresentation,
  attenuateLicense,
  canonicalStatement,
  createJustification,
  createUserRequest,
  issueLicense,
  publicJwk,
  signJws,
  type LicenseClaims,
} from "../src/index.js";
import { detail, fixture, issued, justify } from "./helpers.js";

function present(
  env: ReturnType<typeof fixture>,
  license: string,
  justification: string,
  action = "calendar.read",
  location = "calendar:primary",
) {
  return assessPresentation({
    licenseJws: license,
    justificationJws: justification,
    action,
    location,
    issuerKey: publicJwk(env.issuer),
    userKeys: env.userKeys,
    agentKeys: env.agentKeys,
    now: env.now,
  });
}

function resign(env: ReturnType<typeof fixture>, claims: LicenseClaims): string {
  return signJws(claims as unknown as Record<string, unknown>, env.issuer, LICENSE_TYP);
}

describe("delegation statements", () => {
  const env = fixture();
  const goal = "Prepare a summary of the matter file";
  const childTask = `${goal}: search the matter documents for the cited exhibit`;
  const why = "The office needs the cited exhibit from the matter file";
  const office = "Office of A. Example, Attorney at Law";
  const sentence =
    "I am Researcher (subagent-123), acting on behalf of Planner (planner-1), on behalf of Office of A. Example, Attorney at Law (user:alice), requesting documents.search on documents:matter because The office needs the cited exhibit from the matter file.";

  const request = createUserRequest({
    userId: env.aliceId,
    userKey: env.alice,
    agent: env.plannerId,
    mandate: { type: "user_goal", goal },
    authorizationDetails: [detail(["documents.search", "documents.read"], ["documents:matter"], 5)],
    ttlSeconds: 3600,
    now: env.now,
    jti: "req_office_example_0001",
    principal: { type: "org", name: office, user: env.aliceId },
    name: "Planner",
    instance: "planner-1",
    task: goal,
  });
  const parent = issueLicense({
    userRequestJws: request,
    issuerKey: env.issuer,
    userKeys: env.userKeys,
    agentKeys: env.agentKeys,
    now: env.now,
    ttlSeconds: 3600,
    jti: "lic_office_planner_0001",
  });
  const child = attenuateLicense({
    parentJws: parent.license,
    issuerKey: env.issuer,
    issuerPublicKey: publicJwk(env.issuer),
    agentKeys: env.agentKeys,
    childAgent: env.researcherId,
    authorizationDetails: [detail(["documents.search"], ["documents:matter"], 2)],
    exp: parent.claims.exp - 60,
    now: env.now,
    jti: "lic_office_researcher_01",
    name: "Researcher",
    instance: "subagent-123",
    task: childTask,
  });

  it("renders the office chain as one sentence and accepts that statement", () => {
    const rendered = canonicalStatement({
      license: child.claims,
      action: "documents.search",
      resource: "documents:matter",
      reason: why,
    });
    expect(rendered).toBe(sentence);
    const justification = createJustification({
      license: child.claims,
      agentKey: env.researcher,
      action: "documents.search",
      location: "documents:matter",
      why,
      basis: "user_goal",
      goal,
      now: env.now,
      jti: "jus_office_search_0001",
    });
    const allowed = present(env, child.license, justification, "documents.search", "documents:matter");
    expect(allowed.ok).toBe(true);
    expect(allowed.statement).toBe(sentence);
    expect(allowed.code).toBe("allow");
  });

  it("denies identity_mismatch when the statement forges the instance", () => {
    const forged = sentence.replace("subagent-123", "subagent-999");
    const justification = createJustification({
      license: child.claims,
      agentKey: env.researcher,
      action: "documents.search",
      location: "documents:matter",
      why,
      basis: "user_goal",
      goal,
      statement: forged,
      now: env.now,
      jti: "jus_office_forged_0001",
    });
    const result = present(env, child.license, justification, "documents.search", "documents:matter");
    expect(result.code).toBe("identity_mismatch");
    expect(result.statement).toBe(sentence);
  });

  it("denies chain_incomplete when a hop lacks instance, name, or on_behalf_of", () => {
    const justification = justify(env, child.claims, "documents.search", "documents:matter", "user_goal", why, {
      goal,
      jti: "jus_office_chain_00001",
    });
    const drop = (field: "instance" | "name" | "task" | "on_behalf_of") => {
      const broken = structuredClone(child.claims);
      delete (broken.act as unknown as Record<string, unknown>)[field];
      return present(env, resign(env, broken), justification, "documents.search", "documents:matter").code;
    };
    expect(drop("instance")).toBe("chain_incomplete");
    expect(drop("name")).toBe("chain_incomplete");
    expect(drop("task")).toBe("chain_incomplete");
    expect(drop("on_behalf_of")).toBe("chain_incomplete");
  });

  it("denies chain_incomplete when the chain does not end at the license principal", () => {
    const broken = structuredClone(child.claims);
    broken.principal = { type: "user", user: env.aliceId };
    const justification = justify(env, child.claims, "documents.search", "documents:matter", "user_goal", why, {
      goal,
      jti: "jus_office_principal_01",
    });
    const result = present(env, resign(env, broken), justification, "documents.search", "documents:matter");
    expect(result.code).toBe("chain_incomplete");
  });

  it("denies task_widened when a hop replaces its parent task", () => {
    expect(() =>
      attenuateLicense({
        parentJws: parent.license,
        issuerKey: env.issuer,
        issuerPublicKey: publicJwk(env.issuer),
        agentKeys: env.agentKeys,
        childAgent: env.researcherId,
        authorizationDetails: [detail(["documents.search"], ["documents:matter"], 2)],
        exp: parent.claims.exp - 60,
        now: env.now,
        name: "Researcher",
        instance: "subagent-123",
        task: "Review unrelated client matters",
      }),
    ).toThrow(/task/i);

    const widened = structuredClone(child.claims);
    widened.act.task = "Review unrelated client matters";
    widened.jti = "lic_office_widened_0001";
    const justification = createJustification({
      license: child.claims,
      agentKey: env.researcher,
      action: "documents.search",
      location: "documents:matter",
      why,
      basis: "user_goal",
      goal,
      now: env.now,
      jti: "jus_office_widened_001",
    });
    const result = present(env, resign(env, widened), justification, "documents.search", "documents:matter");
    expect(result.code).toBe("task_widened");
  });

  it("states a single-hop user principal without an office", () => {
    const plain = issued(
      env,
      { type: "user_goal", goal: "Summarize the primary calendar" },
      detail(["calendar.read"], ["calendar:primary"], 2),
    );
    const whyPlain = "This call is the next step that the license permits";
    const expected =
      "I am Planner (run-planner), acting on behalf of user:alice, requesting calendar.read on calendar:primary because This call is the next step that the license permits.";
    const justification = justify(env, plain.claims, "calendar.read", "calendar:primary", "user_goal", whyPlain, {
      goal: "Summarize the primary calendar",
      jti: "jus_plain_chain_00001",
    });
    const result = present(env, plain.license, justification);
    expect(result.ok).toBe(true);
    expect(result.statement).toBe(expected);
  });
});
