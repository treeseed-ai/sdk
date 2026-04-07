# `@treeseed/sdk`

Shared Treeseed SDK for content-backed and D1-backed object models.

It exposes the public data model surface used by Treeseed itself:

- file-backed content access for pages, notes, questions, objectives, people, agents, books, and knowledge
- D1-backed access for subscriptions, messages, agent runs, cursors, and content leases
- stable query and mutation APIs for `get`, `read`, `search`, `follow`, `pick`, `create`, and `update`

`@treeseed/core` consumes this package for Treeseed-specific runtime behavior, but the SDK is designed to be usable independently by external tooling and non-Treeseed agents.

## Consumer Contract

- Node `>=20`
- install from npm as a normal package dependency
- the package root is safe to import from plain Node ESM

Example:

```bash
npm install @treeseed/sdk
```

## Local Development

Inside this repository, contributors should work from the workspace root at `docs/`:

```bash
cd docs
npm install
```

That workspace links `@treeseed/sdk` into `@treeseed/core` and the tenant app for local development, but release verification still uses packed tarballs so published packages do not leak workspace-only or file-based references.
