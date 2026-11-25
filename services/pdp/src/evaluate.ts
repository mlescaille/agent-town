import { isAuthorized } from "@cedar-policy/cedar-wasm/nodejs";

import { effectOf } from "@agentlicense/core";

import { loadPolicies } from "./policy.js";

export interface AuthzenDecision {
  decision: boolean;
  context: {
    reason: string;
    cedar_decision?: "allow" | "deny";
    determining_policies: string[];
    errors?: string[];
  };
}

interface Party {
  type?: string;
  id?: string;
  name?: string;
  properties?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flag(value: unknown): boolean {
  return value === true;
}

function merge(
  base: Record<string, unknown> | undefined,
  over: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(over)) return base;
  return { ...base, ...over };
}

export function evaluateAccess(
  request: unknown,
  policies = loadPolicies(),
): AuthzenDecision {
  if (!isRecord(request)) return deny("malformed", ["request must be an object"]);
  const subject = request.subject as Party | undefined;
  const action = request.action as Party | undefined;
  const resource = request.resource as Party | undefined;
  const context = isRecord(request.context) ? request.context : {};
  if (!subject?.id || !action?.name || !resource?.type || !resource.id) {
    return deny("malformed", ["subject.id, action.name, resource.type, and resource.id are required"]);
  }
  const effect = effectOf(action.name);
  const mandate = String(subject.properties?.mandate ?? context.mandate ?? "");
  const answer = isAuthorized({
    principal: { type: subject.type || "agent", id: subject.id },
    action: { type: "Action", id: action.name },
    resource: { type: resource.type, id: resource.id },
    context: {
      justification_ok: flag(context.justification_ok),
      in_scope: flag(context.in_scope),
      request_match: flag(context.request_match),
      within_budget: flag(context.within_budget),
      chain_ok: flag(context.chain_ok),
      mandate_ok: flag(context.mandate_ok),
      basis_ok: flag(context.basis_ok),
      exact_match: flag(context.exact_match),
      mandate,
      effect,
    },
    policies: { staticPolicies: policies },
    entities: [],
  });
  if (answer.type !== "success") {
    return deny(
      "cedar_error",
      answer.errors.map((error) => error.message),
    );
  }
  const allow = answer.response.decision === "allow";
  return {
    decision: allow,
    context: {
      reason: allow ? "cedar permit" : "cedar deny",
      cedar_decision: answer.response.decision,
      determining_policies: answer.response.diagnostics.reason,
      errors: answer.response.diagnostics.errors.map((error) => error.error.message),
    },
  };
}

function deny(reason: string, errors: string[]): AuthzenDecision {
  return {
    decision: false,
    context: { reason, determining_policies: [], errors },
  };
}

export function evaluateBatch(request: unknown, policies = loadPolicies()): { evaluations: AuthzenDecision[] } {
  if (!isRecord(request) || !Array.isArray(request.evaluations)) {
    throw new Error("evaluations must be an array");
  }
  const evaluations = request.evaluations.map((item) => {
    const over = isRecord(item) ? item : {};
    return evaluateAccess(
      {
        subject: merge(isRecord(request.subject) ? request.subject : undefined, over.subject),
        action: merge(isRecord(request.action) ? request.action : undefined, over.action),
        resource: merge(isRecord(request.resource) ? request.resource : undefined, over.resource),
        context: merge(isRecord(request.context) ? request.context : undefined, over.context),
      },
      policies,
    );
  });
  return { evaluations };
}
