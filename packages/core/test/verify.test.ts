import { describe, expect, it } from "vitest";

import {
  LICENSE_TYP,
  agentSpiffe,
  decodeJws,
  delegationChain,
  signJws,
  verifyJws,
  verifyLicense,
  type LicenseClaims,
} from "../src/index.js";
import { detail, fixture, issued } from "./helpers.js";

describe("license verification", () => {
  const env = fixture();
  const { license, claims, request } = issued(
    env,
    { type: "user_goal", goal: "Summarize the primary calendar" },
    detail(["calendar.read", "calendar.create"], ["calendar:primary"], 10),
  );

  it("accepts an issuer-signed license and shows the delegation chain", () => {
    const verified = verifyLicense(license, env.issuer, env.now);
    expect(verified.jti).toBe(claims.jti);
    expect(verified.sub).toBe("user:alice");
    expect(verified.agent).toBe(agentSpiffe("planner"));
    expect(verified.txn).toMatch(/^req_/);
    expect(verified.req_hash.startsWith("sha-256:")).toBe(true);
    expect(delegationChain(verified)).toEqual(["user:alice", agentSpiffe("planner")]);
    expect(request.split(".").length).toBe(3);
  });

  it("rejects a flipped signature and a different key", () => {
    const [h, p, s] = license.split(".");
    const chars = s!.split("");
    chars[10] = chars[10] === "A" ? "B" : "A";
    const flipped = `${h}.${p}.${chars.join("")}`;
    expect(() => verifyLicense(flipped, env.issuer, env.now)).toThrow(/signature/i);
    const other = fixture();
    expect(() => verifyLicense(license, other.issuer, env.now)).toThrow(/kid|signature/i);
  });

  it("rejects a tampered payload", () => {
    const [h, p, s] = license.split(".");
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as LicenseClaims;
    payload.sub = "user:mallory";
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(() => verifyLicense(`${h}.${encoded}.${s}`, env.issuer, env.now)).toThrow(/signature/i);
  });

  it("rejects expiry and a not-yet-valid window", () => {
    expect(() => verifyLicense(license, env.issuer, env.now + 10_000)).toThrow(/expired/i);
    const early = signJws(
      { ...claims, iat: env.now + 100, nbf: env.now + 100, exp: env.now + 4000 },
      env.issuer,
      LICENSE_TYP,
    );
    expect(() => verifyLicense(early, env.issuer, env.now)).toThrow(/not yet valid/i);
  });

  it("rejects a license whose act chain does not match the agent", () => {
    const broken = signJws(
      {
        ...claims,
        agent: agentSpiffe("researcher"),
        act: { sub: agentSpiffe("planner") },
      },
      env.issuer,
      LICENSE_TYP,
    );
    expect(() => verifyLicense(broken, env.issuer, env.now)).toThrow(/act/i);
  });

  it("rejects alg=none and an agent_initiated scope outside the ceiling", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: LICENSE_TYP })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    expect(() => verifyJws(`${header}.${payload}.`, env.issuer)).toThrow();
    const wide = signJws(
      {
        ...claims,
        jti: "lic_agent_initiated_wide",
        mandate: { type: "agent_initiated" },
        authorization_details: [detail(["mail.send"], ["mail:outbox"], 1)],
      },
      env.issuer,
      LICENSE_TYP,
    );
    expect(() => verifyLicense(wide, env.issuer, env.now).mandate).toThrow(/ceiling|mandate/i);
  });

  it("decodes without verifying so an inspector can show claims", () => {
    expect(decodeJws(license).payload.jti).toBe(claims.jti);
  });
});
