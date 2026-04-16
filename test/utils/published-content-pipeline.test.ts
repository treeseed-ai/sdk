import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPublishedContentPipeline } from '../../src/platform/published-content-pipeline.ts';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from '../../src/platform/contracts.ts';

function writeContentFile(root: string, relativePath: string, body: string) {
	const filePath = resolve(root, relativePath);
	mkdirSync(resolve(filePath, '..'), { recursive: true });
	writeFileSync(filePath, body, 'utf8');
	return filePath;
}

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-published-content-pipeline-'));
	const tenantConfig: TreeseedTenantConfig = {
		id: 'pipeline-site',
		siteConfigPath: './src/config.yaml',
		content: {
			pages: resolve(root, 'src/content/pages'),
			questions: resolve(root, 'src/content/questions'),
			objectives: resolve(root, 'src/content/objectives'),
			agents: resolve(root, 'src/content/agents'),
			templates: resolve(root, 'src/content/templates'),
			knowledge_packs: resolve(root, 'src/content/knowledge_packs'),
			docs: resolve(root, 'src/content/knowledge'),
			workdays: resolve(root, 'src/content/workdays'),
		},
		features: {
			docs: true,
			books: true,
		},
		site: {
			models: {
				workdays: { rendered: false },
				knowledge_packs: { rendered: false },
			},
		},
	};
	const siteConfig: TreeseedDeployConfig = {
		name: 'Pipeline Site',
		slug: 'pipeline-site',
		siteUrl: 'https://pipeline.example.com',
		contactEmail: 'hello@pipeline.example.com',
		cloudflare: {
			accountId: 'account-123',
			r2: {
				binding: 'TREESEED_CONTENT_BUCKET',
				bucketName: 'pipeline-site-content',
				manifestKeyTemplate: 'teams/{teamId}/published/common.json',
				previewRootTemplate: 'teams/{teamId}/previews',
				previewTtlHours: 24,
			},
		},
		providers: {
			content: {
				runtime: 'team_scoped_r2_overlay',
				publish: 'team_scoped_r2_overlay',
				docs: 'default',
			},
		},
	};

	writeContentFile(root, 'src/content/pages/home.mdx', `---
title: Home
slug: home
status: live
updatedAt: 2026-04-15T00:00:00.000Z
---
Welcome home.
`);
	writeContentFile(root, 'src/content/questions/queue-budget.mdx', `---
title: How should we cap the queue?
slug: queue-budget
status: open
relatedObjectives:
  - reduce-spend
updatedAt: 2026-04-15T00:00:00.000Z
---
Queue budgeting notes.
`);
	writeContentFile(root, 'src/content/objectives/reduce-spend.mdx', `---
title: Reduce spend
slug: reduce-spend
status: active
relatedQuestions:
  - queue-budget
updatedAt: 2026-04-14T00:00:00.000Z
---
Reduce spend across the work day.
`);
	writeContentFile(root, 'src/content/agents/planner.mdx', `---
name: Planner
slug: planner
enabled: true
runtimeStatus: active
updatedAt: 2026-04-14T00:00:00.000Z
---
Planner agent.
`);
	writeContentFile(root, 'src/content/templates/starter.mdx', `---
title: Starter Template
slug: starter
listingEnabled: true
offer:
  priceModel: subscription
fulfillment:
  source:
    kind: r2
    objectKey: teams/team-1/artifacts/template-starter-v1.tgz
    version: 1.0.0
    integrity: starter-sha
updatedAt: 2026-04-15T00:00:00.000Z
---
Starter template.
`);
	writeContentFile(root, 'src/content/knowledge_packs/architecture.mdx', `---
title: Architecture Pack
slug: architecture-pack
listingEnabled: true
offer:
  priceModel: free
updatedAt: 2026-04-13T00:00:00.000Z
---
Architecture pack.
`);
	writeContentFile(root, 'src/content/workdays/2026-04-15-workday-1--report-1.mdx', `---
title: Workday Report 1
slug: workdays/2026-04-15/workday-1/report-1
workDayId: workday-1
reportVersion: report-1
projectId: pipeline-site
environment: staging
workdayState: completed
generatedAt: 2026-04-15T12:00:00.000Z
startedAt: 2026-04-15T09:00:00.000Z
endedAt: 2026-04-15T12:00:00.000Z
summary: Completed the first workday report.
changedFiles:
  - src/content/workdays/2026-04-15-workday-1--report-1.mdx
releases: []
---
Workday report content.
`);
	writeContentFile(root, 'src/content/knowledge/index.mdx', `---
title: Knowledge Home
slug: knowledge
updatedAt: 2026-04-12T00:00:00.000Z
---
Knowledge home.
`);

	return { root, tenantConfig, siteConfig };
}

describe('published content pipeline', () => {
	afterEach(() => {
		// Tests create isolated temp dirs; remove all matching roots opportunistically.
	});

	it('builds a generic production manifest across content models and catalog surfaces', async () => {
		const { root, tenantConfig, siteConfig } = createFixture();
		try {
			const pipeline = createPublishedContentPipeline({
				projectRoot: root,
				siteConfig,
				tenantConfig,
				teamId: 'team-1',
				generatedAt: '2026-04-15T12:00:00.000Z',
				sourceCommit: 'abcdef123456',
				sourceRef: 'staging',
			});

			const built = await pipeline.buildProductionRevision();

			expect(built.manifest.mode).toBe('production');
			expect(built.manifest.entries.map((entry) => entry.model)).toEqual(
				expect.arrayContaining(['pages', 'questions', 'objectives', 'agents', 'templates', 'knowledge_packs', 'docs', 'workdays']),
			);
			expect(built.manifest.collections).toHaveProperty('templates');
			expect(built.manifest.runtime).toHaveProperty('docsTree');
			expect(built.manifest.runtime).toHaveProperty('searchIndex');
			expect(built.catalog).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: 'template',
					slug: 'starter',
					offerMode: 'subscription',
				}),
				expect.objectContaining({
					kind: 'knowledge_pack',
					slug: 'architecture-pack',
					offerMode: 'free',
				}),
			]));
			expect(built.manifest.artifacts).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: 'template_artifact',
					itemId: 'starter',
				}),
			]));
			expect(built.objects.length).toBeGreaterThan(built.manifest.entries.length);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('keeps non-rendered site models in the published content pipeline', async () => {
		const { root, tenantConfig, siteConfig } = createFixture();
		try {
			const pipeline = createPublishedContentPipeline({
				projectRoot: root,
				siteConfig,
				tenantConfig,
				teamId: 'team-1',
				generatedAt: '2026-04-15T12:00:00.000Z',
				sourceCommit: 'abcdef123456',
				sourceRef: 'staging',
			});

			const built = await pipeline.buildProductionRevision();
			expect(built.manifest.entries).toEqual(expect.arrayContaining([
				expect.objectContaining({ model: 'workdays' }),
				expect.objectContaining({ model: 'knowledge_packs' }),
			]));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('builds editorial overlays with only changed entries, changed runtime data, and tombstones', async () => {
		const { root, tenantConfig, siteConfig } = createFixture();
		try {
			const initialPipeline = createPublishedContentPipeline({
				projectRoot: root,
				siteConfig,
				tenantConfig,
				teamId: 'team-1',
				generatedAt: '2026-04-15T12:00:00.000Z',
				sourceCommit: 'abcdef123456',
				sourceRef: 'staging',
			});
			const initial = await initialPipeline.buildProductionRevision();

			writeFileSync(resolve(root, 'src/content/questions/queue-budget.mdx'), `---
title: How should we cap the queue?
slug: queue-budget
status: urgent
relatedObjectives:
  - reduce-spend
updatedAt: 2026-04-16T00:00:00.000Z
---
Queue budgeting notes updated.
`, 'utf8');
			unlinkSync(resolve(root, 'src/content/pages/home.mdx'));

			const overlayPipeline = createPublishedContentPipeline({
				projectRoot: root,
				siteConfig,
				tenantConfig,
				teamId: 'team-1',
				generatedAt: '2026-04-16T12:00:00.000Z',
				sourceCommit: 'fedcba654321',
				sourceRef: 'staging',
				previewId: 'preview-1',
			});
			const overlay = await overlayPipeline.buildEditorialOverlay({
				previousManifest: initial.manifest,
				previewId: 'preview-1',
			});

			expect(overlay.overlay.mode).toBe('editorial_overlay');
			expect(overlay.overlay.entries).toHaveLength(1);
			expect(overlay.overlay.entries[0]).toMatchObject({
				model: 'questions',
				slug: 'queue-budget',
				status: 'urgent',
			});
			expect(overlay.overlay.tombstones).toEqual(expect.arrayContaining([
				expect.objectContaining({
					path: 'pages/home',
				}),
			]));
			expect(overlay.objects.every((object) =>
				object.pointer.objectKey.startsWith('teams/team-1/objects/')
				|| object.pointer.objectKey.startsWith('teams/team-1/artifacts/'),
			)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
