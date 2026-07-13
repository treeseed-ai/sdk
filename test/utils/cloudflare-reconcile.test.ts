import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cloudflareApiRequestMock = vi.fn();
const runWranglerMock = vi.fn();
const resolveTreeseedMachineEnvironmentValuesMock = vi.fn();
const upsertRailwayVariablesMock = vi.fn();
const deployRailwayServiceInstanceMock = vi.fn();
const ensureRailwayServiceMock = vi.fn();
const updateRailwayServiceImageSourceMock = vi.fn();
const updateRailwayServiceGitSourceMock = vi.fn();
const renderRailwayIacProjectMock = vi.fn();
const planRailwayIacProjectMock = vi.fn();
const applyRailwayIacProjectMock = vi.fn();
const cleanupRailwayIacRenderMock = vi.fn();
const railwayEnvMock = vi.fn();
const listRailwayCustomDomainsMock = vi.fn();
const listRailwayServiceDomainsMock = vi.fn();
const listRailwayEnvironmentServicesMock = vi.fn();
const ensureRailwayCustomDomainMock = vi.fn();
const deleteRailwayCustomDomainMock = vi.fn();

let kvCreated = false;
let d1Created = false;
let turnstileWidgets: Array<{ name: string; sitekey: string; secret?: string; domains?: string[]; mode?: string }> = [];

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
			binding: 'FORM_GUARD_KV',
			id: 'plan-staging-form-guard',
			previewId: 'plan-staging-form-guard-preview',
		},
	},
	d1Databases: {
		SITE_DATA_DB: {
			databaseName: 'acme-docs-site-data-staging',
			binding: 'SITE_DATA_DB',
			databaseId: 'plan-staging-site-data',
			previewDatabaseId: 'plan-staging-site-data-preview',
		},
	},
	queues: {
		agentWork: {
			name: 'acme-docs-background-events-staging',
			dlqName: 'acme-docs-background-events-dlq-staging',
			binding: 'BACKGROUND_EVENTS_QUEUE',
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
	turnstileWidgets: {
		formGuard: {
			name: 'acme-docs-turnstile-staging',
			sitekey: null,
			secret: null,
			mode: 'managed',
			domains: ['example.com'],
			managed: true,
			lastSyncedAt: null,
		},
	},
	content: {
		r2Binding: 'TREESEED_CONTENT_BUCKET',
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
			{ id: 'TREESEED_RAILWAY_WORKSPACE', scopes: ['staging'], targets: ['railway-var'] },
			{ id: 'TREESEED_GITHUB_TOKEN', scopes: ['staging'], targets: ['railway-secret'] },
		],
	}),
	resolveTreeseedMachineEnvironmentValues: resolveTreeseedMachineEnvironmentValuesMock,
}));

vi.mock('../../src/operations/services/deploy.ts', async () => {
	const actual = await vi.importActual<typeof import('../../src/operations/services/deploy.ts')>('../../src/operations/services/deploy.ts');
	return {
		...actual,
		buildProvisioningSummary: vi.fn(() => ({})),
		buildSecretMap: vi.fn(() => ({
			TREESEED_FORM_TOKEN_SECRET: 'generated-form-secret',
			TREESEED_EDITORIAL_PREVIEW_SECRET: 'generated-preview-secret',
			TREESEED_TURNSTILE_SECRET_KEY: deployState.turnstileWidgets.formGuard.secret,
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
			]
			: [])),
		listPagesProjects: vi.fn(() => [{ name: 'acme-docs', subdomain: 'acme-docs.pages.dev' }]),
		listQueues: vi.fn(() => [
			{ name: 'acme-docs-background-events-staging', id: 'queue-1' },
			{ name: 'acme-docs-background-events-dlq-staging', id: 'queue-dlq-1' },
		]),
		listR2Buckets: vi.fn(() => [{ name: 'acme-docs-content' }]),
		getTurnstileWidget: vi.fn((_env, sitekey) => {
			const widget = turnstileWidgets.find((entry) => entry.sitekey === sitekey);
			return widget ? { ...widget, domains: [...(widget.domains ?? [])] } : null;
		}),
		listTurnstileWidgets: vi.fn(() => turnstileWidgets.map((entry) => ({ ...entry, domains: [...(entry.domains ?? [])] }))),
		createTurnstileWidget: vi.fn((_env, input) => {
			const widget = {
				name: input.name,
				sitekey: 'managed-site-key',
				secret: 'managed-secret-key',
				domains: input.domains,
				mode: input.mode,
			};
			turnstileWidgets.push(widget);
			return widget;
		}),
		updateTurnstileWidget: vi.fn((_env, sitekey, input) => {
			const widget = turnstileWidgets.find((entry) => entry.sitekey === sitekey) ?? {
				name: input.name,
				sitekey,
				secret: 'managed-secret-key',
			};
			widget.name = input.name;
			widget.domains = input.domains;
			widget.mode = input.mode;
			return widget;
		}),
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

vi.mock('../../src/operations/services/railway-deploy.ts', () => ({
	configuredRailwayServices: vi.fn((tenantRoot: string, scope: string) => scope === 'staging'
		? [{
			key: 'api',
			provider: 'railway',
			rootDir: tenantRoot,
			projectId: null,
			projectName: 'acme-docs',
			serviceId: null,
			serviceName: 'api',
			railwayEnvironment: 'staging',
			buildCommand: null,
			startCommand: 'npm start',
			imageRef: null,
			sourceMode: 'git',
			sourceRepo: 'treeseed-ai/api',
			sourceBranch: 'staging',
			sourceCommit: 'abc123',
			sourceRootDirectory: '.',
			dockerfilePath: '/Dockerfile.api',
			healthcheckPath: null,
			healthcheckTimeoutSeconds: null,
			healthcheckIntervalSeconds: null,
			restartPolicy: null,
			runtimeMode: null,
		}]
		: []),
	ensureRailwayProjectContext: vi.fn(),
	runRailway: vi.fn(),
	validateRailwayDeployPrerequisites: vi.fn(),
}));

vi.mock('../../src/operations/services/railway-api.ts', () => ({
	deployRailwayServiceInstance: vi.fn(async (input: { env: Record<string, string> }) => {
		railwayEnvMock(input.env);
		deployRailwayServiceInstanceMock(input);
		return { deploymentId: 'deployment-1' };
	}),
	ensureRailwayEnvironment: vi.fn(async () => ({ environment: { id: 'env-1', name: 'staging' } })),
	ensureRailwayProject: vi.fn(async () => ({
		project: {
			id: 'project-1',
			name: 'acme-docs',
			environments: [{ id: 'env-1', name: 'staging' }],
			services: [{ id: 'service-1', name: 'api' }],
		},
	})),
	ensureRailwayService: vi.fn(async (input) => {
		ensureRailwayServiceMock(input);
		return { service: { id: 'service-1', name: 'api' } };
	}),
	ensureRailwayServiceInstanceConfiguration: vi.fn(async ({ env }: { env: Record<string, string> }) => {
		railwayEnvMock(env);
		return {
			instance: {
				id: 'instance-1',
				startCommand: 'npm start',
				rootDirectory: '.',
				runtimeConfigSupported: true,
			},
		};
	}),
	getRailwayProject: vi.fn(async () => null),
	getRailwayServiceInstance: vi.fn(async () => null),
	listRailwayEnvironmentServices: vi.fn((input) => listRailwayEnvironmentServicesMock(input)),
	listRailwayCustomDomains: vi.fn((input) => listRailwayCustomDomainsMock(input)),
	listRailwayServiceDomains: vi.fn((input) => listRailwayServiceDomainsMock(input)),
	ensureRailwayCustomDomain: vi.fn((input) => ensureRailwayCustomDomainMock(input)),
	deleteRailwayCustomDomain: vi.fn((input) => deleteRailwayCustomDomainMock(input)),
	listRailwayProjects: vi.fn(async ({ env }: { env: Record<string, string> }) => {
		railwayEnvMock(env);
		return [{
			id: 'project-1',
			name: 'acme-docs',
			environments: [{ id: 'env-1', name: 'staging' }],
			services: [{ id: 'service-1', name: 'api' }],
		}];
	}),
	listRailwayVariables: vi.fn(async () => ({})),
	listRailwayVolumes: vi.fn(async () => []),
	resolveRailwayWorkspaceContext: vi.fn(async ({ env }: { env: Record<string, string> }) => {
		railwayEnvMock(env);
		return { id: 'workspace-1', name: env.TREESEED_RAILWAY_WORKSPACE ?? 'workspace' };
	}),
	updateRailwayServiceGitSource: vi.fn(async (input: { env: Record<string, string> }) => {
		railwayEnvMock(input.env);
		updateRailwayServiceGitSourceMock(input);
		return { id: 'service-1', name: 'api' };
	}),
	updateRailwayServiceImageSource: vi.fn(async (input: { env: Record<string, string> }) => {
		railwayEnvMock(input.env);
		updateRailwayServiceImageSourceMock(input);
		return { id: 'service-1', name: 'api' };
	}),
	upsertRailwayVariables: vi.fn(async (input: { env: Record<string, string> }) => {
		railwayEnvMock(input.env);
		upsertRailwayVariablesMock(input);
	}),
}));

vi.mock('../../src/reconcile/providers/railway-iac.ts', () => ({
	renderRailwayIacProject: vi.fn((input) => {
		renderRailwayIacProjectMock(input);
		return {
			filePath: '/tmp/railway.mjs',
			tempDir: '/tmp',
			projectName: input.projectName,
			environmentName: input.environmentName,
			serviceNames: input.services.map((service: { serviceName: string }) => service.serviceName),
			volumeNames: [],
			databaseName: null,
			source: '',
		};
	}),
	planRailwayIacProject: vi.fn(async (input, rendered) => {
		planRailwayIacProjectMock(input, rendered);
		return { ok: true, diagnostics: [], changeSet: { changes: [] } };
	}),
	applyRailwayIacProject: vi.fn(async (input, rendered) => {
		applyRailwayIacProjectMock(input, rendered);
		return { ok: true, diagnostics: [], changeSet: { changes: [] } };
	}),
	validateRailwayIacChangeSet: vi.fn(() => ({
		ok: true,
		destructiveChanges: [],
		blockedReasons: [],
		allowedDrift: [],
	})),
	selectRailwayIacRetainedResources: vi.fn(() => []),
	cleanupRailwayIacRender: vi.fn((rendered) => cleanupRailwayIacRenderMock(rendered)),
}));

describe('cloudflare reconcile adapters', () => {
beforeEach(() => {
	kvCreated = false;
	d1Created = false;
	turnstileWidgets = [];
	deployState.turnstileWidgets.formGuard.sitekey = null;
	deployState.turnstileWidgets.formGuard.secret = null;
	deployState.turnstileWidgets.formGuard.domains = ['example.com'];
	deployState.pages.url = null;
	cloudflareApiRequestMock.mockReset();
		runWranglerMock.mockReset();
		upsertRailwayVariablesMock.mockReset();
		deployRailwayServiceInstanceMock.mockReset();
		ensureRailwayServiceMock.mockReset();
		updateRailwayServiceGitSourceMock.mockReset();
		updateRailwayServiceImageSourceMock.mockReset();
		renderRailwayIacProjectMock.mockReset();
		planRailwayIacProjectMock.mockReset();
		applyRailwayIacProjectMock.mockReset();
		cleanupRailwayIacRenderMock.mockReset();
		railwayEnvMock.mockReset();
		listRailwayCustomDomainsMock.mockReset();
		listRailwayServiceDomainsMock.mockReset();
		listRailwayEnvironmentServicesMock.mockReset();
		ensureRailwayCustomDomainMock.mockReset();
		deleteRailwayCustomDomainMock.mockReset();
		listRailwayCustomDomainsMock.mockResolvedValue([]);
		listRailwayServiceDomainsMock.mockResolvedValue([]);
		listRailwayEnvironmentServicesMock.mockResolvedValue([{ id: 'service-1', name: 'api' }]);
		ensureRailwayCustomDomainMock.mockResolvedValue({
			domain: {
				id: 'domain-1',
				domain: 'api.example.com',
				serviceId: 'service-1',
				dnsRecords: [{ type: 'CNAME', name: 'api.example.com', content: 'api.up.railway.app' }],
			},
			created: true,
		});
		deleteRailwayCustomDomainMock.mockResolvedValue({ status: 'deleted' });
		resolveTreeseedMachineEnvironmentValuesMock.mockReset();
		resolveTreeseedMachineEnvironmentValuesMock.mockImplementation(() => {
			throw new Error('machine key should not be read for hosted reconcile');
		});
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

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('creates live KV and D1 resources when deploy state still has placeholder ids and syncs Pages env vars', async () => {
		const { createCloudflareReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createCloudflareReconcileAdapters().find((entry) => entry.unitTypes.includes('queue'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'queue:acme-docs-background-events-staging',
			unitType: 'queue',
			provider: 'cloudflare',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'acme-docs-background-events-staging',
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
					queueName: 'background-events',
					dlqName: 'background-events-dlq',
					queueBinding: 'BACKGROUND_EVENTS_QUEUE',
					pages: { productionBranch: 'main', stagingBranch: 'staging' },
					r2: {},
				},
				turnstile: { enabled: true },
			},
			launchEnv: {},
			session: new Map(),
		};
		context.launchEnv = {
			TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
			TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
		};
		vi.stubEnv('TREESEED_PUBLIC_TURNSTILE_SITE_KEY', 'manual-site-key');

		const observed = adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		await adapter!.apply({ unit, context, observed, diff } as never);

		expect(runWranglerMock).toHaveBeenCalledWith(['kv', 'namespace', 'create', 'acme-docs-form-guard-staging']);
		expect(
			cloudflareApiRequestMock.mock.calls.some(([path, options]) =>
				typeof path === 'string'
				&& path.includes('/d1/database')
				&& options?.method === 'POST'
				&& options?.body?.name === 'acme-docs-site-data-staging'
			),
		).toBe(true);
		expect(deployState.turnstileWidgets.formGuard).toMatchObject({
			name: 'acme-docs-turnstile-staging',
			sitekey: 'managed-site-key',
			secret: 'managed-secret-key',
			mode: 'managed',
		});
		expect(deployState.turnstileWidgets.formGuard.domains).toEqual(expect.arrayContaining(['example.com', 'acme-docs.pages.dev']));

		const patchCall = cloudflareApiRequestMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
		expect(patchCall).toBeTruthy();
		expect(patchCall?.[1]?.body).toMatchObject({
			deployment_configs: {
				preview: {
					env_vars: {
						EXISTING_VAR: { type: 'plain_text', value: 'keep' },
						TREESEED_PUBLIC_TURNSTILE_SITE_KEY: { type: 'plain_text', value: 'managed-site-key' },
						TREESEED_PROJECT_ID: { type: 'plain_text', value: 'docs' },
						TREESEED_HOSTING_TEAM_ID: { type: 'plain_text', value: 'acme' },
					},
					kv_namespaces: {
						FORM_GUARD_KV: { namespace_id: 'kv-form-1' },
					},
					d1_databases: {
						SITE_DATA_DB: { id: 'd1-1' },
					},
					r2_buckets: {
						TREESEED_CONTENT_BUCKET: { name: 'acme-docs-content' },
					},
				},
			},
		});
		expect(resolveTreeseedMachineEnvironmentValuesMock).not.toHaveBeenCalled();
	});

	it('plans existing Pages projects for update when preview environment variables drift', async () => {
		const { createCloudflareReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createCloudflareReconcileAdapters().find((entry) => entry.unitTypes.includes('pages-project'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'pages-project:acme-docs',
			unitType: 'pages-project',
			provider: 'cloudflare',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'acme-docs',
			dependencies: [],
			spec: {
				projectName: 'acme-docs',
				productionBranch: 'main',
				stagingBranch: 'staging',
				buildOutputDir: 'dist',
			},
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
				connections: {
					api: {
						environments: {
							staging: { baseUrl: 'https://api.preview.example.com' },
						},
					},
				},
				providers: { content: { runtime: 'team_scoped_r2_overlay', publish: 'team_scoped_r2_overlay' } },
				cloudflare: {
					accountId: 'account-123',
					queueName: 'background-events',
					dlqName: 'background-events-dlq',
					queueBinding: 'BACKGROUND_EVENTS_QUEUE',
					pages: { productionBranch: 'main', stagingBranch: 'staging' },
					r2: {},
				},
				turnstile: { enabled: true },
			},
			launchEnv: {
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
				TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
			},
			session: new Map([[
				'custom-domain:railway:api.example.com',
				{ id: 'domain-1', domain: 'api.example.com', dnsRecords: [] },
			]]),
		};

		const observed = adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		expect(diff.action).toBe('update');
		expect(diff.reasons.some((reason) => reason.includes('TREESEED_PROJECT_ID'))).toBe(true);

		await adapter!.apply({ unit, context, observed, diff } as never);
		const patchCall = cloudflareApiRequestMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
		expect(patchCall?.[1]?.body).toMatchObject({
			deployment_configs: {
				preview: {
					env_vars: {
						EXISTING_VAR: { type: 'plain_text', value: 'keep' },
						TREESEED_MARKET_API_BASE_URL: { type: 'plain_text', value: 'https://api.preview.example.com' },
						TREESEED_CENTRAL_MARKET_API_BASE_URL: { type: 'plain_text', value: 'https://api.preview.example.com' },
						TREESEED_API_BASE_URL: { type: 'plain_text', value: 'https://api.preview.example.com' },
						TREESEED_PROJECT_ID: { type: 'plain_text', value: 'docs' },
						TREESEED_HOSTING_TEAM_ID: { type: 'plain_text', value: 'acme' },
					},
				},
			},
		});
	});

	it('verifies Turnstile widgets against a fresh lookup after reconcile updates domains', async () => {
		turnstileWidgets = [
			{
				name: 'acme-docs-turnstile-staging',
				sitekey: 'managed-site-key',
				secret: 'managed-secret-key',
				domains: ['old.example.com'],
				mode: 'managed',
			},
		];
		deployState.turnstileWidgets.formGuard.sitekey = 'managed-site-key';
		deployState.turnstileWidgets.formGuard.secret = 'managed-secret-key';
		deployState.turnstileWidgets.formGuard.domains = ['example.com'];
		const { createCloudflareReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createCloudflareReconcileAdapters().find((entry) => entry.unitTypes.includes('turnstile-widget'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'turnstile-widget:acme-docs-turnstile-staging',
			unitType: 'turnstile-widget',
			provider: 'cloudflare',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'acme-docs-turnstile-staging',
			dependencies: [],
			spec: {
				name: 'acme-docs-turnstile-staging',
				domains: ['example.com'],
				mode: 'managed',
			},
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
					queueName: 'background-events',
					dlqName: 'background-events-dlq',
					queueBinding: 'BACKGROUND_EVENTS_QUEUE',
					pages: { productionBranch: 'main', stagingBranch: 'staging' },
					r2: {},
				},
				turnstile: { enabled: true },
			},
			launchEnv: {
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
				TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
			},
			session: new Map(),
		};

		const observed = adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		const result = await adapter!.apply({ unit, context, observed, diff } as never);
		const verification = await adapter!.verify({ unit, context, observed: result.observed, diff, result, postconditions: [] } as never);

		expect(turnstileWidgets[0]?.domains).toEqual(['acme-docs.pages.dev', 'example.com']);
		expect(verification.verified).toBe(true);
	});

	it('syncs Railway hosted env values from launch env without reading the machine key', async () => {
		d1Created = true;
		const { createRailwayReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createRailwayReconcileAdapters().find((entry) => entry.unitTypes.includes('railway-service:api'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'railway-service:api:acme-docs',
			unitType: 'railway-service:api',
			provider: 'railway',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'api',
			dependencies: [],
			spec: {},
			secrets: {},
			metadata: { serviceKey: 'api' },
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
				services: { api: { provider: 'railway', enabled: true } },
				cloudflare: { accountId: 'account-123' },
			},
			launchEnv: {
				TREESEED_RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'acme-workspace',
				TREESEED_GITHUB_TOKEN: 'github-token',
				TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
			},
			session: new Map(),
		};

		const observed = await adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		await adapter!.apply({ unit, context, observed, diff } as never);

		expect(resolveTreeseedMachineEnvironmentValuesMock).not.toHaveBeenCalled();
		expect(railwayEnvMock).toHaveBeenCalledWith(expect.objectContaining({
			RAILWAY_API_TOKEN: 'railway-token',
			TREESEED_RAILWAY_WORKSPACE: 'acme-workspace',
		}));
		expect(renderRailwayIacProjectMock).toHaveBeenCalledWith(expect.objectContaining({
			projectName: 'acme-docs',
			projectId: 'project-1',
			environmentName: 'staging',
			environmentId: 'env-1',
			services: [expect.objectContaining({
				serviceName: 'api',
				variables: expect.objectContaining({
					TREESEED_RAILWAY_WORKSPACE: 'acme-workspace',
					TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
					TREESEED_API_D1_DATABASE_ID: 'd1-1',
				}),
				secrets: expect.objectContaining({
					TREESEED_GITHUB_TOKEN: 'github-token',
					TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
				}),
			})],
		}));
		expect(applyRailwayIacProjectMock).toHaveBeenCalled();
		expect(upsertRailwayVariablesMock).not.toHaveBeenCalled();
		expect(deployRailwayServiceInstanceMock).not.toHaveBeenCalled();
	});

	it('observes Railway API custom domains from live provider state in fresh verification jobs', async () => {
		listRailwayCustomDomainsMock.mockResolvedValue([{
			id: 'domain-1',
			domain: 'api.example.com',
			environmentId: 'env-1',
			serviceId: 'service-1',
			targetPort: null,
			verified: false,
			certificateStatus: 'VALIDATING',
			verificationDnsHost: '_railway-verify.api',
			verificationToken: 'railway-verify=token',
			dnsRecords: [],
		}]);
		listRailwayServiceDomainsMock.mockResolvedValue([{
			id: 'service-domain-1',
			domain: 'api.up.railway.app',
			kind: 'service',
			environmentId: 'env-1',
			serviceId: 'service-1',
			targetPort: null,
		}]);

		const { createRailwayReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createRailwayReconcileAdapters().find((entry) => entry.unitTypes.includes('custom-domain:api'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'custom-domain:api:api.example.com',
			unitType: 'custom-domain:api',
			provider: 'railway',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'API custom domain',
			dependencies: [],
			spec: { domain: 'api.example.com' },
			secrets: {},
			metadata: { serviceKey: 'api' },
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
				services: { api: { provider: 'railway', enabled: true } },
				cloudflare: { accountId: 'account-123' },
			},
			launchEnv: {
				TREESEED_RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'acme-workspace',
			},
			session: new Map(),
		};

		const observed = await adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		const verification = await adapter!.verify({ unit, context, observed, diff, result: null, postconditions: [] } as never);

		expect(observed.exists).toBe(true);
		expect(observed.live).toEqual(expect.objectContaining({
			domain: 'api.example.com',
			serviceDomain: 'api.up.railway.app',
		}));
		expect(verification.verified).toBe(true);
		expect(listRailwayCustomDomainsMock).toHaveBeenCalledWith(expect.objectContaining({
			projectId: 'project-1',
			environmentId: 'env-1',
			serviceId: 'service-1',
		}));
	});

	it('reattaches a Railway custom domain from an obsolete service in the selected environment', async () => {
		let detached = false;
		let attached = false;
		const domain = {
			id: 'domain-new',
			domain: 'api.example.com',
			environmentId: 'env-1',
			serviceId: 'service-1',
			targetPort: null,
			verified: false,
			certificateStatus: 'VALIDATING',
			verificationDnsHost: '_railway-verify.api',
			verificationToken: 'railway-verify=token',
			dnsRecords: [],
		};
		listRailwayEnvironmentServicesMock.mockResolvedValue([
			{ id: 'service-1', name: 'api' },
			{ id: 'service-old', name: 'api-legacy' },
		]);
		listRailwayCustomDomainsMock.mockImplementation(async ({ serviceId }: { serviceId: string }) => {
			if (serviceId === 'service-1') {
				return attached ? [domain] : [];
			}
			if (serviceId === 'service-old' && !detached) {
				return [{ ...domain, id: 'domain-old', serviceId: 'service-old' }];
			}
			return [];
		});
		deleteRailwayCustomDomainMock.mockImplementation(async () => {
			detached = true;
			return { status: 'deleted' };
		});
		ensureRailwayCustomDomainMock.mockImplementation(async () => {
			attached = true;
			return { domain, created: true };
		});

		const { createRailwayReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createRailwayReconcileAdapters().find((entry) => entry.unitTypes.includes('custom-domain:api'))!;
		const unit = {
			unitId: 'custom-domain:api:api.example.com',
			unitType: 'custom-domain:api',
			provider: 'railway',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'API custom domain',
			dependencies: [],
			spec: { domain: 'api.example.com' },
			secrets: {},
			metadata: { serviceKey: 'api' },
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
				services: { api: { provider: 'railway', enabled: true } },
				cloudflare: { accountId: 'account-123' },
			},
			launchEnv: {
				TREESEED_RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'acme-workspace',
			},
			session: new Map(),
		};
		const observed = await adapter.refresh({ unit, context } as never);
		const diff = adapter.diff({ unit, context, observed } as never);
		const result = await adapter.apply({ unit, context, observed, diff } as never);

		expect(result.observed.exists).toBe(true);
		expect(deleteRailwayCustomDomainMock).toHaveBeenCalledWith(expect.objectContaining({ domainId: 'domain-old' }));
		expect(ensureRailwayCustomDomainMock).toHaveBeenCalledWith(expect.objectContaining({
			serviceId: 'service-1',
			domain: 'api.example.com',
		}));
		expect(deleteRailwayCustomDomainMock.mock.invocationCallOrder[0]).toBeLessThan(ensureRailwayCustomDomainMock.mock.invocationCallOrder[0]);
	});

	it('uses Railway IaC instead of direct source repair when deployment state is missing', async () => {
		d1Created = true;
		deployRailwayServiceInstanceMock
			.mockImplementationOnce(() => {
				throw new Error('Deployment not found');
			})
			.mockImplementationOnce(() => undefined);
		const { createRailwayReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createRailwayReconcileAdapters().find((entry) => entry.unitTypes.includes('railway-service:api'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'railway-service:api:acme-docs',
			unitType: 'railway-service:api',
			provider: 'railway',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'api',
			dependencies: [],
			spec: {},
			secrets: {},
			metadata: { serviceKey: 'api' },
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
				services: { api: { provider: 'railway', enabled: true } },
				cloudflare: { accountId: 'account-123' },
			},
			launchEnv: {
				TREESEED_RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'acme-workspace',
				TREESEED_GITHUB_TOKEN: 'github-token',
				TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
			},
			session: new Map(),
		};

		const observed = await adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		await adapter!.apply({ unit, context, observed, diff } as never);

		expect(applyRailwayIacProjectMock).toHaveBeenCalled();
		expect(deployRailwayServiceInstanceMock).not.toHaveBeenCalled();
		expect(updateRailwayServiceImageSourceMock).not.toHaveBeenCalled();
	});

	it('uses Railway IaC instead of direct service mutation when source repair is unsupported', async () => {
		d1Created = true;
		ensureRailwayServiceMock.mockImplementationOnce(() => {
			throw new Error('Railway Git source update for existing service api (service-1) is unsupported; use a provider-supported source update.');
		});
		const { createRailwayReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createRailwayReconcileAdapters().find((entry) => entry.unitTypes.includes('railway-service:api'));
		expect(adapter).toBeTruthy();

		const unit = {
			unitId: 'railway-service:api:acme-docs',
			unitType: 'railway-service:api',
			provider: 'railway',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'api',
			dependencies: [],
			spec: {},
			secrets: {},
			metadata: { serviceKey: 'api' },
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
				services: { api: { provider: 'railway', enabled: true } },
				cloudflare: { accountId: 'account-123' },
			},
			launchEnv: {
				TREESEED_RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'acme-workspace',
				TREESEED_GITHUB_TOKEN: 'github-token',
				TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
			},
			session: new Map(),
		};

		const observed = await adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		await adapter!.apply({ unit, context, observed, diff } as never);

		expect(applyRailwayIacProjectMock).toHaveBeenCalled();
		expect(ensureRailwayServiceMock).not.toHaveBeenCalled();
		expect(deployRailwayServiceInstanceMock).not.toHaveBeenCalled();
	});

	it('verifies a DNS record from the Cloudflare reconcile response when list reads are stale', async () => {
		const { createCloudflareReconcileAdapters } = await import('../../src/reconcile/builtin-adapters.ts');
		const adapter = createCloudflareReconcileAdapters().find((entry) => entry.unitTypes.includes('dns-record'));
		expect(adapter).toBeTruthy();

		cloudflareApiRequestMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
			if (path.includes('/dns_records') && !options?.method) {
				return { success: true, result: [] };
			}
			if (options?.method === 'POST' && path.includes('/dns_records')) {
				return {
					success: true,
					result: {
						id: 'dns-txt-1',
						type: options.body?.type,
						name: options.body?.name,
						content: `"${options.body?.content}"`,
						proxied: options.body?.proxied,
					},
				};
			}
			return { success: true, result: [] };
		});

		const unit = {
			unitId: 'dns-record:api:api-acme-docs-staging.example.com',
			unitType: 'dns-record',
			provider: 'cloudflare-dns',
			target: { kind: 'persistent', scope: 'staging' },
			logicalName: 'api:api-acme-docs-staging.example.com',
			dependencies: [],
			spec: {
				domain: 'api-acme-docs-staging.example.com',
				recordType: 'TXT',
				recordName: '_railway-verify.api-acme-docs-staging.example.com',
				recordContent: 'railway-token',
				proxied: false,
			},
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
				providers: { dns: 'cloudflare-dns' },
				cloudflare: { accountId: 'account-123', zoneId: 'zone-1' },
			},
			launchEnv: {
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123',
				TREESEED_CLOUDFLARE_API_TOKEN: 'cf-token',
			},
			session: new Map(),
		};

		const observed = adapter!.refresh({ unit, context } as never);
		const diff = adapter!.diff({ unit, context, observed } as never);
		const result = await adapter!.apply({ unit, context, observed, diff } as never);
		const verification = await adapter!.verify({ unit, context, observed: result.observed, diff, result, postconditions: [] } as never);

		expect(verification.verified).toBe(true);
		expect(cloudflareApiRequestMock).toHaveBeenCalledWith(
			'/zones/zone-1/dns_records',
			expect.objectContaining({
				method: 'POST',
				body: expect.objectContaining({
					type: 'TXT',
					name: '_railway-verify.api-acme-docs-staging.example.com',
					content: 'railway-token',
				}),
			}),
		);
	});
});
