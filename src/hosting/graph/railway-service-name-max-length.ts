import { loadTreeseedDeployConfig } from '../../platform/deploy-config.ts';
import { loadTreeseedPlugins } from '../../platform/plugins/runtime.ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveTreeseedMachineEnvironmentValues } from '../../operations/services/config-runtime.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../../operations/services/git-runner.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from '../../operations/services/railway-source-policy.ts';
import { createTreeseedCanonicalReconcileReport, type TreeseedCanonicalAction, type TreeseedCanonicalDrift, type TreeseedCanonicalGraphNode, type TreeseedCanonicalPostcondition } from '../../reconcile/index.ts';
import type { TreeseedRunnableBootstrapSystem } from '../../reconcile/bootstrap-systems.ts';
import { discoverTreeseedApplications, findTreeseedApplication, type TreeseedDiscoveredApplication } from '../apps.ts';
import type {
	TreeseedApplicationHostingProfile,
	TreeseedHostAdapter,
	TreeseedHostProjectGroup,
	TreeseedHostingEnvironment,
	TreeseedHostingGraphFilter,
	TreeseedHostingGraph,
	TreeseedHostingGraphInput,
	TreeseedHostingPlan,
	TreeseedHostingPlacementSummary,
	TreeseedHostingUnit,
	TreeseedServiceInstanceSpec,
	TreeseedServicePlacement,
	TreeseedServiceTypeAdapter,
} from '../contracts.ts';
import {
	createDefaultHostAdapters,
	createDefaultHostingProfiles,
	createDefaultServiceTypeAdapters,
	redactSensitiveConfig,
	sanitizedUnitConfig,
	summarizePlacementStatus,
} from '../builtins.ts';


export const RAILWAY_SERVICE_NAME_MAX_LENGTH = 32;

export const RAILWAY_VOLUME_NAME_MAX_LENGTH = 48;

export function assertRailwayResourceNames(serviceName: string, volumeName?: string | null) {
	if (serviceName.length > RAILWAY_SERVICE_NAME_MAX_LENGTH) {
		throw new Error(`Railway service name ${serviceName} exceeds the provider limit of ${RAILWAY_SERVICE_NAME_MAX_LENGTH} characters.`);
	}
	if (volumeName && volumeName.length > RAILWAY_VOLUME_NAME_MAX_LENGTH) {
		throw new Error(`Railway volume name ${volumeName} exceeds the provider limit of ${RAILWAY_VOLUME_NAME_MAX_LENGTH} characters.`);
	}
}

export const ENVIRONMENT_NAMES: Record<TreeseedHostingEnvironment, string> = {
	local: 'local',
	staging: 'staging',
	prod: 'production',
};

export const PLACEMENT_LABELS: Record<TreeseedServicePlacement, string> = {
	web: 'Site Hosting',
	api: 'API Runtime',
	database: 'Database',
	'knowledge-library': 'Knowledge Library',
	'runner-capacity': 'Runner Capacity',
	repository: 'Repository',
	'content-storage': 'Content Storage',
	email: 'Email',
	operations: 'Operations',
	custom: 'Custom',
};

export function mergeRecord<T>(...records: Array<Record<string, T> | undefined>): Record<string, T> {
	return Object.assign({}, ...records.filter(Boolean));
}

export function asPluginRecord<T>(value: unknown): Record<string, T> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, T> : {};
}

export function normalizeEnvironment(value: unknown): TreeseedHostingEnvironment {
	return value === 'prod' || value === 'production'
		? 'prod'
		: value === 'staging'
			? 'staging'
			: 'local';
}

export function indexedName(baseName: string, index: number) {
	return `${baseName.replace(/-\d+$/u, '').replace(/-\d{2}$/u, '')}-${String(Math.max(1, index)).padStart(2, '0')}`;
}

export function publicTreeDxNodePool(config: Record<string, any>) {
	const nodePool = config.publicTreeDxFederation?.railway?.nodePool ?? {};
	const bootstrapCount = Math.max(1, Number.parseInt(String(nodePool.bootstrapCount ?? 1), 10) || 1);
	const maxNodes = Math.max(bootstrapCount, Number.parseInt(String(nodePool.maxNodes ?? 4), 10) || 4);
	return { bootstrapCount, maxNodes };
}

export function resolvePublicTreeDxRoot(input: TreeseedHostingGraphInput) {
	const candidates = [
		resolve(input.tenantRoot, 'packages', 'treedx'),
		resolve(input.tenantRoot, '..', 'treedx'),
		input.configRoot ? resolve(input.configRoot, 'packages', 'treedx') : null,
	].filter((candidate): candidate is string => Boolean(candidate));
	return candidates.find((candidate) => existsSync(resolve(candidate, 'treeseed.package.yaml')) || existsSync(resolve(candidate, '.git'))) ?? candidates[0]!;
}

export function publicTreeDxSourcePolicy(input: TreeseedHostingGraphInput, config: Record<string, any>, launchEnv: Record<string, string | undefined>) {
	const railway = config.publicTreeDxFederation?.railway ?? {};
	const configuredSource = railway.source && typeof railway.source === 'object' && !Array.isArray(railway.source)
		? railway.source
		: {};
	const configuredMode = typeof railway.sourceMode === 'string' ? railway.sourceMode : null;
	if (input.environment === 'staging' && configuredMode === 'image') {
		throw new Error('public-treedx-node-01: API Railway staging services must use GitHub Dockerfile source builds (configured sourceMode image is not allowed).');
	}
	const treeDxRoot = resolvePublicTreeDxRoot(input);
	const repository = typeof railway.sourceRepo === 'string'
		? railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: readPackageRepository(treeDxRoot) ?? 'treeseed-ai/treedx';
	const sourceMode = configuredMode === 'git' || configuredMode === 'image'
		? configuredMode
		: input.environment === 'staging'
			? 'git'
			: 'image';
	if (sourceMode !== 'git') {
		const imageRef = typeof launchEnv.TREESEED_PUBLIC_TREEDX_IMAGE_REF === 'string' && launchEnv.TREESEED_PUBLIC_TREEDX_IMAGE_REF.trim()
			? launchEnv.TREESEED_PUBLIC_TREEDX_IMAGE_REF.trim()
			: null;
		const policy = {
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceCommit: null,
			sourceRootDirectory: null,
			image: 'treeseed/treedx',
			imageRef,
			imageTagRef: 'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
		};
		const serviceName = railwayTreeDxServiceName(1, input.environment);
		assertApiRailwaySourcePolicy(input.environment, { key: 'public-treedx-node-01', serviceName, ...policy });
		return policy;
	}
	const policy = {
		sourceMode: 'git',
		sourceRepo: repository,
		sourceBranch: typeof railway.sourceBranch === 'string'
			? railway.sourceBranch
			: typeof configuredSource.branch === 'string'
				? configuredSource.branch
				: 'staging',
		sourceCommit: typeof railway.sourceCommit === 'string'
			? railway.sourceCommit
			: typeof configuredSource.commit === 'string'
				? configuredSource.commit
				: headCommitSafe(treeDxRoot) ?? headCommitSafe(input.tenantRoot),
		sourceRootDirectory: typeof railway.sourceRootDirectory === 'string'
			? railway.sourceRootDirectory
			: typeof configuredSource.rootDirectory === 'string'
				? configuredSource.rootDirectory
				: '.',
		image: null,
		imageTagRef: null,
	};
	assertApiRailwaySourcePolicy(input.environment, {
		key: 'public-treedx-node-01',
		serviceName: railwayTreeDxServiceName(1, input.environment),
		dockerfilePath: railway.dockerfilePath ?? '/Dockerfile',
		...policy,
	});
	return policy;
}

export function serviceKeyPlacement(serviceKey: string): TreeseedServicePlacement {
	if (serviceKey === 'api') return 'api';
	if (serviceKey === 'treeseedDatabase') return 'database';
	if (serviceKey === 'operationsRunner') return 'runner-capacity';
	if (/runner|capacity/iu.test(serviceKey)) return 'runner-capacity';
	if (/database|postgres|db/iu.test(serviceKey)) return 'database';
	if (/email|smtp/iu.test(serviceKey)) return 'email';
	return 'operations';
}

export function serviceKeyType(serviceKey: string, service: Record<string, any>): string {
	if (serviceKey === 'treeseedDatabase' || service.railway?.resourceType === 'postgres') return 'relational-database';
	if (String(serviceKey).startsWith('capacityProvider')) return 'capacity-provider';
	if (serviceKey === 'operationsRunner' || /runner/iu.test(serviceKey)) return 'runner-pool';
	if (Array.isArray(service.railway?.schedule) || typeof service.railway?.schedule === 'string') return 'scheduled-job';
	if (serviceKey === 'api') return 'container-api';
	return service.railway?.volumeMountPath ? 'stateful-container' : 'container-api';
}

export function railwayImageRefEnvForService(serviceKey: string) {
	if (serviceKey === 'api') return 'TREESEED_API_IMAGE_REF';
	if (serviceKey === 'operationsRunner') return 'TREESEED_OPERATIONS_RUNNER_IMAGE_REF';
	if (serviceKey === 'capacityProviderManager') return 'TREESEED_AGENT_MANAGER_IMAGE_REF';
	if (serviceKey === 'capacityProviderRunner') return 'TREESEED_AGENT_RUNNER_IMAGE_REF';
	if (String(serviceKey).startsWith('public-treedx-node-')) return 'TREESEED_PUBLIC_TREEDX_IMAGE_REF';
	return null;
}

export function defaultRailwayImageRefForService(serviceKey: string, environment: TreeseedHostingEnvironment) {
	return null;
}

export function readPackageRepository(root: string) {
	const manifestPath = resolve(root, 'treeseed.package.yaml');
	if (!existsSync(manifestPath)) return null;
	try {
		const parsed = parseYaml(readFileSync(manifestPath, 'utf8'));
		const repository = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>).repository
			: null;
		return typeof repository === 'string' && /^[^/\s]+\/[^/\s]+$/u.test(repository.trim()) ? repository.trim() : null;
	} catch {
		return null;
	}
}

export function headCommitSafe(root: string) {
	try {
		return runTreeseedGitText(['rev-parse', 'HEAD'], {
			cwd: root,
			mode: classifyTreeseedGitMode(['rev-parse', 'HEAD']),
		}).trim();
	} catch {
		return null;
	}
}

export function resolveRailwayServiceSourceRoot(input: TreeseedHostingGraphInput, serviceKey: string, service: Record<string, any>) {
	if (String(serviceKey).startsWith('capacityProvider')) {
		if (service.railway?.rootDir) {
			return resolve(input.tenantRoot, service.railway.rootDir);
		}
		const workspaceRoot = input.configRoot ?? input.tenantRoot;
		const candidates = [
			resolve(input.tenantRoot, '..', 'agent'),
			resolve(workspaceRoot, 'packages', 'agent'),
			resolve(input.tenantRoot, '..', '..', 'packages', 'agent'),
		];
		const found = candidates.find((candidate) =>
			existsSync(resolve(candidate, 'treeseed.package.yaml'))
			|| existsSync(resolve(candidate, 'package.json')),
		);
		return found ?? resolve(workspaceRoot, 'packages', 'agent');
	}
	const rootDir = service.railway?.rootDir ?? service.rootDir ?? '.';
	return resolve(input.tenantRoot, rootDir);
}
