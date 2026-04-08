# `@treeseed/sdk`

`@treeseed/sdk` is the standalone TreeSeed SDK for content-backed and D1-backed object models.

It exposes the public model and storage surface used by TreeSeed agents and supporting tooling:

- content-backed access for pages, notes, questions, objectives, people, agents, books, and knowledge
- D1-backed access for subscriptions, messages, agent runs, cursors, and content leases
- stable query and mutation APIs for `get`, `read`, `search`, `follow`, `pick`, `create`, and `update`

## Consumer Contract

- Node `>=20`
- ESM package
- install from npm as a normal package dependency
- import from the package root or documented subpath exports

Install:

```bash
npm install @treeseed/sdk
```

Example:

```ts
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk();
```

## Public Surface

The package root exports the main SDK class, model registry helpers, CLI option helpers, and shared SDK types.

The package also exposes focused subpaths including:

- `@treeseed/sdk/sdk`
- `@treeseed/sdk/content-store`
- `@treeseed/sdk/d1-store`
- `@treeseed/sdk/frontmatter`
- `@treeseed/sdk/git-runtime`
- `@treeseed/sdk/models`
- `@treeseed/sdk/sdk-filters`
- `@treeseed/sdk/cli-tools`
- `@treeseed/sdk/types`
- `@treeseed/sdk/types/agents`
- `@treeseed/sdk/types/cloudflare`
- `@treeseed/sdk/wrangler-d1`
- `@treeseed/sdk/stores/*`

## Content Root Resolution

Content-backed operations need a repository root that contains `src/content`.

`AgentSdk` resolves that root in this order:

1. the explicit `repoRoot` option
2. `TREESEED_SDK_CONTENT_ROOT`
3. `TREESEED_SDK_REPO_ROOT`
4. auto-detection from the current working directory

For package-local tests and fixture-driven development, the SDK also recognizes a package fixture root containing `fixture/src/content`.

Example with an explicit root:

```ts
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
	repoRoot: '/absolute/path/to/site-or-fixture-root',
});
```

## Local Development

From the `sdk/` directory:

```bash
npm ci
npm run build
npm test
npm run test:smoke
npm run verify
```

What each command does:

- `npm run build`: builds `dist/`
- `npm test`: runs unit tests
- `npm run test:smoke`: packs the SDK tarball and verifies a clean import from the packed install
- `npm run verify`: runs the release verification path used by CI

## Sample Fixture Site

`sdk/fixture` is a generic TreeSeed sample site. It serves three purposes at once:

- a small documentation surface about working with TreeSeed
- the default local test ground for content-backed SDK behavior
- a concrete example of a valid `repoRoot` for `AgentSdk`

You can point the SDK at it directly:

```ts
import path from 'node:path';
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
	repoRoot: path.resolve('sdk/fixture'),
});
```

The fixture includes representative entries for pages, notes, questions, objectives, books, knowledge, people, and agents so local queries behave like a small real site instead of a synthetic stub.

## Repository Note

This package currently lives under `sdk/` in the TreeSeed workspace, but the package contract and documentation target standalone npm consumption.
