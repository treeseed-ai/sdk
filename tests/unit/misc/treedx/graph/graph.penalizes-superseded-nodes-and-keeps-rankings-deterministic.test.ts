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
it('penalizes superseded nodes and keeps rankings deterministic', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		await sdk.refreshGraph();

		const reviewOne = await sdk.queryGraph((await sdk.parseGraphDsl('ctx @knowledge:queue-architecture for review in /knowledge via supersedes,related depth 1 limit 6 as list')).query!);
		const reviewTwo = await sdk.queryGraph((await sdk.parseGraphDsl('ctx @knowledge:queue-architecture for review in /knowledge via supersedes,related depth 1 limit 6 as list')).query!);
		expect(reviewOne.nodes.map((entry) => entry.node.id)).toEqual(reviewTwo.nodes.map((entry) => entry.node.id));

		const canonicalIndex = reviewOne.nodes.findIndex((entry) => entry.node.id === 'knowledge:queue-architecture');
		const legacyIndex = reviewOne.nodes.findIndex((entry) => entry.node.id === 'knowledge:queue-legacy');
		expect(canonicalIndex).toBeGreaterThanOrEqual(0);
		expect(legacyIndex).toBeGreaterThan(canonicalIndex);
	});

it('allows an explicit graph ranking provider override', async () => {
		const repoRoot = createGraphFixtureSite();
		const provider: SdkGraphRankingProvider = {
			id: 'test-override',
			buildIndex(input) {
				const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
				return {
					search(request) {
						const node = nodesById.get('knowledge:queue-runbook')!;
						return [{ node, score: request.query.includes('queue') ? 100 : 1, reason: 'override-search' }];
					},
					rankQuery(request) {
						const orderedIds = ['knowledge:queue-runbook', ...request.seedIds.filter((id) => id !== 'knowledge:queue-runbook')];
						return {
							providerId: 'test-override',
							nodes: orderedIds
								.filter((id) => nodesById.has(id))
								.map((id, index) => ({
									nodeId: id,
									score: 100 - index,
									depth: index === 0 ? 0 : 1,
									reasons: index === 0 ? ['override'] : ['seed'],
									seedIds: request.seedIds,
									viaEdgeTypes: [],
									diagnostics: {
										providerId: 'test-override',
										lexicalScore: 1,
										graphScore: 1,
										priorScore: 1,
										canonicalityScore: 1,
										freshnessScore: 1,
										stageScore: 1,
										finalScore: 1,
									},
								})),
							edgeIds: [],
						};
					},
				};
			},
		};

		const sdk = createSdkWithProvider(repoRoot, provider);
		await sdk.refreshGraph();
		const result = await sdk.queryGraph((await sdk.parseGraphDsl('ctx "queue" for debug in /knowledge limit 3 as brief')).query!);
		expect(result.providerId).toBe('test-override');
		expect(result.nodes[0]?.node.id).toBe('knowledge:queue-runbook');
	});
});
