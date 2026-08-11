import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	buckets: [] as Array<{ name: string }>,
	listD1Databases: vi.fn(() => []),
	listKvNamespaces: vi.fn(() => []),
	listPagesProjects: vi.fn(() => []),
	listQueues: vi.fn(() => []),
	listR2Buckets: vi.fn(() => mocks.buckets),
	listTurnstileWidgets: vi.fn(() => []),
	reconcileCloudflareWebCacheRules: vi.fn(),
	runWrangler: vi.fn((args: string[]) => {
		if (args.slice(0, 3).join(' ') === 'r2 bucket create') mocks.buckets = [{ name: args[3]! }];
		return { status: 0, stdout: '', stderr: '' };
	}),
	writeDeployState: vi.fn(),
}));

const deployState = {
	identity: { teamId: 'acme', projectId: 'docs', environment: 'staging' },
	kvNamespaces: { FORM_GUARD_KV: { name: 'unrelated-kv' } },
	d1Databases: { SITE_DATA_DB: { databaseName: 'unrelated-d1' } },
	pages: { projectName: 'unrelated-pages' },
	turnstileWidgets: { formGuard: { name: 'unrelated-turnstile' } },
	content: { bucketName: 'acme-docs-content', r2Binding: 'TREESEED_CONTENT_BUCKET' },
	readiness: {},
};

vi.mock('../../../../src/operations/services/hosting/deployment/deploy.ts', async () => {
	const actual = await vi.importActual<typeof import('../../../../src/operations/services/hosting/deployment/deploy.ts')>('../../../../src/operations/services/hosting/deployment/deploy.ts');
	return {
		...actual,
		buildProvisioningSummary: vi.fn(() => ({})),
		cloudflareApiRequest: vi.fn(() => ({ success: true, result: [] })),
		hasProvisionedCloudflareResources: vi.fn(() => true),
		listD1Databases: mocks.listD1Databases,
		listKvNamespaces: mocks.listKvNamespaces,
		listPagesProjects: mocks.listPagesProjects,
		listQueues: mocks.listQueues,
		listR2Buckets: mocks.listR2Buckets,
		listTurnstileWidgets: mocks.listTurnstileWidgets,
		loadDeployState: vi.fn(() => deployState),
		reconcileCloudflareWebCacheRules: mocks.reconcileCloudflareWebCacheRules,
		runWrangler: mocks.runWrangler,
		writeDeployState: mocks.writeDeployState,
	};
});

const input = {
	unit: {
		unitId: 'content-store:acme-docs-content',
		unitType: 'content-store',
		provider: 'cloudflare',
		target: { kind: 'persistent', scope: 'staging' },
		logicalName: 'acme-docs-content',
		dependencies: [],
		spec: { bucketName: 'acme-docs-content', binding: 'TREESEED_CONTENT_BUCKET' },
		secrets: {}, metadata: {}, identity: deployState.identity,
	},
	context: {
		tenantRoot: '/tmp/tenant',
		target: { kind: 'persistent', scope: 'staging' },
		deployConfig: {
			name: 'Test', slug: 'test', siteUrl: 'https://example.com', contactEmail: 'hello@example.com',
			hosting: { kind: 'hosted_project', teamId: 'acme', projectId: 'docs' },
			runtime: { mode: 'treeseed_managed', registration: 'none', teamId: 'acme', projectId: 'docs' },
			providers: { content: { runtime: 'team_scoped_r2_overlay', publish: 'team_scoped_r2_overlay' } },
			cloudflare: { accountId: 'account-123', r2: {} }, turnstile: { enabled: true },
		},
		launchEnv: { TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-123', TREESEED_CLOUDFLARE_API_TOKEN: 'token' },
		session: new Map(),
	},
} as never;

describe('Cloudflare content-store reconciliation', () => {
	beforeEach(() => {
		mocks.buckets = [];
		vi.clearAllMocks();
	});

	it('treats configured-but-missing R2 state as live drift', async () => {
		const { observeCloudflareUnit } = await import('../../../../src/reconcile/builtin-adapters/hosting/observe-cloudflare-unit.ts');
		const observed = observeCloudflareUnit(input);
		expect(observed).toMatchObject({ exists: false, status: 'pending', locators: { bucketName: null } });
	});

	it('creates and reads back only the selected R2 bucket', async () => {
		const { reconcileCloudflareTarget } = await import('../../../../src/reconcile/builtin-adapters/reconciliation/reconcile-cloudflare-target.ts');
		reconcileCloudflareTarget(input);
		expect(mocks.runWrangler).toHaveBeenCalledOnce();
		expect(mocks.runWrangler).toHaveBeenCalledWith(
			['r2', 'bucket', 'create', 'acme-docs-content'],
			expect.objectContaining({ cwd: '/tmp/tenant', capture: true }),
		);
		expect(mocks.listR2Buckets).toHaveBeenCalledTimes(2);
		expect(mocks.listKvNamespaces).not.toHaveBeenCalled();
		expect(mocks.listD1Databases).not.toHaveBeenCalled();
		expect(mocks.listPagesProjects).not.toHaveBeenCalled();
		expect(mocks.listTurnstileWidgets).not.toHaveBeenCalled();
		expect(mocks.reconcileCloudflareWebCacheRules).not.toHaveBeenCalled();
	});
});
