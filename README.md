# `@treeseed/sdk`

The operator catalog includes versioned `inbox.*` operations for unified team inbox queries, ordered events, private drafts, routed question creation, and exact-version governance actions.

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

Communication contracts treat discussion topics as team-wide coordination scopes. Qualified `@project/agent` addresses select one agent, while unqualified `@agent` addresses expand to every matching chat-enabled agent across active team projects. The API maintains a project-local TreeDX discussion stream for each addressed project and aggregates their invocations under one send identity.

## Agent activity contract

An agent's single class identifies allocation and memory attachment; it does not
restrict which activities its configured handler can perform. Every class may
configure `planning`, `estimating`, `acting`, `reviewing`, `reporting`, and `chat`
with any registered handler. Each profile retains its own explicit prompt,
parameters, permissions, and dependencies. Review independence is a property of
the assigned attempt and candidate provenance, not a reserved class name.

This validator change removes the class restriction only. Group membership and
discussion mentions must determine participation in the control plane; handler
dispatch must support every activity for nondeterministic workloads. Those
consumers must adopt this contract before the complete workflow is available.
The runner's boundary is an already-prepared opaque workload and its runtime
environment: process lifecycle, limits, isolation, observations, measured usage,
and cleanup. It must not interpret agent identity, profile, proposal, review, or
release policy. Workload preparation and task interpretation belong to the
configured application handlers.

The shared workday selection normalizer accepts activity phases only. It rejects
agent names, class IDs, class slugs, union matching and unknown fields even on
internal calls. Proposal groups and discussion addressing supply participants;
the phase selection describes which activities run. Fair allocation weights
still use the agent's one class and are independent of participation.

## Group contribution proposal contract

Current proposal metadata uses `treeseed.proposal/v2`. A proposal requires shared
`groupIds`; its execution plan contains each subscriber's own work items and
bounded estimates with rationale. Work items have no agent or class selector.
Each `estimateRef` names the exact PostgreSQL estimating assignment and revision
that supplied the contribution. The API must verify that assignment's actual
author, current proposal authority, completed result and contribution before
approval or execution; a syntactically valid reference grants no authority.
Every subscriber contributes and executes its work, rather than bidding for one
selected assignment. Dependencies order the contributions and independent review.

The validator preserves historical `treeseed.proposal/v1` records unchanged for
read-back. Schema descriptions default to v2; historical consumers can explicitly
request the v1 description. This contract does not itself implement participation
readiness, estimate integration, execution provenance or peer review in the API.

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
