---
title: SDK reference
description: Call a checkpoint with licensed(fetch), and use the core API to issue, verify, attenuate, and explain an agent credential.
---

# SDK reference

`@agentlicense/sdk` exports one function, `licensed(fetch)`. `@agentlicense/core` is the library that issues and checks licenses. Both are ESM, for Node.js 22 or newer.

They are not on the npm registry yet. From a clone, `pnpm install` links them. After publish:

```text
npm install @agentlicense/sdk
```

That installs `@agentlicense/core` as well.

## licensed(fetch)

`licensed(baseFetch, options)` returns a function with the fetch signature. Each call posts JSON to `{checkpoint}/v1/invoke` and sets `Agent-License` and `Agent-Justification`. The request URL is ignored. The JSON body must include `action` and `resource` with `type` and `id`.

| Option | Required | Role |
| --- | --- | --- |
| `license` | yes | Compact issuer-signed license |
| `agentPrivateKey` | yes | Private key of the agent named by the license |
| `checkpoint` | yes | Origin of the checkpoint, such as `http://127.0.0.1:43122` |
| `why` | yes | A string, or a function of `{ action, location }` |
| `userRequest` | no | User-request JWS. The checkpoint checks its hash when present |

The justification basis is chosen from the mandate. For `user_goal` the goal is copied from the license. The justification lives at most 300 seconds; the helper uses 60.

## Runnable example

`examples/sdk-quickstart/main.mjs` issues a `user_goal` license and presents it. Without `CHECKPOINT`, it uses a stand-in fetch and prints the headers. With `CHECKPOINT` set to a running `agentlicense dev`, it calls that checkpoint. Set `AGENT_LICENSE_HOME` to the same key directory `dev` is using, or the issuer signature will not match.

<!-- include:examples/sdk-quickstart/main.mjs -->

From the repository root, after `pnpm install`:

```sh
pnpm --filter @agent-license/sdk-quickstart start
```

Against a local checkpoint that was started with the default key directory:

```sh
AGENT_LICENSE_HOME=.agent-license \
  CHECKPOINT=http://127.0.0.1:43122 \
  pnpm --filter @agent-license/sdk-quickstart start
```

## Core API

Import from `@agentlicense/core`. The calls below are the ones the CLI and the checkpoint use.

| Function | What it does |
| --- | --- |
| `initKeystore(home)` | Writes issuer, log, `user:alice`, `planner`, and `researcher` keys |
| `loadKeystore(home)` | Reads that directory |
| `generateEd25519Keypair()` | One Ed25519 key, `kid` set to the RFC 7638 thumbprint |
| `publicJwk(key)` | Public OKP JWK |
| `userIdOf(name)` / `agentSpiffe(name)` | `user:alice` and `spiffe://agent-license.example/agent/planner` |
| `createUserRequest(input)` | User-signed `agent-request+jwt` |
| `issueLicense(input)` | Issuer-signed license bound to that request |
| `verifyLicense(jws, issuerPublic)` | Signature, time window, and claim shape |
| `attenuateLicense(input)` | Narrower child license |
| `createJustification(input)` | Agent-signed justification |
| `verifyJustification(jws, agentPublic)` | Checks that justification |
| `assessPresentation(input)` | License, justification, scope, budget, chain, and basis |
| `delegationChain(claims)` | User, then agents from the original to the current |
| `expectedBasis(mandateType)` | `user_request`, `user_goal`, or `agent` |
| `parseLicenseClaims` / `decodeJws` | Parse without trusting a signature |
| `MerkleLog` | Append-only tree of decision records |
| `verifyReplayedLog(entries, sths, logPublic)` | Inclusion and consistency over a saved log |
| `LicenseError` | `error.code` is a stable string such as `malformed` or `expired` |

`issueLicense` returns `{ license, claims }`. `authorization_details` has exactly one element. Unknown claim names are rejected.

Constants worth knowing: `LICENSE_TYP`, `REQUEST_TYP`, `JUSTIFICATION_TYP`, `STH_TYP`, `AGENT_INITIATED_CEILING`, `MAX_CHAIN_DEPTH` (8), and `MAX_JUSTIFICATION_TTL_SECONDS` (300).

The demo at `examples/demo` runs the same API against the services: three mandates, an over-scope denial, attenuation, and a log replay. `pnpm demo` prints `demo: ok` when that walkthrough passes.
