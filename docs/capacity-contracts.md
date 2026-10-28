# Fenced capacity leases and acknowledgements

SDK #488 defines portable `CapacitySchemas`, inferred scope/authority/generation/lease/result/
readiness types, fixed `CapacityContractError` blockers and `CapacityContractBinding` checks.
Root and `./portable` exports share the definitions. Generated projections contain
`capacityLease`, `capacityReadiness` and `capacityResult`; the existing seven global operation
IDs and global projection version stay unchanged. Each capacity schema is independently
versioned at `1.0.0-cordis.1`.

The exact scope binds installation identity and absolute directory, capacity provider,
project, platform profile and worker. Authority binds HTTPS issuer, subject, team, provider,
credential and grant identities/revisions, capability IDs, state and expiry; it contains no
credential or token. A parsed shape establishes no authentication. The trusted caller must
obtain fresh live observations from the existing Keycloak-governed control-plane boundary.

Each manager, worker and runner has a composition generation and a process generation.
Pool, sandbox and environment provider generations remain explicit. A fenced probe lease
binds the scope, authority, exact processes/providers, sandbox/assignment/lease IDs,
compatibility digest and expiry no later than grant expiry. `assertLease(input, trusted, now)`
requires a valid trusted clock, exact admitted lease, current authority, exact generations,
fence and unexpired lifetime. A request cannot manufacture the trusted expectation. Changed
issuer, subject, team, provider, credential, grant or revision must never be silently adopted.

`assertReady(input, scope, role, generation)` requires an actual current process
acknowledgement, matching scope/role/generation and no blockers. Restart invalidates prior
readiness; stored active records are not current observations. Unready records require
blockers. Authentication, native Cordis roots and service transports remain owner work.

`assertResult(input, expectedLease)` verifies historical result identity without reopening
expired admission. Completion requires bounded probe output, empty blockers and destruction
inspection evidence matching the exact sandbox/provider generation. Cancellation and blocked
results have no output. Failed destruction is recovery-required and cannot pass as completion.
Errors expose fixed safe codes/messages; arbitrary provider exceptions and credential fields
are rejected. Results are data; only verified host-backed cleanup can establish their truth.

Agent owns manager/kernel, worker/pool, guest/handler execution and live admission. Deployment
owns bounded runtime operations and custody; API owns seed coordination; Identity retains
Keycloak and existing signed credentials. These contracts do not start services, issue grants
or implement real Work/model execution (Task 10).

Verification is documentation → built portable acceptance → binding/readiness cases →
implementation → complete owner checks/build/four tiers, genuine packed Node/declaration
consumers and exact-head CI. Tests cover identity/generation substitutions, revoked/expired
grants, invalid clocks, contradictory results, restart readiness and actual generated schemas.
All issues remain open; delivery candidates target cordis for review without merging.
