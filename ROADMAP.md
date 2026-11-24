# Roadmap

`agent-license` is a prototype of verifiable agent mandates. The v1 profile in [spec/LICENSE-FORMAT.md](spec/LICENSE-FORMAT.md) is intentionally small: one issuer, Ed25519, three mandate types, and a single append-only log.

## Next milestone: MCP gateway

The checkpoint in v1 is an HTTP proxy in front of one tool API. The next milestone is a gateway in front of [Model Context Protocol](https://modelcontextprotocol.io) servers.

- `tools/call` is refused unless the caller presents a current license and a fresh justification.
- `tools/list` is filtered to the tools named in `authorization_details`.
- When an agent spawns a sub-agent, the gateway asks the issuer to attenuate the license before the child receives it. The child cannot be given a tool the parent license does not already grant.
- Each allowed or denied `tools/call` is appended to the same Merkle log, with the MCP server name and tool name as the action and location.
- The gateway stays outside the agent process, as the checkpoint does today.

That gateway is the first place the license has to meet a real tool protocol. v1 proves the token, the policy call, and the log; it does not speak MCP.

## After that

- Enrollment. v1 reads agent and user keys from a directory. A deployment needs a way to register an agent key without sharing a filesystem.
- Revocation before `exp`, published so a checkpoint can refuse a license that is still inside its window.
- Budget accounting that survives more than one checkpoint process.
- Requiring the original user-request JWS at every checkpoint, instead of treating it as optional extra evidence.
- Embedding ancestor scopes (or the parent license) so a checkpoint can re-check attenuation instead of trusting that the issuer applied it.
- A witness or a second log, so replacing the log key and rewriting history is detectable by someone who kept an older signed tree head.
- Authenticated calls from the checkpoint to the policy decision point. Today the PDP trusts the booleans the checkpoint sends (`in_scope`, `basis_ok`, and the rest) and only re-derives `effect` from the action name.

## Open questions

These are unresolved on purpose. The v1 code picks one side so the prototype runs; a public spec would have to decide.

1. **Mandate changes during attenuation.** v1 copies the mandate type unchanged. Should a `user_goal` license be allowed to narrow into a `direct_request` for one in-scope action, or does that invent a user instruction the user did not sign?
2. **Where the originating request is checked.** The license always carries `txn` and `req_hash`. The checkpoint recomputes the hash only when the caller also presents the user-request JWS. Should that presentation be mandatory?
3. **What "narrower" means for a direct request.** A `direct_request` already names one action. Attenuation can still lower the budget or shorten `exp`. Is a same-scope, shorter-lived copy enough, or should sub-agents be unable to receive a direct request at all?
4. **Agent-initiated authority.** The ceiling is a fixed read-only set. Should a user be able to sign a still-narrower ceiling of their own, or is the built-in set the only legal scope for this mandate?
5. **Log identity.** Signed tree heads use a log key that lives next to the issuer key. Should the log's public key be named in the license so a verifier knows which log to ask?
