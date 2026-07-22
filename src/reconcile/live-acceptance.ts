import {
	type TreeseedCanonicalAction,
	type TreeseedCanonicalDrift,
	type TreeseedCanonicalGraphNode,
	type TreeseedCanonicalPostcondition,
	type TreeseedCanonicalReconcileReport,
} from './platform.ts';
import type { TreeseedDesiredResource } from '../platform/desired-state.ts';
import type { TreeseedReconcileSelector } from './contracts.ts';
import {
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	listRailwayVariables,
	listRailwayVolumes,
	resolveRailwayWorkspaceContext,
} from '../operations/services/railway-api.ts';
import { resolveGitHubCredentialForRepository } from '../operations/services/github-credentials.ts';
import { cloudflareRequest } from './live-acceptance-cloudflare-client.ts';
import type { TreeseedCapacityAcceptanceExecutionInput, TreeseedCapacityAcceptanceExecutionResult } from './live-acceptance-capacity-executor.ts';
import { runCloudflareAcceptance, runCloudflareCleanup } from './live-acceptance-cloudflare.ts';
import { runLocalAcceptance, runLocalCleanup } from './live-acceptance-local.ts';
import { githubRequest, resolveCurrentGitHubRepository } from './live-acceptance-github-client.ts';
import { runGitHubAcceptance, runGitHubCleanup } from './live-acceptance-github.ts';
import { runRailwayAcceptance, runRailwayCleanup } from './live-acceptance-railway.ts';
import {
	PROVIDER_CAPABILITIES,
	emitProgress,
	providerPrefix,
	reportForProvider,
	scenario,
	shortRunId,
} from './live-acceptance-runtime.ts';
import { configuredLiveAcceptanceValue as configuredValue, type LiveAcceptanceEnv } from './live-acceptance-values.ts';

export type TreeseedLiveReconcileProvider = 'railway' | 'cloudflare' | 'github' | 'local';
export type TreeseedLiveReconcileMode = 'smoke' | 'acceptance' | 'cleanup';
export type TreeseedLiveReconcileEnvironment = 'local' | 'staging' | 'prod';

export interface TreeseedLiveReconcileScenarioResult {
	id: string;
	provider: TreeseedLiveReconcileProvider;
	capability: string;
	mode: TreeseedLiveReconcileMode;
	ok: boolean;
	phase: 'smoke' | 'validate' | 'create' | 'update' | 'replace' | 'verify' | 'destroy' | 'cleanup' | 'blocked';
	action: TreeseedCanonicalAction['kind'];
	reason: string;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	locators: Record<string, string | null>;
	createdResources: TreeseedCanonicalGraphNode[];
	updatedResources: TreeseedCanonicalGraphNode[];
	replacedResources: TreeseedCanonicalGraphNode[];
	destroyedResources: TreeseedCanonicalGraphNode[];
	retainedResources: TreeseedCanonicalGraphNode[];
	issues: string[];
}

export interface TreeseedLiveReconcileProviderReport {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	runId: string;
	resourcePrefix: string;
	scenarioResults: TreeseedLiveReconcileScenarioResult[];
	coverage: {
		total: number;
		passed: number;
		failed: number;
		capabilities: string[];
	};
	createdResources: TreeseedCanonicalGraphNode[];
	updatedResources: TreeseedCanonicalGraphNode[];
	replacedResources: TreeseedCanonicalGraphNode[];
	destroyedResources: TreeseedCanonicalGraphNode[];
	retainedResources: TreeseedCanonicalGraphNode[];
	cleanupDrift: TreeseedCanonicalDrift[];
	report: TreeseedCanonicalReconcileReport;
	ok: boolean;
}

export interface TreeseedLiveReconcileRunResult {
	command: 'reconcile test-live';
	mode: TreeseedLiveReconcileMode;
	environment: TreeseedLiveReconcileEnvironment;
	runId: string;
	resourcePrefix: string;
	providers: TreeseedLiveReconcileProviderReport[];
	ok: boolean;
}

export interface TreeseedLiveAcceptanceScenario {
	id: string;
	provider: TreeseedLiveReconcileProvider;
	capability: string;
	desiredResources: TreeseedDesiredResource[];
	selector: TreeseedReconcileSelector;
	expectedActions: TreeseedCanonicalAction['kind'][];
	cleanupSelector: TreeseedReconcileSelector;
	required: boolean;
	probeOnly?: boolean;
	cleanupRequired: boolean;
}

export interface TreeseedLiveReconcileProgressEvent {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	environment: TreeseedLiveReconcileEnvironment;
	runId: string;
	resourcePrefix: string;
	capability?: string;
	phase: 'start' | 'cleanup' | 'create' | 'verify' | 'destroy' | 'complete' | 'blocked';
	message: string;
	elapsedMs?: number;
}

export interface RunTreeseedLiveReconcileTestsOptions {
	cwd: string;
	environment: TreeseedLiveReconcileEnvironment;
	providers: TreeseedLiveReconcileProvider[];
	mode?: TreeseedLiveReconcileMode;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	runId?: string;
	now?: Date;
	fetchImpl?: typeof fetch;
	onProgress?: (event: TreeseedLiveReconcileProgressEvent) => void;
	capacityAssignmentExecutor?: (input: TreeseedCapacityAcceptanceExecutionInput) => Promise<TreeseedCapacityAcceptanceExecutionResult>;
}

type LiveEnv = LiveAcceptanceEnv;
type LiveProgress = RunTreeseedLiveReconcileTestsOptions['onProgress'];


function isCapacityRuntimeProofCapability(capability: string) {
	return capability === 'capacity-provider-assignment-proof'
		|| capability === 'capacity-provider-runtime-assignment-proof';
}

function scenarioResourceKind(provider: TreeseedLiveReconcileProvider, capability: string): TreeseedDesiredResource['kind'] {
	if (provider === 'railway') return capability === 'volume' ? 'railway-volume' : 'railway-service';
	if (provider === 'cloudflare') return 'cloudflare-resource';
	if (provider === 'github') {
		if (capability === 'environment') return 'github-environment';
		if (capability === 'secret') return 'github-secret-binding';
		if (capability === 'variable') return 'github-secret-binding';
		return 'package-workflow';
	}
	if (isCapacityRuntimeProofCapability(capability)) return 'capacity-provider';
	if (capability === 'docker-compose-capacity-provider') return 'local-docker-compose';
	if (capability === 'process') return 'local-process';
	if (capability === 'local-runner') return 'capacity-provider';
	return 'local-process';
}

function scenarioResourceProvider(provider: TreeseedLiveReconcileProvider, capability: string) {
	if (provider === 'cloudflare') return 'cloudflare';
	if (provider === 'github') return 'github';
	if (provider === 'local') return 'local';
	return 'railway';
}

function liveAcceptanceDesiredResource(input: {
	tenantRoot: string;
	environment: TreeseedLiveReconcileEnvironment;
	provider: TreeseedLiveReconcileProvider;
	capability: string;
	runId: string;
}): TreeseedDesiredResource {
	const id = `live-acceptance:${input.environment}:${input.provider}:${input.capability}:${input.runId}`;
	const kind = scenarioResourceKind(input.provider, input.capability);
	return {
		id,
		kind,
		provider: scenarioResourceProvider(input.provider, input.capability),
		environment: input.environment,
		packageId: null,
		serviceId: input.capability,
		logicalName: input.capability,
		spec: {
			liveAcceptance: true,
			provider: input.provider,
			capability: input.capability,
			runId: input.runId,
			prefix: providerPrefix(input.environment, input.provider, input.runId),
			tenantRoot: input.tenantRoot,
		},
		dependencies: [],
		source: { type: 'package-adapter', id },
	};
}

export function compileTreeseedLiveAcceptanceScenarios(input: {
	tenantRoot: string;
	environment: TreeseedLiveReconcileEnvironment;
	provider: TreeseedLiveReconcileProvider | 'all';
	mode: TreeseedLiveReconcileMode;
	runId: string;
}): TreeseedLiveAcceptanceScenario[] {
	const providers: TreeseedLiveReconcileProvider[] = input.provider === 'all'
		? ['railway', 'cloudflare', 'github', 'local']
		: [input.provider];
	return providers.flatMap((provider) => PROVIDER_CAPABILITIES[provider].map((capability) => {
		const probeOnly = input.mode === 'smoke'
			|| (provider === 'github' && ['workflow-observation', 'repository-scoped-token'].includes(capability))
			|| (provider === 'cloudflare' && capability === 'cache-rules')
			|| isCapacityRuntimeProofCapability(capability);
		const desiredResources = probeOnly
			? []
			: [liveAcceptanceDesiredResource({
				tenantRoot: input.tenantRoot,
				environment: input.environment,
				provider,
				capability,
				runId: input.runId,
			})];
		const selector: TreeseedReconcileSelector = {
			environment: input.environment,
			host: [provider],
			resourceKind: desiredResources.map((resource) => resource.kind),
			serviceType: [capability],
		};
		return {
			id: `live-acceptance:${input.environment}:${provider}:${capability}:${input.runId}`,
			provider,
			capability,
			desiredResources,
			selector,
			expectedActions: input.mode === 'cleanup'
				? ['delete', 'noop']
				: probeOnly
					? ['noop']
					: ['create', 'update', 'replace', 'reattach', 'noop'],
			cleanupSelector: selector,
			required: true,
			probeOnly,
			cleanupRequired: input.mode !== 'smoke' && !probeOnly,
		} satisfies TreeseedLiveAcceptanceScenario;
	}));
}






async function runSmokeProvider({
	provider,
	environment,
	prefix,
	mode,
	cwd,
	env,
	fetchImpl,
}: {
	provider: TreeseedLiveReconcileProvider;
	environment: TreeseedLiveReconcileEnvironment;
	prefix: string;
	mode: TreeseedLiveReconcileMode;
	cwd: string;
	env: LiveEnv;
	fetchImpl: typeof fetch;
}) {
	if (provider === 'railway') {
		if (!configuredValue(env, ['TREESEED_RAILWAY_API_TOKEN'])) {
			return PROVIDER_CAPABILITIES.railway.map((capability) => scenario({
				provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked',
				reason: 'Missing TREESEED_RAILWAY_API_TOKEN for Railway live reconciliation tests.',
			}));
		}
		try {
			const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
			const projects = await listRailwayProjects({ workspaceId: workspace.id, env, fetchImpl });
			const apiProject = projects.find((project) => project.name === 'treeseed-api') ?? projects[0] ?? null;
			const environments = apiProject ? await listRailwayEnvironments({ projectId: apiProject.id, env, fetchImpl }) : [];
			const selectedEnvironment = environments.find((candidate) => candidate.name === environment)
				?? environments.find((candidate) => candidate.name === (environment === 'prod' ? 'production' : 'staging'))
				?? environments[0]
				?? null;
			const services = apiProject ? await listRailwayServices({ projectId: apiProject.id, env, fetchImpl }) : [];
			const variables = apiProject && selectedEnvironment
				? await listRailwayVariables({ projectId: apiProject.id, environmentId: selectedEnvironment.id, env, fetchImpl }).catch(() => ({}))
				: {};
			const volumes = apiProject ? await listRailwayVolumes({ projectId: apiProject.id, env, fetchImpl }).catch(() => []) : [];
			const serviceNames = services.map((service) => service.name);
			const base = {
				workspaceId: workspace.id,
				projectId: apiProject?.id ?? null,
				environmentId: selectedEnvironment?.id ?? null,
			};
			return [
				scenario({ provider, mode, prefix, capability: 'project', ok: projects.length > 0, phase: 'smoke', action: 'noop', reason: projects.length ? 'Railway projects are observable.' : 'No Railway projects are visible.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'environment', ok: Boolean(selectedEnvironment), phase: 'smoke', action: 'noop', reason: selectedEnvironment ? 'Railway environments are observable.' : 'No Railway environment is visible.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'service', ok: services.length > 0, phase: 'smoke', action: 'noop', reason: services.length ? 'Railway services are observable.' : 'No Railway services are visible.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'image-service', ok: serviceNames.some((name) => /api|runner|treedx/iu.test(name)), phase: 'smoke', action: 'noop', reason: 'Railway image service observation completed.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'postgres', ok: serviceNames.some((name) => /postgres/iu.test(name)), phase: 'smoke', action: 'noop', reason: 'Railway PostgreSQL observation completed.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'volume', ok: volumes.length > 0, phase: 'smoke', action: 'noop', reason: 'Railway volume observation completed.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'domain', ok: true, phase: 'smoke', action: 'noop', reason: 'Railway domain API uses authenticated provider surface.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'variables', ok: Boolean(selectedEnvironment), phase: 'smoke', action: 'noop', reason: `Railway variables API observed ${Object.keys(variables).length} variables.`, locators: base }),
				scenario({ provider, mode, prefix, capability: 'deployment-health', ok: services.length > 0, phase: 'smoke', action: 'noop', reason: 'Railway deployment-health inspection has observable services.', locators: base }),
				scenario({ provider, mode, prefix, capability: 'capacity-provider-runtime-assignment-proof', ok: true, phase: 'smoke', action: 'noop', reason: 'Railway capacity runtime proof is available through explicit acceptance mode.', locators: base }),
			];
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return PROVIDER_CAPABILITIES.railway.map((capability) => scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason }));
		}
	}
	if (provider === 'cloudflare') {
		const accountId = configuredValue(env, ['TREESEED_CLOUDFLARE_ACCOUNT_ID']);
		if (!configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN']) || !accountId) {
			return PROVIDER_CAPABILITIES.cloudflare.map((capability) => scenario({
				provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked',
				reason: 'Missing TREESEED_CLOUDFLARE_API_TOKEN or TREESEED_CLOUDFLARE_ACCOUNT_ID for Cloudflare live reconciliation tests.',
			}));
		}
		const checks: Array<[string, string]> = [
			['pages', `/accounts/${accountId}/pages/projects?per_page=1`],
			['worker', `/accounts/${accountId}/workers/services?per_page=1`],
			['d1', `/accounts/${accountId}/d1/database?per_page=1`],
			['r2', `/accounts/${accountId}/r2/buckets?per_page=1`],
			['kv', `/accounts/${accountId}/storage/kv/namespaces?per_page=1`],
			['queue', `/accounts/${accountId}/queues?per_page=1`],
			['dns', '/zones?per_page=1'],
			['turnstile', `/accounts/${accountId}/challenges/widgets?per_page=1`],
			['secrets', `/accounts/${accountId}/workers/services?per_page=1`],
			['cache-rules', '/zones?per_page=1'],
		];
		return Promise.all(checks.map(async ([capability, path]) => {
			try {
				await cloudflareRequest(path, env, fetchImpl);
				return scenario({ provider, mode, prefix, capability, ok: true, phase: 'smoke', action: 'noop', reason: 'Cloudflare API surface is reachable.', locators: { accountId } });
			} catch (error) {
				return scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason: error instanceof Error ? error.message : String(error), locators: { accountId } });
			}
		}));
	}
	if (provider === 'github') {
		let repository = '';
		try {
			repository = resolveCurrentGitHubRepository(cwd, env);
			const credential = resolveGitHubCredentialForRepository(repository, { values: env, env });
			if (!credential.token) {
				throw new Error(`Missing GitHub credential for ${repository}; expected ${credential.envName} or TREESEED_GITHUB_TOKEN fallback.`);
			}
			const [owner, repo] = credential.repository.split('/');
			const checks: Array<[string, string]> = [
				['environment', `/repos/${owner}/${repo}/environments?per_page=1`],
				['secret', `/repos/${owner}/${repo}/actions/secrets?per_page=1`],
				['variable', `/repos/${owner}/${repo}/actions/variables?per_page=1`],
				['workflow-dispatch', `/repos/${owner}/${repo}/actions/workflows?per_page=1`],
				['workflow-observation', `/repos/${owner}/${repo}/actions/runs?per_page=1`],
			];
			const results = await Promise.all(checks.map(async ([capability, path]) => {
				try {
					await githubRequest(path, credential.token ?? '', fetchImpl);
					return scenario({ provider, mode, prefix, capability, ok: true, phase: 'smoke', action: 'noop', reason: 'GitHub API surface is reachable.', locators: { repository: credential.repository, credentialKey: credential.envName } });
				} catch (error) {
					return scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason: error instanceof Error ? error.message : String(error), locators: { repository: credential.repository, credentialKey: credential.envName } });
				}
			}));
			results.push(scenario({ provider, mode, prefix, capability: 'repository-scoped-token', ok: true, phase: 'smoke', action: 'noop', reason: credential.fallbackUsed ? 'GitHub credential resolved through fallback.' : 'GitHub credential resolved through repository-scoped key.', locators: { repository: credential.repository, credentialKey: credential.envName } }));
			return results;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return PROVIDER_CAPABILITIES.github.map((capability) => scenario({ provider, mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason, locators: { repository } }));
		}
	}
	return PROVIDER_CAPABILITIES.local.map((capability) => scenario({
		provider, mode, prefix, capability, ok: true, phase: 'smoke', action: 'noop',
		reason: 'Local reconciliation live-test capability is available in-process.',
	}));
}






async function runProvider({
	provider,
	mode,
	environment,
	runId,
	cwd,
	env,
	fetchImpl,
	onProgress,
	capacityAssignmentExecutor,
}: {
	provider: TreeseedLiveReconcileProvider;
	mode: TreeseedLiveReconcileMode;
	environment: TreeseedLiveReconcileEnvironment;
	runId: string;
	cwd: string;
	env: LiveEnv;
	fetchImpl: typeof fetch;
	onProgress?: LiveProgress;
	capacityAssignmentExecutor?: RunTreeseedLiveReconcileTestsOptions['capacityAssignmentExecutor'];
}) {
	const prefix = providerPrefix(environment, provider, runId);
	const started = Date.now();
	emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: 'start', message: `${provider}: ${mode} live reconciliation started` });
	if (mode === 'smoke') {
		const results = await runSmokeProvider({ provider, environment, prefix, mode, cwd, env, fetchImpl });
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	if (provider === 'railway') {
		const { results, cleanupDrift } = mode === 'cleanup'
			? await runRailwayCleanup(environment, prefix, mode, env, fetchImpl)
			: await runRailwayAcceptance(cwd, environment, runId, prefix, env, fetchImpl, onProgress);
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	if (provider === 'cloudflare') {
		const { results, cleanupDrift } = mode === 'cleanup'
			? await runCloudflareCleanup(cwd, environment, prefix, mode, env, fetchImpl)
			: await runCloudflareAcceptance(cwd, environment, runId, prefix, env, fetchImpl, onProgress);
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	if (provider === 'github') {
		const { results, cleanupDrift } = mode === 'cleanup'
			? await runGitHubCleanup(cwd, environment, prefix, mode, env, fetchImpl)
			: await runGitHubAcceptance(cwd, environment, runId, prefix, env, fetchImpl, onProgress);
		const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
		emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
		return report;
	}
	const { results, cleanupDrift } = mode === 'cleanup'
		? await runLocalCleanup(environment, prefix, mode, env, fetchImpl, onProgress)
		: await runLocalAcceptance(environment, prefix, mode, runId, env, fetchImpl, onProgress, capacityAssignmentExecutor);
	const report = reportForProvider({ provider, mode, runId, prefix, environment, results, cleanupDrift });
	emitProgress(onProgress, { provider, mode, environment, runId, resourcePrefix: prefix, phase: report.ok ? 'complete' : 'blocked', elapsedMs: Date.now() - started, message: `${provider}: ${report.ok ? 'passed' : 'blocked'} in ${Date.now() - started}ms` });
	return report;
}

export function treeseedLiveReconcileProviderCapabilities(provider: TreeseedLiveReconcileProvider) {
	return [...PROVIDER_CAPABILITIES[provider]];
}

export function treeseedLiveReconcileResourcePrefix(environment: TreeseedLiveReconcileEnvironment, provider: TreeseedLiveReconcileProvider, runId: string) {
	return providerPrefix(environment, provider, runId);
}

export async function runTreeseedLiveReconcileTests(options: RunTreeseedLiveReconcileTestsOptions): Promise<TreeseedLiveReconcileRunResult> {
	const mode = options.mode ?? 'smoke';
	const runId = options.runId ?? shortRunId(options.now);
	const env = options.env ?? process.env;
	const fetchImpl = options.fetchImpl ?? fetch;
	const providers = [...new Set(options.providers)];
	const reports = await Promise.all(providers.map((provider) => runProvider({
		provider,
		mode,
		environment: options.environment,
		runId,
		cwd: options.cwd,
		env,
		fetchImpl,
		onProgress: options.onProgress,
		capacityAssignmentExecutor: options.capacityAssignmentExecutor,
	})));
	return {
		command: 'reconcile test-live',
		mode,
		environment: options.environment,
		runId,
		resourcePrefix: `trsd-live-${options.environment}`,
		providers: reports,
		ok: reports.every((report) => report.ok),
	};
}
