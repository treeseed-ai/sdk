# TreeDX Content Repository

TreeSeed project content is backed by TreeDX as a portfolio of repositories.
The TreeSeed SDK configures the TreeDX service and optional selection hints; it
does not configure one global repository id.

## Configuration

TreeDX-backed content uses:

```ts
const sdk = new AgentSdk({
  treeDx: {
    baseUrl: 'http://localhost:4000',
    token: process.env.TREESEED_TREEDX_TOKEN,
    ref: 'refs/heads/main',
    workspaceId: process.env.TREESEED_TREEDX_WORKSPACE_ID,
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
TREESEED_TREEDX_BASE_URL
TREESEED_TREEDX_TOKEN
TREESEED_TREEDX_REF
TREESEED_TREEDX_WORKSPACE_ID
```

There is intentionally no repository-id environment variable. TreeDX is a
portfolio. Repository ids are discovered internally through TreeDX repository
APIs only when repo-scoped TreeDX endpoints require them.

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

TreeDX stores project content. TreeSeed model names, aliases, slugs,
frontmatter normalization, filters, and product behavior stay in
`packages/trsd-sdk`.

Project site code, build/watch/deploy behavior, embedded repositories, and
optional project repositories remain local filesystem/git workspace concerns by
default.

`packages/trsd-sdk` keeps its TreeDX access layer inside this package so the
TreeSeed SDK remains standalone. It does not define TreeDX SDK architecture and
keeps its TreeDX calls aligned with the generic SDK/OpenAPI contracts.
