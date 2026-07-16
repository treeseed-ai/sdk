# `@treeseed/sdk`

`@treeseed/sdk` is the main programmatic interface for Treeseed content, control-plane state, and graph-first AI context retrieval.

For most consumers, the right entrypoint is `AgentSdk`.

Use the SDK when you are writing automation, services, scripts, agents, or package internals that need Treeseed data, graph, workflow, config, reconciliation, hosting, package, or TreeDX integration primitives. Use the CLI when you want an operator command. Use Admin when you want a browser UI. Use API when you need the deployed backend service. Use UI when you need reusable components.

## How SDK Fits With Treeseed

The SDK is the shared platform substrate used by:

- `@treeseed/core` for site runtime, content, plugin, and hosting integration
- `@treeseed/admin` for admin contracts, view models, API facades, and platform primitives
- `@treeseed/api` for backend contracts, reconciliation, operation state, and shared data models
- `@treeseed/cli` for workflow, config, hosting, release, and reconciliation commands
- `@treeseed/agent` for provider runtime consumption of shared contracts
- root `@treeseed/market` for tenant config, content, and hosted workflow integration

The SDK is not a UI package, admin portal, backend server, CLI parser, capacity-provider runtime, AgentKernel runtime, or ecommerce implementation. See the root [Package Ownership](../../docs/package-ownership.md) guide for the full system map.

The `@treeseed/sdk/account-contracts` export is the canonical portable contract for auth availability, credential/provider results, account identity and sessions, notification capabilities/preferences, and private personal themes. `@treeseed/sdk/platform/plugin` owns the `TreeseedRouteCapability` registry vocabulary consumed by package route registries and generated UI inventories. These contracts contain no UI or backend implementation.

## Which Surface Should I Use?

Treeseed exposes three public SDK surfaces, but they are not peers:

| Surface | Role | Use It For |
| --- | --- | --- |
| `AgentSdk` | Primary | application code, workers, scripts, API handlers, graph-first context retrieval |
| `ScopedAgentSdk` | Operational | agent-runtime code that must enforce model permissions and inject actor identity |
| `ContentGraphRuntime` | Advanced | low-level graph-only integrations that want the graph engine without the rest of the SDK |

If you are unsure, use `AgentSdk`.

## Major Capability Groups

`AgentSdk` covers five main areas:

- generic model reads and mutations across content-backed models and the static-hub D1 form store
- operational runtime state such as messages, runs, cursors, and leases
- control-plane orchestration for work days, tasks, task events, graph runs, and reports
- provider-neutral capacity and assignment contracts for allocation sets, project agent classes, kernel policy/profile, capacity envelopes, provider sessions, assignments, mode runs, reservations, estimates, checkpoints, and usage actuals
- hosting graph compilation, deployment readiness, live hosted-service checks, Treeseed runner smoke helpers, and verification cache support for Treeseed workflows
- graph-first context retrieval through `parseGraphDsl()`, `resolveSeeds()`, `queryGraph()`, and `buildContextPack()`
- agent scoping through `scopeForAgent()`

## Workflow And Hosting Support

The SDK owns the shared implementation behind the fail-fast `trsd` deployment workflow.
It also owns the canonical reconciliation platform for desired-state infrastructure. See the root workspace `docs/reconciliation-platform.md` for the full contract.

Current workflow-support exports include:

```ts
import {
  collectTreeseedDeploymentReadiness,
  collectTreeseedLiveHostedServiceChecks,
  formatTreeseedReadinessReport,
  runTreeseedOperationsRunnerSmoke,
} from '@treeseed/sdk/workflow-support';
```

These helpers are used by:

- `trsd ready <local|staging|prod>`
- `trsd hosting plan|apply|verify --environment <env> --service <id>`
- `trsd audit hosting --environment <env> --live`
- `trsd doctor --live --hosted-services`
- `trsd operations smoke --environment <env> --service operationsRunner`
- `trsd stage --verify action|local|none`
- `trsd release --verify-deployed-resources`

`trsd stage` is branch/ref promotion. It merges `staging` down into the feature branch, runs local proof by default, promotes exact verified refs to staging, and leaves hosted CI/CD/provider repair to the staging release workflow. Hosted reconciliation and live deployed-resource verification remain owned by hosting, release, and explicit verification commands.

For the API app, the expected hosted backend services are the API service, indexed Treeseed operations runner, PostgreSQL, and public TreeDX federation nodes owned by `packages/api`. The root web app remains a web UI and `/v1/*` proxy/client surface, with admin routes contributed by `@treeseed/admin` and visual primitives contributed by `@treeseed/ui`.

Reconciliation guarantees:

- command surfaces compile desired resources before provider mutation
- cached state can locate resources but live observation proves readiness
- hosted apply cannot report `ok: true` when live postconditions fail
- adapter reports use `desiredGraph`, `observedGraph`, `stateGraph`, `diff`, `actions`, `postconditions`, `blockedDrift`, `providerLimitations`, `liveVerification`, and `ok`

Agent capacity architecture is documented in the root workspace [Agent Capacity Implementation Roadmap](../../docs/agent-capacity-implementation-roadmap.md) and [Agent Capacity Domain Model](../../docs/agent-capacity-domain-model.md). SDK owns the portable contracts only; API owns durable coordination records and `@treeseed/agent` owns runtime execution.

## Install

```bash
npm install @treeseed/sdk
```

Consumer contract:

- Node `>=22`
- ESM package
- import from the package root or documented subpath exports

## Quickstart

```ts
import { AgentSdk } from '@treeseed/sdk/sdk';

const sdk = new AgentSdk({
  repoRoot: '/absolute/path/to/your-site',
});
```

Use `AgentSdk.createLocal()` when you want the local static-hub D1 form store:

```ts
import { AgentSdk } from '@treeseed/sdk/sdk';

const sdk = AgentSdk.createLocal({
  repoRoot: '/absolute/path/to/your-site',
  databaseName: 'treeseed-local',
  persistTo: '.wrangler/state/v3/d1',
});
```

## TreeDX Content Repository

TreeDX is the generic repository service used by Treeseed when TreeDX service configuration is available. The SDK is the Treeseed integration and client layer: it configures the TreeDX portfolio, maps Treeseed model registry behavior onto generic repository/ref/path/frontmatter/body/query requests, and keeps product semantics outside TreeDX. The API package may host public TreeDX federation nodes as part of backend reconciliation.

Project site code and optional project repositories remain local filesystem/git
workspace concerns by default. Use `contentRepository: { adapter: 'local' }` or
`AgentSdk.createLocal()` for explicit local content behavior.

See [TreeDX Content Repository](./docs/treedx-content-repository.md).

## Preferred Graph Workflow

The preferred graph API for new integrations is:

1. `parseGraphDsl()`
2. `queryGraph()`
3. `buildContextPack()`

Example:

```ts
import { AgentSdk } from '@treeseed/sdk/sdk';

const sdk = new AgentSdk();
const parsed = await sdk.parseGraphDsl(
  'ctx "queue api" for implement in /knowledge via implements,references depth 1 budget 4000 as full',
);

if (!parsed.ok || !parsed.query) {
  throw new Error(parsed.errors.join('; '));
}

const graph = await sdk.queryGraph(parsed.query);
const pack = await sdk.buildContextPack(parsed.query);
```

The public `ctx` syntax is:

```text
ctx <target>
  [for <focus>]
  [in <scope>]
  [via <relation[,relation...]>]
  [depth <0-3>]
  [where <filter-expression>]
  [limit <n>]
  [budget <tokens>]
  [as <list|brief|full|map>]
```

The old `key=value` graph DSL is no longer supported.

## TreeDX Remote Repository Mode

TreeDX support is opt-in. Local SDK behavior remains the default.

Use the low-level TreeDX client when you want direct repository, workspace, query, graph, registry, or context calls:

```ts
import { TreeDxClient } from '@treeseed/sdk/treedx';

const treeDx = new TreeDxClient({
  baseUrl: 'http://localhost:4000',
  token: process.env.TREEDX_TOKEN,
  repoId: 'repo_123',
});

const whoami = await treeDx.whoami();
const file = await treeDx.readRepositoryFile({
  path: 'docs/readme.md',
  parseFrontmatter: true,
});
```

`AgentSdk` can delegate content-backed model and graph calls to TreeDX when configured explicitly:

```ts
import { AgentSdk, TreeDxClient } from '@treeseed/sdk';

const treeDx = new TreeDxClient({
  baseUrl: 'http://localhost:4000',
  token: process.env.TREEDX_TOKEN,
  repoId: 'repo_123',
});

const sdk = new AgentSdk({
  repoRoot: process.cwd(),
  treeDx: {
    enabled: true,
    client: treeDx,
    repoId: 'repo_123',
    defaultRef: 'refs/heads/main',
  },
});

const docs = await sdk.search({
  model: 'knowledge',
  filters: [{ field: 'status', op: 'eq', value: 'published' }],
});
```

TreeDX mode keeps TreeSeed model semantics in the SDK model registry. TreeDX receives generic repository/ref/path/frontmatter/body/query requests and returns generic repository/file/query/graph results.

TreeDX auth, policy, audit, and federation helpers are available on the same client:

```ts
const mode = await treeDx.authMode();
const scope = await treeDx.effectiveScope({ repoId: 'repo_123' });

await treeDx.putCapabilityGrant({
  actorId: 'actor_agent',
  tenantId: 'tenant_demo',
  repoIds: ['repo_123'],
  capabilities: ['files:read', 'files:search'],
  refs: ['refs/heads/main'],
  paths: ['docs/**'],
});

const audit = await treeDx.listAuditEvents({
  repoId: 'repo_123',
  eventType: 'repo.query_executed',
  limit: 25,
});

const plan = await treeDx.planFederatedQuery({
  repoIds: ['repo_123'],
  capabilities: ['files:search'],
  paths: { repo_123: ['docs/**'] },
});

const search = await treeDx.federatedSearch({
  repoIds: ['repo_123'],
  refs: { repo_123: 'refs/heads/main' },
  paths: { repo_123: ['docs/**'] },
  query: 'release',
  includeErrors: true,
});
```

Federation planning performs scope reduction before execution. The SDK delegates global execution to TreeDX instead of fanning out across every node and filtering locally.

Snapshot, artifact, mirror sync, and migration helpers are also available on `TreeDxClient`:

```ts
const snapshot = await treeDx.buildSnapshot({
  ref: 'refs/heads/main',
  kind: 'repository_snapshot',
  paths: ['docs/**'],
  includeGraph: true,
});

const artifact = await treeDx.exportArtifact({
  snapshotId: snapshot.snapshotId,
});

const download = await treeDx.downloadArtifact({
  snapshotId: snapshot.snapshotId,
});

await treeDx.syncMirror({
  mirrorId: 'mirror_123',
  remoteName: 'origin',
});

await treeDx.createMigration({
  targetNodeId: 'node_mirror',
  mode: 'primary_transfer',
  planOnly: true,
  requireMirrorSynced: false,
});

await treeDx.ready();
await treeDx.deepHealth();
await treeDx.metrics();
```

`downloadArtifact()` returns an `ArrayBuffer` plus content type, filename, checksum, and snapshot headers. These APIs are generic TreeDX repository operations; TreeSeed package or release semantics are not encoded in TreeDX.

Mocked end-to-end TreeDX contract tests prove the SDK can drive the TreeDX repository loop without an agent-side clone when `contentPathMap` is supplied:

```bash
npx vitest run --config ./vitest.config.ts test/utils/treedx-e2e-contract.test.ts
```

The optional live contract command reports `not configured` and exits
successfully unless all of these are set:

```text
TREEDX_LIVE_URL
TREEDX_LIVE_TOKEN
TREEDX_LIVE_REPO_ID
```

## Capacity Scheduling Contracts

The SDK owns the provider-neutral capacity runtime helpers used by the agent manager, workers, and market control plane. These helpers keep work estimation separate from provider cost by normalizing `taskSignature + executionProfileId` estimates, then routing against grants, provider lanes, quality requirements, quota/congestion pressure, attention/context saturation, utility, predictive reserve, and hybrid execution metadata.

Capacity records remain metadata-compatible: advanced scheduling data lives in task payload JSON, routing decision candidates/scores, reservation metadata, capacity plan metadata, checkpoint artifacts, and usage actual metadata. Missing metadata is neutral, so older callers continue to use the credit-only behavior.

## Shared Fixture Support

SDK also owns the shared fixture support model used across the Treeseed workspace.

That support layer is responsible for:

- resolving the canonical shared fixture in `.fixtures/treeseed-fixtures`
- preparing fixture-local package visibility for package-scoped verification
- linking real workspace or installed packages into the fixture runtime when available
- providing the canonical `contracts-only` Agent shim used by packages such as `core` during isolated verification

The shared fixture is an integrated Treeseed project, but package verification remains package-scoped. SDK owns the tooling that lets other packages validate their own slice of that project without mutating the fixture itself.

## Advanced Graph Methods

The SDK also exposes lower-level graph primitives such as:

- `searchFiles()`
- `searchSections()`
- `searchEntities()`
- `getGraphNode()`
- `getNeighbors()`
- `followReferences()`
- `getBacklinks()`
- `getRelated()`
- `getSubgraph()`
- `refreshGraph()`

These remain public, but they are considered advanced tools. Prefer the graph-first context workflow above unless you specifically need raw lexical search or raw traversal primitives.

## `ScopedAgentSdk`

Use `scopeForAgent()` when code must enforce an agent’s declared permissions:

```ts
const scoped = sdk.scopeForAgent({
  slug: 'guide-agent',
  permissions: [
    { model: 'knowledge', operations: ['get', 'read', 'search'] },
    { model: 'message', operations: ['create'] },
  ],
});
```

`ScopedAgentSdk` is intended for manager/worker and agent-runtime code. It is not the default application entrypoint.

## `ContentGraphRuntime`

`ContentGraphRuntime` is still exported, but it is an advanced graph runtime:

- it powers the graph subsystem behind `AgentSdk`
- it is useful when you want only graph behavior
- it is not the recommended starting point for most applications

## Reference Docs

- [SDK Interface Reference](../../src/content/knowledge/sdk/interface-reference.mdx)
- [Graph API Guide](../../src/content/knowledge/sdk/graph-api-guide.mdx)
- [ctx Query Language](../../src/content/knowledge/sdk/ctx-query-language.mdx)
- [How ctx Works](../../src/content/knowledge/sdk/ctx-query-engine.mdx)

## Other Public Capabilities

The package also exports:

- workflow helpers such as `TreeseedWorkflowSdk`
- remote and queue clients such as `RemoteTreeseedClient`, `CloudflareQueuePullClient`, and `CloudflareQueuePushClient`
- model registry, field, and filter utilities
- plugin/runtime types and helpers

For package work:

```bash
npm install
npm run build
npm test
```

For fixture-specific work:

```bash
npm run fixtures:check
```
