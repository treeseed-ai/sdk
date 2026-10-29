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

## Separate service-channel envelopes

`CapacityChannelSchemas` is a separately versioned `treeseed.capacity-channel/v1` wire
family. It wraps existing capacity data for authenticated worker and guest transports;
it does not add global platform operation IDs or create a second plugin system.

Each request binds a request ID, full capacity installation/project/profile/worker scope,
role (`manager`, `worker` or `runner`), operation and expected process/composition generation. Only
`ready` may use a null expected generation to discover the authenticated process. Worker
operations are ready/reserve/dispatch/cancel; runner operations are ready/run/cancel.
The manager role admits only ready. It cannot reserve, dispatch, run or cancel through this
channel. This additive contract is version `1.1.0-cordis.1`, retaining the v1 wire envelope.
Manager readiness uses the existing manager readiness schema and the same exact scope, request,
composition/process identity and safe-blocker checks. It does not claim enrollment, worker
availability, authority or completed work. Seven global platform operation IDs remain unchanged.
Parameters contain the existing SDK reserve, dispatch or lease contract, never arbitrary
commands, host paths, provider configuration or model execution. Productive Work stays Task 10.

Admission validates the envelope against the trusted server scope, role and actual generation,
then binds the embedded scope/generation. A reserve request's expected worker is the actual
worker; dispatch/run/cancel bind the corresponding lease generation. Owner kernels must
independently check live authority, fences, expiry, profile selection, exclusive assignment and
result custody. A shape-valid message or ready reply establishes no identity authority.

Replies repeat the exact request ID/scope/role/operation and actual server generation. Success
results use existing readiness, reservation, capacity result or runner outcome schemas. Failures
contain only the fixed SDK capacity blocker and a null result. Reply binding validates nested
request, lease and process identities before acceptance; raw provider errors are forbidden.
Transport credentials, replay/idempotency journals, bounded framing, cancellation and private
endpoint custody remain owning implementations. Readiness discovery never authorizes a stale
subsequent operation. The client must use the returned actual generation in its next request.

Portable Node consumers validate cross-message scope, role, process and reply identities through
the binding methods. Generated JSON Schema projections preserve positive operation/result shapes
and exclude unknown host configuration; they do not independently compare separate messages.
This contract slice does not claim that separate programs or live capacity are installed.

## Host-mediated runner session

`SandboxRunnerSchemas` is a separately versioned `treeseed.sandbox-runner/v1` bridge. It does
not change the six sandbox lifecycle operations or the seven global platform operation IDs.
The host-mediated runner client exchanges one positive runner ready/run/cancel message for a
logical sandbox. No host path, executable arguments, image, script bytes or runtime socket is
accepted. Deployment owns transport, immutable runner staging and persistent guest sessions;
Agent owns the actual guest program, worker admission/pool and live authority orchestration.

An explicit private host grant binds exact service/provider generations and the full capacity
installation/project/profile/worker scope, a unique allowed runner-operation set and an expiry.
`SandboxRunnerBinding.assertRequest(input, grant, actualRunnerGeneration, now)` binds both
scopes, request IDs, logical sandbox and the actual guest process/composition generation.
Run/cancel also bind the embedded lease sandbox and cannot outlive the host grant.
`assertGrant(input, grant, now)` performs scope/operation/deadline admission before the host
starts or stages a guest; it does not qualify an actual guest generation. A ready request may discover the actual process
with a null expected generation. Grant data alone authenticates nobody; the host must verify
private credential/custody and fresh grant read-back before effects, then independently verify
its actual sandbox/assignment, immutable runtime and successful environment receipts.

Success wraps the existing runner response; host failures have null result and one fixed safe
sandbox problem code. Reply binding checks the host scope, request and sandbox and then the full
inner capacity-channel response, including nested scope/lease/generation. A valid outer reply
cannot hide a substituted inner request or outcome. The grant contains no bearer credential.
Planning does not start a session; installed runner readiness is not inferred from this schema.
Native roots, worker lease fencing, live Keycloak authority, bounded framing/replay/disposal,
physical destruction and real hosted Kata assembly remain owning implementation obligations.

Deliver this slice as portable schemas/types and generated projections first, with built Node,
integration projection and unit binding tests. It enables the actual guest-session provider;
it does not implement that provider or productive Work/models. All issues remain open.

## Exact standalone guest payload

`GuestRuntimeSchemas.manifest` owns the portable `treeseed.guest-runtime/v1` payload produced
by Agent and verified by Deployment. The qualified format selects Bun 1.4.4, Linux amd64 GNU
baseline, the GNU loader and the exact libc/loader/pthread/dl/m requirement list. It binds a gzip
stream in ordered individually hashed chunks, aggregate compressed identity and executable
identity/size/mode. No host path, command, lifecycle script or ambient runtime is described.

Each chunk is at most 7 MiB, the complete compressed stream at most 64 MiB and the expanded
executable at most 128 MiB with mode 0755. Names are exactly consecutive
`trsd-agent-guest.000.gzpart`, `001`, and so forth, with no duplicates, gaps, zero-length chunks
or partial intermediate chunks. The manifest has between one and sixteen parts and their sizes
sum exactly to the declared compressed size. Required libraries are an exact semantic set.

`GuestRuntimeBinding.assert(input)` checks those cross-field relationships with fixed safe errors;
generated schema carries portable structural bounds. Agent validates its generated manifest
through this contract. Deployment must independently verify every accepted archive/chunk byte,
reject unused runtime chunks, hash the complete compressed stream, bound decompression and verify
expanded bytes and ELF requirements before staging only inside the selected Kata sandbox.
Schema admission alone executes nothing, authenticates nobody and proves no running guest.
Existing host/guest generation bindings, immutable image selections, preparation receipts,
private custody and destruction remain required. All issues remain open; Work stays Task 10.

## Manager readiness delivery slice

The separate manager program needs a portable readiness envelope before its native root is
wired. Extend the positive ready request and append manager ready/failure responses, preserving
all existing worker/runner operations and the host-mediated runner subset. In particular, a
manager cancel is invalid rather than accidentally inheriting the worker/runner cancellation
contract. Ready discovery may omit expected generation; subsequent pinned requests must match
the actual manager process. A foreign worker/runner response or nested readiness generation
cannot satisfy a manager request. Safe failures have null result and fixed SDK blockers.

Deliver documentation, failing built portable manager acceptance, generated-schema integration
and isolated binding negatives, then implementation. Run all owner tiers/build, genuine public
Node/browser consumers and hosted CI. No transport, manager root, runtime activation, new global
operation ID or Work/model execution belongs in this SDK slice. All issues stay open.
