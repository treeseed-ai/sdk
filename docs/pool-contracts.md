# Virgin warm-pool contracts

SDK #488 supplies portable `PoolSchemas` and inferred `PoolCompatibility`, `PoolPolicy`,
`PoolResourceShape` and `VirginSandbox` types through the root and portable exports.
The schema version is `1.0.0-cordis.1`; the seven global operation IDs and projection
version remain unchanged. This follows the approved seed-driven Agent design.

Compatibility binds the exact Kata runtime version/archive hash, native Linux/amd64
image manifest, CPU/memory/scratch shape, offline or explicitly granted TCP destinations,
isolation-policy hash and worker/runner/pool/sandbox/environment generations. The image
reference must select its manifest. Missing or incompatible fields fail validation.

Policy requires a nonnegative warm target, positive maximum and bounded claim deadline;
the target cannot exceed the maximum. A virgin-base record binds its identity,
compatibility and inspection hashes with `credentials: absent` and `assigned: false`.
Shape validation cannot prove actual isolation, virgin state, resource limits or custody.
Agent owns admission, atomic one-use claims, refill, quarantine and retained generations;
Deployment supplies authenticated bounded host inspection and verified destruction.
No credential creation, container start, setup, model or Work execution occurs here.

## Delivery and verification

Documentation precedes built portable Node acceptance, then implementation. Preserve
all accepted activity/environment/capacity suites. Complete owner verify/build/four tiers,
script-free archive consumption and emitted-declaration checks qualify this SDK slice.
Runtime pool/setup/egress remain separate owner gates. The public program tests valid
compatibility and policy, invalid bounds/image/generations, and non-virgin records.
New methods obey the canonical twenty-line rule. Keep all issues open; target cordis.
