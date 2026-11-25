import { describe, expect, it } from "vitest";

import {
  agentSpiffe,
  createUserRequest,
  generateEd25519Keypair,
  issueLicense,
  publicJwk,
  userIdOf,
  verifyJustification,
} from "@agentlicense/core";

import { licensed } from "../src/index.js";

describe("licensed(fetch)", () => {
  it("posts the tool call to the checkpoint with a verifiable justification", async () => {
    const now = Math.floor(Date.now() / 1000);
    const issuer = generateEd25519Keypair();
    const alice = generateEd25519Keypair();
    const planner = generateEd25519Keypair();
    const aliceId = userIdOf("alice");
    const plannerId = agentSpiffe("planner");
    const request = createUserRequest({
      userId: aliceId,
      userKey: alice,
      agent: plannerId,
      mandate: { type: "user_goal", goal: "Summarize the primary calendar" },
      authorizationDetails: [
        {
          type: "urn:agent-license:tool",
          actions: ["calendar.read"],
          locations: ["calendar:primary"],
          budget: { max_calls: 2 },
        },
      ],
      ttlSeconds: 600,
      now,
    });
    const { license, claims } = issueLicense({
      userRequestJws: request,
      issuerKey: issuer,
      userKeys: { [aliceId]: publicJwk(alice) },
      agentKeys: { [plannerId]: publicJwk(planner) },
      now,
    });
    let seen: { url: string; license?: string; justification?: string; body: string } | undefined;
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen = {
        url: String(input),
        license: headers.get("agent-license") ?? undefined,
        justification: headers.get("agent-justification") ?? undefined,
        body: String(init?.body),
      };
      return new Response(JSON.stringify({ decision: "allow" }), { status: 200 });
    }) as typeof fetch;
    const call = licensed(fakeFetch, {
      license,
      agentPrivateKey: planner,
      checkpoint: "http://127.0.0.1:43122",
      why: "Reading the calendar is how the summary is produced.",
      userRequest: request,
    });
    const response = await call("http://tool.invalid/ignored", {
      method: "POST",
      body: JSON.stringify({
        action: "calendar.read",
        resource: { type: "calendar", id: "primary" },
      }),
    });
    expect(response.status).toBe(200);
    expect(seen?.url).toBe("http://127.0.0.1:43122/v1/invoke");
    expect(seen?.license).toBe(license);
    const justification = verifyJustification(seen!.justification!, publicJwk(planner), now);
    expect(justification.license_jti).toBe(claims.jti);
    expect(justification.basis).toBe("user_goal");
    expect(justification.goal).toBe("Summarize the primary calendar");
    expect(JSON.parse(seen!.body).user_request).toBe(request);
  });
});
