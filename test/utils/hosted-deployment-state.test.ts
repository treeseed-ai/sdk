import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createPersistentDeployTarget,
	loadDeployState,
	recordHostedDeploymentState,
} from '../../src/operations/services/deploy.ts';
import { loadCliDeployConfig } from '../../src/operations/services/runtime-tools.ts';

const roots: string[] = [];

function makeTenantRoot() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-hosted-deployment-state-'));
	roots.push(root);
	mkdirSync(resolve(root, 'src'), { recursive: true });
	writeFileSync(resolve(root, 'src', 'manifest.yaml'), 'content: []\n', 'utf8');
	writeFileSync(resolve(root, 'src', 'config.yaml'), 'site:\n  title: Hosted Deployment\n', 'utf8');
	writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Hosted Deployment
slug: hosted-deployment
siteUrl: https://example.com
contactEmail: hello@example.com
surfaces:
  web:
    publicBaseUrl: https://example.com
hosting:
  kind: hosted_project
  teamId: team
  projectId: project
cloudflare:
  accountId: account
providers:
  deploy: cloudflare
`, 'utf8');
	return root;
}

describe('hosted deployment state', () => {
	afterEach(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('records successful hosted deploy gates into persistent deploy state', () => {
		const root = makeTenantRoot();

		const state = recordHostedDeploymentState(root, {
			scope: 'prod',
			commit: 'abc123',
			timestamp: '2026-05-07T02:30:00Z',
			workflow: 'deploy-web.yml',
			runId: 12345,
		});
		const persisted = loadDeployState(root, loadCliDeployConfig(root), {
			target: createPersistentDeployTarget('prod'),
		});

		expect(state.lastDeploymentTimestamp).toBe('2026-05-07T02:30:00Z');
		expect(persisted.lastDeploymentTimestamp).toBe('2026-05-07T02:30:00Z');
		expect(persisted.lastDeployedCommit).toBe('abc123');
		expect(persisted.lastDeployedUrl).toBe('https://example.com');
		expect(persisted.readiness).toMatchObject({
			initialized: true,
			configured: true,
			provisioned: true,
			deployable: true,
			phase: 'provisioned',
		});
		expect(persisted.deploymentHistory.at(-1)).toMatchObject({
			commit: 'abc123',
			timestamp: '2026-05-07T02:30:00Z',
			url: 'https://example.com',
			target: 'prod',
			source: 'hosted-github-workflow',
			workflow: 'deploy-web.yml',
			runId: 12345,
		});
	});
});
