# TreeDB Content Repository

TreeSeed project content is backed by TreeDB as a portfolio of repositories.
The TreeSeed SDK configures the TreeDB service and optional selection hints; it
does not configure one global repository id.

## Configuration

TreeDB-backed content uses:

```ts
const sdk = new AgentSdk({
  treeDb: {
    baseUrl: 'http://localhost:4000',
    token: process.env.TREESEED_TREEDB_TOKEN,
    ref: 'refs/heads/main',
    workspaceId: process.env.TREESEED_TREEDB_WORKSPACE_ID,
    contentPathMap: {
      page: 'src/content/pages/**'
    },
    repositoryHints: [
      { purpose: 'project_content', name: 'project-content' }
    ]
  }
});
```

The supported environment variables are:

```text
TREESEED_TREEDB_BASE_URL
TREESEED_TREEDB_TOKEN
TREESEED_TREEDB_REF
TREESEED_TREEDB_WORKSPACE_ID
```

There is intentionally no repository-id environment variable. TreeDB is a
portfolio. Repository ids are discovered internally through TreeDB repository
APIs only when repo-scoped TreeDB endpoints require them.

## Local Opt-Out

Use local content explicitly when working with fixture sites or local-only
content:

```ts
const sdk = new AgentSdk({
  contentRepository: { adapter: 'local' }
});
```

`AgentSdk.createLocal()` also forces local content behavior.

## Boundaries

TreeDB stores project content. TreeSeed model names, aliases, slugs,
frontmatter normalization, filters, and product behavior stay in
`packages/trsd-sdk`.

Project site code, build/watch/deploy behavior, embedded repositories, and
optional project repositories remain local filesystem/git workspace concerns by
default.

`packages/trsd-sdk` keeps its TreeDB access layer inside this package so the
TreeSeed SDK remains standalone. It does not define TreeDB SDK architecture and
keeps its TreeDB calls aligned with the generic SDK/OpenAPI contracts.
