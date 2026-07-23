import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../src/operations/services/config-runtime.ts', () => ({
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
vi.mock('../../../src/operations/services/deploy.ts', async () => {
	const actual = await vi.importActual<typeof import('../../../src/operations/services/deploy.ts')>('../../../src/operations/services/deploy.ts');
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
		listD1Databases: vi.fn(() => (reconcileState.d1Created ? [{ name: 'acme-docs-site-data-staging', uuid: 'd1-1' }] : [])),
		listKvNamespaces: vi.fn(() => (reconcileState.kvCreated
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
			const widget = reconcileState.turnstileWidgets.find((entry) => entry.sitekey === sitekey);
			return widget ? { ...widget, domains: [...(widget.domains ?? [])] } : null;
		}),
		listTurnstileWidgets: vi.fn(() => reconcileState.turnstileWidgets.map((entry) => ({ ...entry, domains: [...(entry.domains ?? [])] }))),
		createTurnstileWidget: vi.fn((_env, input) => {
			const widget = {
				name: input.name,
				sitekey: 'managed-site-key',
				secret: 'managed-secret-key',
				domains: input.domains,
				mode: input.mode,
			};
			reconcileState.turnstileWidgets.push(widget);
			return widget;
		}),
		updateTurnstileWidget: vi.fn((_env, sitekey, input) => {
			const widget = reconcileState.turnstileWidgets.find((entry) => entry.sitekey === sitekey) ?? {
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
				reconcileState.kvCreated = true;
			}
			if (args[0] === 'd1' && args[1] === 'create') {
				reconcileState.d1Created = true;
			}
			return { status: 0, stdout: '', stderr: '' };
		}),
		writeDeployState: vi.fn(),
	};
});
vi.mock('../../../src/operations/services/railway-deploy.ts', () => ({
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
	railwayObsoleteAliasCleanupPolicy: vi.fn(() => ({ retainedResourceNames: [], allowedResourceDeletions: [] })),
	runRailway: vi.fn(),
	validateRailwayDeployPrerequisites: vi.fn(),
}));
vi.mock('../../../src/operations/services/railway-api.ts', () => ({
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
	inspectRailwayServiceDeploymentHealth: vi.fn(async () => ({
		repo: 'treeseed-ai/api',
		branch: 'staging',
	})),
	listRailwayEnvironmentServices: vi.fn((input) => listRailwayEnvironmentServicesMock(input)),
	listRailwayServices: vi.fn((input) => listRailwayEnvironmentServicesMock(input)),
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
vi.mock('../../../src/reconcile/providers/railway-iac.ts', () => ({
	resolveRailwayIacVolumeBindings: vi.fn(() => ({ bindings: [], blockedReasons: [] })),
	findRailwayPendingVolumeNameCollisions: vi.fn(() => []),
	waitForRailwayVolumeName: vi.fn(),
	waitForRailwayServices: vi.fn(async ({ serviceNames }: { serviceNames: string[] }) => ({
		services: serviceNames.map((name, index) => ({ id: `service-${index + 1}`, name })),
		attempts: 1,
	})),
	waitForRailwayVolumeAdoptionResources: vi.fn(),
	detachRetainedRailwayVolumeBindings: vi.fn((resources) => resources),
	detachRetainedRailwayCustomDomains: vi.fn((resources) => resources),
	railwayIacApplyFailure: vi.fn(() => null),
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
	applyRailwayIacProjectWithPlan: vi.fn(async (input, rendered, plan) => {
		applyRailwayIacProjectMock(input, rendered, plan);
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
import { cloudflareApiRequestMock, runWranglerMock, resolveTreeseedMachineEnvironmentValuesMock, upsertRailwayVariablesMock, deployRailwayServiceInstanceMock, ensureRailwayServiceMock, updateRailwayServiceImageSourceMock, updateRailwayServiceGitSourceMock, renderRailwayIacProjectMock, planRailwayIacProjectMock, applyRailwayIacProjectMock, cleanupRailwayIacRenderMock, railwayEnvMock, listRailwayCustomDomainsMock, listRailwayServiceDomainsMock, listRailwayEnvironmentServicesMock, ensureRailwayCustomDomainMock, deleteRailwayCustomDomainMock, reconcileState, deployState } from './cloudflare-reconcile.support.ts';
describe('cloudflare reconcile adapters', () => {
beforeEach(() => {
	reconcileState.kvCreated = false;
	reconcileState.d1Created = false;
	reconcileState.turnstileWidgets = [];
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
				reconcileState.d1Created = true;
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

it('verifies a DNS record from the Cloudflare reconcile response when list reads are stale', async () => {
		const { createCloudflareReconcileAdapters } = await import('../../../src/reconcile/builtin-adapters.ts');
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
