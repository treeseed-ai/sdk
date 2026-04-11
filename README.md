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

- generic model reads and mutations across content-backed and D1-backed models
- operational runtime state such as messages, runs, cursors, and leases
- control-plane orchestration for work days, tasks, task events, graph runs, and reports
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
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
  repoRoot: '/absolute/path/to/your-site',
});
```

Use `AgentSdk.createLocal()` when you want a local Wrangler-backed D1 database:

```ts
import { AgentSdk } from '@treeseed/sdk';

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
import { AgentSdk } from '@treeseed/sdk';

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
- gateway and queue clients such as `TreeseedGatewayClient` and `CloudflareQueuePullClient`
- model registry, field, and filter utilities
- plugin/runtime types and helpers

For package work:

```bash
npm install
npm run build
npm test
```
