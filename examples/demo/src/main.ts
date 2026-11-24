import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startCheckpoint, startDemoUpstream } from "@agent-license/checkpoint";
import {
  LICENSE_TYP,
  agentSpiffe,
  canonicalize,
  canonicalStatement,
  createJustification,
  createUserRequest,
  delegationChain,
  initKeystore,
  loadKeystore,
  publicJwk,
  signJws,
  verifyConsistency,
  verifyInclusion,
  verifyLicense,
  verifyReplayedLog,
  type ConsistencyProof,
  type InclusionProof,
  type AuthorizationDetail,
  type LicenseClaims,
  type Mandate,
  type Principal,
} from "@agent-license/core";
import { startIssuer } from "@agent-license/issuer";
import { startLog } from "@agent-license/log";
import { startPdp } from "@agent-license/pdp";
import { licensed } from "@agent-license/sdk";

interface Step {
  label: string;
  pass: boolean;
  detail: string;
}

export async function runDemo(): Promise<{ transcript: string; ok: boolean }> {
  const home = await mkdtemp(join(tmpdir(), "agent-license-"));
  const steps: Step[] = [];
  const running: Array<{ close: () => Promise<void> }> = [];
  try {
    initKeystore(home);
    const keys = loadKeystore(home);
    const log = await startLog({ home, port: 0 });
    running.push(log);
    const pdp = await startPdp({ port: 0 });
    running.push(pdp);
    const upstream = await startDemoUpstream({ port: 0 });
    running.push(upstream);
    const issuer = await startIssuer({ home, port: 0 });
    running.push(issuer);
    const checkpoint = await startCheckpoint({
      home,
      port: 0,
      pdpUrl: pdp.url,
      logUrl: log.url,
      upstreamUrl: upstream.url,
    });
    running.push(checkpoint);

    const lines = [
      "agent-license demo",
      "",
      `issuer      ${issuer.url}`,
      `checkpoint  ${checkpoint.url}`,
      `pdp         ${pdp.url}`,
      `log         ${log.url}`,
      "",
    ];

    const direct = await issue(issuer.url, keys, {
      type: "direct_request",
      action: "calendar.read",
      location: "calendar:primary",
    }, scope(["calendar.read"], ["calendar:primary"], 1));
    const goal = await issue(issuer.url, keys, {
      type: "user_goal",
      goal: "Summarize the primary calendar",
    }, scope(["calendar.read", "calendar.create"], ["calendar:primary"], 20));
    const own = await issue(issuer.url, keys, { type: "agent_initiated" }, scope(["clock.read"], ["clock:local"], 3));

    await tool(steps, "direct_request allow", "allow", () =>
      throughSdk(checkpoint.url, direct, keys, "calendar.read", "calendar", "primary"),
    );
    await tool(steps, "user_goal allow", "allow", () =>
      throughSdk(checkpoint.url, goal, keys, "calendar.read", "calendar", "primary"),
    );
    await tool(steps, "agent_initiated allow", "allow", () =>
      throughSdk(checkpoint.url, own, keys, "clock.read", "clock", "local"),
    );
    await tool(steps, "over_scope deny", "over_scope", () =>
      throughSdk(checkpoint.url, goal, keys, "mail.send", "mail", "outbox"),
    );

    const mismatched = createJustification({
      license: goal.claims,
      agentKey: keys.agent("planner"),
      action: "calendar.read",
      location: "calendar:primary",
      basis: "user_request",
      why: "Claiming the user asked for this exact read.",
    });
    await tool(steps, "justification mismatch", "justification_mismatch", () =>
      fetch(`${checkpoint.url}/v1/invoke`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "agent-license": goal.license,
          "agent-justification": mismatched,
        },
        body: JSON.stringify({
          action: "calendar.read",
          resource: { type: "calendar", id: "primary" },
          user_request: goal.request,
        }),
      }),
    );
    await tool(steps, "missing license", "missing_license", () =>
      fetch(`${checkpoint.url}/v1/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "calendar.read", resource: { type: "calendar", id: "primary" } }),
      }),
    );

    const exp = Math.floor(Date.now() / 1000) + 900;
    const narrowed = await fetch(`${issuer.url}/v1/licenses/attenuate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parent: goal.license,
        agent: agentSpiffe("researcher"),
        authorization_details: [scope(["calendar.read"], ["calendar:primary"], 4)],
        exp,
      }),
    });
    const narrowedBody = (await narrowed.json()) as { license?: string; error?: { code: string } };
    const childLicense = narrowedBody.license ?? "";
    const childClaims = childLicense ? verifyLicense(childLicense, publicJwk(keys.issuer)) : undefined;
    steps.push({
      label: "attenuate to researcher",
      pass: narrowed.ok && childClaims?.authorization_details[0]?.actions.join(",") === "calendar.read",
      detail: childClaims ? delegationChain(childClaims).join(" -> ") : narrowedBody.error?.code ?? "no license",
    });

    const widened = await fetch(`${issuer.url}/v1/licenses/attenuate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parent: goal.license,
        agent: agentSpiffe("researcher"),
        authorization_details: [scope(["mail.send"], ["mail:outbox"], 1)],
        exp,
      }),
    });
    const widenedBody = (await widened.json()) as { error?: { code: string } };
    steps.push({
      label: "reject widened scope",
      pass: widened.status === 400 && widenedBody.error?.code === "scope_widen",
      detail: widenedBody.error?.code ?? `http ${widened.status}`,
    });

    if (childLicense && childClaims) {
      const child = { request: goal.request, license: childLicense, claims: childClaims };
      await tool(steps, "sub-agent allow", "allow", () =>
        throughSdk(checkpoint.url, child, keys, "calendar.read", "calendar", "primary", "researcher"),
      );
      await tool(steps, "sub-agent over scope", "over_scope", () =>
        throughSdk(checkpoint.url, child, keys, "calendar.create", "calendar", "primary", "researcher"),
      );
    }

    const officeGoal = "Prepare a summary of the matter file";
    const officeTask = `${officeGoal}: search the matter documents for the cited exhibit`;
    const officeWhy = "The office needs the cited exhibit from the matter file";
    const officeName = "Office of A. Example, Attorney at Law";
    const office = await issue(
      issuer.url,
      keys,
      { type: "user_goal", goal: officeGoal },
      scope(["documents.search", "documents.read"], ["documents:matter"], 5),
      {
        principal: { type: "org", name: officeName, user: "user:alice" },
        name: "Planner",
        instance: "planner-1",
        task: officeGoal,
      },
    );
    const officeExp = Math.floor(Date.now() / 1000) + 800;
    const officeNarrowed = await fetch(`${issuer.url}/v1/licenses/attenuate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parent: office.license,
        agent: agentSpiffe("researcher"),
        authorization_details: [scope(["documents.search"], ["documents:matter"], 2)],
        exp: officeExp,
        name: "Researcher",
        instance: "subagent-123",
        task: officeTask,
      }),
    });
    const officeBody = (await officeNarrowed.json()) as { license?: string; error?: { code: string; message?: string } };
    const officeChildLicense = officeBody.license;
    if (!officeNarrowed.ok || !officeChildLicense) {
      throw new Error(`office attenuate failed: ${officeBody.error?.code ?? officeNarrowed.status} ${officeBody.error?.message ?? ""}`);
    }
    const officeClaims = verifyLicense(officeChildLicense, publicJwk(keys.issuer));
    const officeLicense = { request: office.request, license: officeChildLicense, claims: officeClaims };
    const officeSentence = canonicalStatement({
      license: officeClaims,
      action: "documents.search",
      resource: "documents:matter",
      reason: officeWhy,
    });
    const officeResponse = await throughSdk(
      checkpoint.url,
      officeLicense,
      keys,
      "documents.search",
      "documents",
      "matter",
      "researcher",
      officeWhy,
    );
    const officeDecision = (await officeResponse.json()) as { code?: string; decision?: string };
    const loggedOffice = (await fetch(`${log.url}/v1/entries`).then((response) => response.json())) as {
      entries: Array<{ decision?: string; statement?: string }>;
    };
    const stored = loggedOffice.entries.some(
      (entry) => entry.decision === "allow" && entry.statement === officeSentence,
    );
    steps.push({
      label: "office subagent allow",
      pass: officeDecision.code === "allow" && stored,
      detail: officeSentence,
    });

    const forged = createJustification({
      license: officeClaims,
      agentKey: keys.agent("researcher"),
      action: "documents.search",
      location: "documents:matter",
      basis: "user_goal",
      goal: officeGoal,
      why: officeWhy,
      statement: officeSentence.replace("subagent-123", "subagent-999"),
    });
    await tool(steps, "forged instance", "identity_mismatch", () =>
      invoke(checkpoint.url, officeChildLicense, forged, "documents.search", "documents", "matter", office.request),
    );

    const missingHop = structuredClone(officeClaims);
    delete (missingHop.act as unknown as Record<string, unknown>).on_behalf_of;
    await tool(steps, "missing hop", "chain_incomplete", () =>
      invoke(
        checkpoint.url,
        signJws(missingHop as unknown as Record<string, unknown>, keys.issuer, LICENSE_TYP),
        forged,
        "documents.search",
        "documents",
        "matter",
      ),
    );

    const widenedTask = structuredClone(officeClaims);
    widenedTask.act.task = "Review unrelated client matters";
    widenedTask.jti = "lic_office_widened_task_01";
    await tool(steps, "widened task", "task_widened", () =>
      invoke(
        checkpoint.url,
        signJws(widenedTask as unknown as Record<string, unknown>, keys.issuer, LICENSE_TYP),
        forged,
        "documents.search",
        "documents",
        "matter",
      ),
    );

    const entriesResponse = await fetch(`${log.url}/v1/entries`);
    const headsResponse = await fetch(`${log.url}/v1/sths`);
    const entriesBody = (await entriesResponse.json()) as { entries: unknown[] };
    const headsBody = (await headsResponse.json()) as { sths: string[] };
    const blobs = entriesBody.entries.map((entry) => Buffer.from(canonicalize(entry), "utf8"));
    const report = verifyReplayedLog(blobs, headsBody.sths, publicJwk(keys.log));
    const inclusion = (await fetch(`${log.url}/v1/proofs/inclusion?leaf_index=0&tree_size=${blobs.length}`).then((response) =>
      response.json(),
    )) as InclusionProof;
    const consistency = (await fetch(`${log.url}/v1/proofs/consistency?first=1&second=${blobs.length}`).then((response) =>
      response.json(),
    )) as ConsistencyProof;
    const proofsOk = verifyInclusion(inclusion) && verifyConsistency(consistency);
    const tampered = blobs.map((blob) => Buffer.from(blob));
    tampered[0]![10] ^= 0xff;
    const tamper = verifyReplayedLog(tampered, headsBody.sths, publicJwk(keys.log));
    steps.push({
      label: "log replay",
      pass: report.ok && proofsOk && blobs.length === 12 && !tamper.ok,
      detail: `entries=${blobs.length} inclusion=${report.inclusion_checked} consistency=${report.consistency_checked} tamper_caught=${!tamper.ok} root=${report.root_hash.slice(0, 16)}`,
    });

    for (const step of steps) {
      lines.push(`${step.pass ? "ok  " : "FAIL"} ${step.label.padEnd(28)} ${step.detail}`);
    }
    const ok = steps.every((step) => step.pass);
    lines.push("");
    lines.push(ok ? "demo: ok" : "demo: failed");
    return { transcript: lines.join("\n"), ok };
  } finally {
    await Promise.all(running.map((service) => service.close()));
    await rm(home, { recursive: true, force: true });
  }
}

async function issue(
  issuerUrl: string,
  keys: ReturnType<typeof loadKeystore>,
  mandate: Mandate,
  authorization: AuthorizationDetail,
  identity: { principal?: Principal; name?: string; instance?: string; task?: string } = {},
): Promise<{ request: string; license: string; claims: LicenseClaims }> {
  const request = createUserRequest({
    userId: "user:alice",
    userKey: keys.user("user:alice"),
    agent: agentSpiffe("planner"),
    mandate,
    authorizationDetails: [authorization],
    ttlSeconds: 3600,
    principal: identity.principal,
    name: identity.name,
    instance: identity.instance,
    task: identity.task,
  });
  const response = await fetch(`${issuerUrl}/v1/licenses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_request: request, ttl_seconds: 3600 }),
  });
  if (!response.ok) throw new Error(`issuer rejected ${mandate.type}: ${await response.text()}`);
  const body = (await response.json()) as { license: string; claims: LicenseClaims };
  return { request, license: body.license, claims: body.claims };
}

function scope(actions: string[], locations: string[], maxCalls: number): AuthorizationDetail {
  return { type: "urn:agent-license:tool", actions, locations, budget: { max_calls: maxCalls } };
}

async function throughSdk(
  checkpoint: string,
  issued: { request: string; license: string; claims: LicenseClaims },
  keys: ReturnType<typeof loadKeystore>,
  action: string,
  type: string,
  id: string,
  agent: "planner" | "researcher" = "planner",
  why?: string,
): Promise<Response> {
  const call = licensed(fetch, {
    license: issued.license,
    agentPrivateKey: keys.agent(agent),
    checkpoint,
    userRequest: issued.request,
    why: why ?? ((tool) => `Doing ${tool.action} on ${tool.location} under the signed mandate.`),
  });
  return call("http://tool.invalid/invoke", {
    method: "POST",
    body: JSON.stringify({ action, resource: { type, id } }),
  });
}

function invoke(
  checkpoint: string,
  license: string,
  justification: string,
  action: string,
  type: string,
  id: string,
  userRequest?: string,
): Promise<Response> {
  return fetch(`${checkpoint}/v1/invoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "agent-license": license,
      "agent-justification": justification,
    },
    body: JSON.stringify({
      action,
      resource: { type, id },
      user_request: userRequest,
    }),
  });
}

async function tool(steps: Step[], label: string, expected: string, run: () => Promise<Response>): Promise<void> {
  const response = await run();
  const body = (await response.json()) as { code?: string; reason?: string; decision?: string };
  steps.push({
    label,
    pass: body.code === expected,
    detail: `${body.decision ?? "?"} ${body.code ?? "?"} ${body.reason ?? ""}`.trim(),
  });
}

const result = await runDemo();
console.log(result.transcript);
if (!result.ok) process.exit(1);
