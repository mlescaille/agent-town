import {
  LicenseError,
  assessPresentation,
  closeServer,
  createHttpServer,
  effectOf,
  hashPresentedJustification,
  listen,
  loadKeystore,
  parseAction,
  parseLocation,
  publicJwk,
  readJson,
  requestUrl,
  sendJson,
  type Assessment,
  type DecisionRecord,
} from "@agentlicense/core";

import { combineDecision, type PolicyAnswer } from "./decide.js";

export interface Running {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export interface CheckpointOptions {
  home: string;
  pdpUrl: string;
  logUrl: string;
  upstreamUrl: string;
  port?: number;
  host?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startCheckpoint(options: CheckpointOptions): Promise<Running> {
  const keys = loadKeystore(options.home);
  const calls = new Map<string, number>();
  const seen = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  const server = createHttpServer(async (req, res) => {
    const url = requestUrl(req);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "checkpoint" });
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/v1/invoke") {
      sendJson(res, 404, { error: { code: "not_found", message: "not found" } });
      return;
    }
    const body = await readJson(req);
    const run = queue.then(() => handleInvoke(body, req.headers, keys, options, calls, seen));
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    const result = await run;
    sendJson(res, result.status, result.body);
  });
  const port = await listen(server, options.port ?? 0, options.host ?? "127.0.0.1");
  return { port, url: `http://127.0.0.1:${port}`, close: () => closeServer(server) };
}

async function handleInvoke(
  body: unknown,
  headers: IncomingHttpHeaders,
  keys: ReturnType<typeof loadKeystore>,
  options: CheckpointOptions,
  calls: Map<string, number>,
  seen: Set<string>,
): Promise<{ status: number; body: unknown }> {
  if (!isRecord(body) || typeof body.action !== "string") {
    throw new LicenseError("malformed", "action is required");
  }
  const action = parseAction(body.action);
  const location = locationOf(body);
  const license = headerValue(headers["agent-license"]);
  const justification = headerValue(headers["agent-justification"]);
  const userRequest = typeof body.user_request === "string" ? body.user_request : undefined;
  const assessment = assessPresentation({
    licenseJws: license,
    justificationJws: justification,
    userRequestJws: userRequest,
    action,
    location,
    callsSoFar: license ? calls.get(jtiOf(license)) ?? 0 : 0,
    seenJustifications: seen,
    issuerKey: publicJwk(keys.issuer),
    userKeys: keys.userPublic(),
    agentKeys: keys.agentPublic(),
  });
  const policy = await askPdp(options.pdpUrl, assessment, action, location);
  const combined = combineDecision(assessment, policy);
  const record: Omit<DecisionRecord, "index" | "v"> = {
    time: new Date().toISOString(),
    decision: combined.decision,
    code: combined.code,
    reason: combined.reason,
    license_jti: assessment.licenseJti,
    justification_jti: assessment.justificationJti,
    justification_hash: hashPresentedJustification(justification),
    agent: assessment.agent,
    sub: assessment.sub,
    mandate: assessment.mandate,
    action,
    location,
    policy_decision: combined.policy_decision,
    why: assessment.why,
  };
  const logged = await fetch(`${options.logUrl}/v1/entries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!logged.ok) {
    throw new LicenseError("internal", "decision log rejected the entry");
  }
  const logBody = (await logged.json()) as { index: number };
  if (combined.decision === "allow" && assessment.licenseJti) {
    calls.set(assessment.licenseJti, (calls.get(assessment.licenseJti) ?? 0) + 1);
  }
  const payload = {
    decision: combined.decision,
    code: combined.code,
    reason: combined.reason,
    log_index: logBody.index,
    policy_decision: combined.policy_decision,
    determining_policies: combined.determining_policies,
  };
  if (combined.decision === "deny") return { status: 403, body: payload };
  const upstream = await fetch(`${options.upstreamUrl}/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, location, input: body.input ?? null }),
  });
  if (!upstream.ok) {
    return {
      status: 502,
      body: { ...payload, reason: "upstream tool failed after the call was allowed" },
    };
  }
  return { status: 200, body: { ...payload, upstream: await upstream.json() } };
}

function locationOf(body: Record<string, unknown>): string {
  if (typeof body.location === "string") return parseLocation(body.location);
  if (isRecord(body.resource) && typeof body.resource.type === "string" && typeof body.resource.id === "string") {
    return parseLocation(`${body.resource.type}:${body.resource.id}`);
  }
  throw new LicenseError("malformed", "resource {type,id} or location is required");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function jtiOf(license: string): string {
  try {
    const payload = license.split(".")[1];
    if (!payload) return "";
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { jti?: string };
    return parsed.jti ?? "";
  } catch {
    return "";
  }
}

async function askPdp(
  pdpUrl: string,
  assessment: Assessment,
  action: string,
  location: string,
): Promise<PolicyAnswer | null> {
  const [type, id] = splitLocation(location);
  try {
    const response = await fetch(`${pdpUrl}/access/v1/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: {
          type: "agent",
          id: assessment.agent || "unknown",
          properties: { user: assessment.sub, mandate: assessment.mandate },
        },
        action: { name: action, properties: { effect: effectOf(action) } },
        resource: { type, id },
        context: {
          ...assessment.flags,
          mandate: assessment.mandate,
          license_jti: assessment.licenseJti,
          why: assessment.why,
        },
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    return (await response.json()) as PolicyAnswer;
  } catch {
    return null;
  }
}

function splitLocation(location: string): [string, string] {
  const index = location.indexOf(":");
  return [location.slice(0, index), location.slice(index + 1)];
}

type IncomingHttpHeaders = import("node:http").IncomingHttpHeaders;
