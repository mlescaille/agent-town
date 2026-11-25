import { agentNameFromSpiffe } from "./keys.js";
import type { ActClaim, LicenseClaims, Mandate, Principal } from "./types.js";

const TASK_MAX = 1000;

export function isPrincipal(value: ActClaim | Principal): value is Principal {
  return "type" in value;
}

/** Outermost hop first. Stops before the terminating principal. */
export function agentHops(act: ActClaim): ActClaim[] {
  const hops: ActClaim[] = [];
  let current: ActClaim | Principal = act;
  while (!isPrincipal(current)) {
    hops.push(current);
    current = current.on_behalf_of;
  }
  return hops;
}

export function terminalPrincipal(act: ActClaim): Principal {
  let current: ActClaim | Principal = act;
  while (!isPrincipal(current)) current = current.on_behalf_of;
  return current;
}

/**
 * A child task narrows its parent when it keeps the parent text and adds a
 * stricter clause after a separator. Equal text, a shorter text, or a
 * replacement is not a narrowing.
 */
export function taskNarrows(parent: string, child: string): boolean {
  if (child.length <= parent.length || child.length > TASK_MAX) return false;
  if (!child.startsWith(parent)) return false;
  const next = child[parent.length];
  return next === " " || next === ":" || next === "," || next === ";" || next === "." || next === "(";
}

export function formatPrincipal(principal: Principal): string {
  if (principal.type === "org") return `${principal.name} (${principal.user})`;
  if (principal.name) return `${principal.name} (${principal.user})`;
  return principal.user;
}

/** Who is speaking, for whom, up to the principal. No call and no trailing period. */
export function delegationSentence(act: ActClaim): string {
  const hops = agentHops(act);
  const self = hops[0];
  if (!self) return "";
  const behalf = [
    ...hops.slice(1).map((hop) => `${hop.name} (${hop.instance})`),
    formatPrincipal(terminalPrincipal(act)),
  ];
  let sentence = `I am ${self.name} (${self.instance})`;
  sentence += `, acting on behalf of ${behalf[0]}`;
  for (const further of behalf.slice(1)) sentence += `, on behalf of ${further}`;
  return sentence;
}

/**
 * Sentence the checkpoint renders from the signed license and the call.
 * `resource` is the `type:id` location.
 */
export function canonicalStatement(input: {
  license: Pick<LicenseClaims, "act">;
  action: string;
  resource: string;
  reason: string;
}): string {
  const reason = input.reason.endsWith(".") ? input.reason : `${input.reason}.`;
  return `${delegationSentence(input.license.act)}, requesting ${input.action} on ${input.resource} because ${reason}`;
}

export function defaultIdentity(agent: string, mandate: Mandate): { name: string; instance: string; task: string } {
  const slug = agentNameFromSpiffe(agent);
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  return {
    name,
    instance: `run-${slug}`,
    task: defaultTask(mandate),
  };
}

export function defaultChildTask(parentTask: string, name: string, instance: string): string {
  return `${parentTask} for ${name} (${instance})`;
}

function defaultTask(mandate: Mandate): string {
  if (mandate.type === "user_goal") return mandate.goal;
  if (mandate.type === "direct_request") return `Perform ${mandate.action} on ${mandate.location}`;
  return "Act within the agent-initiated ceiling";
}
