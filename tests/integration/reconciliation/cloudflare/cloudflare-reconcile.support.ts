import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
export const cloudflareApiRequestMock = vi.fn();
export const runWranglerMock = vi.fn();
export const resolveMachineEnvironmentValuesMock = vi.fn();
export const upsertRailwayVariablesMock = vi.fn();
export const deployRailwayServiceInstanceMock = vi.fn();
export const ensureRailwayServiceMock = vi.fn();
export const updateRailwayServiceImageSourceMock = vi.fn();
export const updateRailwayServiceGitSourceMock = vi.fn();
export const renderRailwayIacProjectMock = vi.fn();
export const planRailwayIacProjectMock = vi.fn();
export const applyRailwayIacProjectMock = vi.fn();
export const cleanupRailwayIacRenderMock = vi.fn();
export const railwayEnvMock = vi.fn();
export const listRailwayCustomDomainsMock = vi.fn();
export const listRailwayServiceDomainsMock = vi.fn();
export const listRailwayEnvironmentServicesMock = vi.fn();
export const ensureRailwayCustomDomainMock = vi.fn();
export const deleteRailwayCustomDomainMock = vi.fn();
export const reconcileState = {
	kvCreated: false,
	d1Created: false,
	turnstileWidgets: [] as Array<{ name: string; sitekey: string; secret?: string; domains?: string[]; mode?: string }>,
};
export const deployState = {
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
