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

## Verified sandbox profiles

`SandboxProfileSchemas` and `SandboxProfileBinding` are portable exports beside the pool schemas.
A `treeseed.sandbox-profile/v1` record contains `id`, a canonical SHA-256 `revision`, exact
`runtime`, `image`, `resources`, `network` and `isolationPolicyDigest`. Reuse the pool/environment
field schemas. The image reference must select its manifest. No timestamps, filesystem paths,
credentials, measurements or unknown fields belong in this record.

`create(content)` validates the content, applies the existing offline network default, sorts the
semantic destination set and computes its revision. `assert(profile)` verifies that revision and
returns normalized detached data. `assertCompatible(profile, compatibility)` additionally requires
the pool's exact `hostProfile: {id, revision}` reference and matching runtime, image, resource,
network and isolation fields. Destination order does not change identity. Fixed
`SandboxProfileError` codes are `SANDBOX_PROFILE_INVALID` and `SANDBOX_PROFILE_MISMATCH`; private
input never becomes error text.

`PoolSchemas.compatibility.hostProfile` is optional for earlier declarations. Earlier pool
records remain readable, but cannot pass the new verified-profile admission helper without an
explicit reference. `SandboxControlSchemas.availability.profile` is likewise optional: unchanged
legacy host availability remains readable. An absent profile cannot authorize resource-bound pool
admission. Generated projections expose both profile and reference schemas. SDK candidate .40
retains the projection version and the same seven global platform operation IDs.

Deployment alone may advertise a profile after actually enforcing and qualifying the declared
resource/isolation boundary. A valid SDK record is no evidence of CPU, memory, scratch or egress
enforcement. Worker admission must also bind the selected host configuration digest, live grants
and actual provider/runner generations; this helper does not authenticate the host, acquire a
sandbox or create authority. Resource profiles do not replace definition-owned activity profiles
or execution environments. SDK owns this data contract; Deployment and Agent retain their runtime
responsibilities.

Delivery: documentation → built portable Node/projection acceptance and intended missing-binding
red → isolated contract controls → implementation → complete owner checks/build/tiers and genuine
script-free archive/public declaration consumer → exact-head CI/review. Preserve all earlier
contracts, methods' canonical twenty-line limits and every open issue. Physical resource-profile
qualification remains an explicit following owner gate; Work/model execution remains Task 10.

The three profile-binding operations are asynchronous and must be awaited. Canonical digest
verification uses the portable Web Crypto SHA-256 API, including in Node, Bun and browser
consumers. Plain JSON schemas validate shape and digest syntax; awaited `assert` and
`assertCompatible` recompute the canonical digest before accepting a record. No handwritten
hash algorithm or Node-only import enters the portable export. The existing real Firefox
qualification must exercise this binding while preserving its native replacement/disposal proof.
