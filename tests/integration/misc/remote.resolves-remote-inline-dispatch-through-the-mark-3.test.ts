import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	RemoteTreeseedAuthClient,
	RemoteTreeseedClient,
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from '../../../src/remote.ts';

import {
	MarketClient,
	addMarketProfile,
	listIntegratedMarketCatalog,
	loadMarketRegistryState,
	resolveDefaultCentralMarketBaseUrl,
	resolveMarketProfile,
} from '../../../src/market-client.ts';

import { AgentSdk } from '../../../src/sdk.ts';

import { findDispatchCapability } from '../../../src/dispatch.ts';

import {
	resolveTreeseedRemoteConfig,
	setTreeseedRemoteSession,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
} from '../../../src/operations/services/config-runtime.ts';

import {
	buildSecretMap,
	buildWranglerConfigContents,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
	resolveConfiguredSurfaceBaseUrl,
} from '../../../src/operations/services/deploy.ts';

import { loadCliDeployConfig } from '../../../src/operations/services/runtime-tools.ts';

import { MemoryAgentDatabase } from '../../../src/d1-store.ts';

import { sdkFixtureRoot } from '../../support/test-fixture.ts';

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-remote-test-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	mkdirSync(resolve(tenantRoot, '.treeseed', 'config'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  notes: ./src/content/notes\n  questions: ./src/content/questions\n  objectives: ./src/content/objectives\n  proposals: ./src/content/proposals\n  decisions: ./src/content/decisions\n  people: ./src/content/people\n  agents: ./src/content/agents\n  books: ./src/content/books\n  docs: ./src/content/knowledge\nfeatures:\n  docs: true\n  proposals: true\n  decisions: true\n');
	writeFileSync(resolve(tenantRoot, '.treeseed', 'config', 'machine.yaml'), 'version: 1\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
hosting:
  kind: hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
  pages:
    productionBranch: main
    stagingBranch: staging
  r2:
    binding: TREESEED_CONTENT_BUCKET
    manifestKeyTemplate: teams/{teamId}/published/common.json
    previewRootTemplate: teams/{teamId}/previews
    previewTtlHours: 168
services:
  workdayManager:
    enabled: true
    provider: railway
    railway:
      projectName: acme-docs
      serviceName: acme-docs-workday-manager
      rootDir: .
      schedule:
        - "0 9 * * 1-5"
  workerRunner:
    enabled: true
    provider: railway
    railway:
      projectName: acme-docs
      rootDir: .
  api:
    enabled: true
    provider: railway
    railway:
      projectName: acme-docs
      serviceName: acme-docs-api
      rootDir: .
    environments:
      staging:
        baseUrl: https://staging-api.example.com
        railwayEnvironment: staging
      prod:
        baseUrl: https://api.example.com
        railwayEnvironment: production
providers:
  forms: store_only
  agents:
    execution: codex
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: cloudflare
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
`, 'utf8');
	return tenantRoot;
}
describe('remote Treeseed support', () => {
beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-remote-home-')));
	});

afterEach(() => {
		vi.unstubAllEnvs();
	});

it('resolves remote inline dispatch through the market v1 contract', async () => {
		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			expect(String(input)).toBe('https://market.example.com/v1/projects/project-1/dispatch');
			const headers = Object.fromEntries(new Headers(init?.headers).entries());
			expect(headers.authorization).toBe('Bearer dispatch-token');
			expect(JSON.parse(String(init?.body))).toMatchObject({
				namespace: 'sdk',
				operation: 'read',
				preferredMode: 'prefer_remote',
			});
			return new Response(JSON.stringify({
				ok: true,
				mode: 'inline',
				namespace: 'sdk',
				operation: 'read',
				target: 'project_api',
				capability: findDispatchCapability('sdk', 'read'),
				payload: {
					ok: true,
					model: 'knowledge',
					operation: 'read',
					payload: { slug: 'remote-knowledge' },
				},
			}), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
				},
			});
		});
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
			dispatch: {
				projectId: 'project-1',
				marketBaseUrl: 'https://market.example.com',
				policy: 'prefer_remote',
				credentialSource: {
					type: 'bearer',
					token: 'dispatch-token',
				},
				fetchImpl: fetchMock,
			},
		});

		const result = await sdk.dispatch({
			operation: 'read',
			input: {
				model: 'knowledge',
				slug: 'research/inquiry/questions-as-records',
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			ok: true,
			mode: 'inline',
			target: 'project_api',
		});
	});

it('returns queued remote jobs for long-running dispatch operations', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			ok: true,
			mode: 'job',
			namespace: 'sdk',
			operation: 'refreshGraph',
			target: 'project_runner',
			capability: findDispatchCapability('sdk', 'refreshGraph'),
			job: {
				id: 'job-1',
				projectId: 'project-1',
				namespace: 'sdk',
				operation: 'refreshGraph',
				status: 'pending',
				preferredMode: 'prefer_remote',
				selectedTarget: 'project_runner',
				input: {},
				output: null,
				error: null,
				requestedByType: 'user',
				requestedById: 'user-1',
				assignedRunnerId: null,
				idempotencyKey: null,
				capability: findDispatchCapability('sdk', 'refreshGraph'),
				createdAt: '2026-04-15T00:00:00.000Z',
				updatedAt: '2026-04-15T00:00:00.000Z',
				startedAt: null,
				finishedAt: null,
				cancelledAt: null,
			},
		}), {
			status: 200,
			headers: {
				'content-type': 'application/json',
				[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			},
		}));
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
			dispatch: {
				projectId: 'project-1',
				marketBaseUrl: 'https://market.example.com',
				policy: 'prefer_remote',
				fetchImpl: fetchMock,
			},
		});

		const result = await sdk.dispatch({
			operation: 'refreshGraph',
			input: {},
		});

		expect(result).toMatchObject({
			ok: true,
			mode: 'job',
			target: 'project_runner',
			job: {
				id: 'job-1',
				status: 'pending',
			},
		});
	});
});
