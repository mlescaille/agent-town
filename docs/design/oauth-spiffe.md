# OAuth and SPIFFE for Agent License

Status: design only. Nothing in this file is implemented. It describes how to rebase the 0.1.0 profile ([spec/LICENSE-FORMAT.md](../../spec/LICENSE-FORMAT.md)) onto OAuth and SPIFFE. The running code stays as it is until a later change.

The prototype's issuer, checkpoint, policy decision point, and log still bind to `127.0.0.1` only. Logical names such as `https://issuer.agent-license.example` are identifiers, not hosts to dial.

## Diff

| 0.1.0 | Target |
| --- | --- |
| Issuer-signed JWS, `typ` `agent-license+jwt` | JWT access token, `typ` `at+jwt` ([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.1) |
| `POST /v1/licenses/attenuate` | Down-scoped [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) token exchange |
| Per-call justification JWS, 300 seconds | [DPoP](https://www.rfc-editor.org/rfc/rfc9449) proof, same 300-second window, plus the `why` text in the body |
| Agent keys in `.agent-license/agents/` | SPIRE SVIDs |
| No revocation | [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662) introspection, tokens capped at 900 seconds |
| Checkpoint `POST /v1/invoke` only | Same checks, plus an MCP resource server ([MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)) |

Kept: the mandate object, `policies/mandates.cedar`, the AuthZEN PDP, and the Merkle log. There is no dashboard in this repository; `site/` is the documentation site.

## What 0.1.0 does

Verified against this checkout (package version `0.1.0`).

| Behavior | Where |
| --- | --- |
| Compact JWS ([RFC 7515](https://www.rfc-editor.org/rfc/rfc7515)), `alg` `EdDSA`, Ed25519 ([RFC 8032](https://www.rfc-editor.org/rfc/rfc8032), JOSE binding [RFC 8037](https://www.rfc-editor.org/rfc/rfc8037)). `kid` is the [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638) §3 thumbprint of `{crv, kty, x}`. A `crit` header is rejected. | `packages/core/src/jws.ts`, `packages/core/src/keys.ts` (`jwkThumbprint`) |
| One Rich Authorization Requests detail, `type` `urn:agent-license:tool` ([RFC 9396](https://www.rfc-editor.org/rfc/rfc9396)). | `packages/core/src/types.ts`, `packages/core/src/constants.ts` (`AUTH_DETAIL_TYPE`) |
| Delegation is the [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) §4.1 `act` claim only. Outermost `act.sub` is the current agent. Nested `act` is the prior agent. Depth at most 8. No repeated id. | `packages/core/src/validate.ts` (`parseAct`, `MAX_CHAIN_DEPTH`) |
| Mandate is `direct_request`, `user_goal`, or `agent_initiated`. `agent_initiated` allows only `catalog.list`, `clock.read`, and `memory.read` on `catalog:public`, `clock:local`, and `memory:self`, and `budget.max_calls` must be present and at most 5. | `packages/core/src/constants.ts` (`AGENT_INITIATED_CEILING`), `packages/core/src/validate.ts` (`assertMandateMatchesScope`) |
| The checkpoint assesses the call, `POST`s an AuthZEN 1.0 evaluation to `{pdp}/access/v1/evaluation`, and appends the decision. Cedar is `policies/mandates.cedar`. | `services/checkpoint/src/server.ts`, `services/checkpoint/src/decide.ts`, `services/pdp/src/server.ts` |
| The log is a Merkle tree as in [RFC 9162](https://www.rfc-editor.org/rfc/rfc9162) §2.1: empty root is SHA-256 of the empty string, leaf is SHA-256(`0x00` \|\| entry), internal node is SHA-256(`0x01` \|\| left \|\| right). Inclusion §2.1.3, consistency §2.1.4. Wire hashes are unpadded base64url. | `packages/core/src/merkle.ts` |
| A SPIFFE id is the string `spiffe://agent-license.example/agent/<name>`. Keys are Ed25519 JWKs read from a directory. No SPIRE server. | `packages/core/src/keys.ts` (`agentSpiffe`, `loadKeystore`) |
| Narrowing is `POST /v1/licenses/attenuate`, implemented by `attenuateLicense`. Scope, budget, and `exp` can shrink. The mandate is copied. | `packages/core/src/attenuate.ts`, `services/issuer/src/server.ts` |
| Each call carries an agent-signed justification. `exp - iat` is at most 300 seconds. A repeated `jti` is `justification_replay`. | `packages/core/src/justify.ts`, `packages/core/src/constants.ts` (`MAX_JUSTIFICATION_TTL_SECONDS`), `packages/core/src/assess.ts`, spec §8 |
| No MCP method is implemented. `POST /v1/invoke` is the only call path. No revoke route exists. | `services/checkpoint/src/server.ts`, [ROADMAP.md](../../ROADMAP.md), [docs/faq.md](../faq.md) |

`agent_initiated` writes are forbidden by Cedar from the action verb (`read`, `list`, `get` are reads; every other verb is a write). `effectOf` in `packages/core/src/validate.ts` derives that. The caller does not supply it.

## 1. Agent identity

SPIRE issues the SVID. The authorization server and the checkpoint consume it. An agent does not sign its own identity document.

Trust domain: `agent-license.example`, the value of `TRUST_DOMAIN` today. One trust domain. No federation in this design.

| SPIFFE ID | Workload |
| --- | --- |
| `spiffe://agent-license.example/agent/<name>` | Agent or sub-agent. `<name>` matches `^[a-z][a-z0-9-]{0,62}$`, the rule in `agentSpiffe`. |
| `spiffe://agent-license.example/issuer` | Authorization server process |
| `spiffe://agent-license.example/checkpoint` | Resource server process |

The OAuth issuer identifier stays `https://issuer.agent-license.example` ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)). That `iss` value is not a SPIFFE ID.

The path stays flat. Planner and researcher are peers, as they are today (`spiffe://agent-license.example/agent/planner`, `.../researcher`). The parent/child relationship is the `act` chain, not a longer path. A sub-agent is a separate SPIRE registration with its own SVID. The parent does not mint it. SPIRE server does.

Each workload gets both forms:

- X.509-SVID. Exactly one URI SAN ([X.509-SVID §2](https://spiffe.io/docs/latest/spiffe-specs/x509-svid/), [RFC 5280](https://www.rfc-editor.org/rfc/rfc5280) §4.2.1.6). Leaf only: `cA` is false, and `keyCertSign` is unset.
- JWT-SVID. `sub` is the SPIFFE ID ([JWT-SVID §3.1](https://spiffe.io/docs/latest/spiffe-specs/jwt-svid/)). `aud` is present and is only the authorization server's token audience (§3.2, §7.2). `exp` is set (§3.3). A JWT-SVID is a bearer until it is exchanged (§7.1); the audience pin is what keeps a token stolen from one service from being replayed at another.

The workload fetches both from the [Workload API](https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/): `FetchX509SVID` and `FetchJWTSVID`. The authorization server validates a JWT-SVID with the trust bundle for `agent-license.example` (`FetchJWTBundles`). It rejects any other trust domain.

Configure the trust domain so the X.509-SVID key can sign a DPoP proof with `ES256`. The same key is the DPoP key. `cnf.jkt` is the [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638) thumbprint of that public key.

Local dev, still on `127.0.0.1`:

1. Run a SPIRE server and a SPIRE agent for trust domain `agent-license.example`. The Workload API is the agent's default Unix socket.
2. Register each workload with a distinct Unix selector. Example shape, not a committed config: `spire-server entry create` with `-spiffeID spiffe://agent-license.example/agent/planner` and a `unix:uid` selector, and a second entry for `researcher`.
3. `agentlicense dev` keeps binding the authorization server, checkpoint, PDP, and log to `127.0.0.1`. Directory files under `.agent-license/agents/*.jwk` are no longer the agent trust root.

## 2. The license is an access token

An agent access token is issued by token exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) §2.1).

| Request parameter | Value |
| --- | --- |
| `grant_type` | `urn:ietf:params:oauth:grant-type:token-exchange` |
| `subject_token` | The user's access token on the first hop. The parent agent access token when narrowing a sub-agent. |
| `subject_token_type` | `urn:ietf:params:oauth:token-type:access_token` ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) §3) |
| `actor_token` | The caller's JWT-SVID |
| `actor_token_type` | `urn:ietf:params:oauth:token-type:jwt` |
| `requested_token_type` | `urn:ietf:params:oauth:token-type:access_token` |
| `resource` | The checkpoint's MCP resource URI ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) §2). One value. |
| `authorization_details` | A one-element JSON array ([RFC 9396](https://www.rfc-editor.org/rfc/rfc9396) §6) |

The token request also carries a DPoP proof ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §5). The response uses `token_type` `DPoP` (§7.1) and returns the granted `authorization_details` ([RFC 9396](https://www.rfc-editor.org/rfc/rfc9396) §7).

The user's access token is the output of an authorization-code grant with PKCE. That grant is what [MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) requires of an authorization server: OAuth 2.1 as `draft-ietf-oauth-v2-1-13` (still a draft; not an RFC), PKCE, the [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) `resource` parameter, and [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207) issuer check on the authorization response. The authorization request carries `authorization_details` and the `mandate` object. The issued user token contains both. Its `sub` is `user:<name>`. Its audience is the authorization server, for exchange, not the checkpoint. The first exchange copies `sub` and `mandate` and sets `act` to `{ "sub": "<jwt-svid sub>" }`. The actor's SPIFFE ID must be the agent the user grant names.

### Access-token claims

Header: `typ` `at+jwt`, `alg` `RS256`. [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.1 requires conforming authorization servers and resource servers to support RS256, and forbids `none`. The Ed25519 issuer key in `.agent-license/issuer.jwk` signs 0.1.0 licenses. It does not sign these access tokens. The log key stays Ed25519; a signed tree head is not an access token.

Clock skew stays 5 seconds (`SKEW_SECONDS`).

| Claim | Rule | Authority |
| --- | --- | --- |
| `iss` | `https://issuer.agent-license.example` | [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.1.1, [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.2 |
| `sub` | `user:<name>`, the resource owner. Copied from the user grant. | [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.1.2 |
| `aud` | The `resource` URI of the checkpoint. An array of one string. | [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.1.3, [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §3 |
| `exp` | Seconds since the epoch. `exp <=` the subject token's `exp`, and `exp <= iat + 900`. | [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.1.4 |
| `iat` | Issued-at, seconds. | [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.1.6, [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.2 |
| `nbf` | Equal to `iat`. | [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.1.5 |
| `jti` | New id for this token. | [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.1.7, [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.2 |
| `client_id` | SPIFFE ID of the current actor. Equals outermost `act.sub`. | [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) §4.3, [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.2 |
| `act` | Nested actor chain. See below. | [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) §4.1 |
| `authorization_details` | One object, filtered to this `aud`. | [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396) §9.1 |
| `mandate` | The object in the schema below. Copied from the subject token. | This profile. [RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.2–§4.3 |
| `cnf` | `{ "jkt": "<base64url SHA-256 JWK thumbprint>" }` of the DPoP key. | `cnf` is [RFC 7800](https://www.rfc-editor.org/rfc/rfc7800) §3.1. `jkt` is [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §6.1, thumbprint [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638) |
| `txn` | `jti` of the original user grant. Copied unchanged. | This profile. Not a registered claim. |
| `parent_jti` | Present only on a down-scoped token. The parent access token's `jti`. | This profile. |

`iat` and `client_id` are required by [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.2, so they sit in the table beside the claims this profile adds. Unknown claim names are rejected, as `parseLicenseClaims` rejects them today.

`act` members are only `sub` and a nested `act`, the same closure as `parseAct`. The outermost `act.sub` is the current actor. The deepest `act` is the original agent. At most 8 actors (`MAX_CHAIN_DEPTH`). No id repeats. A root token has one `act` and no `parent_jti`. A down-scoped token has `parent_jti` and at least two actors.

[RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) §4.1 says the resource server, when applying access-control policy, considers the token's top-level claims and the current actor only. Nested `act` values are history. The checkpoint still rejects a chain that breaks the rules above, because those rules are how this authorization server builds the claim. Cedar does not treat an ancestor id as a grant. The granted actions are `authorization_details` on this token.

The single detail keeps today's shape. [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396) §2.2 defines `actions` and `locations` as common fields; the type defines what else is legal. There is no IANA registry of `type` values in RFC 9396. This profile's type is `urn:agent-license:tool`, advertised in `authorization_details_types_supported` (RFC 9396 §10).

| Field | Rule |
| --- | --- |
| `type` | `urn:agent-license:tool` |
| `actions` | Non-empty set, stored sorted. Each value matches `^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$`. |
| `locations` | Non-empty set, stored sorted. Each value matches `^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+` (`resourceType:resourceId`). These are not RFC 8707 resource URIs. |
| `budget.max_calls` | Optional integer from 1 to 1,000,000. Absent means no cap. |

`locations` here are tool locations (`calendar:primary`). The OAuth `resource` / `aud` is the checkpoint.

### `mandate` schema

Exactly one of these objects. No extra keys. `user_goal.goal` is 1 to 300 characters.

| `type` | Fields |
| --- | --- |
| `direct_request` | `action`, `location`. The detail has that one action and that one location. |
| `user_goal` | `goal`. Any call inside the detail is eligible. The body restates `goal`. |
| `agent_initiated` | None. Every action and location is inside `AGENT_INITIATED_CEILING`, and `budget.max_calls` is present and at most 5. |

Registration. `mandate` is a private claim ([RFC 7519](https://www.rfc-editor.org/rfc/rfc7519) §4.3) while only this authorization server and this checkpoint rely on it. [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2.2.2 allows that inside one deployment, and points at RFC 7519 §4.2 for anything that leaves it: a public claim is registered in the IANA "JSON Web Token Claims" registry (RFC 7519 §10.1) or is a collision-resistant URI. Before a second issuer is expected to accept the claim, register the short name `mandate` in that registry, with this profile as the specification. Do not emit both `mandate` and a URI alias.

The same three strings are the legal values of the body's `basis`: `user_request`, `user_goal`, and `agent`. `expectedBasis` in `packages/core/src/validate.ts` is the match.

### Never-widen

[RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) does not itself require the issued scope to be a subset. [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396) §6.1 leaves the comparison to the type. For `urn:agent-license:tool` the authorization server applies the rules in `assertNarrowed` (`packages/core/src/attenuate.ts`) on every exchange, including the first hop against the user grant:

- Every requested action is in the subject token's action set, and every requested location is in its location set. Otherwise `scope_widen`.
- If the subject token sets `max_calls`, the new token sets `max_calls` less than or equal to it. Dropping or raising the cap is `budget_widen`. Adding a cap the subject token did not have is allowed.
- `exp` is less than or equal to the subject token's `exp`. A later expiry is `expiry_widen`.
- At least one reduction is strict: fewer actions, fewer locations, a lower cap, or an earlier `exp`. An equal copy is `not_narrowed`. The first hop is the exception: the agent token may equal the user grant, because that hop introduces the actor rather than a further delegate.
- `mandate`, `sub`, and `txn` are copied. A different mandate is `invalid_request`. A `direct_request` child keeps the one action and narrows by budget or expiry.
- The actor SPIFFE ID is not already in the chain (`chain_cycle`). Depth stays at most 8.
- `agent_initiated` is re-checked against the ceiling.

The OAuth error for a bad detail is `invalid_authorization_details` ([RFC 9396](https://www.rfc-editor.org/rfc/rfc9396) §6). `error_description` carries the stable code (`scope_widen`, `budget_widen`, `expiry_widen`, `not_narrowed`, `chain_cycle`).

Narrowing a sub-agent is another exchange. `subject_token` is the parent access token. `actor_token` is the child JWT-SVID. The new `act` is `{ "sub": "<child>", "act": <parent.act> }`. `parent_jti` is the parent's `jti`. The child proves possession of its own key. The parent's DPoP key signs the parent's requests, and the child signs its own.

## 3. Proof of possession

Recommendation: **DPoP ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)), bound by `cnf.jkt` ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §6.1 under the [RFC 7800](https://www.rfc-editor.org/rfc/rfc7800) §3.1 `cnf` claim).**

The DPoP key is the X.509-SVID private key. At the token endpoint the agent presents that certificate (mutual TLS) and a DPoP proof signed by the same key. The authorization server checks three equalities: the certificate's URI SAN equals the JWT-SVID `sub`, the [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638) thumbprint of the DPoP `jwk` equals the thumbprint of the certificate's public key exported as a JWK, and `cnf.jkt` is that thumbprint. That comparison is a key thumbprint, not `x5t#S256`, which hashes the whole certificate ([RFC 8705](https://www.rfc-editor.org/rfc/rfc8705) §3.1). The checkpoint does not terminate the client certificate. It checks the proof.

| | DPoP, RFC 9449 | Mutual TLS, RFC 8705 |
| --- | --- | --- |
| Possession | JWS over the proof, asymmetric `alg`, not `none` (§4.2, §4.3) | TLS handshake with the client certificate (§3) |
| Token binding | `cnf.jkt`, the JWK thumbprint (§6.1) | `cnf."x5t#S256"`, SHA-256 of the DER certificate (§3.1) |
| Request binding | `htm` and `htu` (§4.2). Query and fragment are not part of `htu`. | The TLS connection. The HTTP request is application data after the handshake. |
| Token hash | `ath` = base64url(SHA-256(ASCII access token)) when the proof is presented to a resource server (§4.2) | None |
| Replay id | `jti`, remembered for the acceptance window (§11.1) | None at the application layer |
| Freshness | `iat` inside a window the server chooses (§4.3 item 11, §11.1) | The connection |
| `why`, action, body | Not covered. §4.2 signs the method and URI, not the body. | Not covered |
| MCP HTTP clients | [MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), "Access Token Usage", says the client MUST send `Authorization: Bearer`. [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §7.1 says a DPoP-bound token uses scheme `DPoP` plus a `DPoP` header. Those two requirements disagree. | A client certificate on the connection to the gateway. The MCP profile is HTTP authorization, not client-certificate TLS. |
| SPIRE | The workload already holds the key. | The workload already holds the certificate. A new certificate changes `x5t#S256` even when the key is unchanged. |

Mutual TLS at the token endpoint is how the authorization server ties the JWT-SVID to a key. The checkpoint does not ask for that certificate. A TLS-terminating proxy would strip it before the process that runs Cedar, and the MCP profile's resource request is an HTTP `Authorization` header.

The gateway sets `dpop_bound_access_tokens_required` to true and lists `ES256` in `dpop_signing_alg_values_supported` ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) §2). Those parameters are the RFC 9449 ones RFC 9728 registers. A request that presents the access token as a bearer token gets 401 with `WWW-Authenticate: DPoP` ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §7.1). A proof that fails §4.3 uses `error="invalid_dpop_proof"`.

This diverges from the MCP 2026-07-28 requirement that clients send `Authorization: Bearer`. Metadata, discovery, `resource`, and audience checks still follow that specification. The scheme does not. Clients this repository ships send DPoP. A client that only implements the Bearer scheme cannot call this gateway. Giving that client a bearer token would drop the key check the justification provides today. Question 15 records that choice.

### What the justification becomes

The 0.1.0 justification (`packages/core/src/justify.ts`, spec §8) is one JWS with a 300-second cap, a `jti` replay cache, and a binding to the license, the action, the location, the mandate, and a `why` string of 12 to 500 characters. DPoP replaces the signature and the replay cache. It does not replace `why`.

| 0.1.0 guarantee | Target |
| --- | --- |
| Signed by the licensed agent's key | DPoP signature verifies under the `jwk` in the proof header, and that key's thumbprint equals `cnf.jkt` ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §4.3, §6, §7). |
| Bound to this license (`license_jti`) | `ath` over this access token (§4.2). |
| Lifetime at most 300 seconds | The checkpoint accepts `iat` only when `now - 300 <= iat <= now + 5`, the old cap (`MAX_JUSTIFICATION_TTL_SECONDS`) and the old skew. DPoP has no `exp`; the window is the server's. |
| `jti` replay rejected | [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §11.1. The checkpoint stores proof `jti` values for the window, as `seenJustifications` does in `packages/core/src/assess.ts`. |
| `action` and `location` are this call | The checkpoint compares the MCP tool call with `authorization_details`. The proof does not name them. |
| `why`, `basis`, `goal` | They stay in the JSON body. `why` is still 12 to 500 characters and is still the Merkle leaf's `why`. `basis` must equal `expectedBasis(mandate.type)`. `goal` is present only for `user_goal` and must equal `mandate.goal`. |
| Body swap under a captured proof | A profile claim on the DPoP payload, `req`, is unpadded base64url(SHA-256(raw request body)). [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §4.2 allows additional claims. `req` is not `ath`. The checkpoint recomputes it. A proof without `req` is rejected. |
| `txn`, `req_hash`, `mandate_type` echoed in the justification | Not echoed. The access token already carries `txn` and `mandate`. The authorization server checked the user grant at exchange time. |
| Optional user-request JWS at the checkpoint | Not presented on the call. The user grant was the `subject_token`. |

`req` is a private profile claim. It is the piece that keeps "this call, for this reason" attached to the proof after the justification JWS is gone.

## 4. Checkpoint

The checkpoint is an OAuth resource server and an MCP gateway. Protected resource metadata ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) §2–§3) is served at `/.well-known/oauth-protected-resource` and, when the MCP path is not `/`, at `/.well-known/oauth-protected-resource/<path>` as well. A 401 carries `resource_metadata` ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) §5.1). The document includes `authorization_servers` with one issuer ([MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization); the client chooses among them per RFC 9728 §7.6). It also includes `authorization_details_types_supported` with `urn:agent-license:tool`.

The authorization server publishes [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414) metadata: the token endpoint, the introspection endpoint, `code_challenge_methods_supported` including `S256`, and `dpop_signing_alg_values_supported`. The 2026-07-28 MCP flow sends `code_challenge` on the authorization request and `code_verifier` on the token request.

On `tools/call` the checkpoint does this, in order, and appends a Merkle record either way. It does not call the tool after a deny. A failed token or proof is HTTP 401. An in-scope failure (mandate, budget, Cedar) is HTTP 403, which matches the MCP error table. 0.1.0 returns 403 for both (`services/checkpoint/src/server.ts`). The stable `code` values from spec §9 stay (`bad_signature`, `expired`, `act_chain`, `justification_replay`, `justification_mismatch`, `over_scope`, `budget_exceeded`, `policy_deny`, `pdp_unreachable`), plus `introspection_unreachable`.

1. JWT access token: `typ` `at+jwt`, signature under the authorization server's published key, `iss`, `aud` equal to this resource, `exp` / `nbf` with 5 seconds of skew ([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) §2).
2. Introspection ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662) §2). `active` must be true. An unreachable authorization server is a deny, code `introspection_unreachable`.
3. DPoP proof per [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §4.3, including `ath`, `cnf.jkt`, the 300-second `iat` window, a fresh `jti`, and `req`.
4. `act` structure: outermost `act.sub` equals `client_id`, depth at most 8, no duplicates. Nested actors are not an allow.
5. `mandate` shape, and the `agent_initiated` ceiling.
6. Body `basis` and `goal` against the mandate.
7. The tool name is in `actions`, and `mcp:<server>` is in `locations`. For `direct_request`, both equal `mandate.action` and `mandate.location`.
8. `budget.max_calls` against allows already counted for this `jti` in this process. The counter still dies on restart; [ROADMAP.md](../../ROADMAP.md) already says so.
9. AuthZEN `POST /access/v1/evaluation`, the same request shape as spec §10. The booleans in `policies/mandates.cedar` are unchanged. `justification_ok` means the DPoP proof and `req` checked out. `effect` is still derived from the verb. `permit-bound-call`, `forbid-agent-initiated-writes`, and `forbid-direct-request-inexact` stay. Cedar's default is deny. An unreachable PDP is `pdp_unreachable`.

`tools/list` returns only tools whose names are in `actions` and whose server location is in `locations`. `tools/call` is the invoke path above. The action string is the tool name and must match the existing action grammar. The location is `mcp:<server>`, which matches the existing location grammar. That is the mapping [ROADMAP.md](../../ROADMAP.md) describes.

The decision record in `packages/core/src/types.ts` (`DecisionRecord`) is unchanged. `justification_jti` stores the DPoP proof `jti`. `justification_hash` stores the hash of the proof. The log signs the tree head as it does now (`agent-log-sth+jwt`, Ed25519).

## 5. Revocation and lifetimes

Recommendation: **introspect every call ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662)), and cap access-token lifetime at 900 seconds.**

`active: false` is a deny, including a token whose `exp` has not arrived (§2.2). The checkpoint authenticates to the introspection endpoint (§2.1 says the endpoint should require authentication). On `127.0.0.1` that credential is local, the same trust boundary as today's unauthenticated log. If the endpoint does not answer, the checkpoint denies the call. It does not fall back to the JWT alone.

The 900-second cap is the bound on how long a token can live if a later change caches introspection. This design does not cache. A client revokes by calling the revocation endpoint ([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009) §2). The next introspection returns `active: false`. The user grant lives until its own `exp`. The agent access token's `exp` is the earlier of that instant and `iat + 900`. A re-exchange is subject to the never-widen rules, so it cannot grow the grant back.

Token Status List is not the choice. `draft-ietf-oauth-status-list-21` was in the RFC Editor queue as of 2026-11-18 and had no RFC number. Citing it as a standard would be premature. A bitstring also pays off when many offline verifiers share one list. This checkpoint is one service that already waits for AuthZEN on every call.

Short lifetimes alone do not revoke a token at a chosen moment. Introspection does. The cap is what keeps a fail-closed dependency from turning into a long-lived bearer if introspection is ever skipped.

## 6. Which authorization server

Recommendation: **a minimal authorization server in this repository, in place of `services/issuer`.**

It has to do five things the 0.1.0 issuer already approximates: RFC 8693 exchange with an external JWT-SVID as `actor_token`, RFC 9396 details with this type's comparison, an immutable `mandate`, `cnf.jkt`, and RFC 7662 introspection. It also needs authorization code plus PKCE for the human grant, because MCP clients require that of the authorization server, and RFC 8414 metadata. It does not need to be a general identity product.

| Option | What it already does | What this profile would still build |
| --- | --- | --- |
| In-repo | `attenuateLicense`, mandate checks, `act` limits, Ed25519 log, localhost bind | Token endpoint, RS256 access tokens, DPoP, introspection, authorization-code + PKCE, RFC 8414 metadata |
| Keycloak | Standard token exchange since 26.2 for an internal Keycloak access token exchanged for another. Delegation `actor_token` is also a Keycloak access token (`actor_token_type` `urn:ietf:params:oauth:token-type:access_token`), and the subject token carries `may_act` ([Keycloak token exchange](https://www.keycloak.org/securing-apps/token-exchange)). DPoP exists. | A SPIFFE JWT-SVID is not that actor token. The never-widen rules and the mandate ceiling are not Keycloak policy. Running it pulls this prototype off a single localhost process. |
| Ory Hydra open source | OAuth 2.0 and OpenID Connect. The vendor's feature table marks token exchange as absent from open source and present in Ory Network and the enterprise license ([ory.com/hydra](https://www.ory.com/hydra)). | RFC 8693 in the open-source server, DPoP (public request [ory/hydra#3235](https://github.com/ory/hydra/issues/3235) was closed stale in July 2025 without a merge), and the mandate comparison. |
| Authlete | RFC 8693, RFC 9396, and DPoP, with the authorization decision left to the API caller ([Authlete token exchange](https://developers.authlete.com/protocols-and-flows/advanced-flows/oauth-2-0-token-exchange-rfc-8693)). | A commercial API in front of the same comparison code. The prototype's services are localhost-only and do not take a network dependency for issuance. |

Keycloak and Hydra are the right tools when the missing piece is a stock OAuth server. The missing piece here is the narrowing rule in `packages/core/src/attenuate.ts`. That rule stays in this repository either way. Putting the token endpoint next to it avoids a second product that cannot see a SPIFFE actor token.

The in-repo server is not a full identity provider. The human grant is authorization code plus PKCE against this server for local dev (the user is `user:<name>`, the same ids as today). An external identity provider can later mint the subject token; the exchange rules do not change. That split is an open question, not a requirement.

## 7. Dropped, kept, migration

Dropped:

- The presented credential `typ` `agent-license+jwt`, and the user-request `typ` `agent-request+jwt` once phase 5 below is done.
- `POST /v1/licenses` and `POST /v1/licenses/attenuate` as the public API. The comparison inside `attenuateLicense` remains the authorization server's check.
- `typ` `agent-justification+jwt`, the `Agent-License` header, and the `Agent-Justification` header.
- Agent private keys in `.agent-license/agents/` as the trust root.
- A separate `agent` claim on the access token. The current actor is outermost `act.sub` and `client_id`.
- `req_hash` on the token. The authorization server verified the subject token instead of echoing a hash for the checkpoint to re-check.

Kept:

- The mandate object and the three types, including the `agent_initiated` ceiling.
- `policies/mandates.cedar` and the AuthZEN routes in `services/pdp/src/server.ts`.
- The Merkle log (`packages/core/src/merkle.ts`, `services/log`) and `agentlicense log verify`.
- The documentation site under `site/`. This checkout has no operational dashboard. The log's HTTP API is what a later view would read. This design does not add one.

Package names stay `agentlicense`, `@agentlicense/core`, and `@agentlicense/sdk`. They are at version `0.1.0`. [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) publishes all three on a `v*` tag that matches that version. [README.md](../../README.md) says they are not on the npm registry until that tag runs.

API:

| Package | 0.1.0 | Target |
| --- | --- | --- |
| `@agentlicense/core` | `issueLicense`, `attenuateLicense`, `createJustification`, `verifyLicense`, `assessPresentation` | `exchange` request builder, `assertNarrowed` exported, `verifyAccessToken`, `verifyDpop`. Merkle exports stay. |
| `@agentlicense/sdk` | `licensed(fetch)` sets `Agent-License` and `Agent-Justification` (`packages/sdk/src/index.ts`) | `licensed(fetch)` sets `Authorization: DPoP` and a `DPoP` header. `why` stays an option. The URL passed to `fetch` is still not contacted. |
| `agentlicense` | `keys init` writes agent JWKs. `issue` and `attenuate` print a license JWS. | `issue` and `attenuate` call the token endpoint. `keys init` writes the log key and the RS256 authorization-server key. It does not write agent keys. |

Deprecation, assuming a publish happens:

1. If `v0.1.0` is published before the OAuth API exists, leave it as the custom-JWS release. Do not add features to it.
2. The first release that speaks token exchange marks `issueLicense`, `attenuateLicense`, `createJustification`, `verifyLicense`, `LICENSE_TYP`, `JUSTIFICATION_TYP`, and `REQUEST_TYP` with `@deprecated` and keeps them working.
3. The release that removes them is `1.0.0`. Publish it only when phase 5 below is green.
4. Then `npm deprecate agentlicense@<1`, `@agentlicense/core@<1`, and `@agentlicense/sdk@<1`, with a message that points at this document. The binary name `agentlicense` does not change.

If nothing has been published yet, skip step 1 and do not tag `v0.1.0` once `1.0.0` is the API that should be installed. Tagging `v0.1.0` after that would put the custom JWS on the registry as a fresh package.

### Phases

Each phase is a separate change. `pnpm test` for that phase passes without the later phases.

| Phase | Ships | Verified by |
| --- | --- | --- |
| 1 | Token endpoint emits the claims table. Subject token may be a 0.1.0 user-request JWS, accepted only on `127.0.0.1`. Old `/v1/licenses` still works. | A fixture exchange. A widened detail returns `invalid_authorization_details`. Mandate, `sub`, and `txn` on the JWT equal the user grant. `alg` is `RS256`, `typ` is `at+jwt`. |
| 2 | `actor_token` is a JWT-SVID checked against a local SPIRE bundle. | A wrong trust domain is rejected. A second exchange adds one `act` level. A repeated actor and a ninth actor are rejected. |
| 3 | `POST /v1/invoke` accepts a DPoP proof with `ath` and `req`. The justification header still works. | A reused proof `jti` is `justification_replay`. A proof over a different body is `justification_mismatch`. A `jkt` mismatch is `bad_signature`. Cedar and the log still run. |
| 4 | Protected resource metadata and MCP `tools/list` / `tools/call`. | A GET of the metadata document returns the issuer and `dpop_bound_access_tokens_required: true`. `tools/list` omits a tool outside the detail. A denied `tools/call` is in the log and is not forwarded. |
| 5 | Introspection is required. `/v1/licenses` and `/v1/licenses/attenuate` return 410. The SDK stops sending the old headers. | A token with `active: false` is denied before `exp`. An unreachable introspection endpoint is denied. A request with only `Agent-License` is denied. |

Phase 1's localhost subject-token exception is deleted in phase 5. Until then it is how the existing user-request fixtures drive the new token.

## 8. Threat-model deltas and open questions

| Threat | 0.1.0 | This design |
| --- | --- | --- |
| Stolen license used from another process | The thief still needs the agent JWK to sign a justification. | The thief still needs the SVID private key to sign DPoP. A stolen JWT-SVID alone fails the token-endpoint certificate check. |
| Stolen proof replayed | 300-second justification, in-process `jti` set. The set is empty after a restart. | Same window, same gap ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) §11.1). A restart forgets `jti`s. |
| Proof rebound to a different body | The justification names `action`, `location`, and `why`. | Closed only by the profile `req` claim. DPoP by itself does not bind the body. |
| Delegate widens scope | `attenuateLicense` rejects it. The checkpoint does not re-check the parent. | The authorization server rejects it. The checkpoint still does not see the parent detail. [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693) §4.1 tells the resource server not to authorize from nested `act`. Ancestor scope is still not embedded ([ROADMAP.md](../../ROADMAP.md)). |
| Long-lived token after the user changes their mind | No revocation. The license lives until `exp`. | Introspection returns `active: false`. The access token also dies within 900 seconds. |
| Authorization server unavailable | Issuance fails. Already-issued licenses still verify. | Every call fails closed. Availability of the authorization server becomes part of the call path. |
| Issuer-key compromise | Mints any license. | Mints any access token. Unchanged blast radius, RS256 key instead of Ed25519. |
| SPIRE CA compromise | No SPIRE. A directory of JWKs is the agent root. | Mints SVIDs. Does not by itself mint a user grant. The attacker still needs a subject token. |
| JWT-SVID replayed at the wrong service | Not issued. | [JWT-SVID §7.1](https://spiffe.io/docs/latest/spiffe-specs/jwt-svid/). `aud` is only the token endpoint. |
| Custom canonical-JSON bug in the license parser | Every token uses that canonical subset. | Access tokens are ordinary JWT JSON. The log's canonical leaves stay. |
| Cedar trusts checkpoint booleans | Documented in the roadmap. The PDP re-derives `effect` only. | Unchanged. |
| Log replacement | Detectable if the verifier kept an older signed tree head. Callers of the log are unauthenticated on localhost. | Unchanged. |
| MCP token mix-up | No MCP. | `aud` and the RFC 8707 `resource` are the one checkpoint URI. Metadata names one authorization server. |

Open questions for the owner:

1. During narrowing, may `user_goal` become `direct_request` for one in-scope action, or does that invent an instruction the user did not grant? 0.1.0 copies the mandate. This design copies it too.
2. Should the checkpoint ever see the user grant again, or is the authorization server's signature on `mandate` enough?
3. For `direct_request`, is a shorter `exp` or a lower `max_calls` enough of a narrowing, or should a sub-agent be unable to receive a direct request?
4. May a user grant an `agent_initiated` ceiling smaller than the built-in three actions, or is that set the only legal one?
5. Should the access token name the log key, so a verifier knows which log to ask? 0.1.0 does not.
6. There is no dashboard in this checkout. `site/` is docs, and `services/log` is the API. Is that the surface to keep?
7. Is the private DPoP claim name `req` acceptable for the body hash, or should it be a URI?
8. Is 900 seconds the right access-token cap, and is the 300-second DPoP window still right once proofs are single-use?
9. Should this authorization server be the thing that logs the user in, or should it only exchange a subject token minted elsewhere?
10. Do agent ids stay `spiffe://agent-license.example/agent/<name>`, or do instances need another path segment?
11. Do `txn` and `parent_jti` earn a place in the IANA JWT claims registry next to `mandate`, or are they log fields only?
12. Budgets still live in one checkpoint process. Is a shared counter in scope for this rebase?
13. The on-behalf-of English sentence is only in open pull request #1. This design does not add it. Is the `act` chain the record that should ship?
14. Confirm the SVID key type is ECDSA P-256 (`ES256` DPoP) before the authorization server advertises that `alg` and no other.
15. MCP 2026-07-28 requires `Authorization: Bearer`. This design requires `Authorization: DPoP`. Accept that divergence, or keep bearer tokens and drop sender-constraining?
