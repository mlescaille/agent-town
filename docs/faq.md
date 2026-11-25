---
title: FAQ
description: Which agent is calling, how a license differs from a guess, and what this prototype does not do.
---

# FAQ

## Which agent is calling my API?

The one named by the `Agent-License` header, if the checkpoint accepts the signature, the lifetime, the scope, the delegation chain, and the mandate. The license `agent` claim is a SPIFFE-style id. `sub` is the user that agent acts for. A justification signed by that agent's key says why this call is the one being made. The checkpoint is outside the agent, so the agent does not grade its own homework.

## Is this authentication or authorization?

Both, in a small way. The signatures are how the checkpoint authenticates the issuer and the agent. The mandate, the scope, and the Cedar policy are the authorization decision. A valid signature with the wrong action is still a deny.

## What is an on-behalf-of chain?

The license `act` claim, from RFC 8693. Each nested actor delegated to the next. The outermost actor is the agent making the call. On current `main`, `inspect` prints those ids. The English sentence ("I am Researcher, acting on behalf of Planner, on behalf of user:alice") is only in open [pull request #1](https://github.com/mlescaille/agent-town/pull/1).

## Can an agent widen its license?

No. Attenuation can drop actions, drop locations, lower `max_calls`, and shorten `exp`. It cannot add authority, and it cannot change `direct_request`, `user_goal`, or `agent_initiated` into a different mandate.

## Does this speak MCP?

Not yet. The checkpoint is an HTTP proxy in front of one demo tool. [ROADMAP.md](https://github.com/mlescaille/agent-town/blob/main/ROADMAP.md) describes a later gateway where `tools/call` would require a license and `tools/list` would be filtered to the license scope. Nothing in this repository speaks the Model Context Protocol today.

## Is the npm package installable?

The names `agentlicense`, `@agentlicense/sdk`, and `@agentlicense/core` are the publish names. They are not on the registry until someone pushes a `v*` tag and the publish workflow runs with an `NPM_TOKEN` secret. Until then, clone the repository and use pnpm. `npm install github:mlescaille/agent-town` is the git install, and it needs the repository to be readable by npm.

## Why does `agentlicense dev` bind to localhost?

The issuer, the policy decision point, and the log share a key directory and trust each other without authentication. That is acceptable for a prototype on `127.0.0.1` and unsafe anywhere else.

## What does the website's well-known file mean?

`/.well-known/agent-license.json` describes this project for agents that fetch the site. It is proposed, not an IANA registration, and the services do not fetch it. The PDP's `/.well-known/authzen-configuration` is different: that route exists in the running process and follows OpenID AuthZEN.

## What is deliberately unfinished?

Revocation before `exp`, budgets that survive a restart, a mandatory user-request presentation, ancestor scopes embedded so a checkpoint can re-check attenuation, and a second log so a replaced log key is visible to someone who kept an older tree head. Those are listed in the roadmap. This repository is not a production trust service.
