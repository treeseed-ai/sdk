# TreeDX Remote Mode

TreeDX remote mode lets SDK callers use TreeDX repository APIs without a local Git checkout. Local SDK mode remains the default. Remote mode is explicit through `treeDx.enabled`.

```ts
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
  modelRegistry,
  treeDx: {
    enabled: true,
    baseUrl: 'https://treedx.example.test',
    token: process.env.TREEDX_TOKEN,
    repoId: 'repo_docs',
    contentPathMap: {
      knowledge: 'src/content/knowledge',
    },
    registryRouting: true,
  },
});
```

## Client Setup

You can pass either an existing `TreeDxClient` or client options:

```ts
import { TreeDxClient } from '@treeseed/sdk/treedx';

const client = new TreeDxClient({
  baseUrl: 'https://treedx.example.test',
  token: process.env.TREEDX_TOKEN,
  repoId: 'repo_docs',
  timeoutMs: 5000,
});
```

`registryRouting: true` exposes `sdk.treeDx.registry` and `sdk.treeDx.federated` for registry and global query calls.

## Common Calls

```ts
await sdk.search({ model: 'knowledge', limit: 10 });
await sdk.get({ model: 'knowledge', slug: 'release-guide' });
await sdk.create({
  model: 'knowledge',
  actor: 'agent',
  data: { slug: 'new-note', title: 'New Note', body: 'Body' },
});

await sdk.treeDx?.graph.queryGraph({ query: 'release' });
await sdk.treeDx?.graph.buildContextPack({ query: 'release' });
const snapshot = await sdk.treeDx?.client.buildSnapshot({ paths: ['src/content/**'] });
if (snapshot) {
  await sdk.treeDx?.client.exportArtifact({ snapshotId: snapshot.snapshotId });
}
await sdk.treeDx?.client.ready();
await sdk.treeDx?.client.deepHealth();
await sdk.treeDx?.client.metrics();
await sdk.treeDx?.client.prometheusMetrics();
```

## Exports

Stable TreeDX imports:

```ts
import { TreeDxClient } from '@treeseed/sdk/treedx';
import { TreeDxClient as ClientOnly } from '@treeseed/sdk/treedx/client';
import type { TreeDxRepository } from '@treeseed/sdk/treedx/types';
import { TreeDxGraphAdapter } from '@treeseed/sdk/treedx/adapters';
```

## Constraints

- Remote mode uses generic TreeDX repo/ref/path APIs.
- Product model names are SDK mapping concerns only.
- TreeDX mode does not require a local clone when `modelRegistry` or `models` and needed `contentPathMap` entries are provided.
- Local-only SDK workflows remain local unless they are explicitly mapped to a
  TreeDX adapter or port.
