# Virgin pool and cross-process probe protocol

SDK #488 extends the separately versioned capacity/activity/environment contracts with
`PoolSchemas` and `CapacityProtocolSchemas`. These are portable data boundaries; native Agent
roots, authenticated service transport and real Deployment evidence remain owner obligations.
The seven global operations and projection version are unchanged.

Pool compatibility binds exact Kata runtime/archive, Linux/amd64 image, vCPU/memory/scratch,
network/isolation policy and worker/runner/pool/sandbox/environment generations. Policy has a
non-negative warm target, positive maximum and bounded claim deadline; warm target cannot
exceed maximum. A base is credential-free and never assigned, with exact compatibility and
inspection digests. SDK parsing cannot attest actual virgin state. Agent owns pool admission,
exclusive claims/refill and generation retention; Deployment inspects and destroys resources.

`reserve` binds a request/assignment/lease, scope, fresh authority, actual manager and expected
worker processes, compatibility, fence and expiry. `reservation` acknowledges a caller-owned
sandbox and actual runner/provider generations. Caller authentication, live authority and
atomic one-use custody must precede publication. A lost reply still requires verified cleanup.

`dispatch` binds the reservation, exact lease, Agent definition, selected profile, environment
and bounded harmless input. `CapacityProtocolBinding.assertDispatch(input, reservation, now)`
rejects substituted IDs, scope, authority, generations, compatibility, fence and expiry. The
profile must belong to the definition and reference the supplied environment. Structural
equality is not artifact admission or live permission; owners validate parameter semantics,
accepted package hashes and authority independently before dispatch and result publication.

`CapacityWorkerClient` exposes ready/reserve/dispatch/cancel with abort signals and final
host-backed `CapacityResult`. `CapacityRunnerClient` exposes ready/run/cancel and a runner
outcome with no cleanup assertion. Only the worker can publish verified destruction. Runner
output uses the same bound as final output, so a successful guest result can be represented
without truncation in the final receipt. A process restart must freshly acknowledge readiness.

Documentation precedes built portable Node acceptance and binding/unit cases. Complete SDK
checks/build/tiers, real archive and declaration consumers, and exact-head owner CI qualify the
combined closure. Genuine Kata/identity acceptance is still required in owners. Work/model
execution stays Task 10; all issues remain open and review candidates target cordis.
