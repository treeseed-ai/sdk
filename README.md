# Cordis SDK contracts

The SDK defines executable portable schemas and seven operation bindings. There is no transport,
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
credentialReferences (named reference URIs only), and a pinned local release source. Plan artifacts are discriminated package/archive or OCI-image identities; generated `dist/contract.json` includes the configuration, release, recipe and plugin declaration schemas.
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

Saved plans include the validated restricted recipe and selected plugin bindings, so ports, volume mounts, credential slots and injection edges can be reviewed without reopening a bundle. These declarations contain no plaintext credentials and authorize no execution.

## Task 3A: native composition contract

Implementation work is authorized in #455, from the approved Platform architecture at
8974d196318d542eb795f15eaa54150fbd9e08fd. This section specifies the intended new behavior;
verification evidence is recorded separately. Package candidate advances to 0.0.0-cordis.3;
the generated contract advances to **0.3.0-cordis.1**, retaining the seven operation IDs.
Existing format-1 release/plugin planning metadata remains 0.2.0-cordis.1: it does not become
an executable provider declaration or gain activation authority.

Portable exports add CapabilityToken, ProviderSchemas and inferred declaration/selection types.
A capability token has a stable service ID, contract version and executable adapter validator.
The explicit `@treeseed-cordis/sdk/runtime` export owns CordisComposition, CompositionHandle,
CordisServiceLocator, ProviderLease and InstalledProviderLoader. Portable imports start no
context. Runtime helpers use **cordis@4.0.0-rc.12**, exact registry SRI in bun.lock and published
gitHead 01b396240ce47cf2779c40af9bc445bb748fe112, rather than pretending the earlier inspected
35fdc969 source candidate is the published artifact. Optional Cordis loader/include peers are
not installed or needed for this bounded native-class composition. Qualify the actual bytes.

`CordisComposition.start(descriptor, trustedContext)` validates all provider metadata,
selections, configurations, contracts and dependency edges before mounting native class
plugins. A registration contains its CapabilityToken, declaration, class export, executable
configuration schema and configuration. Declarations bind provider/plugin/capability IDs,
contract version, target and native provide/inject fields. Selections bind one provider per
capability and explicit scope. Accepted JSON configuration is copied independently of the caller before validation/mounting;
caller mutation cannot change a generation's provider configuration. Descriptor identity also binds each provider's supplied
artifact identity; bundled sources and verified external package identities are distinguished.
`CompositionHandle.mount(ConsumerClass, configuration)` uses native Cordis; `locator(context)`
requires an actual dependent plugin context in that root. No unrestricted root lookup or
second service-instance map is permitted. `acquire(token)` yields a generation-pinned lease;
its value validates the adapter and checks lifetime on property/method use. `release()` and
root disposal fence subsequent calls. `describe(token)` reports safe identities and selection.
Native effects own disposal; captured lifecycle errors fail completion rather than leaking
raw plugin errors or allowing false success. Live transitions are not implemented in Task 3A.

The trusted context identifies scope, target, principal and resource scope; the runtime never
accepts a forged context through ordinary configuration fields. Separate roots isolate service
instances. A token/selection mismatch, absent/duplicate provider, injection cycle, invalid config
or incompatible class declaration raises a safe CompositionError before activation.

The loader reads an explicitly supplied prepared manifest whose SHA-256 is pinned by its caller.
Version 1 binds contractVersion, target, scopeId, providerId, package identity, entrypoint,
configuration and a complete sorted list of relative file paths/SHA-256 identities. Package
metadata must match the requested capability token and contract before any entry module import. The
manifest directory is its package root, named by the pinned manifest SHA-256 so a new
generation cannot reuse a cached module URL. It must be owned/private, contain no symlinks or
extra files, and have only immutable regular package files. Declared dependencies and required
peers must resolve to compatible packages inside this tree; optional peers may be absent.
Exact semver@7.8.5 validates ranges; no package manager runs. Entry and ordinary ESM dependencies
resolve within that verified tree using the native runtime module resolver. Verify before
imports and read back afterward; same-user/root malicious mutation and trusted plugin code
are outside a filesystem-sandbox claim. Dynamic import is permitted only in this reviewed
loader method, through a verified handle; source policy rejects arbitrary computed imports
elsewhere. Manifest parsing rejects malformed/duplicate JSON and prohibited paths. No
package extraction, scripts, downloads, persistent registry, plan changes or installer occur.

Prepared plugins may import the exact qualified Cordis library through their package closure;
compatibility is native Context recognition, root/service/registry identity and declared
injection, not a misleading class-name check. No provider may construct a competing root or
resolve a different framework version. Built-program fixtures prove the shared native graph
and ordinary helper dependency behavior without an external Node/Bun installation.

The reserved native service `cordis.composition` exposes the current CompositionHandle inside
its own root. Consumers declare that injection and call
`CordisServiceLocator.from(context)`; this resolves the handle through Cordis itself and
returns the scoped locator. Plugins cannot register or select a provider for that reserved
kernel service. This avoids any global handle map or caller-created resolver and preserves
native dependency lifetimes. Stream emission after CLI root disposal is an integrated
presentation invariant: render through the selected output provider, verify cleanup, then emit.

## Task 3B: Portable installed composition contracts

InstalledSchemas owns explicit format-2 service declarations, plans, journal records and fixed worker requests/responses. Native ProviderSchemas remains 0.3.0-cordis.1; historical format-1 schemas remain unchanged. The generated operation contract advances to 0.4.0-cordis.1 with the same seven IDs. Application acceptance is distinct from readiness. All private state binds installation, engine, owner and expected generation. ProjectTooling is available as a public development command; it never runs package scripts.

Task 3B is authorized after the maintainer reviewed the isolated setup. Tracking: #457. Detailed integration plan: https://github.com/treeseed-ai/platform/blob/cordis/docs/superpowers/plans/2026-10-24-task3b-installed-composition.md. Implementation evidence is recorded separately; these requirements are not a passing-test claim.

Development: Bun 1.4.4, Node 24.19.0, TypeScript 5.9.3, native Cordis 4.0.0-rc.12. Run bun run verify (semantic class/source check, strict compiler, build and nonempty unit/integration/program smoke). Installed acceptance uses genuine exact package/OCI bytes, real identity/database/API/HTTPS and explicit isolated certificate trust. No global trust mutation or legacy service changes. All handwritten source, tools and tests are strict TypeScript classes.

All capabilities that can be plugins, including container services, are native Cordis class plugins with typed swappable contracts. No parallel DI graph. Keep independent repository/public package boundaries, exact archive pins and original licenses. Migration PRs target cordis with Part of issue references. All issues remain open until authorized release; installer/Agent/generalized recovery are later tasks.

Container definitions are generated from owning native class declarations. InstalledSchemas.definition binds bounded container argv, non-secret environment, named-volume/secret targets, private slot projections and readiness predicates. Installed service selections carry that exact definition, and composition binds the Admin browser asset digest. Deployment supplies generic accepted-declaration execution; service configuration remains in its owner. Historical format-1 recipes still reject these new fields.

Format-2 locked closure qualification permits absent optional peers only when archive metadata and lock optionalPeers agree; optional runtime dependencies remain unsupported. Format-1 verification retains its original refusal. This accommodates the qualified Cordis package's unused optional loader/include peers without acquiring or executing them.

## Task 3C: extensible service contracts

Contract projection `0.5.0-cordis.1` retains the seven operations and historical format-1/2
readers. `ServiceSchemas` adds a format-3 graph of named service instances, typed bindings,
dependency ports, container definitions, probe exports, transition policies and resources.
A profile lists required binding IDs; it does not impose a fixed four-role catalog. Missing,
duplicate, incompatible and cyclic bindings fail validation. Exact provider references bind
package/version/SHA-256, entry, class export and deployment contract 0.4. Graph limits are
explicit. `ProviderV4Schemas` adds browser targets and manifest-2 named exports.
`@treeseed-cordis/sdk/portable` exports these schemas without Node built-ins. Implementation
and container activation remain owner responsibilities; a valid graph makes no active claim.
Part of #460 and treeseed-ai/platform#726. All issues remain open until release.

Portable native composition is exposed through `@treeseed-cordis/sdk/composition`. It uses
Cordis class plugins, native injection/effects and typed leases in browser and Node scopes.
Normalized configuration defaults participate in generation identity; the original accepted
input reaches Cordis exactly once so transforms are not replayed. The Node-only `/runtime`
loader continues to verify private prepared archives and delegates mounting to that same
composition implementation. Semantic tooling accepts class TSX and continues to reject
functional components/hooks and handwritten JavaScript.
Every visual component must be mobile-first from 320 CSS pixels to widescreen monitors; test 320/375/768/1024/1440/1920/2560 widths, long content, keyboard/touch and 200% text resizing. Keep authored controls at least 44×44 CSS pixels, required actions visible, logical/fluid dimensions and no page overflow (labeled local semantic-table overflow is permitted). UI owns components/styles/renderers; consumers retain domain behavior and Identity retains Keycloak authority.

## Task 3C package management data

`PluginSource.parse(locator)` accepts the bounded documented NPM name/version/range/tag grammar or an HTTPS Git repository with optional `#ref`. It rejects URL credentials, aliases, local paths, alternate Git transports, query strings and ambiguous control/option forms. This is syntax/canonicalization, not resolution or trust. Deployment resolves through pinned standard tooling and records exact bytes/commit/tree before activation. The supported forms follow the [NPM package-spec documentation](https://docs.npmjs.com/cli/v11/using-npm/package-spec/); the broader NPM shorthand/alias/tarball surface is deliberately outside this contract.

`PluginManagementSchemas` defines strict install/select requests, exact source receipts, package descriptors and install results. Requests require a caller-visible idempotency key; a CLI may generate one for a new invocation. Trusted authority and grants are not fields clients can assert. Deployment fills and persists the initial expected generation before any source action and never recomputes it for the same key. Unknown/ambiguous target selection cannot be reported active. Results distinguish active/already-active/prepared/pending/blocked/recovery-required, with null identities before resolution and no fabricated installation references. Only exact acknowledged active generations may return active/already-active.

A version-4 package descriptor binds each exported native declaration to its package entry, class export, configuration-schema projection, replacement policy and optional bounded container/probe metadata. Owner build tooling derives it from the same native class declaration/Config used by actual construction. Immutable browser assets are separately inventoried. These are executable-code identity/compatibility claims; they do not authorize an unknown publisher or sandbox same-process code. SDK adds no installer transport or eighth operation. Historical planning/installed/provider formats remain unchanged.
