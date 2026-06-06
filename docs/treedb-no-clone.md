# TreeDB No-Clone Workflows

No-clone mode is for environments where the SDK should read, search, mutate, and inspect repository content through TreeDB only.

## Requirements

- `treeDb.enabled: true`
- TreeDB `baseUrl`, token, and `repoId`, or an existing `TreeDbClient`
- `modelRegistry` or `models`
- `contentPathMap` for content models whose `contentDir` cannot be resolved without a local repo root

```ts
const sdk = new AgentSdk({
  modelRegistry,
  treeDb: {
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
- Workspace commit through the TreeDB repository adapter
- Graph query through `sdk.treeDb.graph`
- Context build through `sdk.treeDb.graph.buildContextPack`
- Snapshot and artifact metadata through `sdk.treeDb.client`
- Federated search/query through `sdk.treeDb.federated` when registry routing is enabled

## Local Mode Compatibility

If `treeDb.enabled` is absent or false, `AgentSdk` keeps using the existing local content store and graph runtime.
