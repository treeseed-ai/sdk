import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudflareApiRequestMock = vi.fn();
const runWranglerMock = vi.fn();

let kvCreated = false;
let d1Created = false;

const deployState = {
	version: 2,
	target: { kind: 'persistent', scope: 'staging' },
	identity: {
		teamId: 'acme',
		projectId: 'docs',
		slug: 'test',
		environment: 'staging',
		deploymentKey: 'acme-docs',
		environmentKey: 'acme-docs-staging',
	},
	workerName: 'acme-docs-edge-staging',
	kvNamespaces: {
		FORM_GUARD_KV: {
			name: 'acme-docs-form-guard-staging',
			id: 'dryrun-staging-form-guard',
			previewId: 'dryrun-staging-form-guard-preview',
		},
		SESSION: {
			name: 'acme-docs-session-staging',
			id: 'dryrun-staging-session',
			previewId: 'dryrun-staging-session-preview',
		},
	},
	d1Databases: {
		SITE_DATA_DB: {
			databaseName: 'acme-docs-site-data-staging',
			databaseId: 'dryrun-staging-site-data',
			previewDatabaseId: 'dryrun-staging-site-data-preview',
		},
	},
	queues: {
		agentWork: {
			name: 'acme-docs-agent-work-staging',
			dlqName: 'acme-docs-agent-work-dlq-staging',
			binding: 'AGENT_WORK_QUEUE',
			queueId: null,
			dlqId: null,
		},
	},
	pages: {
		projectName: 'acme-docs',
		productionBranch: 'main',
		stagingBranch: 'staging',
		buildOutputDir: 'dist',
		url: null,
	},
	content: {
		bucketName: 'acme-docs-content',
	},
	generatedSecrets: {},
	readiness: {},
	services: {},
	webCache: {},
};

vi.mock('../../src/operations/services/config-runtime.ts', () => ({
	collectTreeseedEnvironmentContext: () => ({
		entries: [
			{ id: 'TREESEED_PUBLIC_TURNSTILE_SITE_KEY', scopes: ['staging'], targets: ['cloudflare-var'] },
			{ id: 'TREESEED_TURNSTILE_SECRET_KEY', scopes: ['staging'], targets: ['cloudflare-secret'] },
		],
	}),
	resolveTreeseedMachineEnvironmentValues: () => ({
		CLOUDFLARE_ACCOUNT_ID: 'account-123',
		CLOUDFLARE_API_TOKEN: 'cf-token',
		TREESEED_PUBLIC_TURNSTILE_SITE_KEY: 'site-key',
		TREESEED_TURNSTILE_SECRET_KEY: 'secret-key',
	}),
}));

vi.mock('../../src/operations/services/deploy.ts', async () => {
	const actual = await vi.importActual<typeof import('../../src/operations/services/deploy.ts')>('../../src/operations/services/deploy.ts');
	return {
		...actual,
		buildProvisioningSummary: vi.fn(() => ({})),
		buildSecretMap: vi.fn(() => ({
			TREESEED_FORM_TOKEN_SECRET: 'generated-form-secret',
			TREESEED_EDITORIAL_PREVIEW_SECRET: 'generated-preview-secret',
		})),
		cloudflareApiRequest: cloudflareApiRequestMock,
		ensureGeneratedWranglerConfig: vi.fn(() => ({
			wranglerPath: '/tmp/treeseed-generated/wrangler.toml',
			state: deployState,
		})),
		hasProvisionedCloudflareResources: vi.fn(() => true),
		listD1Databases: vi.fn(() => (d1Created ? [{ name: 'acme-docs-site-data-staging', uuid: 'd1-1' }] : [])),
		listKvNamespaces: vi.fn(() => (kvCreated
			? [
				{ title: 'acme-docs-form-guard-staging', id: 'kv-form-1' },
				{ title: 'acme-docs-session-staging', id: 'kv-session-1' },
			]
			: [])),
		listPagesProjects: vi.fn(() => [{ name: 'acme-docs', subdomain: 'acme-docs.pages.dev' }]),
		listQueues: vi.fn(() => [
			{ name: 'acme-docs-agent-work-staging', id: 'queue-1' },
			{ name: 'acme-docs-agent-work-dlq-staging', id: 'queue-dlq-1' },
		]),
		listR2Buckets: vi.fn(() => [{ name: 'acme-docs-content' }]),
		loadDeployState: vi.fn(() => deployState),
		reconcileCloudflareWebCacheRules: vi.fn(),
		runWrangler: vi.fn((args: string[]) => {
			runWranglerMock(args);
			if (args[0] === 'kv' && args[1] === 'namespace' && args[2] === 'create') {
				kvCreated = true;
			}
			if (args[0] === 'd1' && args[1] === 'create') {
				d1Created = true;
			}
			return { status: 0, stdout: '', stderr: '' };
		}),
		writeDeployState: vi.fn(),
	};
});

describe('cloudflare reconcile adapters', () => {
	beforeEach(() => {
		kvCreated = false;
		d1Created = false;
		cloudflareApiRequestMock.mockReset();
		runWranglerMock.mockReset();
		cloudflareApiRequestMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
			if (options?.method === 'POST' && path.includes('/d1/database')) {
				d1Created = true;
				return { success: true, result: { uuid: 'd1-1' } };
			}
			if (options?.method === 'PATCH') {
				return { success: true, result: { path, body: options.body } };
			}
			return {
				success: true,
				result: {
					deployment_configs: {
						preview: { env_vars: { EXISTING_VAR: { type: 'plain_text', value: 'keep' } } },
						production: { env_vars: {} },
					},
				},
			};
		});
	});

	it('creates live KV and D1 resources when deploy state still has placeholder ids and syncs Pages env vars', async () => {
		const { createCloudflareReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createCloudflareReconcileAdapters().find((entry) => entry.unitTypes.includes('queue'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'queue:acme-docs-agent-work-staging',
			unitType: 'queue',
			provider: 'cloudflare',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'acme-docs-agent-work-staging',
			dependencies: [],
			spec: {},
			secrets: {},
			metadata: {},
			identity: deployState.identity,
		};
		const context = {
			tenantRoot: '/tmp/tenant',
			target: { kind: 'persistent', scope: 'staging' },
			deployConfig: {
				name: 'Test',
				slug: 'test',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				hosting: { kind: 'hosted_project', teamId: 'acme', projectId: 'docs' },
				runtime: { mode: 'treeseed_managed', registration: 'none', teamId: 'acme', projectId: 'docs' },
				providers: { content: { runtime: 'team_scoped_r2_overlay', publish: 'team_scoped_r2_overlay' } },
				cloudflare: {
					accountId: 'account-123',
					queueName: 'agent-work',
					dlqName: 'agent-work-dlq',
					queueBinding: 'AGENT_WORK_QUEUE',
					pages: { productionBranch: 'main', stagingBranch: 'staging' },
					r2: {},
				},
			},
			launchEnv: {},
			session: new Map(),
		};

		const observed = adapter!.observe({ unit, context } as never);
		const diff = adapter!.plan({ unit, context, observed } as never);
		await adapter!.reconcile({ unit, context, observed, diff } as never);

		expect(runWranglerMock).toHaveBeenCalledWith(['kv', 'namespace', 'create', 'acme-docs-form-guard-staging']);
		expect(
			cloudflareApiRequestMock.mock.calls.some(([path, options]) =>
				typeof path === 'string'
				&& path.includes('/d1/database')
				&& options?.method === 'POST'
				&& options?.body?.name === 'acme-docs-site-data-staging'
			),
		).toBe(true);

		const patchCall = cloudflareApiRequestMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
		expect(patchCall).toBeTruthy();
		expect(patchCall?.[1]?.body).toMatchObject({
			deployment_configs: {
				preview: {
					env_vars: {
						EXISTING_VAR: { type: 'plain_text', value: 'keep' },
						TREESEED_PUBLIC_TURNSTILE_SITE_KEY: { type: 'plain_text', value: 'site-key' },
						TREESEED_PROJECT_ID: { type: 'plain_text', value: 'docs' },
						TREESEED_HOSTING_TEAM_ID: { type: 'plain_text', value: 'acme' },
					},
				},
			},
		});
	});
});
