# Portable capacity contracts

Implementation contract under #488; verification evidence is separate. These contracts replace
the proposed Agent root inside Deployment's worker with separate manager, worker and guest
processes. They preserve the bounded composition probe and portable seed contracts. They do not
implement execution, authenticate a caller or establish sandbox isolation.

## Public surfaces and ownership

The root and portable SDK exports supply `ActivitySchemas`, `EnvironmentSchemas` and
`CapacitySchemas`, their inferred types and safe binding checks. Generated projections include
these separately versioned schemas. The seven existing platform operation IDs stay unchanged.

Agent owns definitions, profiles, manager/kernel, worker/pool policy, guest runner, handlers and
environment preparation. Deployment owns bounded runtime operations, artifact custody and
service installation. API owns seed reconciliation. Identity owns Keycloak integration and
existing authority protocols. No SDK catalogue stores plugin instances or schedules services.

Legacy SDK activity-profile types become open portable profile contracts in this same owner.
The Agent implementation consumes these public contracts; no legacy source import or transfer
of Agent runtime behavior into SDK is permitted.

## Profile capabilities, instances and effective profiles

A profile capability declares a namespaced extensible type ID, exact provider identity, parameter
schema identity/digest, required handler contracts, dependencies and orchestration semantics.
The identifiers planning, estimating, acting, reviewing, reporting and chat are core declarations,
not an exhaustive schema enum. An external accepted package can add a type without editing SDK
or Agent's core catalogue. Productive handlers for those six types remain Task 10.

A profile instance belongs to one Agent definition. It selects a capability revision, handler,
parameters and dependency instances. An effective profile binds that definition revision, exact
capability/handler/environment artifacts and intersected live permissions. Schema validation
checks graph and identity consistency; Agent separately resolves accepted providers, validates
parameters against their locked schemas and rechecks live authority before dispatch.

Reject unknown selected types, unavailable/incompatible handlers, invalid parameters, duplicate
IDs, missing dependencies and cycles before assignment. Unknown productive operations cannot be
disguised as harmless probes. Task 3D dispatch admits only explicitly qualified probe handlers.

## Environments and virgin pool compatibility

An environment binds an immutable package/image identity and explicit packaged setup and
verification entrypoints. Packaging resolves naming conventions/defaults into concrete manifest
entries; execution does not search for an ambient script. Entrypoints have exact relative paths,
hashes, arguments, deadlines and output limits. They run inside an assigned guest before its
handler, never through a host-side shell or Kata guest-agent hook.

Network policy defaults to offline. A requested destination must also be allowed by host policy
and the live assignment grant. A declaration is not an egress enforcement mechanism; Deployment
and the selected sandbox/network provider must enforce and qualify the effective policy.
Setup failure, timeout, cancellation or failed verification prevents handler execution and
requires cleanup. Credentials and setup output never enter reusable bases or machine errors.

`EnvironmentSchemas.definition` uses `treeseed.agent-environment/v1`, an ID/revision, exact
package identity, native Linux/amd64 image reference/manifest digest, `setup` and `verification`
entrypoints, and `network`. Each entrypoint has an inventory file descriptor, argument array,
deadline and output-byte limit. A network is `offline` with no destinations or `allow-list` with
unique exact TCP hostname/port destinations. Hostnames are canonical lower-case DNS names or
IPv4 literals; this first qualified contract does not admit wildcard or IPv6 destinations.
`EnvironmentNetwork.intersect` rejects any requested destination absent from either supplied
trusted policy. It is a data computation: callers must obtain host/assignment grants from live
authority, and the sandbox provider still enforces network isolation.

Pool compatibility binds the exact runtime, base image, CPU/memory/resource shape, isolation
policy and worker/pool/sandbox/environment provider generations. Capacity is policy-bounded,
without a fixed four-service or four-sandbox schema limit. Only clean, credential-free,
never-assigned sandboxes enter the warm pool. Claim is exclusive. Used sandboxes are destroyed
and verified, never reset into the pool. Affected old-generation unused bases are discarded;
in-flight assignments retain their original generation through cleanup.

## Fenced protocols and acknowledgements

Versioned capacity messages bind installation, capacity-provider identity, manager/worker/runner
generations, assignment/request/lease IDs and exact issuer, subject, team, provider and grant
identity/revision. Wall clocks do not become identity. A lease fence and expiry govern admission;
heartbeats and cancellation cannot resurrect a revoked or superseded lease.

Readiness requires acknowledgement from the actual current process generation. A saved active
record is not readiness. Results bind the admitted assignment, lease and generations; stale
results cannot be accepted. Completion requires successful bounded probe output and verified
guest destruction. Cancellation has no productive output. Failed destruction or lost custody
reports recovery-required and fences further dispatch, never success.

The first wire contracts use `treeseed.capacity-lease/v1`,
`treeseed.capacity-readiness/v1` and `treeseed.capacity-result/v1`. A scope binds installation
identity/directory, capacity provider, project/platform profile and worker. Authority carries
issuer, subject, team, provider, credential/grant identities and revisions, granted capability
IDs, state and expiry; it carries no token or private credential. Each manager/worker/runner
identity has both a composition generation and a process generation. Process generations change
on startup; deterministic artifact/configuration identities alone cannot acknowledge a live
target. Pool/sandbox/environment provider generations remain explicit.

The admitted lease binds scope, live authority, generations, lease/assignment/sandbox IDs,
compatibility digest, positive fence and expiry bounded by authority expiry. A trusted owner
expectation supplies those exact values; ordinary request fields cannot construct it. Results
repeat the admitted lease and a sandbox cleanup receipt. Completed requires bounded probe output,
no blockers and destruction inspection evidence. Other states have null output; failed cleanup
requires recovery-required. Fixed safe blockers reject arbitrary provider exception text.
Read-back of a historical receipt is distinct from admitting a new expired lease.

Public manager/worker/sandbox/runner client interfaces carry only versioned data across process
boundaries. Each process owns a native Cordis root. The worker receives a service-scoped bounded
Deployment control endpoint, never the read-only observer endpoint as a mutation backdoor and
never raw Docker/containerd sockets. Worker/sandbox-provider replacement requires explicit restart
unless an exact transition has separately passed qualification.

## Verification

Capability ID sets normalize to lexical order without changing their array type. The first
`bun run build` projection attempt with Zod 4.6.7, TypeScript 5.9.3 and Bun 1.4.4 failed with
`Transforms cannot be represented in JSON Schema` when that field used `.transform()`. The
same pinned build uses Zod's type-preserving
[`.overwrite()`](https://zod.dev/v4#overwrite) for normalization. No optional Zod plugins or
unrepresentable-as-any fallback are used. Graph, identity and lifecycle refinements still require
the executable SDK validators; generated JSON Schema alone cannot prove those invariants.

Outside-in built public Node consumers precede implementation. Contract suites cover external
profile types, graph/parameter/handler rejection, generation and authority substitutions,
offline defaults, entrypoint tampering and truthful cleanup states. All four permanent test tiers,
strict checks/build, genuine archive consumers and owner CI remain required. Real Kata and
isolated Keycloak/control-plane acceptance belong to the assembled owner implementation; schema
tests cannot replace them. All issues stay open, and no production publication or merge is
authorized by this contract work.
