# AGENTS.md

How an agent obtains a license and presents it when calling a tool through Agent License.

This repository is a prototype. The issuer, checkpoint, policy decision point, and log in `agentlicense dev` listen on `127.0.0.1` only. Do not point them at a network.

## Obtain a license

An agent does not sign its own license. A user signs a request. A separate issuer signs the license.

From a checkout of this repository, after `pnpm install`:

```sh
pnpm exec agentlicense keys init
pnpm exec agentlicense issue \
  --user alice \
  --agent planner \
  --mandate user_goal \
  --goal "Summarize the primary calendar" \
  --actions calendar.read \
  --locations calendar:primary \
  --budget 10 \
  --ttl 3600 > license.jwt
```

The stdout of `issue` is the compact JWS. Keep it. The private agent key is `.agent-license/agents/planner.jwk`. Do not print that key into a prompt, a log, or a commit.

A sub-agent gets a narrower license with `agentlicense attenuate`. Scope, budget, and expiry can shrink. They cannot grow, and the mandate type cannot change.

Mandates are `direct_request` (one exact action and location), `user_goal` (a goal, calls chosen inside the scope), and `agent_initiated` (read-only ceiling: `clock.read`, `catalog.list`, `memory.read`).

## Present it at a checkpoint

Start the local stack with `pnpm exec agentlicense dev`. The checkpoint is `http://127.0.0.1:43122`.

Every tool call is `POST /v1/invoke` with:

- header `Agent-License`: the license JWS
- header `Agent-Justification`: a new justification signed by the agent key for this action and location
- JSON body: `action`, `resource` with `type` and `id`, optional `input`, optional `user_request`

`licensed(fetch)` from `@agentlicense/sdk` sets those headers. The URL passed to fetch is not contacted. The runnable example is `examples/sdk-quickstart/main.mjs`:

```sh
AGENT_LICENSE_HOME=.agent-license CHECKPOINT=http://127.0.0.1:43122 pnpm --filter @agent-license/sdk-quickstart start
```

An allow is HTTP 200. A deny is HTTP 403. Both are appended to the Merkle log. Check it with:

```sh
pnpm exec agentlicense log verify --url http://127.0.0.1:43124
```

## What is on main, and what is only in pull request #1

On `main`, the delegation chain is the RFC 8693 `act` claim. `agentlicense inspect` prints agent ids. It does not print an English sentence.

Open pull request #1 would add a canonical sentence of the form "I am Researcher (subagent-123), acting on behalf of Planner (planner-1), on behalf of user:alice, requesting documents.search." That behavior is not in this checkout until that pull request merges. Do not pass `--name`, `--instance`, or `--task` to `attenuate` here.

## Discovery files

- `llms.txt` and `llms-full.txt` describe the project for agents that read the site.
- `site/.well-known/agent-license.json` is a proposed descriptor. It is not an IANA registration, and the checkpoint does not fetch it.
- The running policy decision point does serve `GET /.well-known/authzen-configuration`. That route is real.

## Working in this repository

Node.js 22 and pnpm 9. `pnpm install` builds. `pnpm test` runs Vitest. `pnpm render-docs` regenerates `docs/cli.md` from `agentlicense --help` and the pages under `site/docs/`. The CLI help text in `packages/cli/src/main.ts` is the source for the command reference. Package names for a later npm publish are `agentlicense`, `@agentlicense/sdk`, and `@agentlicense/core`.
