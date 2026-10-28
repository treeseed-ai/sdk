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
