# TreeDB Remote Mode

TreeDB remote mode lets SDK callers use TreeDB repository APIs without a local Git checkout. Local SDK mode remains the default. Remote mode is explicit through `treeDb.enabled`.

```ts
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
  modelRegistry,
  treeDb: {
    enabled: true,
    baseUrl: 'https://treedb.example.test',
    token: process.env.TREEDB_TOKEN,
    repoId: 'repo_docs',
    contentPathMap: {
      knowledge: 'src/content/knowledge',
    },
    registryRouting: true,
  },
});
```

## Client Setup

You can pass either an existing `TreeDbClient` or client options:

```ts
import { TreeDbClient } from '@treeseed/sdk/treedb';

const client = new TreeDbClient({
  baseUrl: 'https://treedb.example.test',
  token: process.env.TREEDB_TOKEN,
  repoId: 'repo_docs',
  timeoutMs: 5000,
});
```

`registryRouting: true` exposes `sdk.treeDb.registry` and `sdk.treeDb.federated` for registry and global query calls.

## Common Calls

```ts
await sdk.search({ model: 'knowledge', limit: 10 });
await sdk.get({ model: 'knowledge', slug: 'release-guide' });
await sdk.create({
  model: 'knowledge',
  actor: 'agent',
  data: { slug: 'new-note', title: 'New Note', body: 'Body' },
});

await sdk.treeDb?.graph.queryGraph({ query: 'release' });
await sdk.treeDb?.graph.buildContextPack({ query: 'release' });
const snapshot = await sdk.treeDb?.client.buildSnapshot({ paths: ['src/content/**'] });
if (snapshot) {
  await sdk.treeDb?.client.exportArtifact({ snapshotId: snapshot.snapshotId });
}
await sdk.treeDb?.client.ready();
await sdk.treeDb?.client.deepHealth();
await sdk.treeDb?.client.metrics();
await sdk.treeDb?.client.prometheusMetrics();
```

## Exports

Stable TreeDB imports:

```ts
import { TreeDbClient } from '@treeseed/sdk/treedb';
import { TreeDbClient as ClientOnly } from '@treeseed/sdk/treedb/client';
import type { TreeDbRepository } from '@treeseed/sdk/treedb/types';
import { TreeDbGraphAdapter } from '@treeseed/sdk/treedb/adapters';
```

## Constraints

- Remote mode uses generic TreeDB repo/ref/path APIs.
- Product model names are SDK mapping concerns only.
- TreeDB mode does not require a local clone when `modelRegistry` or `models` and needed `contentPathMap` entries are provided.
- Local-only SDK workflows remain local unless they are explicitly mapped to a
  TreeDB adapter or port.
