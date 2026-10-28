# Manager, worker and guest probe protocol

SDK #488 publishes separately versioned `CapacityProtocolSchemas`, inferred reserve,
reservation, dispatch and runner-outcome types, `CapacityProtocolBinding`, and typed
`CapacityWorkerClient` / `CapacityRunnerClient` interfaces through root/portable exports.
These carry data across separate process-local Cordis roots; they establish no authority.
The seven global operation IDs and projection version remain unchanged.

Reserve binds caller-owned request/assignment/lease IDs, installation/provider/project/profile
scope, fresh authority, actual manager and expected worker generations, compatibility hash,
fence and expiry. Reservation acknowledges a worker-owned sandbox with actual runner/provider
generations. Managers authenticate the worker and workers recheck live grants before admission.
Owners must publish durable one-use custody before replying. An identical repeated reserve
must read back its exact receipt; a reused ID with different bytes fails. A lost reply or
restarted worker never authorizes a second assignment or automatic adoption of uncertain state.
Expiry and verified destruction remain mandatory; explicit recovery is required when custody
cannot be proved. No process-local SDK map can establish this durable owner invariant.

Dispatch binds reservation/request IDs, the complete lease, Agent definition/profile,
environment and bounded harmless input. `assertDispatch(input, reservation, now)` rejects
substituted IDs, scope, authority, generations, compatibility, fence and expiry. The profile
must exist in that definition and reference the supplied environment. Owners independently
verify accepted artifacts, parameter semantics and current authority before running anything.

`CapacityWorkerClient` exposes ready/reserve/dispatch/cancel with abort signals and final
host-backed `CapacityResult`. `CapacityRunnerClient` exposes ready/run/cancel with a guest
outcome. `assertRunner(input, lease)` binds the exact returned lease; it does not prove fresh
permission, cleanup or execution. Only the worker publishes verified destruction. Guest and
final output share the 1024-character bound; failures cannot include success output. Readiness
must acknowledge the actual role/scope/current composition and process generations.

## Delivery and verification

Documentation → intended-red built portable Node acceptance → hostile binding unit cases →
implementation → complete SDK checks/build/all four tiers → genuine script-free archive and
inferred client-declaration consumer → current-head CI. Tests cover reservation/lease swaps,
profile/environment mismatch, unsupported envelopes and oversized output. New methods obey
the canonical twenty-line rule. Authenticated service programs and real Kata/identity remain
Agent/Deployment gates. Work/model execution remains Task 10. All issues remain open.

## Service-scoped sandbox control

A separately versioned `treeseed.sandbox-control/v1` family carries only bounded host operations
between the Agent worker and Deployment's private sandbox provider. This is distinct from the
read-only observer and the seven global platform operation IDs. SDK owns portable schemas,
inferred client/provider types, generated projections and safe binding errors. Deployment owns
the actual authenticated private transport, filesystem custody and host operations; Agent owns
pool/admission/setup orchestration. No process-local Cordis context crosses this boundary.

Requests bind a request ID, exact installation/service/provider/service-generation scope, one
operation and its positive arguments. Operations are `ready`, `create`, `inspect`, `assign`,
`execute` and `destroy`. They accept only logical sandbox IDs, assignment/environment IDs and
setup/verification phases. There are no raw paths, command arrays, runtime endpoints, image pulls,
arbitrary environment values or script bytes in worker requests. Trusted host configuration owns
those exact immutable selections. The caller cannot use a request to acquire another scope.

A host-owned expiring grant names its exact scope and unique allowed operations. Authorization
material remains in owner-private custody/transport; the portable grant contains no credential.
The server compares requests to its actual admitted scope and current grant before host effects.
Availability reports successful host preflight, not a warm pool or a healthy Agent. Actual sandbox
inspection and the guest's own readiness remain separate evidence. Replies bind the same request,
operation and scope; evidence exposes safe logical identities and digests, never host sockets,
PIDs, physical resource names, credentials or script output.

Creation returns only a never-assigned base. Assignment returns the exact one-use assignment and
environment identity. Execute returns a bounded successful setup/verification receipt; destroy
requires verified destruction. Failures contain null result and one fixed safe problem code.
Bindings reject cross-scope responses, changed request/operation/phase/assignment/sandbox identity,
expired grants and ungranted methods. Repeated requests still require fresh owner validation;
portable schemas alone provide no authentication, live authority, virtualization or custody proof.

The eventual installed transport uses an explicitly granted service socket and private authority;
it must never mount raw Docker/containerd sockets or reuse the observer channel. Native Cordis
composition selects both provider and consumer implementations. Worker/provider replacement stays
restart-only until exact transition qualification, preserving in-flight generation custody through
verified cleanup. All issues remain open; productive Work/model execution stays Task 10.
