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
Inherited `.agents` upstream resources and generated `dist`/`vendor` archives are excluded.
See [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).

Private `0.0.0-cordis.1` candidates are packed without lifecycle scripts. Consumer `vendor/`
archives contain the exact generated package bytes, with source commit and SHA256 in
`package.json` and installation integrity in `bun.lock`. Consumers use public package exports,
never sibling source. These are review candidates, with no registry publication or production
release. Migration PRs target `cordis`; issues remain open until authorized release.
