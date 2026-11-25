import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ID_BLOCK = /@id\("([^"]+)"\)\s*([\s\S]*?)(?=@id\("|$)/g;

/** Split the annotated policy file into a Cedar policy map keyed by `@id`. */
export function policiesFromText(text: string): Record<string, string> {
  const policies: Record<string, string> = {};
  for (const match of text.matchAll(ID_BLOCK)) {
    const id = match[1];
    const body = match[2]?.trim();
    if (!id || !body) continue;
    policies[id] = body;
  }
  if (Object.keys(policies).length === 0) {
    throw new Error("policy file contains no @id blocks");
  }
  return policies;
}

export function defaultPolicyPath(): string {
  const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
  const candidates = [
    process.env.AGENT_LICENSE_POLICY,
    fromHere("../../../policies/mandates.cedar"),
    fromHere("../policies/mandates.cedar"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Cedar policy not found. Set AGENT_LICENSE_POLICY. Looked in ${candidates.join(", ")}`);
  }
  return found;
}

export function loadPolicies(path = defaultPolicyPath()): Record<string, string> {
  return policiesFromText(readFileSync(path, "utf8"));
}
