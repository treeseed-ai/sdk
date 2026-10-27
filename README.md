# Cordis SDK contracts

## Accepted service observation context

Task 3C adds portable `ServiceSchemas.runtimeContent`, `runtimeBinding`, `observationIdentity`
and `observationContext`, with inferred types. Content evidence binds the actual runtime package
closure and entry digests. A host runtime binding additionally identifies the selected OCI manifest;
the service does not claim to rediscover its image manifest from inside a container.

`ServiceObservationContext` contains `formatVersion:1`, an `identity` (installation/service IDs,
accepted composition/service generations, loopback origin, asset digest and nullable runtime
binding), and explicitly declared `dependencies` (port/binding/contract, accepted identity and
endpoint map). Dependency ports are unique and every identity shares the installation, accepted
composition, origin and asset scope. It contains no credentials, private paths, process authority,
health samples or readiness claim. Endpoints contain no userinfo, query, fragments or secret refs.

`ProbeContext.observation` is optional for source compatibility with existing provider contracts;
new host probes that need accepted membership require and validate it. Hosts freeze its nested
metadata before providing it. The existing `expected` fields and provider contract remain intact.
`ServiceRuntimeEvidence.content` optionally carries measured package-set/entry digests; new API
qualification requires that evidence and compares it against the host's exact runtime binding.

Private worker protocol 3 adds readonly `observation.context` with a validated `serviceId`. Its
response is accepted membership data, never overall worker readiness or permission to mutate.
This lets an installed API produce leaf generation evidence without recursively querying worker
readiness. The Deployment host must independently bind actual resources/image identity; an echoed
generation or image label does not prove runtime content. Public operation IDs remain the same
seven, and historical worker protocols/readers are unchanged.

`ServicePlan.runtimeBindings` optionally records verified native runtime content/image bindings by
service ID. Every key must identify a selected service and its manifest must match that service's
digest-pinned recipe image. The owning resolver derives the complete map from the same verified
package closure and OCI configuration used during planning, and revalidates it before effects.
Source-free observation reads this accepted map, never infers proof from unqualified labels.
Absence remains absence when reading earlier format-3 plans; no default field is injected into
their saved digest payload. External images without native package runtime declarations have no
binding. SDK schema admission is not a substitute for owner artifact/resource verification.

The SDK defines executable portable schemas, seven operation bindings, native Cordis composition
and verified prepared-provider loading. Network transports, authorization, source acquisition and
application readiness/durable publication remain in their capability owners.
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

## Task 3C service journal boundary

Format-3 plans distinguish the desired `compositionGeneration` from the plan digest (which also binds expected prior state), each `serviceGeneration`, and stable resource IDs. Retention references identify immutable private receipts; planning does not read secret values. A resource receipt records its creating generation and referenced compositions, actual ownership/identity and optional exact format-2 origin. It cannot silently adopt a foreign resource. Format-3 application records bind the plan, expected composition, resource-set digest and target acknowledgements. Active/ready completion requires observed target generations; all seven public operation IDs remain unchanged.

`ServiceWorkerSchemas` defines the new private protocol-3 submit/status/application and local plugin-management requests. It does not add an installer REST/MCP endpoint. Historical protocol/receipt/plan formats remain strict and separate; old readers reject the new format. Migration records require exact old receipt/composition, non-serving and compatibility proof identities. The owner must produce/verify those proofs under its single writer before conversion; a schema alone is not authorization or migration implementation.

A package may declare digest-pinned OCI archives as image sources. Source acquisition verifies the archive and OCI closure before emitting a local format-3 release; apply never pulls. Missing source/trust/build/selection requirements remain explicit. An unapproved image origin cannot acquire authority through metadata.

The service-generation CLI envelope accepts historical plan formats 1/2 and format 3 plans,
service status and application read-back. Failed envelopes carry `result: null`, a safe problem,
structured blockers and references; transport success never proves plugin activation. Local worker
protocol 3 failure responses distinguish expected blockers from unexpected runtime failures so
callers preserve exit codes 3 and 1. Protocol 2 readers remain unchanged.

Each provided binding carries its owner-declared `port` separately from its composition-wide
`bindingId`. Two ports may advertise the same contract without becoming ambiguous; consumers
select one exact binding. Readiness explicitly declares `scheme` (`http` by default, `https`
or `tcp`) and must match the chosen probe's advertised schemes.

## Bounded native scope replacement

`CordisScope` uses the native composition/locator and holds no provider-instance registry.
Admission closes before draining held leases; a bounded drain may return pending without
replacing the old provider. Callers hold leases for the full duration of their operation.
After drain, old effects dispose before the candidate mounts. Candidate inspection is private
to the owner; admission reopens only after the owner verifies workload read-back and durable
publication, releases inspection leases, then calls `commitReplacement()`. Mounting alone is
not an application-health claim. Constructor/disposal failures fence admission for explicit
repair. Shutdown cancels replacement and awaits cleanup; no new candidate may survive it.
Unknown native configuration failures are sanitized before returning to a caller.

## Instance-neutral owner projections

Container package declarations describe dependency **ports**, not another instance's name.
`ServiceProjectionSchemas` distinguishes the owner declaration from its resolved service graph:
non-secret environment values may refer to a declared dependency endpoint or host context;
credential grants refer to a dependency port and local slot. Deployment resolves these through
the graph's exact bindings and verifies the complete result before planning. A class receives
only its resolved `service.context` and scoped engine, so one class can serve different instance
IDs without a role catalog. A selected dependency does not itself grant credential access.

Private slot templates support explicit `$secret`, `$endpoint`, `$context` and `$template`
markers. Secret markers identify an own slot or an explicitly granted dependency-port slot;
planning resolves references without reading values. Endpoint markers select the declared
port and URL/host/port/authority part. Context markers select bounded installation/origin/owner
or asset identity data. Unknown markers, undeclared ports/grants and cycles fail in Deployment.
No declaration supplies raw trusted principal or account grants. Optional `user` selects image
default or installation owner; a worker-socket consumer must use the owner identity.

`SourceToolSchemas` is shared by package-management metadata and optional format-3 release/
plan helper inventory. A helper has exactly one source: a pinned HTTPS URL or a prepared local
bundle path, with archive SHA-256/size and complete per-file hashes/modes. Prepared helpers allow
release-managed standard Bun/Git programs without global installation. `stage-helper` is a
format-3 future effect only. Helper validation, staging and execution remain Deployment-owned;
SDK validates data and adds no source transport or operation ID. Optional additions preserve
historical plan bytes and format-1/2 readers.

Configuration projection discards arbitrary Zod metadata overrides so annotations cannot change
its validation meaning. Unrepresentable custom validation fails package metadata generation;
planning never imports a class to discover omitted predicates. The pinned Zod conversion and
its documented [metadata/override behavior](https://zod.dev/json-schema) are qualified with
native-validation/projection regression cases rather than assuming every projection is sound.

`$configuration: [key, ...]` selects a validated, default-normalized provider configuration
value for an owner-declared environment/private template. Paths are bounded safe key arrays;
missing values block instead of becoming implicit defaults. `$context: serviceId` names the
current instance. Neither marker can select trusted principal or other private host state.

### Release-built runtime images

A package can declare `runtimeImages` as `{id,entry}` associations for images assembled
from its exact locked runtime archive closure. The entry is an actual packaged file.
These associations contain no final image digest: package archives are produced first,
then images bind that closure and the selected asset generation; the exact release binds
the resulting OCI bytes. External images continue to use complete pinned descriptors in
`images`. The same image ID cannot appear in both forms or belong to multiple packages.
This prevents an archive/image hash cycle without weakening either final identity.

The SDK owner gate runs the built public composition and portable exports in real Firefox,
with no Node polyfills. It holds a provider lease across replacement, observes pending,
drains and inspects the mounted candidate before commit, and awaits native effect cleanup.
Ubuntu 26.04 CI installs the exact Playwright Firefox prerequisites and fails visibly if
those prerequisites are unavailable.

### Accepted probe context and runtime evidence

A `ProbeContext` binds the selected endpoint, deadline/cancellation, exact expected installation,
composition/service/asset generations, explicit credential references and own declared authority
IDs. `credential(reference)` and `authority(id)` are bounded host operations; a probe receives
no filesystem, Docker command or arbitrary service resolver. Service owners retain protocol
interpretation. The host still independently verifies resource/image identities.

`ServiceReadiness.acknowledgements` carries observed target acknowledgements; ready alone cannot
acknowledge an API/runtime generation. `ServiceSchemas.runtimeEvidence` binds actual target
installation/service/composition/runtime/asset identities for owner protocol read-back. Probes
must compare observed values to accepted context; mounting a provider does not create evidence.

External image declarations can use `source: {kind:'prepared'}` when the exact OCI image is
provided in the selected local release. Missing prepared bytes remain a blocker; source install
cannot invent a fetch location or claim activation. Downloadable immutable OCI archives retain
their existing complete URL/hash/size source. Both forms bind the same exact native manifest and
local selected index. This keeps curated initial bundles honest without placeholder image URLs.

Private worker protocol 3 also accepts `{operation:'plan',configuration}`. An installed host
serializes plan publication through its existing durable writer; local callers do not acquire a
second journal lock. This remains a private local control operation, with the existing public
`platform.plan` identity unchanged and no remote source-install endpoint.

### Explicit service restart scope

Task 3C format-3 apply options and private submit requests may include `restartServices`, a
nonempty unique set of exact service IDs. It authorizes only restart actions named by the exact
selected plan/digest. It grants no migration, removal, host-binary change or unrelated service
authority. Missing authorization leaves a changed existing service prepared/action-required.
Only the explicit reviewed apply action supplies this scope; plugin install cannot infer it.

Format-3 application records preserve that optional scope so request-digest/idempotency read-back
can verify the actual accepted intent. Owners sort semantic sets before persistence/hashing.
Absent fields stay absent, and format-1/2 readers/bytes remain unchanged. The public apply
operation gains the same optional scope without adding an operation ID; API transport activation
still requires its owning implementation and authorization. A schema alone activates nothing.

Generated JSON Schema declares the restart set's nonempty bound, service-ID pattern and
`uniqueItems: true`; runtime validation still checks uniqueness. The narrow metadata projection
uses [Zod's documented JSON Schema metadata](https://zod.dev/json-schema#metadata), and the
owner regression verifies the actual emitted operation schema.

### Explicit container instance intent

Plugin install may carry an optional `serviceId` and `bindings` map from declared dependency
port to exact installed binding ID. Plugin select may carry an optional `serviceId` for its
existing service scope. These fields belong only to `scope: installation`, `target: deployment`;
they never select all instances or grant another scope. Keep provider configuration separate.
An owner must reject ambiguous/missing bindings before effects and must not replace an existing
selection merely because a new alternative was registered. The same package can back two
explicit service IDs; retry identity includes that instance/binding intent.

Absent fields preserve historical request bytes. The CLI may infer deployment target from its
explicit service/binding flags; machine callers supply it explicitly. Bare installation remains
subject to unique target/provider/dependency resolution in the owning manager. These data
contracts do not implement acquisition or activation. Generated JSON Schema carries the same
conditional scope/target rule; the runtime independently validates it.

The explicit dependency-binding map is bounded to 256 declared ports, matching the service graph
boundary; generated JSON Schema includes the same `maxProperties` limit.

### Accepted source and isolated-build policy

Optional format-3 `acquisitionPolicy` binds source authorization as data in the exact accepted
release/plan. An absent policy authorizes no managed source installation. `SourceAcquisitionSchemas`
defines explicit NPM registry/package/target grants and HTTPS Git origin/package/target grants,
optional hash-pinned public CA files, the approved helper-release identity, and exact source-only
build policies. Unknown publishers/origins/targets remain blocked/prepared before package imports;
a package hash alone is never publisher approval. Updating policy requires a reviewed exact bundle
and explicit plan/apply, rather than a plugin changing its own grants.

A source-only Git build policy binds origin, exact commit, recipe entry/hash, package output
directory, digest-pinned build image, helper-release identity, deadline and `network: none`.
Policy IDs identify exact canonical build definitions; Deployment independently checks their
hashes before execution. Package lifecycle fields do not authorize builds. No host paths,
credential environment, shell selection, networking switch or ambient build tools are policy
inputs. Disposable isolation executes only the explicitly accepted recipe; activation still
uses the normal verified local bundle and accepted plan, never a live build.

`acquisitionPolicy` is optional and absent fields remain absent in historical format-3 data.
The executable contract projection exposes the policy/build data and preserves the same seven
operation IDs and current provider/installed format versions. SDK provides schemas/types, not
acquisition, trust decisions, container execution or installation authority.

Optional `liveTransitions` approves exact previous/next package artifacts and provider IDs for
one capability/target/state version and qualification digest. A provider advertising `live`
without a matching accepted transition does not authorize replacement. Deployment must still
close admission, drain held native leases, verify cleanup/readiness and read back the target
before committing active. These records neither expand source grants nor promise transport-wide
hot replacement; unsupported target/safety boundaries remain prepared/action-required.

### Pending source acquisition

`plugin.install`/`plugin.select` can return `pending` while an accepted durable request is
acquiring helpers/source/build output and no deployment plan/application exists. The result
still carries its request ID; plan/application references are both null, active generation is
null and acknowledgements are empty. Artifact/plugin identity stays null until acquired.
Inspection derives this progress from the stored request; it does not fabricate an application.

Once apply is accepted, pending retains both actual plan and application references. A partial
reference pair is invalid. Neither pending form is a successful activation envelope or exit 0.
Active/already-active still requires exact artifact/target/generation/application evidence.
The worker protocol and seven public operation IDs remain unchanged.


## Bounded Agent composition contract

SDK #482 is the first Task 3D delivery slice. Public root and portable exports supply `AgentSchemas`, `AgentContractBinding` and safe `AgentContractError`; runtime composition remains the existing SDK Cordis API. Agent owns execution plugins; Deployment owns accepted-package installation; UI owns human presentation. This is a composition probe, with no real Work/model/sandbox execution or new Keycloak authority.

Protocol 1 request fields: operation `composition-probe`, executionId, scopeId, principalId, resourceScope, grantId, grantRevision (positive safe integer), expectedGeneration (64 lowercase hex), handlerId and text (0–1024 characters). IDs are 1–128 characters from the existing ASCII provider-key alphabet. All objects are strict; unknown model/credential/Work fields fail validation.

Trusted authority fields: scopeId, principalId, resourceScope, grantId, grantRevision and state `granted` or `revoked`. Hosts supply this binding separately; a request is never its own authority. `AgentContractBinding.assert(request, authority, generation)` parses both values, rejects revoked state and any mismatch, and returns a detached parsed request. This verifies binding equality only; the hosting owner must resolve and revalidate the actual grant at each execution seam. No OAuth or live revocation guarantee is implied by a portable data comparison.

Results repeat protocol, executionId, scopeId, principalId, resourceScope, grantId, grantRevision, generation and handlerId. State is completed/cancelled/blocked/recovery-required; output is bounded text or null; blockers have fixed safe code/message; cleanup is disposed/failed. Completed requires output, no blockers and disposed cleanup. All noncompleted states have null output. Cancelled has disposed cleanup. Failed cleanup requires recovery-required, and recovery-required requires failed cleanup plus a blocker. Blocked requires a blocker. Result schemas validate internal consistency; Agent separately binds every result to its admitted request.

Contract binding failures expose only `INVALID_AGENT_CONTRACT`, `AGENT_GRANT_REVOKED`, `AGENT_SCOPE_MISMATCH` or `STALE_AGENT_GENERATION`, with fixed messages. Underlying errors and request bytes are never included.

Generated projection advances to `0.6.0-cordis.1` and adds agentAuthority, agentExecutionRequest and agentExecutionResult. Existing seven operations, ProviderV4 format/version and installed package descriptors are unchanged. Package candidate advances to `0.0.0-cordis.17`; this is local migration candidate identity, not production publication.

Acceptance runs a Node program through the built public portable export. Unit cases pin scope/principal/resource/grant/revision, revocation, generation, payload bounds, unknown fields, safe errors and result consistency. Root and browser portable contracts must share the same schemas without Node runtime imports.

## Portable seed reconciliation contracts

Task 3D adds `SeedSchemas` and inferred `SeedBundle`, `SeedResource`, `SeedPlan`,
`SeedResourcePlan`, `SeedReceipt` and `SeedResourceReceipt` from the root and portable exports.
API owns reconciliation behavior and its journal; SDK contracts establish shape/binding, not
identity authority, plugin trust, filesystem custody or live readiness.

A `treeseed.seed-bundle/v4` has a namespaced name, positive integer version, SHA-256 digest,
capability requirements and resource declarations. Requirements identify the source locator,
provider, capability, target and compatible contract version. Resource declarations have unique
keys, extensible namespaced kinds, explicit schema identity/version/digest, required capability
IDs, dependency keys and owner-validated payload data. Reject duplicate identities, missing
requirements/dependencies, self-dependencies and cycles. The schema does not fix resource kinds
or activity types to a closed enum. Legacy v3 receipts are historical and not silently v4.

A `treeseed.seed-plan/v1` binds the bundle digest, project/profile/installation and trusted grant
references; exact resolved package/source closures; and each resource's selected provider,
configuration/desired digest, expected generation, previous record and future effects. The ID is
`seed-plan-<digest>`. Only unblocked complete plans are accepted. Exact artifacts, executable
validators and schema hashes are locked before apply; planning does not establish authority.

A `treeseed.seed-receipt/v1` binds its exact plan identity/digest and the expected resource plans.
Each resource receipt binds provider/artifact/desired digest, its owner record reference and
read-back state. Completed requires one verified matching receipt per planned resource, empty
blockers and matching observed digests. Partial, pending, blocked and recovery-required cannot
claim completion. Unknown protocol fields and fabricated identities fail strict validation.

`SeedResourceProvider` defines validate, plan, reconcile and readBack through typed data and a
trusted execution context with cancellation. Native Cordis supplies selected instances; no SDK
resource registry, reconciliation engine or service cache is introduced. `SeedContractBinding`
checks data identity only and raises fixed safe `SeedContractError` codes. The seven existing
platform operation IDs and bounded Agent probe contracts remain compatible. Generated contract
projections include the new seed schemas; the actual public portable Node consumer is the outer
acceptance gate.
