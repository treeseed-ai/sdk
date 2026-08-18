import { mkdirSync,writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
import { localTreeDxContentProjects } from '../../../src/platform/desired-state/safe-tree-dx-repository-name.ts';

describe('local TreeDX project repository inputs', () => {
	it('seeds repository documentation beside content for production agent access', () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-project-'));
		mkdirSync(join(root, 'seeds'), { recursive: true });
		mkdirSync(join(root, 'src/content'), { recursive: true });
		mkdirSync(join(root, 'docs'), { recursive: true });
		mkdirSync(join(root, 'guarantees'), { recursive: true });
		writeFileSync(join(root, 'src/content/page.md'), '# Page\n');
		writeFileSync(join(root, 'docs/architecture.md'), '# Architecture\n');
		writeFileSync(join(root, 'package.json'), '{}\n');
		writeFileSync(join(root, 'treeseed.site.yaml'), 'version: 1\n');
		writeFileSync(join(root, 'seeds/treeseed.yaml'), `resources:\n  projects:\n    - slug: market\n      repository:\n        checkoutPath: .\n      architecture:\n        contentPath: src/content\n`);
		expect(localTreeDxContentProjects(root)[0]?.seedPaths).toEqual(['src/content', 'docs', 'guarantees', 'package.json', 'treeseed.site.yaml']);
	});

	it('uses the documentation root once when content is nested below it', () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-package-'));
		mkdirSync(join(root, 'seeds'), { recursive: true });
		mkdirSync(join(root, 'packages/example/docs/src/content'), { recursive: true });
		writeFileSync(join(root, 'packages/example/docs/src/content/page.md'), '# Page\n');
		writeFileSync(join(root, 'seeds/treeseed.yaml'), `resources:\n  projects:\n    - slug: example\n      repository:\n        checkoutPath: packages/example\n      architecture:\n        contentPath: docs/src/content\n`);
		expect(localTreeDxContentProjects(root)[0]?.seedPaths).toEqual(['docs']);
	});

	it('derives content paths and retains projects whose documentation is not prepared', () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-project-closure-'));
		mkdirSync(join(root, 'seeds'), { recursive: true });
		mkdirSync(join(root, 'packages/ready/docs/src/content'), { recursive: true });
		mkdirSync(join(root, 'packages/planned/guarantees'), { recursive: true });
		writeFileSync(join(root, 'packages/ready/docs/src/content/page.md'), '# Page\n');
		writeFileSync(join(root, 'packages/planned/package.json'), '{"name":"planned"}\n');
		writeFileSync(join(root, 'seeds/treeseed.yaml'), `resources:
  projects:
    - slug: ready
      repository:
        checkoutPath: packages/ready
      architecture:
        sitePath: docs
    - slug: planned
      repository:
        checkoutPath: packages/planned
      architecture:
        sitePath: docs
`);

		expect(localTreeDxContentProjects(root).map((project) => ({
			slug: project.slug,
			contentPath: project.contentPath,
			seedPaths: project.seedPaths,
		}))).toEqual([
			{ slug: 'ready', contentPath: 'docs/src/content', seedPaths: ['docs'] },
			{ slug: 'planned', contentPath: 'docs/src/content', seedPaths: ['docs/src/content', 'guarantees', 'package.json'] },
		]);
	});

	it('binds split content projects to the paired live GitHub staging repository', () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-remote-content-'));
		mkdirSync(join(root, 'seeds'), { recursive: true });
		writeFileSync(join(root, 'seeds/treeseed.yaml'), `resources:
  projects:
    - key: project:treeseed/admin
      team: team:treeseed
      slug: admin
      repository:
        checkoutPath: packages/admin
      architecture:
        topology: split_site_content
        sitePath: docs
        contentPath: src/content
  hubRepositories:
    - project: project:treeseed/admin
      role: content
      owner: treeseed-ai
      name: admin-content
      gitUrl: https://github.com/treeseed-ai/admin-content.git
      repositoryPolicy:
        visibility: private
`);

		expect(localTreeDxContentProjects(root)[0]).toMatchObject({
			projectKey: 'project:treeseed/admin',
			teamSlug: 'treeseed',
			contentPath: 'src/content',
			defaultRef: 'refs/heads/staging',
			remoteUrl: 'https://github.com/treeseed-ai/admin-content.git',
			remoteOwner: 'treeseed-ai',
			remoteName: 'admin-content',
			remoteVisibility: 'private',
			sourceBranch: 'staging',
			seedPaths: ['src/content'],
		});
	});

	it('composes the exact selected local seed inventory', () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-selected-seeds-'));
		mkdirSync(join(root, 'seeds'), { recursive: true });
		writeFileSync(join(root, 'seeds/treeseed.yaml'), `environments: [local]\nresources:\n  projects:\n    - key: project:treeseed/platform\n      slug: platform\n`);
		writeFileSync(join(root, 'seeds/market-singleton.yaml'), `environments: [local, staging, prod]\nresources:\n  projects:\n    - key: project:treeseed/market\n      slug: market\n  hubRepositories:\n    - key: repository:treeseed/market-content\n      project: project:treeseed/market\n      role: content\n      owner: treeseed-ai\n      name: market-content\n      gitUrl: https://github.com/treeseed-ai/market-content.git\n`);

		expect(localTreeDxContentProjects(root, ['treeseed', 'market-singleton']).map((project) => project.projectKey)).toEqual([
			'project:treeseed/platform',
			'project:treeseed/market',
		]);
		expect(localTreeDxContentProjects(root, ['market-singleton'])[0]).toMatchObject({
			projectKey: 'project:treeseed/market',
			remoteName: 'market-content',
		});
	});

	it('fails closed when selected seeds conflict on a project definition', () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-conflicting-seeds-'));
		mkdirSync(join(root, 'seeds'), { recursive: true });
		writeFileSync(join(root, 'seeds/one.yaml'), `environments: [local]\nresources:\n  projects:\n    - key: project:treeseed/example\n      slug: first\n`);
		writeFileSync(join(root, 'seeds/two.yaml'), `environments: [local]\nresources:\n  projects:\n    - key: project:treeseed/example\n      slug: second\n`);

		expect(() => localTreeDxContentProjects(root, ['one', 'two'])).toThrow(/conflicting TreeDX input project:treeseed\/example/u);
	});
});
