import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  agentSpiffe,
  createUserRequest,
  initKeystore,
  issueLicense,
  loadKeystore,
  userIdOf,
} from "@agentlicense/core";
import { licensed } from "@agentlicense/sdk";

const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const home = process.env.AGENT_LICENSE_HOME
  ? resolve(invokedFrom, process.env.AGENT_LICENSE_HOME)
  : mkdtempSync(join(tmpdir(), "agent-license-"));
const keys = existsSync(join(home, "issuer.jwk")) ? loadKeystore(home) : initKeystore(home);
const userId = userIdOf("alice");
const agent = agentSpiffe("planner");
const now = Math.floor(Date.now() / 1000);

const userRequest = createUserRequest({
  userId,
  userKey: keys.user(userId),
  agent,
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

const { license } = issueLicense({
  userRequestJws: userRequest,
  issuerKey: keys.issuer,
  userKeys: keys.userPublic(),
  agentKeys: keys.agentPublic(),
  ttlSeconds: 600,
  now,
});

const checkpoint = process.env.CHECKPOINT ?? "http://127.0.0.1:43122";
const baseFetch = process.env.CHECKPOINT
  ? globalThis.fetch
  : async (input, init) => {
      const headers = new Headers(init?.headers);
      const presented = headers.get("agent-license") ?? "";
      const justification = headers.get("agent-justification") ?? "";
      console.log(`POST ${input}`);
      console.log(`agent-license ${presented.slice(0, 32)}…`);
      console.log(`agent-justification ${justification ? "present" : "missing"}`);
      return new Response(JSON.stringify({ decision: "allow", offline: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

const call = licensed(baseFetch, {
  license,
  agentPrivateKey: keys.agent(agent),
  checkpoint,
  why: "Reading the calendar is how the summary is produced.",
  userRequest,
});

const response = await call("http://tool.invalid/ignored", {
  method: "POST",
  body: JSON.stringify({
    action: "calendar.read",
    resource: { type: "calendar", id: "primary" },
  }),
});

console.log(`status ${response.status}`);
console.log(await response.text());
