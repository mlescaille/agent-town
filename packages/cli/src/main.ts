import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { startCheckpoint, startDemoUpstream, combineDecision } from "@agent-license/checkpoint";
import {
  LicenseError,
  agentSpiffe,
  assessPresentation,
  attenuateLicense,
  createJustification,
  createUserRequest,
  decodeJws,
  delegationChain,
  expectedBasis,
  initKeystore,
  issueLicense,
  loadKeystore,
  parseAuthorizationDetail,
  parseLicenseClaims,
  publicJwk,
  verifyLicense,
  verifyReplayedLog,
  type AuthorizationDetail,
  type Mandate,
} from "@agentlicense/core";
import { startIssuer } from "@agent-license/issuer";
import { startLog, verifyRemoteLog } from "@agent-license/log";
import { evaluateAccess, startPdp } from "@agent-license/pdp";

const HELP = `agentlicense — verifiable mandates for AI agents

Signed licenses for agent identity and delegated authority. An issuer signs
a license that names the agent, who it acts for, and what it may do. A
checkpoint outside the agent checks that license on every call.

Usage:
  agentlicense --help
  agentlicense keys init [--home <dir>]
  agentlicense issue --user <name> --agent <name> --mandate <mandate> [flags]
  agentlicense inspect <license> [--home <dir>]
  agentlicense attenuate --parent <license> --agent <name> [flags]
  agentlicense check --license <license> --action <name> --location <type:id> [flags]
  agentlicense log verify [--url <url>] [--home <dir>]
  agentlicense dev [--home <dir>]

The default key directory is ./.agent-license.
issue and attenuate print a compact JWS on stdout. Notes go to stderr.

keys init
  Write Ed25519 keys for the issuer, the log, user:alice, planner, and researcher.
  --home <dir>           Key directory. Default: .agent-license

issue
  Sign a license. Requires --user, --agent, and --mandate.
  The named user's key signs the request. The issuer key signs the license.
  direct_request needs exactly one action and one location.
  user_goal needs --goal. agent_initiated must stay inside the read-only ceiling:
  clock.read, catalog.list, memory.read and clock:local, catalog:public, memory:self,
  with budget at most 5.
  --home <dir>           Key directory. Default: .agent-license
  --user <name>          Required. User name, or user:<name>.
  --agent <name>         Required. Agent slug, or a spiffe:// id.
  --mandate <mandate>    Required. direct_request, user_goal, or agent_initiated.
  --goal <text>          Required for user_goal. The goal the user set.
  --action <name>        One action, such as calendar.read.
  --location <type:id>   One location, such as calendar:primary.
  --actions <list>       Comma-separated actions.
  --locations <list>     Comma-separated locations.
  --budget <n>           max_calls for this license.
  --ttl <seconds>        Lifetime in seconds. Default: 3600.

inspect
  Print the claims and the delegation chain. Checks the issuer signature when the key directory has an issuer key.
  <license>              Positional compact JWS.
  --home <dir>           Key directory. Default: .agent-license

attenuate
  Sign a narrower license for a sub-agent. Scope, budget, and expiry can shrink. They cannot grow, and the mandate type cannot change.
  --home <dir>           Key directory. Default: .agent-license
  --parent <license>     Required. Parent compact JWS.
  --agent <name>         Required. Child agent slug, or a spiffe:// id.
  --actions <list>       Comma-separated actions. Default: the parent's actions.
  --locations <list>     Comma-separated locations. Default: the parent's locations.
  --budget <n>           max_calls. Cannot exceed the parent.
  --ttl <seconds>        Lifetime. Must expire no later than the parent.

check
  Dry-run one call against the Cedar policy. Does not start services and does not append to the log.
  --home <dir>              Key directory. Default: .agent-license
  --license <license>       Required. Compact JWS.
  --action <name>           Required.
  --location <type:id>      Required.
  --why <text>              Why this call is being made. Used when --justification is omitted.
  --justification <jws>     Pre-signed justification. Default: sign one with the agent key.
  --user-request <jws>      Originating user-request JWS. Checked when present.
  --basis <basis>           user_request, user_goal, or agent. Default: the basis the mandate requires.

log verify
  Replay the Merkle decision log and check inclusion and consistency.
  --home <dir>     Key directory. Default: .agent-license. Supplies the log public key, and the local log when --url is omitted.
  --url <url>      Log base URL, for example http://127.0.0.1:43124.

dev
  Start the issuer, checkpoint, Cedar PDP, Merkle log, and demo tool on 127.0.0.1.
  Ports: issuer 43121, checkpoint 43122, pdp 43123, log 43124, upstream 43125.
  Creates the key directory when it is missing. Runs until SIGINT or SIGTERM.
  --home <dir>     Key directory. Default: .agent-license
`;

async function main(): Promise<void> {
  const [command, second] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "keys" && second === "init") return keysInit(process.argv.slice(4));
  if (command === "issue") return issue(process.argv.slice(3));
  if (command === "inspect") return inspect(process.argv.slice(3));
  if (command === "attenuate") return attenuate(process.argv.slice(3));
  if (command === "check") return check(process.argv.slice(3));
  if (command === "log" && second === "verify") return logVerify(process.argv.slice(4));
  if (command === "dev") return dev(process.argv.slice(3));
  throw new LicenseError("malformed", `unknown command ${command}\n\n${HELP}`);
}

function keysInit(args: string[]): void {
  const { values } = parseArgs({ args, options: { home: { type: "string" } } });
  const home = values.home ?? ".agent-license";
  if (existsSync(join(home, "issuer.jwk"))) {
    throw new LicenseError("malformed", `${home} already contains keys`);
  }
  initKeystore(home);
  console.log(`wrote issuer, log, user:alice, planner, and researcher keys to ${home}`);
}

function issue(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      home: { type: "string" },
      user: { type: "string" },
      agent: { type: "string" },
      mandate: { type: "string" },
      goal: { type: "string" },
      action: { type: "string" },
      location: { type: "string" },
      actions: { type: "string" },
      locations: { type: "string" },
      budget: { type: "string" },
      ttl: { type: "string" },
    },
  });
  if (!values.user || !values.agent || !values.mandate) {
    throw new LicenseError("malformed", "issue requires --user, --agent, and --mandate");
  }
  const keys = loadKeystore(values.home ?? ".agent-license");
  const userId = values.user.startsWith("user:") ? values.user : `user:${values.user}`;
  const agent = values.agent.startsWith("spiffe://") ? values.agent : agentSpiffe(values.agent);
  const scope = scopeFrom(values);
  const mandate = mandateFrom(values.mandate, values, scope);
  const now = Math.floor(Date.now() / 1000);
  const ttl = numberOption(values.ttl, 3600, "ttl");
  const request = createUserRequest({
    userId,
    userKey: keys.user(userId),
    agent,
    mandate,
    authorizationDetails: [scope],
    ttlSeconds: ttl,
    now,
  });
  const issued = issueLicense({
    userRequestJws: request,
    issuerKey: keys.issuer,
    userKeys: keys.userPublic(),
    agentKeys: keys.agentPublic(),
    ttlSeconds: ttl,
    now,
  });
  console.error(
    `issued ${issued.claims.jti} mandate=${issued.claims.mandate.type} agent=${issued.claims.agent} exp=${issued.claims.exp}`,
  );
  process.stdout.write(`${issued.license}\n`);
}

function inspect(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { home: { type: "string" } },
  });
  const token = (positionals[0] ?? "").trim();
  if (!token) throw new LicenseError("malformed", "inspect requires a license");
  const home = values.home ?? ".agent-license";
  const keys = existsSync(join(home, "issuer.jwk")) ? loadKeystore(home) : undefined;
  const claims = keys ? verifyLicense(token, publicJwk(keys.issuer)) : unverified(token);
  const detail = claims.authorization_details[0]!;
  console.log(`license  ${claims.jti}`);
  console.log(`subject  ${claims.sub}`);
  console.log(`agent    ${claims.agent}`);
  console.log(`mandate  ${claims.mandate.type}`);
  if (claims.mandate.type === "user_goal") console.log(`goal     ${claims.mandate.goal}`);
  if (claims.mandate.type === "direct_request") {
    console.log(`action   ${claims.mandate.action}`);
    console.log(`location ${claims.mandate.location}`);
  }
  console.log(`txn      ${claims.txn}`);
  console.log(`req_hash ${claims.req_hash}`);
  console.log(`expires  ${new Date(claims.exp * 1000).toISOString()}`);
  console.log(`actions  ${detail.actions.join(", ")}`);
  console.log(`locations ${detail.locations.join(", ")}`);
  console.log(`budget   ${detail.budget ? `max_calls=${detail.budget.max_calls}` : "none"}`);
  if (claims.parent_jti) console.log(`parent   ${claims.parent_jti}`);
  console.log("chain");
  for (const id of delegationChain(claims)) console.log(`  ${id}`);
  console.log(`signature ${keys ? "valid" : "not checked (no --home keystore)"}`);
}

function attenuate(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      home: { type: "string" },
      parent: { type: "string" },
      agent: { type: "string" },
      actions: { type: "string" },
      locations: { type: "string" },
      budget: { type: "string" },
      ttl: { type: "string" },
    },
  });
  if (!values.parent || !values.agent) throw new LicenseError("malformed", "attenuate requires --parent and --agent");
  const keys = loadKeystore(values.home ?? ".agent-license");
  const parent = verifyLicense(values.parent.trim(), publicJwk(keys.issuer));
  const now = Math.floor(Date.now() / 1000);
  const ttl = numberOption(values.ttl, Math.max(1, parent.exp - now - 1), "ttl");
  const exp = now + ttl;
  if (exp > parent.exp) {
    throw new LicenseError("expiry_widen", `ttl reaches ${exp}; parent expires at ${parent.exp}`);
  }
  const inherited = parent.authorization_details[0]!;
  const scope = parseAuthorizationDetail({
    type: "urn:agent-license:tool",
    actions: csv(values.actions).length > 0 ? csv(values.actions) : inherited.actions,
    locations: csv(values.locations).length > 0 ? csv(values.locations) : inherited.locations,
    budget: budgetOf(values.budget) ?? inherited.budget,
  });
  const child = attenuateLicense({
    parentJws: values.parent.trim(),
    issuerKey: keys.issuer,
    issuerPublicKey: publicJwk(keys.issuer),
    agentKeys: keys.agentPublic(),
    childAgent: values.agent.startsWith("spiffe://") ? values.agent : agentSpiffe(values.agent),
    authorizationDetails: [scope],
    exp,
    now,
  });
  console.error(`attenuated ${child.claims.jti} agent=${child.claims.agent} exp=${child.claims.exp}`);
  process.stdout.write(`${child.license}\n`);
}

function check(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      home: { type: "string" },
      license: { type: "string" },
      action: { type: "string" },
      location: { type: "string" },
      why: { type: "string" },
      justification: { type: "string" },
      "user-request": { type: "string" },
      basis: { type: "string" },
    },
  });
  if (!values.license || !values.action || !values.location) {
    throw new LicenseError("malformed", "check requires --license, --action, and --location");
  }
  const keys = loadKeystore(values.home ?? ".agent-license");
  const license = values.license.trim();
  const claims = verifyLicense(license, publicJwk(keys.issuer));
  const basis = (values.basis ?? expectedBasis(claims.mandate.type)) as "user_request" | "user_goal" | "agent";
  const justification =
    values.justification?.trim() ??
    createJustification({
      license: claims,
      agentKey: keys.agent(claims.agent),
      action: values.action,
      location: values.location,
      why: values.why ?? "",
      basis,
      goal: claims.mandate.type === "user_goal" ? claims.mandate.goal : undefined,
    });
  const assessment = assessPresentation({
    licenseJws: license,
    justificationJws: justification,
    userRequestJws: values["user-request"],
    action: values.action,
    location: values.location,
    issuerKey: publicJwk(keys.issuer),
    userKeys: keys.userPublic(),
    agentKeys: keys.agentPublic(),
  });
  const [type, id] = splitLocation(values.location);
  const policy = evaluateAccess({
    subject: { type: "agent", id: assessment.agent || claims.agent, properties: { mandate: claims.mandate.type } },
    action: { name: values.action },
    resource: { type, id },
    context: { ...assessment.flags, mandate: claims.mandate.type },
  });
  const combined = combineDecision(assessment, policy);
  console.log(`decision  ${combined.decision}`);
  console.log(`code      ${combined.code}`);
  console.log(`mandate   ${claims.mandate.type}`);
  console.log(`action    ${values.action}`);
  console.log(`location  ${values.location}`);
  console.log(`policy    ${combined.policy_decision}`);
  console.log(`policies  ${combined.determining_policies.join(", ") || "(none)"}`);
  console.log(`reason    ${combined.reason}`);
}

async function logVerify(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { home: { type: "string" }, url: { type: "string" } },
  });
  const home = values.home ?? ".agent-license";
  const keys = loadKeystore(home);
  if (values.url) {
    const report = await verifyRemoteLog(values.url.replace(/\/$/, ""), publicJwk(keys.log));
    printReport(report);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  const entryPath = join(home, "log", "entries.ndjson");
  const sthPath = join(home, "log", "sths.ndjson");
  const entries = existsSync(entryPath)
    ? readFileSync(entryPath, "utf8").split("\n").filter(Boolean).map((line) => Buffer.from(line, "utf8"))
    : [];
  const sths = existsSync(sthPath) ? readFileSync(sthPath, "utf8").split("\n").filter(Boolean) : [];
  const report = verifyReplayedLog(entries, sths, publicJwk(keys.log));
  printReport(report);
  if (!report.ok) process.exitCode = 1;
}

function printReport(report: { ok: boolean; tree_size: number; root_hash: string; inclusion_checked: number; consistency_checked: number; errors: string[] }): void {
  console.log(`ok                   ${report.ok}`);
  console.log(`tree_size            ${report.tree_size}`);
  console.log(`root_hash            ${report.root_hash}`);
  console.log(`inclusion_checked    ${report.inclusion_checked}`);
  console.log(`consistency_checked  ${report.consistency_checked}`);
  for (const error of report.errors) console.log(`error                ${error}`);
}

async function dev(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { home: { type: "string" } } });
  const home = values.home ?? ".agent-license";
  if (!existsSync(join(home, "issuer.jwk"))) initKeystore(home);
  const log = await startLog({ home, port: 43124 });
  const pdp = await startPdp({ port: 43123 });
  const upstream = await startDemoUpstream({ port: 43125 });
  const issuer = await startIssuer({ home, port: 43121 });
  const checkpoint = await startCheckpoint({
    home,
    port: 43122,
    pdpUrl: pdp.url,
    logUrl: log.url,
    upstreamUrl: upstream.url,
  });
  console.log(`issuer      ${issuer.url}`);
  console.log(`checkpoint  ${checkpoint.url}`);
  console.log(`pdp         ${pdp.url}`);
  console.log(`log         ${log.url}`);
  console.log(`upstream    ${upstream.url}`);
  console.log(`keys        ${home}`);
  const shutdown = async () => {
    await Promise.all([checkpoint.close(), issuer.close(), pdp.close(), log.close(), upstream.close()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await new Promise(() => undefined);
}

function unverified(token: string): ReturnType<typeof verifyLicense> {
  return parseLicenseClaims(decodeJws(token.trim()).payload);
}

function scopeFrom(values: { action?: string; location?: string; actions?: string; locations?: string; budget?: string }): AuthorizationDetail {
  const actions = csv(values.actions);
  const locations = csv(values.locations);
  if (values.action) actions.push(values.action);
  if (values.location) locations.push(values.location);
  return parseAuthorizationDetail({
    type: "urn:agent-license:tool",
    actions,
    locations,
    budget: budgetOf(values.budget),
  });
}

function mandateFrom(
  kind: string,
  values: { goal?: string; action?: string; location?: string },
  scope: AuthorizationDetail,
): Mandate {
  if (kind === "direct_request") {
    return { type: "direct_request", action: values.action ?? scope.actions[0]!, location: values.location ?? scope.locations[0]! };
  }
  if (kind === "user_goal") {
    if (!values.goal) throw new LicenseError("malformed", "user_goal requires --goal");
    return { type: "user_goal", goal: values.goal };
  }
  if (kind === "agent_initiated") return { type: "agent_initiated" };
  throw new LicenseError("malformed", "mandate must be direct_request, user_goal, or agent_initiated");
}

function budgetOf(value: string | undefined): { max_calls: number } | undefined {
  if (value === undefined) return undefined;
  return { max_calls: numberOption(value, 0, "budget") };
}

function numberOption(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new LicenseError("malformed", `${label} must be an integer`);
  return Number(value);
}

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function splitLocation(location: string): [string, string] {
  const index = location.indexOf(":");
  if (index <= 0) throw new LicenseError("malformed", "location must be type:id");
  return [location.slice(0, index), location.slice(index + 1)];
}

main().catch((error: unknown) => {
  if (error instanceof LicenseError) console.error(`${error.code}: ${error.message}`);
  else console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
