import {
  createJustification,
  decodeJws,
  expectedBasis,
  parseLicenseClaims,
  type LicenseClaims,
  type OkpPrivateJwk,
} from "@agentlicense/core";

export interface LicensedOptions {
  /** Compact issuer-signed license JWS. */
  license: string;
  /** Private key of the agent named by the license. */
  agentPrivateKey: OkpPrivateJwk;
  /** Why this call is being made. A function receives the tool call. */
  why: string | ((call: { action: string; location: string }) => string);
  /** Checkpoint origin, for example `http://127.0.0.1:43122`. */
  checkpoint: string;
  /** Optional user-request JWS. The checkpoint recomputes its hash when present. */
  userRequest?: string;
}

/**
 * Wrap `fetch` so each call is posted to the checkpoint with a license and a
 * fresh signed justification. The request URL is not contacted; the checkpoint
 * is the only hop. The JSON body must name `action` and `resource`.
 */
export function licensed(baseFetch: typeof fetch, options: LicensedOptions): typeof fetch {
  const claims = licenseClaims(options.license);
  return (async (_input, init) => {
    void _input;
    const body = readToolCall(init?.body);
    const why = typeof options.why === "function" ? options.why(body) : options.why;
    const justification = createJustification({
      license: claims,
      agentKey: options.agentPrivateKey,
      action: body.action,
      location: body.location,
      why,
      basis: expectedBasis(claims.mandate.type),
      goal: claims.mandate.type === "user_goal" ? claims.mandate.goal : undefined,
    });
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    headers.set("agent-license", options.license);
    headers.set("agent-justification", justification);
    const payload = {
      action: body.action,
      resource: { type: body.type, id: body.id },
      input: body.input,
      user_request: options.userRequest,
    };
    return baseFetch(new URL("/v1/invoke", options.checkpoint), {
      ...init,
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  }) as typeof fetch;
}

function licenseClaims(token: string): LicenseClaims {
  return parseLicenseClaims(decodeJws(token).payload);
}

function readToolCall(body: RequestInit["body"]): {
  action: string;
  location: string;
  type: string;
  id: string;
  input: unknown;
} {
  if (typeof body !== "string") {
    throw new Error("licensed(fetch) expects a JSON string body describing the tool call");
  }
  const parsed = JSON.parse(body) as {
    action?: string;
    location?: string;
    resource?: { type?: string; id?: string };
    input?: unknown;
  };
  const type = parsed.resource?.type ?? parsed.location?.split(":")[0];
  const id = parsed.resource?.id ?? parsed.location?.split(":").slice(1).join(":");
  if (!parsed.action || !type || !id) {
    throw new Error("tool call JSON needs action and resource {type, id}");
  }
  return { action: parsed.action, location: `${type}:${id}`, type, id, input: parsed.input ?? null };
}
