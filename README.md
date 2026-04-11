# `@treeseed/sdk`

`@treeseed/sdk` is the standalone TreeSeed SDK for TreeSeed content/data access and TreeSeed workflow/runtime operations.

It is the authoritative programmatic interface for Treeseed. The published `@treeseed/cli` package is the terminal adapter that turns these SDK capabilities into command-line flows.

It exposes the public model and storage surface used by TreeSeed agents and supporting tooling:

- content-backed access for pages, notes, questions, objectives, people, agents, books, and knowledge
- D1-backed access for subscriptions, messages, agent runs, cursors, and content leases
- D1-backed operational control-plane models for work days, tasks, task events, task outputs, graph runs, and reports
- stable query and mutation APIs for `get`, `read`, `search`, `follow`, `pick`, `create`, and `update`
- typed HTTP clients for the Treeseed gateway and Cloudflare Queue pull consumers
- typed workflow primitives for Treeseed development, staging, release, and environment operations

## Control Plane Additions

The SDK is now the shared contract for the unified agent-hosting system.

Important additions:

- `work_day`
- `task`
- `task_event`
- `task_output`
- `graph_run`
- `report`

Important process-facing helpers:

- `startWorkDay()`
- `closeWorkDay()`
- `createTask()`
- `claimTask()`
- `recordTaskProgress()`
- `completeTask()`
- `failTask()`
- `appendTaskEvent()`
- `searchTasks()`
- `createReport()`
- `getManagerContext()`
- `TreeseedGatewayClient`
- `CloudflareQueuePullClient`

## Consumer Contract

- Node `>=22`
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

Programmatic workflow access:

```ts
import { TreeseedWorkflowSdk } from '@treeseed/sdk';

const workflow = new TreeseedWorkflowSdk({
	cwd: '/absolute/path/to/your-site',
});

const status = workflow.status();
```

Published verify executable:

```bash
treeseed-sdk-verify
```

Packages that depend on `@treeseed/sdk` should use the published SDK verify entrypoint rather than carrying a local verify-driver wrapper. The executable delegates to the same SDK verification framework exposed by `@treeseed/sdk/verification`.

For `package.json` scripts, use the exported script entrypoint:

```json
{
  "scripts": {
    "verify": "node --input-type=module -e \"await import('@treeseed/sdk/scripts/verify-driver')\""
  }
}
```

Gateway client example:

```ts
import { TreeseedGatewayClient } from '@treeseed/sdk';

const gateway = new TreeseedGatewayClient({
	baseUrl: 'https://treeseed-agent-gateway.example.workers.dev',
	bearerToken: process.env.TREESEED_GATEWAY_BEARER_TOKEN!,
});

await gateway.requestJson('/workdays/start', {
	body: {
		projectId: 'treeseed-market',
		capacityBudget: 100,
	},
});
```

Cloudflare Queue pull consumer example:

```ts
import { CloudflareQueuePullClient } from '@treeseed/sdk';

const queue = new CloudflareQueuePullClient({
	accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
	queueId: process.env.TREESEED_QUEUE_ID!,
	token: process.env.TREESEED_QUEUE_PULL_TOKEN!,
});

const batch = await queue.pull({
	batchSize: 1,
	visibilityTimeoutMs: 120000,
});
```

## Using The SDK In Applications

`AgentSdk` is the main application entrypoint. It routes each request to either the content-backed store or the D1-backed store based on the model you ask for, and it always returns a JSON envelope with:

- `ok`
- `model`
- `operation`
- `payload`
- optional `meta`

For most application code, the working pattern is:

1. create one SDK instance for your process, request handler, worker, or job
2. call `get`, `read`, `search`, `follow`, `pick`, `create`, or `update`
3. read the typed `payload` from the returned envelope

For manager/worker code, the common pattern is:

1. use `AgentSdk.createLocal()` for local graph and content access
2. use `TreeseedGatewayClient` for durable remote operational writes
3. use `CloudflareQueuePullClient` for worker-side queue pull, ack, and retry

### Initialize An SDK Instance

Use the default constructor when you want in-memory D1 behavior and a content root resolved from your environment or working directory:

```ts
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
	repoRoot: '/absolute/path/to/your-site',
});
```

Use `models` when a site extends the built-in model surface. The SDK keeps the core operations and filters, but the active model registry can be extended per site or package.

```ts
import { AgentSdk } from '@treeseed/sdk';
import { resolve } from 'node:path';

const repoRoot = '/absolute/path/to/your-site';
const sdk = new AgentSdk({
	repoRoot,
	models: [
		{
			name: 'template',
			aliases: ['templates'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			filterableFields: ['slug', 'title', 'status', 'category', 'tags', 'templateVersion', 'updated'],
			sortableFields: ['title', 'updated', 'templateVersion'],
			pickField: 'updated',
			contentCollection: 'templates',
			contentDir: resolve(repoRoot, 'src', 'content', 'templates'),
		},
	],
});
```

Use `createLocal()` when you want a local Wrangler-backed D1 database:

```ts
import { AgentSdk } from '@treeseed/sdk';

const sdk = AgentSdk.createLocal({
	repoRoot: '/absolute/path/to/your-site',
	databaseName: 'treeseed-local',
	persistTo: '.wrangler/state/v3/d1',
});
```

Use `MemoryAgentDatabase` explicitly in tests or scripts when you want a fully in-memory setup:

```ts
import { AgentSdk } from '@treeseed/sdk';
import { MemoryAgentDatabase } from '@treeseed/sdk/d1-store';

const sdk = new AgentSdk({
	repoRoot: '/absolute/path/to/your-site',
	database: new MemoryAgentDatabase(),
});
```

### Read A Single Record

Use `get()` when you want one record by `id`, `slug`, or `key`.

```ts
const response = await sdk.get({
	model: 'knowledge',
	slug: 'guides/getting-started/1-introduction',
});

if (response.payload) {
	console.log(response.payload.title);
	console.log(response.payload.body);
}
```

Use `read()` when you want the same lookup behavior but want the returned envelope to say `operation: 'read'`.

```ts
const response = await sdk.read({
	model: 'page',
	slug: 'getting-started',
});
```

### Search Across A Model

Use `search()` to list and filter records from a model.

```ts
const response = await sdk.search({
	model: 'knowledge',
	filters: [
		{ field: 'title', op: 'contains', value: 'TreeSeed' },
		{ field: 'tags', op: 'contains', value: 'onboarding' },
	],
	sort: [{ field: 'updated', direction: 'desc' }],
	limit: 10,
});

console.log(response.meta?.count);
console.log(response.payload.map((item) => item.slug));
```

`search()` is the main method for application reads such as:

- listing recent notes
- finding objectives by status
- finding people by role or affiliation
- finding queued D1 messages by type or status

### Follow Changes Since A Timestamp

Use `follow()` when your application wants records changed since a known point in time.

```ts
const response = await sdk.follow({
	model: 'knowledge',
	since: '2026-04-07T00:00:00.000Z',
	filters: [{ field: 'tags', op: 'contains', value: 'treeseed' }],
});

for (const item of response.payload.items) {
	console.log(item.slug);
}
```

The payload shape is:

```ts
{
	items: [...],
	since: '...'
}
```

### Pick Work Items

Use `pick()` when you want the SDK to choose one item from a model for a worker.

For content-backed models, `pick()` tries to claim a content lease and returns both the selected item and a `leaseToken` when a claim succeeds.

```ts
const response = await sdk.pick({
	model: 'objective',
	workerId: 'planner-1',
	leaseSeconds: 300,
	filters: [{ field: 'status', op: 'eq', value: 'in progress' }],
});

if (response.payload.item) {
	console.log(response.payload.item.slug);
	console.log(response.payload.leaseToken);
}
```

For `message`, `pick()` routes to queue claiming behavior in the D1 layer.

Use `strategy` to control the selection order:

- `latest` selects the most recent candidate
- `oldest` selects the oldest candidate
- `highest_priority` selects the highest-priority candidate when the model exposes `priority`, otherwise it falls back to the model default

### Create Content Or D1 Records

Use `create()` for models that support creation.

For content-backed models, pass frontmatter-like fields in `data`. The SDK writes the document and returns the created item plus git metadata.

```ts
const response = await sdk.create({
	model: 'note',
	actor: 'app-server',
	data: {
		slug: 'operating-a-small-treeseed',
		title: 'Operating a Small TreeSeed',
		status: 'live',
		author: 'TreeSeed Team',
		tags: ['operations', 'treeseed'],
		body: 'Keep the content model simple and the workflows visible.',
	},
});

console.log(response.payload.item.slug);
console.log(response.payload.git);
```

For D1-backed models, `create()` delegates to the relevant store and returns the created entity.

### Work-Day And Task Lifecycle

Use the dedicated methods for orchestration instead of the generic mutation surface when you are writing manager or worker code.

Start a work day:

```ts
const workDay = await sdk.startWorkDay({
	projectId: 'treeseed-market',
	capacityBudget: 100,
	actor: 'manager',
});
```

Create and claim a task:

```ts
const task = await sdk.createTask({
	workDayId: String(workDay.payload?.id),
	agentId: 'market-curator',
	type: 'agent_root',
	idempotencyKey: `${workDay.payload?.id}:market-curator`,
	payload: { trigger: 'startup' },
	actor: 'manager',
});

await sdk.claimTask({
	id: String(task.payload?.id),
	workerId: 'worker-1',
	leaseSeconds: 120,
	actor: 'worker-1',
});
```

Complete a task:

```ts
await sdk.completeTask({
	id: String(task.payload?.id),
	output: { ok: true },
	summary: { status: 'completed' },
	actor: 'worker-1',
});
```

## Development Workflow

For SDK package work:

```bash
npm install
npm run build
npm test
```

When changing the control plane:

- update the typed models first
- update the D1 store and any HTTP clients second
- keep orchestration semantics in the dedicated task/workday APIs, not hidden in ad hoc generic `update()` calls

### Update Existing Records

Use `update()` when you want to modify an existing content-backed or D1-backed record.

```ts
const response = await sdk.update({
	model: 'objective',
	slug: 'make-the-sample-site-easy-to-operate',
	actor: 'app-server',
	data: {
		status: 'live',
		body: 'The objective is now complete and documented.',
	},
});
```

For content-backed models, `update()` returns the updated item and git metadata. For D1-backed models, it returns the updated row or `null` when no matching record exists.

Pass `expectedVersion` when you want optimistic update safety. The SDK compares the supplied value against the record’s current version marker before applying the update and throws on mismatch.

Use `resolveSdkRecordVersion(record)` when you need a stable version token from a returned content or D1 entity.

### Work With Messages

The SDK exposes dedicated queue helpers in addition to generic model access.

Create a message:

```ts
const created = await sdk.createMessage({
	type: 'guidance_ready',
	actor: 'guide-agent',
	payload: {
		slug: 'guides/getting-started/1-introduction',
	},
	relatedModel: 'knowledge',
	relatedId: 'guides/getting-started/1-introduction',
	priority: 5,
	maxAttempts: 3,
});
```

Claim a message:

```ts
const claimed = await sdk.claimMessage({
	workerId: 'worker-1',
	messageTypes: ['guidance_ready'],
	leaseSeconds: 300,
});
```

Acknowledge a message:

```ts
await sdk.ackMessage({
	id: 1,
	status: 'completed',
});
```

### Record Agent Runs, Cursors, And Leases

Record a run:

```ts
await sdk.recordRun({
	run: {
		runId: 'run-123',
		agentSlug: 'guide-agent',
		status: 'completed',
		triggerSource: 'message',
		startedAt: '2026-04-07T00:00:00.000Z',
		finishedAt: '2026-04-07T00:05:00.000Z',
	},
});
```

Read and update a cursor:

```ts
const cursor = await sdk.getCursor({
	agentSlug: 'guide-agent',
	cursorKey: 'knowledge-sync',
});

await sdk.upsertCursor({
	agentSlug: 'guide-agent',
	cursorKey: 'knowledge-sync',
	cursorValue: '2026-04-07T00:00:00.000Z',
});
```

Release one lease or all leases:

```ts
await sdk.releaseLease({
	model: 'objective',
	itemKey: 'make-the-sample-site-easy-to-operate',
	leaseToken: 'lease-token',
});

await sdk.releaseAllLeases();
```

### How TreeSeed Uses Agent Runs, Cursors, And Leases

These three concepts are the operational state layer for TreeSeed's agent runtime. They are not general content models like `page` or `knowledge`. Instead, they let TreeSeed coordinate ongoing agent work safely and make that work inspectable after the fact.

#### Agent Runs

An `agent_run` is the execution trace for one agent invocation.

TreeSeed records a run when the agent kernel starts an agent, and records it again when the run finishes or fails. In practice, that means a run captures:

- which agent ran
- what triggered it
- the current status such as `running`, `completed`, `failed`, or `waiting`
- which message or item was selected
- summary or error output
- optional branch, commit, PR, and changed-path metadata
- start and finish timestamps

In the TreeSeed agent runtime, [`agent/src/agents/kernel/agent-kernel.ts`](/home/adrian/Projects/treeseed/agent/src/agents/kernel/agent-kernel.ts) calls `sdk.recordRun()` at the beginning of execution and again after the handler returns. That gives TreeSeed a durable per-run audit trail for:

- debugging agent behavior
- understanding why an agent did or did not run
- inspecting outputs from planner, reviewer, notifier, and similar handlers
- connecting downstream events back to the run that produced them

Conceptually, `agent_run` is the answer to: "What happened during this agent invocation?"

#### Agent Cursors

An `agent_cursor` is a tiny per-agent checkpoint. It stores one named progress marker as:

- `agentSlug`
- `cursorKey`
- `cursorValue`

TreeSeed uses cursors to remember where an agent last left off, so the next cycle can resume from the correct point instead of starting over.

In the runtime, cursors are used in a few concrete ways:

- the agent kernel writes `last_run_at` after a successful run
- follow triggers read a cursor like `follow:model-a,model-b` to know which timestamp to compare against
- the sample planner agent writes `last_priority_run_at`
- the sample notifier agent reads and updates `last_notified_at` so it only announces new activity

You can see that usage in:

- [`agent/src/agents/kernel/agent-kernel.ts`](/home/adrian/Projects/treeseed/agent/src/agents/kernel/agent-kernel.ts)
- [`agent/src/agents/kernel/trigger-resolver.ts`](/home/adrian/Projects/treeseed/agent/src/agents/kernel/trigger-resolver.ts)
- [`planner.ts`](/home/adrian/Projects/treeseed/core/.fixtures/treeseed-fixtures/sites/working-site/src/agents/planner.ts)
- [`notifier.ts`](/home/adrian/Projects/treeseed/core/.fixtures/treeseed-fixtures/sites/working-site/src/agents/notifier.ts)

Conceptually, `agent_cursor` is the answer to: "Where should this agent continue from next time?"

#### Content Leases

A `content_lease` is a short-lived claim on one content item. TreeSeed uses leases to avoid two workers picking and mutating the same item at the same time.

When `pick()` runs against a content-backed model, the SDK does not just choose the "best" item. It also tries to claim a lease in the database. If another worker already holds a live lease for that item, the claim fails and the picker moves on.

Each lease stores:

- the model
- the item key
- who claimed it
- when it was claimed
- when the lease expires
- a lease token

This is how TreeSeed prevents duplicate work during autonomous or parallel agent execution, especially for content-backed tasks like selecting the next note, question, or objective to act on.

In the SDK, the lease flow is wired through:

- content selection in [`sdk/src/content-store.ts`](/home/adrian/Projects/treeseed/sdk/src/content-store.ts)
- D1 lease persistence in [`sdk/src/stores/lease-store.ts`](/home/adrian/Projects/treeseed/sdk/src/stores/lease-store.ts)
- runtime cleanup through `releaseLease()` and `releaseAllLeases()`

The agent kernel exposes that cleanup path as `releaseLeases()` so TreeSeed operators can clear stale claims when needed.

Conceptually, `content_lease` is the answer to: "Who currently owns this piece of work, and when does that claim expire?"

#### How They Work Together

In TreeSeed, these records solve different parts of the same runtime problem:

- `agent_run` records what happened
- `agent_cursor` records where to resume
- `content_lease` records who currently owns a piece of work

Together, they make the agent system:

- inspectable, because each run leaves a trace
- incremental, because agents can continue from saved cursors
- concurrency-safe, because content picking is guarded by leases

That combination is what lets TreeSeed move from one-off scripts toward a manageable long-running agent runtime.

### Discover Agent Specs

When your application stores agent definitions in content, use `listRawAgentSpecs()` or `listAgentSpecs()`.

```ts
const specs = await sdk.listAgentSpecs({ enabled: true });

for (const spec of specs) {
	console.log(spec.slug, spec.handler);
}
```

Use `listRawAgentSpecs()` when you want the underlying content entries. Use `listAgentSpecs()` when you want normalized runtime specs.

### Restrict Access With `ScopedAgentSdk`

Use `scopeForAgent()` when you want application code to enforce an agent’s declared permissions before executing SDK operations.

```ts
const scoped = sdk.scopeForAgent({
	slug: 'guide-agent',
	permissions: [
		{ model: 'knowledge', operations: ['get', 'read', 'search'] },
		{ model: 'message', operations: ['create'] },
	],
});

await scoped.search({
	model: 'knowledge',
	filters: [{ field: 'tags', op: 'contains', value: 'treeseed' }],
});
```

`ScopedAgentSdk` automatically injects the agent slug as `actor` for `create()`, `update()`, and `createMessage()`, and throws when the requested operation is not allowed.

### Model And Filter Notes

The SDK resolves model aliases for you. For example, `docs` maps to `knowledge` and `people` maps to `person`.

Common request fields:

- `model`: the canonical model or an accepted alias
- `filters`: array of `{ field, op, value }`
- `sort`: array of `{ field, direction }`
- `limit`: max number of returned items

Common filter operators include:

- `eq`
- `in`
- `contains`
- `prefix`
- `gt`
- `gte`
- `lt`
- `lte`
- `updated_since`
- `related_to`

### Envelope Pattern

Every top-level SDK call returns a consistent envelope:

```ts
const response = await sdk.search({ model: 'person', limit: 1 });

response.ok;        // true
response.model;     // 'person'
response.operation; // 'search'
response.payload;   // typed result
response.meta;      // optional metadata
```

That envelope shape makes it straightforward to use the SDK in API handlers, background jobs, CLIs, and agent runtimes without introducing a second application-specific response format.

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

For fixture-driven development, the SDK also recognizes the shared submodule fixture at `.fixtures/treeseed-fixtures/sites/working-site`.

Example with an explicit root:

```ts
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
	repoRoot: '/absolute/path/to/site-or-fixture-root',
});
```

## Local Development

Initialize the shared fixtures submodule before running fixture-backed tests:

```bash
git submodule update --init --recursive
```

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

The canonical shared fixture lives in the pinned `treeseed-fixtures` submodule at `.fixtures/treeseed-fixtures/sites/working-site`.

It serves three purposes at once:

- a small documentation surface about working with TreeSeed
- the default local test ground for content-backed SDK behavior
- a concrete example of a valid `repoRoot` for `AgentSdk`

You can point the SDK at it directly:

```ts
import path from 'node:path';
import { AgentSdk } from '@treeseed/sdk';

const sdk = new AgentSdk({
	repoRoot: path.resolve('.fixtures/treeseed-fixtures/sites/working-site'),
});
```

The fixture includes representative entries for pages, notes, questions, objectives, books, knowledge, people, and agents so local queries behave like a small real site instead of a synthetic stub.

Shared fixture commands:

```bash
npm run fixtures:resolve
npm run fixtures:check
```

- `fixtures:resolve`: prints the active shared fixture root
- `fixtures:check`: verifies that the pinned shared fixture is initialized and usable
