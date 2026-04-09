import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { AgentSdk } from '../../src/sdk.ts';

function createGraphFixtureSite() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-graph-site-'));
	const contentRoot = resolve(root, 'src', 'content');
	for (const directory of ['questions', 'objectives', 'people', 'knowledge', 'templates']) {
		mkdirSync(resolve(contentRoot, directory), { recursive: true });
	}

	writeFileSync(
		resolve(contentRoot, 'people', 'market-steward.mdx'),
		`---
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
title: How Should Planning Work?
date: 2026-04-08
status: live
tags: [planning, graph]
questionType: strategy
primaryContributor: people/market-steward
relatedObjectives:
  - objectives/launch-market-site
---

Planning needs a retrieval system that can follow references across the working corpus.
`,
		'utf8',
	);

	writeFileSync(
		resolve(contentRoot, 'objectives', 'launch-market-site.mdx'),
		`---
title: Launch The Market Site
date: 2026-04-08
status: in progress
tags: [planning, delivery]
timeHorizon: near-term
primaryContributor: people/market-steward
relatedQuestions:
  - questions/how-should-planning-work
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
title: Planning Handbook
tags: [planning]
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
		resolve(contentRoot, 'templates', 'starter-basic.mdx'),
		`---
slug: starter-basic
title: Starter Basic
status: live
category: starter
tags: [planning, starter]
templateVersion: 1.0.0
---

Starter Basic gives the graph a custom content model to index.
`,
		'utf8',
	);

	return root;
}

function createSdk(repoRoot: string) {
	return new AgentSdk({
		repoRoot,
		database: new MemoryAgentDatabase(),
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
			totalFiles: 5,
			totalEntities: 5,
		});

		const fileResults = await sdk.searchFiles('capacity budget');
		const sectionResults = await sdk.searchSections('capacity budget');
		const entityResults = await sdk.searchEntities('starter basic');

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

	it('keeps stable section ids across unchanged refreshes and reparses only changed files', async () => {
		const repoRoot = createGraphFixtureSite();
		const sdk = createSdk(repoRoot);
		await sdk.refreshGraph();

		const before = (await sdk.searchSections('capacity budget'))[0]!.node;
		expect(before.id).toContain('capacity-budget');

		const unchangedRefresh = await sdk.refreshGraph();
		expect(unchangedRefresh.changed.added).toEqual([]);
		expect(unchangedRefresh.changed.modified).toEqual([]);
		expect((await sdk.searchSections('capacity budget'))[0]!.node.id).toBe(before.id);

		const objectivePath = resolve(repoRoot, 'src', 'content', 'objectives', 'launch-market-site.mdx');
		writeFileSync(
			objectivePath,
			`---
title: Launch The Market Site
date: 2026-04-08
status: in progress
tags: [planning, delivery]
timeHorizon: near-term
primaryContributor: people/market-steward
relatedQuestions:
  - questions/how-should-planning-work
---

Intro context before headings.

## Capacity Budget

The execution budget governs what can fit into a single work day.
`,
			'utf8',
		);

		const changedRefresh = await sdk.refreshGraph({ paths: [objectivePath] });
		expect(changedRefresh.changed.modified).toHaveLength(1);

		const after = (await sdk.searchSections('execution budget'))[0]!.node;
		expect(after.id).toBe(before.id);
	});
});
