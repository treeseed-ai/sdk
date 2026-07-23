import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryAgentDatabase } from '../../../src/d1-store.ts';

import { AgentSdk } from '../../../src/sdk.ts';

import type { SdkGraphRankingProvider } from '../../../src/sdk-types.ts';

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
it('builds file, section, and entity indexes including custom content models', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		const refresh = await sdk.refreshGraph();

		expect(refresh.ready).toBe(true);
		expect(refresh.metrics).toMatchObject({
			totalFiles: 9,
			totalEntities: 9,
		});

		const fileResults = await sdk.searchFiles('capacity budget');
		const sectionResults = await sdk.searchSections('capacity budget');
		const entityResults = await sdk.searchEntities('fixture template');

		expect(fileResults[0]?.node.title).toBe('Launch The Market Site');
		expect(sectionResults[0]?.node.heading).toBe('Capacity Budget');
		expect(entityResults.some((result) => result.node.sourceModel === 'template' && result.node.nodeType === 'Entity')).toBe(true);
	});

it('resolves frontmatter relationships, markdown section links, and unresolved references', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		await sdk.refreshGraph();

		const question = (await sdk.searchEntities('How Should Planning Work?'))[0]!.node;
		const objective = (await sdk.searchEntities('Launch The Market Site'))[0]!.node;
		const knowledgeFile = (await sdk.searchFiles('Planning Handbook'))[0]!.node;

		const traversal = await sdk.followReferences(question.id, { depth: 2 });
		expect(traversal.nodes.some((node) => node.id === objective.id)).toBe(true);

		const resolved = await sdk.resolveReference('../objectives/launch-market-site.mdx#capacity-budget', { fromNodeId: knowledgeFile.id });
		expect(resolved?.nodeType).toBe('Section');
		expect(resolved?.heading).toBe('Capacity Budget');

		const backlinks = await sdk.getBacklinks(objective.id);
		expect(backlinks.nodes.some((node) => node.id === question.id)).toBe(true);

		const brokenTraversal = await sdk.followReferences(knowledgeFile.id, { depth: 3 });
		expect(brokenTraversal.nodes.some((node) => node.nodeType === 'Reference')).toBe(true);
	});

it('parses the ctx DSL and enforces defaults and validation', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		const parsed = await sdk.parseGraphDsl('ctx "planning" via depends_on,related depth 2 budget 300 as brief');
		expect(parsed.ok).toBe(true);
		expect(parsed.query).toMatchObject({
			stage: 'plan',
			relations: ['depends_on', 'related'],
			view: 'brief',
			options: { depth: 2, limit: 8, maxNodes: 8 },
		});

		const invalid = await sdk.parseGraphDsl('root=query:planning depth=2');
		expect(invalid.ok).toBe(false);

		const invalidWhere = await sdk.parseGraphDsl('ctx @knowledge:planning where unknown=value');
		expect(invalidWhere.ok).toBe(false);
	});
});
