# TreeDX No-Clone Workflows

No-clone mode is for environments where the SDK should read, search, mutate, and inspect repository content through TreeDX only.

## Requirements

- `treeDx.enabled: true`
- TreeDX `baseUrl`, token, and `repoId`, or an existing `TreeDxClient`
- `modelRegistry` or `models`
- `contentPathMap` for content models whose `contentDir` cannot be resolved without a local repo root

```ts
const sdk = new AgentSdk({
  modelRegistry,
  treeDx: {
    enabled: true,
    baseUrl,
    token,
    repoId,
    contentPathMap: {
      page: 'src/content/pages',
      knowledge: 'src/content/knowledge',
    },
  },
});
```

## Supported Surfaces

- Repository read/search through `sdk.get` and `sdk.search`
- Workspace-backed create/update through `sdk.create` and `sdk.update`
- Workspace commit through the TreeDX repository adapter
- Graph query through `sdk.treeDx.graph`
- Context build through `sdk.treeDx.graph.buildContextPack`
- Snapshot and artifact metadata through `sdk.treeDx.client`
- Federated search/query through `sdk.treeDx.federated` when registry routing is enabled

## Local Mode Compatibility

If `treeDx.enabled` is absent or false, `AgentSdk` keeps using the existing local content store and graph runtime.
