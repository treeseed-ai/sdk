import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryAgentDatabase } from '../../../../../src/persistence/d1-store.ts';

import { AgentSdk } from '../../../../../src/entrypoints/models/sdk.ts';

import type { SdkGraphRankingProvider } from '../../../../../src/entrypoints/models/sdk-types.ts';

function createGraphFixtureSite() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-graph-site-'));
	const contentRoot = resolve(root, 'src', 'content');
	for (const directory of ['questions', 'objectives', 'people', 'knowledge', 'templates']) {
		mkdirSync(resolve(contentRoot, directory), { recursive: true });
	}

	writeFileSync(
		resolve(contentRoot, 'people', 'market-steward.mdx'),
		`---
id: person:market-steward
name: Market Steward
role: Steward
affiliation: TreeSeed
status: live
tags: [operators]
---

The market steward keeps delivery grounded.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'questions', 'how-should-planning-work.mdx'),
		`---
id: question:planning-work
title: How Should Planning Work?
date: 2026-04-08
status: live
tags: [planning, graph]
questionType: strategy
primaryContributor: people/market-steward
relatedObjectives:
  - objectives/launch-market-site
dependsOn:
  - knowledge/planning
---

Planning needs a retrieval system that can follow references across the working corpus.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'objectives', 'launch-market-site.mdx'),
		`---
id: objective:launch-market-site
title: Launch The Market Site
date: 2026-04-08
status: in progress
tags: [planning, delivery]
timeHorizon: near-term
primaryContributor: people/market-steward
relatedQuestions:
  - questions/how-should-planning-work
about:
  - knowledge/planning
---

Intro context before headings.

## Capacity Budget

The capacity budget governs what can fit into a single work day.

### Execution Window

Execution depends on the capacity budget and the unresolved planning question.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'knowledge', 'planning.mdx'),
		`---
id: knowledge:planning
title: Planning Handbook
tags: [planning]
canonical: true
related:
  - objectives/launch-market-site
---

Overview text before sections.

## Reference Paths

Use the [capacity budget](../objectives/launch-market-site.mdx#capacity-budget) section to reason about daily work.

The Market Steward keeps the planning thread coherent.

## Broken Link

Follow [the missing section](./missing.mdx#nowhere) when diagnostics need an unresolved reference.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'knowledge', 'queue-architecture.mdx'),
		`---
id: knowledge:queue-architecture
title: Queue Architecture
type: architecture
status: canonical
audience: [agent, developer]
domain: infrastructure
updatedAt: 2026-04-10
tags: [queue]
related:
  - knowledge/queue-api
supersedes:
  - knowledge/queue-legacy
---

Queue architecture defines the planning topology for queue-backed work.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'knowledge', 'queue-api.mdx'),
		`---
id: knowledge:queue-api
title: Queue API Guide
type: api
status: live
audience: [developer]
domain: infrastructure
updatedAt: 2026-04-09
tags: [queue]
implements:
  - knowledge/queue-architecture
---

Queue API guide documents concrete queue endpoints, payloads, and implementation details.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'knowledge', 'queue-runbook.mdx'),
		`---
id: knowledge:queue-runbook
title: Queue Runbook
type: runbook
status: live
audience: [agent]
domain: infrastructure
updatedAt: 2026-04-08
tags: [queue]
references:
  - knowledge/queue-api
---

Queue runbook explains how to debug queue failures in production.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'knowledge', 'queue-legacy.mdx'),
		`---
id: knowledge:queue-legacy
title: Queue Legacy Design
type: architecture
status: deprecated
audience: [developer]
domain: infrastructure
updatedAt: 2024-01-15
tags: [queue]
related:
  - knowledge/queue-api
---

Queue legacy design describes the outdated queue layout that has been superseded.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'templates', 'fixture-template.mdx'),
		`---
id: template:fixture-template
slug: fixture-template
title: Fixture Template
status: live
category: starter
tags: [planning, starter]
templateVersion: 1.0.0
about:
  - knowledge/planning
---

Fixture Template gives the graph a custom content model to index.
`,
		'utf8',
	);

	return root;
}

function createSdk(repoRoot: string) {
	return createSdkWithProvider(repoRoot);
}

function createSdkWithProvider(repoRoot: string, graphRankingProvider?: SdkGraphRankingProvider) {
	return new AgentSdk({
			contentRepository: { adapter: 'local' },
		repoRoot,
		database: new MemoryAgentDatabase(),
		graphRankingProvider,
		models: [
			{
				name: 'template',
				aliases: ['templates'],
				storage: 'content',
				operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
				fields: {
					slug: { key: 'slug', filterable: true, contentKeys: ['slug'], writeContentKey: 'slug' },
					title: { key: 'title', filterable: true, sortable: true, contentKeys: ['title'], writeContentKey: 'title' },
					status: { key: 'status', filterable: true, contentKeys: ['status'], writeContentKey: 'status' },
					category: { key: 'category', filterable: true, contentKeys: ['category'], writeContentKey: 'category' },
					tags: { key: 'tags', filterable: true, comparableAs: 'string_array', contentKeys: ['tags'], writeContentKey: 'tags' },
					template_version: { key: 'template_version', aliases: ['templateVersion'], filterable: true, sortable: true, contentKeys: ['template_version', 'templateVersion'], writeContentKey: 'template_version' },
				},
				filterableFields: ['slug', 'title', 'status', 'category', 'tags', 'template_version'],
				sortableFields: ['title', 'template_version'],
				pickField: 'template_version',
				contentCollection: 'templates',
				contentDir: resolve(repoRoot, 'src', 'content', 'templates'),
			},
		],
	});
}
describe('content graph runtime', () => {
it('builds graph queries and context packs from ctx syntax', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		const refresh = await sdk.refreshGraph();

		expect((refresh.metrics as any).validation).toMatchObject({
			missingIds: 0,
			duplicateIds: 0,
		});

		const parsed = await sdk.parseGraphDsl('ctx "planning" via depends_on,related depth 2 budget 300 as brief');
		const query = await sdk.queryGraph(parsed.query!);
		expect(query.seedIds.length).toBeGreaterThan(0);
		expect(query.nodes.some((entry) => entry.node.title === 'Planning Handbook')).toBe(true);

		const pack = await sdk.buildContextPack(parsed.query!);
		expect(pack.nodes.length).toBeGreaterThan(0);
		expect(pack.totalTokenEstimate).toBeGreaterThan(0);
		expect(pack.nodes.every((entry) => entry.provenance.seedIds.length > 0)).toBe(true);
	});

it('applies stage, scope, relation, where, and view controls', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		await sdk.refreshGraph();

		const planQuery = await sdk.queryGraph((await sdk.parseGraphDsl('ctx "queue" for plan in /knowledge limit 5 as brief')).query!);
		const implementQuery = await sdk.queryGraph((await sdk.parseGraphDsl('ctx "queue" for implement in /knowledge limit 5 as brief')).query!);
		expect(planQuery.nodes[0]?.node.title).toBe('Queue Architecture');
		expect(implementQuery.nodes[0]?.node.title).toBe('Queue API Guide');

		const scoped = await sdk.queryGraph((await sdk.parseGraphDsl('ctx #queue in /knowledge where status=canonical limit 5 as list')).query!);
		expect(scoped.nodes.every((entry) => entry.node.title?.includes('Queue') || entry.node.id.includes('queue'))).toBe(true);
		expect(scoped.nodes.some((entry) => entry.node.title === 'Queue Architecture')).toBe(true);
		expect(scoped.nodes.every((entry) => entry.node.status === 'canonical' || entry.node.nodeType === 'Tag')).toBe(true);

		const relationLimited = await sdk.queryGraph((await sdk.parseGraphDsl('ctx @question:planning-work via depends_on depth 1 as map')).query!);
		expect(relationLimited.nodes.some((entry) => entry.node.title === 'Planning Handbook')).toBe(true);
		expect(relationLimited.nodes.some((entry) => entry.node.title === 'Launch The Market Site')).toBe(false);

		const mapPack = await sdk.buildContextPack((await sdk.parseGraphDsl('ctx %architecture in /knowledge as map limit 3')).query!);
		expect(mapPack.nodes.length).toBeGreaterThan(0);
		expect(mapPack.nodes.every((entry) => entry.text === entry.node.title || entry.text === entry.node.id)).toBe(true);

		const fullPack = await sdk.buildContextPack((await sdk.parseGraphDsl('ctx "queue api" for implement in /knowledge as full budget 500')).query!);
		expect(fullPack.nodes.some((entry) => entry.text.includes('implementation details'))).toBe(true);
	});

it('uses bm25f lexical weighting and query-biased graph reranking', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		await sdk.refreshGraph();

		const lexical = await sdk.searchFiles('queue architecture');
		expect(lexical[0]?.node.title).toBe('Queue Architecture');

		const implementGraph = await sdk.queryGraph((await sdk.parseGraphDsl('ctx "queue" for implement in /knowledge limit 5 as brief')).query!);
		expect(implementGraph.nodes[0]?.node.title).toBe('Queue API Guide');
		expect(implementGraph.nodes[0]?.diagnostics?.lexicalScore).toBeGreaterThan(0);
		expect(implementGraph.nodes[0]?.diagnostics?.providerId).toBe('default-bm25f-ppr');

		const relatedGraph = await sdk.queryGraph((await sdk.parseGraphDsl('ctx @knowledge:queue-api via implements,related depth 1 as map')).query!);
		expect(relatedGraph.nodes.some((entry) => entry.node.title === 'Queue Architecture')).toBe(true);
	});
});
