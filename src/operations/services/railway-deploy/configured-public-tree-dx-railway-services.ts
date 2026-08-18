import { existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { apiRailwayDefaultDockerfilePath,apiRailwayDefaultSourceRepo,assertApiRailwaySourcePolicy,isApiRailwaySourcePolicyService,railwayTreeDxServiceName } from '../hosting/railway/railway-source-policy.ts';
import { classifyGitMode,runGitText } from '../operations/git-runner.ts';
import { publicTreeDxRuntimeEnvironment } from '../../../platform/treedx/runtime-environment.ts';
import { PUBLIC_TREEDX_NODE_SERVICE_KEY_PREFIX,envValue,resolveRailwayEnvironmentForScope } from './normalize-scope.ts';

export function configuredPublicTreeDxRailwayServices({ tenantRoot, scope, deployConfig, identity, hostingKind, application, imageRefEnv, workspaceRoot, identityOnly = false }) {
	if (deployConfig.hosting?.kind !== 'treeseed_control_plane') {
		return [];
	}
	const railway = deployConfig.publicTreeDxFederation?.railway ?? {};
	const nodePool = railway.nodePool && typeof railway.nodePool === 'object' && !Array.isArray(railway.nodePool)
		? railway.nodePool
		: {};
	const bootstrapCount = Math.max(0, Number.parseInt(String(nodePool.bootstrapCount ?? 1), 10) || 0);
	if (bootstrapCount <= 0) {
		return [];
	}
	const configuredSource = railway.source && typeof railway.source === 'object' && !Array.isArray(railway.source)
		? railway.source
		: {};
	const treeDxRoot = resolve(workspaceRoot ?? tenantRoot, 'packages', 'treedx');
	const configuredMode = typeof railway.sourceMode === 'string' ? railway.sourceMode : null;
	if (scope === 'staging' && configuredMode === 'image') {
		throw new Error('public-treedx-node-01: API Railway staging services must use GitHub Dockerfile source builds (configured sourceMode image is not allowed).');
	}
	const sourceMode = scope === 'prod'
		? 'image'
		: configuredMode === 'git' || configuredMode === 'image'
			? configuredMode
			: 'git';
	const repository = typeof railway.sourceRepo === 'string'
		? railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: readPackageRepositorySlug(treeDxRoot) ?? 'treeseed-ai/treedx';
	const sourceBranch = typeof railway.sourceBranch === 'string'
		? railway.sourceBranch
		: typeof configuredSource.branch === 'string'
			? configuredSource.branch
			: scope === 'staging'
				? 'staging'
				: null;
	const sourceRootDirectory = typeof railway.sourceRootDirectory === 'string'
		? railway.sourceRootDirectory
		: typeof configuredSource.rootDirectory === 'string'
			? configuredSource.rootDirectory
			: '.';
	const projectName = typeof railway.projectName === 'string' && railway.projectName.trim()
		? railway.projectName.trim()
		: typeof imageRefEnv.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME === 'string' && imageRefEnv.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME.trim()
			? imageRefEnv.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME.trim()
			: identity.deploymentKey;
	const railwayEnvironment = resolveRailwayEnvironmentForScope(scope, railway.environmentName);
	const baseImageRef = envValue('TREESEED_PUBLIC_TREEDX_IMAGE_REF', imageRefEnv) || 'treeseed/treedx';
	const runtimeEnvironment = publicTreeDxRuntimeEnvironment(railway, railway.volumeMountPath ?? '/data');
	return Array.from({ length: bootstrapCount }, (_, offset) => {
		const index = offset + 1;
		const baseServiceName = `${PUBLIC_TREEDX_NODE_SERVICE_KEY_PREFIX}${String(index).padStart(2, '0')}`;
		const serviceName = railwayTreeDxServiceName(index, scope);
		const service = {
			key: baseServiceName,
			serviceName,
			sourceMode,
			sourceRepo: sourceMode === 'git' ? repository : null,
			sourceBranch: sourceMode === 'git' ? sourceBranch : null,
			sourceCommit: sourceMode === 'git'
				? typeof railway.sourceCommit === 'string'
					? railway.sourceCommit
					: typeof configuredSource.commit === 'string'
						? configuredSource.commit
						: headCommitSafe(treeDxRoot) ?? headCommitSafe(tenantRoot)
				: null,
			sourceRootDirectory: sourceMode === 'git' ? sourceRootDirectory : null,
			imageRef: sourceMode === 'image' ? baseImageRef : null,
			dockerfilePath: sourceMode === 'git' ? railway.dockerfilePath ?? '/Dockerfile' : null,
			buildCommand: sourceMode === 'git' ? railway.buildCommand ?? null : null,
			startCommand: sourceMode === 'git' ? railway.startCommand ?? null : null,
		};
		if (!identityOnly) {
			assertApiRailwaySourcePolicy(scope, service);
		}
		return {
			key: service.key,
			instanceKey: serviceName,
			runnerIndex: null,
			serviceConfig: null,
			scope,
			projectId: typeof railway.projectId === 'string' ? railway.projectId : null,
			projectName,
			serviceId: typeof railway.serviceId === 'string' && bootstrapCount === 1 ? railway.serviceId : null,
			serviceName: service.serviceName,
			runnerId: null,
			rootDir: treeDxRoot,
			publicBaseUrl: null,
			railwayEnvironment,
			buildCommand: service.buildCommand,
			startCommand: service.startCommand,
			imageRef: service.imageRef,
			sourceMode: service.sourceMode,
			sourceRepo: service.sourceRepo,
			sourceBranch: service.sourceBranch,
			sourceCommit: service.sourceCommit,
			sourceRootDirectory: service.sourceRootDirectory,
			dockerfilePath: service.dockerfilePath,
			healthcheckPath: railway.healthcheckPath ?? null,
			healthcheckTimeoutSeconds: railway.healthcheckTimeoutSeconds ?? null,
			healthcheckIntervalSeconds: railway.healthcheckIntervalSeconds ?? null,
			restartPolicy: railway.restartPolicy ?? null,
			runtimeMode: railway.runtimeMode ?? 'replicated',
			volumeMountPath: railway.volumeMountPath ?? '/data',
			schedule: [],
			hostingKind,
			runnerPool: null,
			application,
				environmentVariables: runtimeEnvironment,
				secretRefs: ['TREEDX_SECRET_KEY_BASE', 'TREEDX_ADMIN_TOKEN', 'TREEDX_JWT_HS256_SECRET'],
				variableRefs: Object.keys(runtimeEnvironment),
			};
		});
	}

export function readPackageRepositorySlug(packageRoot) {
	const manifestPath = resolve(packageRoot, 'treeseed.package.yaml');
	if (!existsSync(manifestPath)) return null;
	try {
		const manifest = parseYaml(readFileSync(manifestPath, 'utf8'));
		const repository = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
			? (manifest as Record<string, unknown>).repository
			: null;
		return typeof repository === 'string' && /^[^/\s]+\/[^/\s]+$/u.test(repository.trim()) ? repository.trim() : null;
	} catch {
		return null;
	}
}

export function headCommitSafe(cwd) {
	try {
		return runGitText(['rev-parse', 'HEAD'], {
			cwd,
			mode: classifyGitMode(['rev-parse', 'HEAD']),
		}).trim();
	} catch {
		return null;
	}
}

export function resolveRailwayServiceSourcePolicy({ tenantRoot, scope, serviceKey, service, serviceRoot, imageRef, serviceName: effectiveServiceName }) {
	const configuredMode = typeof service.railway?.sourceMode === 'string' ? service.railway.sourceMode : null;
	const configuredSource = service.railway?.source && typeof service.railway.source === 'object' && !Array.isArray(service.railway.source)
		? service.railway.source
		: {};
	const configuredRepo = typeof service.railway?.sourceRepo === 'string'
		? service.railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: null;
	const serviceName = effectiveServiceName ?? service.railway?.serviceName ?? null;
	const packageRepository = configuredRepo
		?? readPackageRepositorySlug(serviceRoot)
		?? readPackageRepositorySlug(tenantRoot)
		?? apiRailwayDefaultSourceRepo({ key: serviceKey, serviceName });
	const dockerfilePath = service.railway?.dockerfilePath ?? apiRailwayDefaultDockerfilePath({ key: serviceKey, serviceName });
	const apiPackageSourceEligible = ['api', 'operationsRunner'].includes(serviceKey);
	if (scope === 'staging' && isApiRailwaySourcePolicyService({ key: serviceKey, serviceName }) && (configuredMode === 'image' || service.railway?.imageRef)) {
		throw new Error(`${serviceName ?? serviceKey}: API Railway staging services must use GitHub Dockerfile source builds (configured image source is not allowed).`);
	}
	const sourceMode = scope === 'prod'
		? 'image'
		: scope === 'staging' && apiPackageSourceEligible
			? 'git'
		: configuredMode === 'git' || configuredMode === 'image'
			? configuredMode
			: imageRef
				? 'image'
			: 'git';
	if (sourceMode !== 'git') {
		const policy = {
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceCommit: null,
			sourceRootDirectory: null,
		};
		assertApiRailwaySourcePolicy(scope, {
			key: serviceKey,
			serviceName,
			imageRef,
			dockerfilePath: null,
			buildCommand: null,
			startCommand: null,
			...policy,
		});
		return policy;
	}
	const policy = {
		sourceMode: 'git',
		sourceRepo: packageRepository,
		sourceBranch: typeof service.railway?.sourceBranch === 'string'
			? service.railway.sourceBranch
			: typeof configuredSource.branch === 'string'
				? configuredSource.branch
				: scope === 'staging'
					? 'staging'
					: null,
		sourceCommit: typeof service.railway?.sourceCommit === 'string'
			? service.railway.sourceCommit
			: typeof configuredSource.commit === 'string'
				? configuredSource.commit
				: headCommitSafe(serviceRoot),
		sourceRootDirectory: typeof service.railway?.sourceRootDirectory === 'string'
			? service.railway.sourceRootDirectory
			: typeof configuredSource.rootDirectory === 'string'
				? configuredSource.rootDirectory
				: '.',
	};
	assertApiRailwaySourcePolicy(scope, {
		key: serviceKey,
		serviceName,
		imageRef: null,
		dockerfilePath,
		...policy,
	});
	return policy;
}

export function resolveRailwayCapacityProviderRoot(tenantRoot, service) {
	if (service.railway?.rootDir) {
		return resolve(tenantRoot, service.railway.rootDir);
	}
	const candidates = [
		resolve(tenantRoot, '..', 'agent'),
		resolve(tenantRoot, 'packages', 'agent'),
		resolve(tenantRoot, '..', '..', 'packages', 'agent'),
	];
	const found = candidates.find((candidate) =>
		existsSync(resolve(candidate, 'treeseed.package.yaml'))
		|| existsSync(resolve(candidate, 'package.json')),
	);
	return found ?? resolve(tenantRoot, 'packages', 'agent');
}
