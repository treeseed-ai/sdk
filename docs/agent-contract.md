# Bounded Agent composition contract

SDK #482 is the first Task 3D delivery slice. Public root and portable exports supply `AgentSchemas`, `AgentContractBinding` and safe `AgentContractError`; runtime composition remains the existing SDK Cordis API. Agent owns execution plugins; Deployment owns accepted-package installation; UI owns human presentation. This is a composition probe, with no real Work/model/sandbox execution or new Keycloak authority.

Protocol 1 request fields: operation `composition-probe`, executionId, scopeId, principalId, resourceScope, grantId, grantRevision (positive safe integer), expectedGeneration (64 lowercase hex), handlerId and text (0–1024 characters). IDs are 1–128 characters from the existing ASCII provider-key alphabet. All objects are strict; unknown model/credential/Work fields fail validation.

Trusted authority fields: scopeId, principalId, resourceScope, grantId, grantRevision and state `granted` or `revoked`. Hosts supply this binding separately; a request is never its own authority. `AgentContractBinding.assert(request, authority, generation)` parses both values, rejects revoked state and any mismatch, and returns a detached parsed request. This verifies binding equality only; the hosting owner must resolve and revalidate the actual grant at each execution seam. No OAuth or live revocation guarantee is implied by a portable data comparison.

Results repeat protocol, executionId, scopeId, principalId, resourceScope, grantId, grantRevision, generation and handlerId. State is completed/cancelled/blocked/recovery-required; output is bounded text or null; blockers have fixed safe code/message; cleanup is disposed/failed. Completed requires output, no blockers and disposed cleanup. All noncompleted states have null output. Cancelled has disposed cleanup. Failed cleanup requires recovery-required, and recovery-required requires failed cleanup plus a blocker. Blocked requires a blocker. Result schemas validate internal consistency; Agent separately binds every result to its admitted request.

Contract binding failures expose only `INVALID_AGENT_CONTRACT`, `AGENT_GRANT_REVOKED`, `AGENT_SCOPE_MISMATCH` or `STALE_AGENT_GENERATION`, with fixed messages. Underlying errors and request bytes are never included.

Generated projection advances to `0.6.0-cordis.1` and adds agentAuthority, agentExecutionRequest and agentExecutionResult. Existing seven operations, ProviderV4 format/version and installed package descriptors are unchanged. Package candidate advances to `0.0.0-cordis.17`; this is local migration candidate identity, not production publication.

Acceptance runs a Node program through the built public portable export. Unit cases pin scope/principal/resource/grant/revision, revocation, generation, payload bounds, unknown fields, safe errors and result consistency. Root and browser portable contracts must share the same schemas without Node runtime imports.
