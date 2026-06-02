# `@treeseed/sdk`

`@treeseed/sdk` is the main programmatic interface for Treeseed content, control-plane state, and graph-first AI context retrieval.

For most consumers, the right entrypoint is `AgentSdk`.

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
- provider-neutral capacity scheduling contracts for task classification, admission, execution profiles, routing, estimates, planning proposals, attention load, utility, predictive reserve, hybrid execution, checkpoints, and usage actuals
- graph-first context retrieval through `parseGraphDsl()`, `resolveSeeds()`, `queryGraph()`, and `buildContextPack()`
- agent scoping through `scopeForAgent()`

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
  [for <stage>]
  [in <scope>]
  [via <relation[,relation...]>]
  [depth <0-3>]
  [where <filter-expression>]
  [limit <n>]
  [budget <tokens>]
  [as <list|brief|full|map>]
```

The old `key=value` graph DSL is no longer supported.

## TreeDB Remote Repository Mode

TreeDB support is opt-in. Local SDK behavior remains the default.

Use the low-level TreeDB client when you want direct repository, workspace, query, graph, registry, or context calls:

```ts
import { TreeDbClient } from '@treeseed/sdk/treedb';

const treeDb = new TreeDbClient({
  baseUrl: 'http://localhost:4000',
  token: process.env.TREEDB_TOKEN,
  repoId: 'repo_123',
});

const whoami = await treeDb.whoami();
const file = await treeDb.readRepositoryFile({
  path: 'docs/readme.md',
  parseFrontmatter: true,
});
```

`AgentSdk` can delegate content-backed model and graph calls to TreeDB when configured explicitly:

```ts
import { AgentSdk, TreeDbClient } from '@treeseed/sdk';

const treeDb = new TreeDbClient({
  baseUrl: 'http://localhost:4000',
  token: process.env.TREEDB_TOKEN,
  repoId: 'repo_123',
});

const sdk = new AgentSdk({
  repoRoot: process.cwd(),
  treeDb: {
    enabled: true,
    client: treeDb,
    repoId: 'repo_123',
    defaultRef: 'refs/heads/main',
  },
});

const docs = await sdk.search({
  model: 'knowledge',
  filters: [{ field: 'status', op: 'eq', value: 'published' }],
});
```

TreeDB mode keeps TreeSeed model semantics in the SDK model registry. TreeDB receives generic repository/ref/path/frontmatter/body/query requests and returns generic repository/file/query/graph results.

TreeDB auth, policy, audit, and federation planning helpers are available on the same client:

```ts
const mode = await treeDb.authMode();
const scope = await treeDb.effectiveScope({ repoId: 'repo_123' });

await treeDb.putCapabilityGrant({
  actorId: 'actor_agent',
  tenantId: 'tenant_demo',
  repoIds: ['repo_123'],
  capabilities: ['files:read', 'files:search'],
  refs: ['refs/heads/main'],
  paths: ['docs/**'],
});

const audit = await treeDb.listAuditEvents({
  repoId: 'repo_123',
  eventType: 'repo.query_executed',
  limit: 25,
});

const plan = await treeDb.planFederatedQuery({
  repoIds: ['repo_123'],
  capabilities: ['files:search'],
  paths: { repo_123: ['docs/**'] },
});
```

Federation planning is scope reduction only in this phase. The SDK does not fan out across every TreeDB node and filter locally.

Snapshot, artifact, mirror sync, and migration helpers are also available on `TreeDbClient`:

```ts
const snapshot = await treeDb.buildSnapshot({
  ref: 'refs/heads/main',
  kind: 'repository_snapshot',
  paths: ['docs/**'],
  includeGraph: true,
});

const artifact = await treeDb.exportArtifact({
  snapshotId: snapshot.snapshotId,
});

const download = await treeDb.downloadArtifact({
  snapshotId: snapshot.snapshotId,
});

await treeDb.syncMirror({
  mirrorId: 'mirror_123',
  remoteName: 'origin',
});

await treeDb.createMigration({
  targetNodeId: 'node_mirror',
  mode: 'primary_transfer',
  dryRun: true,
  requireMirrorSynced: false,
});
```

`downloadArtifact()` returns an `ArrayBuffer` plus content type, filename, checksum, and snapshot headers. These APIs are generic TreeDB repository operations; TreeSeed package or release semantics are not encoded in TreeDB.

Phase 10 adds mocked end-to-end TreeDB contract tests that prove the SDK can drive the TreeDB repository loop without an agent-side clone when `contentPathMap` is supplied:

```bash
npx vitest run --config ./vitest.config.ts test/utils/treedb-e2e-contract.test.ts
```

An optional live contract test is skipped unless all of these are set:

```text
TREEDB_LIVE_URL
TREEDB_LIVE_TOKEN
TREEDB_LIVE_REPO_ID
```

## Capacity Scheduling Contracts

The SDK owns the provider-neutral capacity runtime helpers used by the agent manager, workers, and market control plane. These helpers keep work estimation separate from provider cost by normalizing `taskSignature + executionProfileId` estimates, then routing against grants, provider lanes, quality requirements, quota/congestion pressure, attention/context saturation, utility, predictive reserve, and hybrid phase metadata.

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

- [SDK Interface Reference](/home/adrian/Projects/treeseed/market/src/content/knowledge/sdk/interface-reference.mdx)
- [Graph API Guide](/home/adrian/Projects/treeseed/market/src/content/knowledge/sdk/graph-api-guide.mdx)
- [ctx Query Language](/home/adrian/Projects/treeseed/market/src/content/knowledge/sdk/ctx-query-language.mdx)
- [How ctx Works](/home/adrian/Projects/treeseed/market/src/content/knowledge/sdk/ctx-query-engine.mdx)

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
