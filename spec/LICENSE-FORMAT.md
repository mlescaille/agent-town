# Agent license format, v1

Status: prototype profile. This document is the normative description of the tokens, checks, and log this repository implements. It borrows names and shapes from existing specifications and is not itself an IETF standard.

## 1. Roles

- **User.** The person identified by `sub`. The user signs one originating request.
- **Issuer.** A service distinct from every agent. Only the issuer signs licenses. Agents never do.
- **Agent.** The holder of a license, identified by a SPIFFE-style id. The agent signs a justification for each call.
- **Checkpoint.** A policy enforcement point outside the agent process. It verifies the license and the justification, asks a policy decision point, and writes the decision to the log before it forwards the call.
- **Policy decision point.** An OpenID AuthZEN 1.0 endpoint that evaluates Cedar policies.
- **Log.** An append-only Merkle tree of decisions. The log signs each tree head.

Logical identifiers in this profile, which are not network addresses:

| Name | Value |
| --- | --- |
| Issuer (`iss` of a license) | `https://issuer.agent-license.example` |
| Checkpoint audience | `https://checkpoint.agent-license.example` |
| SPIFFE trust domain | `agent-license.example` |

## 2. Cryptography

All signatures are JWS compact serialization (RFC 7515) with `"alg": "EdDSA"` and an Ed25519 key (RFC 8032). No other algorithm is accepted. A `crit` header is rejected. The `kid` is the RFC 7638 thumbprint of the public JWK, base64url-encoded without padding:

```json
{"crv":"Ed25519","kty":"OKP","x":"<base64url>"}
```

Object keys in that thumbprint input are in lexicographic order and there is no whitespace. The same canonical JSON subset is used for every signed payload and every Merkle leaf: objects with sorted keys, arrays in order, strings, safe integers, booleans, and null, with no insignificant whitespace.

`typ` values:

| Token | `typ` |
| --- | --- |
| User request | `agent-request+jwt` |
| License | `agent-license+jwt` |
| Justification | `agent-justification+jwt` |
| Signed tree head | `agent-log-sth+jwt` |

Unknown claim names are rejected. A verifier checks `nbf` and `exp` with five seconds of skew. A token is not yet valid when `now + 5 < nbf`, and it is expired when `now - 5 >= exp`.

## 3. Identifiers

A user id is `user:<name>` where `<name>` matches `^[a-z][a-z0-9-]{0,62}$`.

An agent id is `spiffe://agent-license.example/agent/<name>` with the same name rule. This is a SPIFFE-style id (a trust domain and a path). v1 does not federate other trust domains.

An action matches `^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$`, for example `calendar.read`. The verb is the last dot-separated label. `read`, `list`, and `get` are read effects. Every other verb is a write.

A location matches `^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+` and means `resourceType:resourceId`, for example `calendar:primary`.

Token ids (`jti`, `txn`, `parent_jti`) match `^[A-Za-z0-9_-]{8,80}$`.

## 4. Originating user request

The user signs one request. The license is bound to that exact compact JWS, not to a re-encoding of it.

```json
{
  "iss": "user:alice",
  "sub": "user:alice",
  "aud": "https://issuer.agent-license.example",
  "iat": 1700000000,
  "exp": 1700003600,
  "jti": "req_0123456789abcdef0123456789abcdef",
  "agent": "spiffe://agent-license.example/agent/planner",
  "mandate": { "type": "user_goal", "goal": "Summarize the primary calendar" },
  "authorization_details": [
    {
      "type": "urn:agent-license:tool",
      "actions": ["calendar.create", "calendar.read"],
      "locations": ["calendar:primary"],
      "budget": { "max_calls": 10 }
    }
  ]
}
```

`iss` and `sub` are the same user id. `aud` is the issuer. `authorization_details` has exactly one element. `exp` is after `iat`.

The request hash is `sha-256:` concatenated with unpadded base64url(SHA-256(UTF-8 bytes of the compact JWS)).

## 5. License

The issuer verifies the user request, checks that the named agent key is enrolled, and signs a license. The license does not outlive the user request.

```json
{
  "iss": "https://issuer.agent-license.example",
  "sub": "user:alice",
  "aud": "https://checkpoint.agent-license.example",
  "iat": 1700000000,
  "nbf": 1700000000,
  "exp": 1700003600,
  "jti": "lic_0123456789abcdef0123456789abcdef",
  "agent": "spiffe://agent-license.example/agent/planner",
  "act": { "sub": "spiffe://agent-license.example/agent/planner" },
  "mandate": { "type": "user_goal", "goal": "Summarize the primary calendar" },
  "authorization_details": [
    {
      "type": "urn:agent-license:tool",
      "actions": ["calendar.create", "calendar.read"],
      "locations": ["calendar:primary"],
      "budget": { "max_calls": 10 }
    }
  ],
  "txn": "req_0123456789abcdef0123456789abcdef",
  "req_hash": "sha-256:<base64url>"
}
```

`txn` is the user request's `jti`. It is the transaction identifier in the sense of an OAuth transaction token: one id for the originating request. `req_hash` binds that id to the signed bytes. An attenuated license adds `parent_jti`, the `jti` of the parent license.

### 5.1 Delegation chain

`act` is the actor claim from RFC 8693. The outermost `act.sub` is the current actor and MUST equal `agent`. A nested `act` is the prior actor. The deepest `act` is the original agent. Only `sub` and a nested `act` are allowed inside the claim. The chain is at most eight agents, and no agent id repeats.

A root license has a single `act` and no `parent_jti`. An attenuated license has `parent_jti` and at least two actors.

Displayed from the user outward, the chain is `sub`, then the actors from deepest to outermost. The last id is the agent that may present the license.

### 5.2 Authorization details

The single detail uses the Rich Authorization Requests shape (RFC 9396):

| Field | Rule |
| --- | --- |
| `type` | `urn:agent-license:tool` |
| `actions` | Non-empty set of actions, stored in sorted order |
| `locations` | Non-empty set of locations, stored in sorted order |
| `budget.max_calls` | Optional positive integer up to 1,000,000. Absent means no call cap. |

No other budget field is defined. A call is in scope when its action is in `actions` and its location is in `locations`.

## 6. Mandate semantics

`mandate.type` is exactly one of `direct_request`, `user_goal`, or `agent_initiated`.

### 6.1 `direct_request`

The user named one action. The mandate is `{ "type": "direct_request", "action", "location" }`. The authorization detail contains exactly that one action and that one location. The checkpoint allows a call only when both match. The justification `basis` MUST be `user_request`. A `goal` field on the justification is rejected.

### 6.2 `user_goal`

The user named a goal string of 1 to 300 characters. The agent may choose any call inside the scope. The justification `basis` MUST be `user_goal`, and `goal` MUST equal `mandate.goal`. A justification that claims `basis: user_request` is a mismatch: the user did not ask for that exact action.

### 6.3 `agent_initiated`

The user signed a grant that lets the agent act without a user goal. The mandate is `{ "type": "agent_initiated" }`. The scope MUST sit inside this ceiling, and `budget.max_calls` MUST be present and at most 5:

| Actions | Locations |
| --- | --- |
| `catalog.list` | `catalog:public` |
| `clock.read` | `clock:local` |
| `memory.read` | `memory:self` |

The justification `basis` MUST be `agent`. A `goal` field is a mismatch: the agent must not claim a user goal it was not given. The issuer and the verifier both reject a license outside the ceiling, so a mis-issued token does not become valid by skipping the issuer's own checks.

## 7. Attenuation

A sub-agent license is signed by the issuer, not by the parent agent. The issuer verifies the parent license and then signs the child. The child copies `sub`, `mandate`, `txn`, and `req_hash` unchanged. It sets `agent` to the child, `parent_jti` to the parent's `jti`, and:

```json
"act": { "sub": "<child>", "act": <parent.act> }
```

The child agent MUST NOT already appear in the parent chain.

Narrowing is mandatory and one-way:

- Every child action is in the parent action set, and every child location is in the parent location set. Adding either is `scope_widen`.
- If the parent sets `max_calls`, the child MUST set `max_calls` less than or equal to it. Dropping the cap or raising it is `budget_widen`. Adding a cap the parent did not have is a narrowing.
- `exp` MUST be less than or equal to the parent `exp`, and greater than the child's `nbf`. A later expiry is `expiry_widen`.
- At least one of these is strict: fewer actions, fewer locations, a lower cap, or an earlier `exp`. An equal copy is `not_narrowed`.

Changing `mandate.type`, the goal text, the user, the transaction id, or the request hash is not possible through this operation because those fields are copied. A `direct_request` child therefore keeps the single action; it can still be narrower by budget or expiry.

## 8. Justification

The agent signs a new justification for each presentation. Its lifetime (`exp - iat`) is at most 300 seconds. The checkpoint remembers `jti` values it has accepted and rejects a replay.

```json
{
  "iss": "spiffe://agent-license.example/agent/planner",
  "sub": "user:alice",
  "aud": "https://checkpoint.agent-license.example",
  "iat": 1700000000,
  "exp": 1700000060,
  "jti": "jus_0123456789abcdef0123456789abcdef",
  "license_jti": "lic_0123456789abcdef0123456789abcdef",
  "txn": "req_0123456789abcdef0123456789abcdef",
  "req_hash": "sha-256:<base64url>",
  "mandate_type": "user_goal",
  "basis": "user_goal",
  "action": "calendar.read",
  "location": "calendar:primary",
  "why": "Reading the calendar is how the summary is produced.",
  "goal": "Summarize the primary calendar"
}
```

`iss` is the licensed agent. `why` is 12 to 500 characters. `action` and `location` are the call being made, not a description of some other call. `txn`, `req_hash`, `sub`, `license_jti`, and `mandate_type` MUST equal the license. `goal` is present only for `user_goal`.

`basis` is `user_request`, `user_goal`, or `agent`, and it MUST match section 6. A mismatch is `justification_mismatch` even when the action is inside the scope. That is the check of the justification against the originating request: the justification is tied to the request id and hash, and it may not claim a different kind of user instruction than the signed request recorded.

When the caller also presents the user-request JWS, the checkpoint verifies it, recomputes `req_hash`, and checks that `txn`, `sub`, and the mandate (including the goal text) match the license. Presentation of the JWS is optional in v1. The hash echo inside the justification is not.

## 9. Checkpoint

The checkpoint accepts `POST /v1/invoke` with headers `Agent-License` and `Agent-Justification` and a JSON body:

```json
{
  "action": "calendar.read",
  "resource": { "type": "calendar", "id": "primary" },
  "input": {},
  "user_request": "<optional compact JWS>"
}
```

`location` may be sent instead of `resource`. The checkpoint allows the call only when every structural check passes and the policy decision point returns `"decision": true`. Otherwise it responds `403` and does not call the tool. Either way it appends a decision first.

Order of structural checks:

1. License signature, `typ`, issuer, audience, lifetime, agent id, `act` chain, mandate shape, and the agent-initiated ceiling.
2. Justification signature under the enrolled key of `license.agent`, lifetime, and equality of the binding fields in section 8.
3. Replay of `justification.jti`.
4. Mandate basis and goal rules.
5. Scope, including the exact action pair for `direct_request`.
6. `budget.max_calls` against the number of allows already recorded for this license `jti` in this process.
7. The user-request JWS, when one was presented.

Stable `code` values include `missing_license`, `missing_justification`, `bad_signature`, `expired`, `not_yet_valid`, `act_chain`, `bad_agent_id`, `mandate_invalid`, `justification_mismatch`, `justification_replay`, `over_scope`, `budget_exceeded`, `request_hash_mismatch`, `policy_deny`, and `pdp_unreachable`. A structural failure is reported even if Cedar would also have denied. If the structure passes and Cedar denies, the code is `policy_deny`. If the policy decision point cannot be reached, the checkpoint fails closed.

## 10. AuthZEN and Cedar

The checkpoint `POST`s to `{pdp}/access/v1/evaluation`. The batch endpoint `{pdp}/access/v1/evaluations` accepts a default subject, action, resource, and context, plus an `evaluations` array of overrides, as in AuthZEN 1.0. Metadata is at `GET /.well-known/authzen-configuration`.

A single evaluation:

```json
{
  "subject": {
    "type": "agent",
    "id": "spiffe://agent-license.example/agent/planner",
    "properties": { "user": "user:alice", "mandate": "user_goal" }
  },
  "action": { "name": "calendar.read" },
  "resource": { "type": "calendar", "id": "primary" },
  "context": {
    "justification_ok": true,
    "in_scope": true,
    "request_match": true,
    "within_budget": true,
    "chain_ok": true,
    "mandate_ok": true,
    "basis_ok": true,
    "exact_match": true,
    "mandate": "user_goal",
    "why": "Reading the calendar is how the summary is produced."
  }
}
```

The response is an AuthZEN decision. Reasons ride in `context`:

```json
{
  "decision": true,
  "context": {
    "reason": "cedar permit",
    "cedar_decision": "allow",
    "determining_policies": ["permit-bound-call"]
  }
}
```

`decision` is a boolean, as AuthZEN requires. The PDP evaluates `policies/mandates.cedar` with `@cedar-policy/cedar-wasm`:

- `permit-bound-call` permits a call only when every checkpoint boolean above is true.
- `forbid-agent-initiated-writes` forbids `agent_initiated` when the effect of `action.name` is `write`. The effect is derived from the action name, not from a boolean the caller supplies.
- `forbid-direct-request-inexact` forbids `direct_request` when `exact_match` is false.

Cedar's default is deny, so a missing permit is a deny. The PDP is an internal component. It trusts the checkpoint to supply the booleans. A deployment isolates it on the same host.

## 11. Decision log

The log is a Merkle tree as defined in RFC 9162 section 2.1, with SHA-256.

- The empty tree's root is SHA-256 of the empty string.
- A leaf is SHA-256(`0x00` concatenated with the canonical JSON of the decision).
- An internal node is SHA-256(`0x01` concatenated with the left child and then the right child).
- Inclusion proofs follow RFC 9162 section 2.1.3. The proof's `leaf_hash` is the leaf hash above, not the raw JSON.
- Consistency proofs follow RFC 9162 section 2.1.4. Equal tree sizes are consistent only when the roots match and the path is empty.

Node hashes on the wire are unpadded base64url. RFC 9162 uses standard base64; the tree construction is unchanged.

Each appended record is:

```json
{
  "v": 1,
  "index": 0,
  "time": "2026-01-01T00:00:00.000Z",
  "decision": "allow",
  "code": "allow",
  "reason": "signature, lifetime, scope, mandate, and originating request all match",
  "license_jti": "lic_...",
  "justification_jti": "jus_...",
  "justification_hash": "sha-256:...",
  "agent": "spiffe://agent-license.example/agent/planner",
  "sub": "user:alice",
  "mandate": "user_goal",
  "action": "calendar.read",
  "location": "calendar:primary",
  "policy_decision": "allow",
  "why": "Reading the calendar is how the summary is produced."
}
```

`decision` is `allow` or `deny`. `policy_decision` is `allow`, `deny`, or `not_evaluated`. `justification_hash` is the hash of the justification JWS, or an empty string when there was none. `why` is the justification text the checkpoint accepted, or empty when the call never got that far. `license_jti` is the license id.

After every append the log signs a tree head. The payload is:

```json
{
  "v": 1,
  "log_id": "<log key thumbprint>",
  "tree_size": 1,
  "root_hash": "<base64url>",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

A verifier replays the entries, recomputes every prefix root, checks it against the signed tree head, checks an inclusion proof for every leaf, and checks consistency between tree heads. Changing any leaf, or any signed head, makes that replay fail. The log refuses to start when the files on disk already fail this check.

HTTP, all JSON:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/entries` | Append a decision. Returns the index, leaf hash, inclusion proof, and signed tree head. |
| `GET` | `/v1/entries?start=&end=` | Read records for replay. |
| `GET` | `/v1/sth` | Latest signed tree head. |
| `GET` | `/v1/sths` | Every signed tree head, in order. |
| `GET` | `/v1/proofs/inclusion?leaf_index=&tree_size=` | Inclusion proof. |
| `GET` | `/v1/proofs/consistency?first=&second=` | Consistency proof between two sizes. |

The log does not authenticate callers. It is bound to localhost. An observer who does not keep a signed tree head, and who also loses the log key, cannot detect a full rewrite. Keeping any older signed tree head is enough to detect one, because the consistency proof against the new head will fail.
