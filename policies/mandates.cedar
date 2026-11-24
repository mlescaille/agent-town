@id("permit-bound-call")
permit (
  principal,
  action,
  resource
)
when {
  context.justification_ok == true &&
  context.in_scope == true &&
  context.request_match == true &&
  context.within_budget == true &&
  context.chain_ok == true &&
  context.mandate_ok == true &&
  context.basis_ok == true
};

@id("forbid-agent-initiated-writes")
forbid (
  principal,
  action,
  resource
)
when {
  context.mandate == "agent_initiated" &&
  context.effect == "write"
};

@id("forbid-direct-request-inexact")
forbid (
  principal,
  action,
  resource
)
when {
  context.mandate == "direct_request" &&
  context.exact_match == false
};
