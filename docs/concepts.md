---
title: Concepts
description: Agent identity, the three mandates, delegation, checkpoints, Cedar policy, and the Merkle decision log.
---

# Concepts

An agent does not mint its own authority. A separate issuer signs a license. The agent presents that license, plus a signed reason for this call, to a checkpoint that is not the agent process. The checkpoint decides, records the decision, and only then forwards the call.

That is the answer to "which agent is calling my API": the caller presents an agent credential, the credential names a user it acts for, and a component outside the agent checks both.

## License

A license is a compact JWS (`typ` `agent-license+jwt`) signed by the issuer with Ed25519. It names:

- `sub`, the user, such as `user:alice`
- `agent`, a SPIFFE-style id such as `spiffe://agent-license.example/agent/planner`
- one mandate
- one `authorization_details` entry (`urn:agent-license:tool`) with actions, locations, and an optional call budget
- `txn` and `req_hash`, binding the license to the user-signed request
- `act`, the delegation chain

The issuer id and the checkpoint audience in this prototype are logical names, not hosts you can dial: `https://issuer.agent-license.example` and `https://checkpoint.agent-license.example`.

Agents never sign licenses. They sign a short-lived justification (`agent-justification+jwt`) for one action and one location.

## Mandates

A license carries exactly one mandate.

| Mandate | Meaning |
| --- | --- |
| `direct_request` | The user asked for this exact action and location. The scope is that one pair. |
| `user_goal` | The user set a goal. The agent chooses calls inside the granted scope. The justification restates that goal. |
| `agent_initiated` | The agent acts on its own, inside a fixed ceiling: `clock.read`, `catalog.list`, and `memory.read` on `clock:local`, `catalog:public`, and `memory:self`, with at most 5 calls. |

The justification basis has to match the mandate: `user_request`, `user_goal`, or `agent`. A read verb is `read`, `list`, or `get`. Every other verb is a write. `agent_initiated` cannot write.

## Delegation chain

`act` is the actor claim from RFC 8693. The outermost actor is the agent presenting the license. A nested `act` is the previous agent. The chain is at most eight agents, and no agent id repeats.

On current `main`, `agentlicense inspect` prints that chain as identifiers. A root license is the user, then the agent:

```text
chain
  user:alice
  spiffe://agent-license.example/agent/planner
```

An attenuated license adds the child at the end and sets `parent_jti`. Attenuation can narrow actions, locations, budget, and expiry. It cannot widen them, and it cannot change the mandate type.

### Canonical sentence

A single English sentence for the chain is not on `main`. It is only in open [pull request #1](https://github.com/mlescaille/agent-town/pull/1). That pull request would have `inspect` print a sentence of this shape:

> I am Researcher (subagent-123), acting on behalf of Planner (planner-1), on behalf of user:alice, requesting documents.search.

Until that pull request merges, the checkpoint does not require the sentence, and `attenuate` does not take `--name`, `--instance`, or `--task`. The on-behalf-of relationship that exists today is the nested `act` claim.

## Checkpoint

The checkpoint is a policy enforcement point outside the agent. `licensed(fetch)` posts the tool call to the checkpoint and sets two headers:

| Header | Value |
| --- | --- |
| `Agent-License` | The issuer-signed license |
| `Agent-Justification` | A new agent-signed justification for this call |

The JSON body carries `action`, `resource` (`type` and `id`), optional `input`, and an optional `user_request` JWS. The URL the agent passed to `fetch` is not contacted. The checkpoint owns the upstream.

`agentlicense dev` binds the checkpoint to `127.0.0.1:43122`. `POST /v1/invoke` is the only call path. `GET /health` reports that the process is up.

## Policy

The checkpoint sends an [OpenID AuthZEN 1.0](https://openid.net/specs/authorization-api-1_0.html) evaluation to a Cedar policy decision point. The policies in `policies/mandates.cedar` are:

- `permit-bound-call`, when the justification, scope, request binding, budget, chain, mandate, and basis all check out
- `forbid-agent-initiated-writes`
- `forbid-direct-request-inexact`, when a direct request is not exactly the named action and location

The decision point in this prototype trusts the booleans the checkpoint computed (`in_scope`, `basis_ok`, and the rest) and is meant to stay on localhost. Its discovery document is real: `GET /.well-known/authzen-configuration` on the PDP process.

## Log

Allowed and denied calls are appended to a Merkle log. The log signs each tree head (`agent-log-sth+jwt`). `agentlicense log verify` replays the entries and checks inclusion and consistency. A flipped leaf fails verification.

The log key can rewrite history if an observer did not keep an older signed tree head. [ROADMAP.md](https://github.com/mlescaille/agent-town/blob/main/ROADMAP.md) records that limit.

## What is not a registered discovery document

`GET /.well-known/authzen-configuration` on the running PDP is the AuthZEN discovery document this code serves.

`/.well-known/agent-license.json` on this website is a proposed descriptor for people and agents. It is not registered with IANA. The checkpoint does not fetch it. The fields in it match this prototype: header names, token `typ` values, mandate names, and `POST /v1/invoke`. Treat the file as documentation in JSON, not as a protocol the services implement.
