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
import { CONTROL_PLANE_OPERATIONS } from '@treeseed/sdk/operator-contracts';

const client = new ControlPlaneClient({
  profile: defaultLocalControlPlaneServer(),
  accessToken: process.env.TREESEED_ACCESS_TOKEN,
});

const health = await client.invoke(CONTROL_PLANE_OPERATIONS.health.readiness, {
  path: {},
  query: {},
  body: undefined,
});
```

The client provides typed operation dispatch, RFC 9457 problem handling, OAuth device and refresh flows, server-profile normalization, idempotency keys, optimistic-concurrency headers, and request cancellation. Operation bindings come from the versioned operation catalog; callers do not construct control-plane paths. Token and profile persistence belong to the consuming CLI, application, or host credential store.

## TreeDX API

```ts
import { ControlPlaneClient } from '@treeseed/sdk/control-plane-client';
import { TreeSeedTreeDxClient } from '@treeseed/sdk/treedx';

const controlPlane = new ControlPlaneClient({
  profile: defaultLocalControlPlaneServer(),
  accessToken: process.env.TREESEED_ACCESS_TOKEN,
});
const treeDx = new TreeSeedTreeDxClient(controlPlane);

const result = await treeDx.proxy.repositories.searchFiles({
  path: { projectId: 'project_123', repositoryId: 'repository_123' },
  query: { query: 'release' },
  body: undefined,
});
```

TreeDX remains an independently released remote service. This package imports its authoritative payload types but exposes only the project-scoped TreeSeed proxy facade. Direct TreeDX transport, endpoints, topology, and credentials remain confined to trusted control-plane infrastructure.

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
