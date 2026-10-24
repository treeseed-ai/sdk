# Cordis SDK contracts

Task 1 defines executable portable schemas and seven operation bindings. There is no transport,
remote client, server dispatcher, authorization implementation or plugin runtime yet.
`OperationDefinition.define(definition)` returns a typed binding with `parseInput` and
`parseOutput`; metadata declares ID, scope, effect, REST, CLI and MCP exposure and mutation
policy. Non-strict or non-object schemas fail definition validation. Success/failure
envelopes require matching null/non-null problems. `PlatformOperations.all` is the sole seven-binding catalog; duplicate IDs/routes/tool
names and inconsistent write/idempotency policy are rejected. `PlatformSchemas` owns schemas.
Types are inferred from [strict Zod objects](https://zod.dev/api?id=objects).
`ContractProjection.generate()` projects every binding to JSON Schema and metadata;
`dist/contract.json` is generated from that source with a SHA256 digest, not a second schema.
See [Zod JSON Schema](https://zod.dev/json-schema).

| ID | Input | Output | Effect / scope | REST |
| --- | --- | --- | --- | --- |
| platform.describe | empty | contractVersion, platformVersion, schemaDigest, plugins, operations | read / platform.read | GET /v1/platform |
| platform.status | empty | installationId, engine, desiredComposition, activeComposition, ready, plugins, blockers, applicationId | read / platform.read | GET /v1/platform/status |
| platform.plan | desired configuration | id, digest, expectedComposition, artifacts, effects, blockers | write / platform.manage | POST /v1/platform/plans |
| platform.apply | planId, digest | id, accepted | write / platform.manage | POST /v1/platform/applications |
| platform.applications.get | id | id, phase, desiredComposition, activeComposition, result, recovery, historyReference | read / platform.read | GET /v1/platform/applications/{id} |
| platform.applications.events | id, cursor?, limit? | events, nextCursor | read / platform.read | GET /v1/platform/applications/{id}/events |
| platform.applications.cancel | id, expectedState | id, cancellationRequested, phase | write / platform.manage | POST /v1/platform/applications/{id}/cancel |

All objects are strict, required strings nonempty, SHA256 digests 64 lowercase hexadecimal,
event limits integers 1–1000, ports integers 1–65535. Trusted principal/context never appears
in user input. Write bindings require idempotency and expected-state metadata; request headers
carry those policies, not trusted body fields. Plan persists a private plan, so is a write.
Desired configuration: installationId, engineContext, installationDirectory, loopback HTTP(S)
origin, runtimeState (`running`/`stopped`), plugins (id, package, version, integrity),
credentialReferences (reference URIs only). Artifacts have package, version, integrity.
Plugin status has id, ready; blockers have code, message. Application phases are
resolve, validate, stage, prepare, drain, activate, readiness, commit, completed, failed, cancelled.
Events have sequence, cursor, phase, message; application result/recovery/historyReference
are nullable nonempty strings. Composition identities and nextCursor are nullable SHA256
and nullable nonempty string respectively. No wildcard public result records.

Doctor configuration/report and CLI envelope are local contracts, never an eighth remote
operation. Report: ready; host (os, architecture, distribution, release); engine (context,
endpoint, serverVersion, serverArchitecture, composeVersion, cpus, memoryBytes; nullable when
unavailable); installation (path, exists, freeBytes); port; checks (id, status, code, message).
CLI envelope: command, success, result (identity/help/diagnostic or null), problem (code,
title, detail or null), blockers and references (string references). Success has no problem;
failure has a problem. Contract version is `0.1.0-cordis.1`.

Legacy ownership: SDK operator-contracts/control-plane-operations and control-plane-client
remain in this repository. This slice replaces only contracts; remote transport is deferred.

## Development and candidate delivery

Use Bun 1.4.4, TypeScript 5.9.3, Zod 4.6.7 and Node 24.19.0 for portability qualification.
Run `bun install --frozen-lockfile`, `bun run check`, `bun run build`, then
`bun run test:unit`, `bun run test:integration`, `bun run test:smoke`.
`bun run verify` runs all of these in order. No empty suites or skipped targets count as qualification.
The first executable target is Ubuntu 26.04 x64 with a local Linux/amd64 Docker engine.
Other operating systems/architectures remain unqualified. Cordis upstream candidate:
`35fdc969e4b6c48c48ed44717c7a018324e4dd88`; this slice does not mount a Cordis host.

The SDK's `SourcePolicy` development export checks the actual TypeScript AST and strict
compiler diagnostics before every build. Handwritten JavaScript, standalone functions,
function expressions/arrows, object method bags and source imports escaping the owner
are rejected. Class methods, interfaces and declarative data/schemas are supported.
Only root-level inherited `.agents` resources, dependency directories and generated `dist`/`vendor` archives are excluded. Nested directories with those names remain subject to source policy. Static, dynamic and require-style imports must use literal package/builtin or owner-contained paths; computed imports cannot establish an owner boundary. Builds replace generated `dist` only after source and type validation, so removed modules cannot survive in a candidate archive.
See [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).

Private `0.0.0-cordis.1` candidates are packed without lifecycle scripts. Consumer `vendor/`
archives contain the exact generated package bytes, with source commit and SHA256 in
`package.json` and installation integrity in `bun.lock`. Consumers use public package exports,
never sibling source. These are review candidates, with no registry publication or production
release. Migration PRs target `cordis`; issues remain open until authorized release.

## Task 2: non-activating plans

`trsd platform plan --file CONFIG [--json]` validates an explicitly prepared local release bundle. It never downloads, installs packages, imports plugin code, runs scripts, binds ports, loads images, creates credentials or starts containers. Apply remains unsupported. Successful plans describe future effects, not an active or healthy installation.

Configuration retains installationId, engineContext, installationDirectory (absolute), origin (loopback), runtimeState, plugins (exact id/package/version/archive SHA-256) and credentialReferences (unique `secret://<slot>` values). Add `release: {directory: ABSOLUTE_PATH, manifestDigest: SHA256}`. The installation and bundle must be disjoint. JSON object keys and semantic sets normalize deterministically; artifact byte identities remain exact.

The SDK release inventory version 1 binds `packageJson`, `lockfile`, and `recipe` descriptors `{path,sha256}`, requiredPluginIds/requiredServices, package entries `{name,version,path,sha256}` and image entries `{id,reference,layout,indexSha256,manifestDigest}`. All paths inside the inventory are relative and contained without symlinks. Image references are digest-only and match the selected OCI manifest. Package archives exactly cover the flat locked runtime closure; Bun v2 registry and local tarball records are accepted, without resolving versions or contacting a registry. Unsupported lock forms fail closed. Selected plugin package metadata is produced from the SDK PluginDefinition declaration also used for class static provide/inject fields.

The recipe is a restricted Compose JSON object with services/volumes/secrets. Service fields: image, depends_on (names), ports (long-form target/published/host_ip/protocol tcp), volumes (type volume/source/target/read_only) and secrets (names). Exactly one published port matches origin; localhost maps to 127.0.0.1, IPv6 literals to ::1. Volume declarations are empty local objects; secret declarations are `{file: '.cordis/credentials/<slot>'}` and match configuration references bijectively. No command/entrypoint/environment/build/include/interpolation/host mount/custom network/privileged/external/hook fields. Named resources derive from `cordis-` plus the first 16 hex SHA-256 characters of canonical `{installationId,installationDirectory}`.

Deployment validates native Ubuntu 26.04 x64, local Docker Linux amd64 context/endpoint/daemon identity, capacity, ownership and ports. Port checks read Linux TCP tables without binding. Existing project containers/networks/volumes block; planning adopts no runtime. Only fresh/empty owned installation directories or valid owner-private plan-only state are accepted.

Plans bind normalized configuration, configuration/release/lock/recipe digests, expected engine, expectedComposition null, exact package/image artifacts and typed future effects. No timestamps or volatile capacity samples enter the digest. ID is `plan-<digest>`. Only unblocked plans are persisted under installation/.cordis (0700 directories, 0600 records), with no-overwrite atomic publication and verified read-back. Descriptor-anchored access rejects symlinks and unsafe ownership/permissions. Repetition revalidates inputs before byte-identical reuse. Interrupted/foreign/malformed state blocks; no automatic adoption or repair. Stored read-back does not require the source bundle, and grants no permission to apply.

CLI exits: 0 verified saved plan; 1 sanitized runtime/I/O failure; 2 invalid arguments/JSON/schema; 3 prerequisites/artifact/authority/state blockers. Blocked responses have result null, structured blockers and no saved reference. Never echo invalid input, archive content, credentials or engine stderr. SDK PlanningBlockedError carries only validated safe blockers. Seven remote operation IDs remain unchanged; platform.plan stays a write operation because saving a plan needs local ownership.

Verification: documentation first; outside-in built-program failure before implementation; exact read-back/modes/determinism; immutable/architecture/graph/recipe/secret/path/journal negative cases; no-runtime snapshots; actual default construction; all owner check/build/unit/integration/smoke gates plus assembled acceptance. Test fixtures are not a production application composition. CI must run a positive plan on ubuntu-26.04 and fail visibly if prerequisites are absent. No container starts, even in tests.

Tracked in #453; parent integration treeseed-ai/platform#697. Issues remain open until authorized release.
