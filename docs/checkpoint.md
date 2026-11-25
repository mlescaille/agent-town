---
title: Running a checkpoint
description: Start the local issuer, checkpoint, Cedar PDP, and Merkle log, then verify a decision.
---

# Running a checkpoint

`agentlicense dev` starts five processes on `127.0.0.1`. They share the key directory. This is the prototype's whole deployment: one machine, no public listener.

```sh
pnpm exec agentlicense dev
```

| Port | Process | Role |
| --- | --- | --- |
| 43121 | Issuer | Signs licenses and attenuated licenses |
| 43122 | Checkpoint | Checks the caller, then forwards the tool call |
| 43123 | Cedar PDP | AuthZEN evaluation |
| 43124 | Log | Merkle decisions and proofs |
| 43125 | Demo tool | Upstream the checkpoint calls when the decision is allow |

If `.agent-license/` is missing, `dev` creates it. The process runs until SIGINT or SIGTERM.

Health checks, from another shell:

```sh
curl -s http://127.0.0.1:43121/health
curl -s http://127.0.0.1:43122/health
curl -s http://127.0.0.1:43123/health
curl -s http://127.0.0.1:43123/.well-known/authzen-configuration
curl -s http://127.0.0.1:43124/health
curl -s http://127.0.0.1:43125/health
```

The AuthZEN document on port 43123 is served by the PDP. It points at `/access/v1/evaluation` on that same process.

## Present a license

With `dev` running, the SDK quickstart can use the same keys:

```sh
AGENT_LICENSE_HOME=.agent-license CHECKPOINT=http://127.0.0.1:43122 pnpm --filter @agent-license/sdk-quickstart start
```

The agent posts to `http://127.0.0.1:43122/v1/invoke` with `Agent-License` and `Agent-Justification`. An allow is HTTP 200 and includes the upstream result. A deny is HTTP 403 and still has a `log_index`, because the denial is recorded before the tool is contacted.

Issuer routes, if you sign without the CLI:

| Method and path | Body |
| --- | --- |
| `POST /v1/licenses` | `{ "user_request": "<jws>", "ttl_seconds": 3600 }` |
| `POST /v1/licenses/attenuate` | `{ "parent": "<jws>", "agent": "<spiffe id>", "authorization_details": [], "exp": 1700000000 }` |
| `GET /jwks` | Issuer, user, and agent public keys |

## Verify the log

After at least one invoke:

```sh
pnpm exec agentlicense log verify --url http://127.0.0.1:43124
```

That downloads the entries and signed tree heads, replays them, and checks an inclusion proof and a consistency proof. `ok true` means the replay matched. The log public key comes from `--home` (default `.agent-license`).

`log verify` without `--url` reads `.agent-license/log/entries.ndjson` and `sths.ndjson` instead of the network.

## What this process is not

The checkpoint does not authenticate itself to the policy decision point. Budgets live in the checkpoint process and reset when it exits. A checkpoint cannot re-prove that an ancestor scope was narrowed unless it is shown the parent license. Do not put these ports on a network.
