# `@treeseed/sdk`

`@treeseed/sdk` is TreeSeed's portable contract and remote API package. It gives API, CLI, Agent, browser, and external integrations one versioned description of the control plane and typed conduits to remote TreeSeed and TreeDX services.

The SDK does not own control-plane persistence, scheduling, repository mutation, content publication, deployment, provider runtimes, or server-side business workflows. Those implementations belong to the API or their dedicated runtime packages.

## Install

```bash
npm install @treeseed/sdk
```

Requirements: Node.js 22 or newer and ESM.

## Control-plane API

```ts
import {
  ControlPlaneClient,
  defaultLocalControlPlaneServer,
} from '@treeseed/sdk/control-plane-client';

const client = new ControlPlaneClient({
  profile: defaultLocalControlPlaneServer(),
  accessToken: process.env.TREESEED_ACCESS_TOKEN,
});

const health = await client.call({ method: 'GET', path: '/v1/health' });
```

The client provides typed operation dispatch, RFC 9457 problem handling, OAuth device and refresh flows, server profiles, encrypted local session custody, idempotency keys, optimistic-concurrency headers, and request cancellation. Generated operation bindings come from the versioned operation catalog; the generic `call` method accepts only the public REST path shape.

## TreeDX API

```ts
import { TreeDxClient } from '@treeseed/sdk/treedx/client';

const treeDx = new TreeDxClient({
  baseUrl: 'http://127.0.0.1:4000',
  token: process.env.TREEDX_TOKEN,
  repoId: 'repo_123',
});

const result = await treeDx.searchRepositoryFiles({ query: 'release' });
```

TreeDX remains a remote service. Its client and transport types are retained here so consumers do not duplicate protocol code.

## Public boundaries

The package intentionally exposes only:

- standards and semantic-compatibility contracts for TypeScript, OpenAPI, and MCP;
- the control-plane operation catalog and human-centered command/workday contracts;
- control-plane, TreeDX, and capacity-provider remote clients;
- portable account, knowledge, feedback, content, agent, capacity, provider, secret-capability, and graph request contracts;
- deterministic validation that belongs to those wire contracts.

There is no root catch-all export. Import a documented subpath so ownership and compatibility remain explicit.

## Verification

```bash
npm test
npm run verify:direct
```

The release gate builds only the package export closure, verifies deterministic contract artifacts, checks the packed public boundary, and runs the focused contract/client suite. Removed implementation and lifecycle suites are not executed.

## Versioning

Contract removals, input or output narrowing, scope escalation, risk escalation, and incompatible REST or MCP surface changes are breaking. Compatible additions require a minor version; contract-preserving repairs require a patch. Prerelease consumers pin an exact immutable version.

License: Apache-2.0.
