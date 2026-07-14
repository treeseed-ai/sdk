export type TreeseedRailwaySourcePolicyScope = 'local' | 'staging' | 'prod';

export type TreeseedRailwaySourcePolicyService = {
	key?: string | null;
	serviceName?: string | null;
	sourceMode?: string | null;
	sourceRepo?: string | null;
	sourceBranch?: string | null;
	sourceCommit?: string | null;
	sourceRootDirectory?: string | null;
	imageRef?: string | null;
	dockerfilePath?: string | null;
	buildCommand?: string | null;
	startCommand?: string | null;
};

export type TreeseedRailwaySourceIdentity = TreeseedRailwaySourcePolicyService & {
	environment?: string | null;
};

const SOURCE_DIVERGENT_ENVIRONMENT_SUFFIX = /-(?:staging|production)(?=-\d+$|$)/u;

export function railwayEnvironmentQualifiedServiceName(
	serviceName: string,
	scope: TreeseedRailwaySourcePolicyScope | string,
) {
	const normalizedName = String(serviceName ?? '').trim();
	const suffix = scope === 'prod' || scope === 'production'
		? 'production'
		: scope === 'staging'
			? 'staging'
			: null;
	if (!normalizedName || !suffix) return normalizedName;
	const unqualifiedName = normalizedName.replace(SOURCE_DIVERGENT_ENVIRONMENT_SUFFIX, '');
	const indexedName = /^(.*?)(-\d+)$/u.exec(unqualifiedName);
	return indexedName
		? `${indexedName[1]}-${suffix}${indexedName[2]}`
		: `${unqualifiedName}-${suffix}`;
}

function railwaySourceSignature(service: TreeseedRailwaySourceIdentity) {
	return JSON.stringify({
		sourceMode: service.sourceMode ?? null,
		sourceRepo: service.sourceRepo ?? null,
		sourceBranch: service.sourceBranch ?? null,
		sourceRootDirectory: service.sourceRootDirectory ?? null,
		imageRef: service.imageRef ?? null,
		dockerfilePath: service.dockerfilePath ?? null,
		buildCommand: service.buildCommand ?? null,
	});
}

export function assertNoRailwaySourceIdentityCollisions(services: TreeseedRailwaySourceIdentity[]) {
	const identities = new Map<string, TreeseedRailwaySourceIdentity>();
	for (const service of services) {
		const serviceName = String(service.serviceName ?? '').trim();
		if (!serviceName) continue;
		const existing = identities.get(serviceName);
		if (existing && railwaySourceSignature(existing) !== railwaySourceSignature(service)) {
			throw new Error(
				`${serviceName}: Railway service identity is shared by ${existing.environment ?? 'one environment'} and ${service.environment ?? 'another environment'} with different source/build configurations. Use environment-qualified service names.`,
			);
		}
		identities.set(serviceName, service);
	}
}

export function isApiRailwaySourcePolicyService(service: TreeseedRailwaySourcePolicyService) {
	const key = String(service.key ?? '').trim();
	const serviceName = String(service.serviceName ?? '').trim();
	return key.startsWith('public-treedx-node-')
		|| /^treeseed-api(?:-(?:staging|production))?$/u.test(serviceName)
		|| /^treeseed-api-operations-runner(?:-(?:staging|production))?(?:-\d+)?$/u.test(serviceName)
		|| /^public-treedx-node(?:-(?:staging|production))?-\d+$/u.test(serviceName);
}

export function isImmutableRailwayImageRef(value: unknown) {
	const imageRef = typeof value === 'string' ? value.trim() : '';
	if (!imageRef || !imageRef.includes(':')) return false;
	const tag = imageRef.split(':').pop()?.trim() ?? '';
	return Boolean(tag) && !['latest', 'staging', 'dev', 'local'].includes(tag);
}

export function apiRailwayDefaultSourceRepo(service: TreeseedRailwaySourcePolicyService) {
	const serviceName = String(service.serviceName ?? '').trim();
	if (String(service.key ?? '') === 'api' || String(service.key ?? '') === 'operationsRunner' || /^treeseed-api(?:-(?:staging|production))?$/u.test(serviceName) || /^treeseed-api-operations-runner(?:-(?:staging|production))?(?:-\d+)?$/u.test(serviceName)) return 'treeseed-ai/api';
	if (/^public-treedx-node(?:-(?:staging|production))?-\d+$/u.test(serviceName) || String(service.key ?? '').startsWith('public-treedx-node-')) return 'treeseed-ai/treedx';
	return null;
}

export function apiRailwayDefaultDockerfilePath(service: TreeseedRailwaySourcePolicyService) {
	const serviceName = String(service.serviceName ?? '').trim();
	if (String(service.key ?? '') === 'api' || /^treeseed-api(?:-(?:staging|production))?$/u.test(serviceName)) return '/Dockerfile.api';
	if (String(service.key ?? '') === 'operationsRunner' || /^treeseed-api-operations-runner(?:-(?:staging|production))?(?:-\d+)?$/u.test(serviceName)) return '/Dockerfile.operations-runner';
	if (/^public-treedx-node(?:-(?:staging|production))?-\d+$/u.test(serviceName) || String(service.key ?? '').startsWith('public-treedx-node-')) return '/Dockerfile';
	return null;
}

export function assertApiRailwaySourcePolicy(
	scope: TreeseedRailwaySourcePolicyScope | string,
	service: TreeseedRailwaySourcePolicyService,
) {
	if (!isApiRailwaySourcePolicyService(service)) return;
	const normalizedScope = scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
	const label = service.serviceName ?? service.key ?? 'Railway service';
	const serviceName = String(service.serviceName ?? '').trim();
	const expectedServiceName = railwayEnvironmentQualifiedServiceName(serviceName, normalizedScope);
	if (normalizedScope === 'staging') {
		const issues = [
			serviceName === expectedServiceName && /-staging(?:-|$)/u.test(serviceName) ? null : `serviceName must be ${expectedServiceName}`,
			service.sourceMode === 'git' ? null : 'sourceMode must be git',
			service.imageRef ? 'imageRef must be empty' : null,
			service.sourceRepo ? null : 'sourceRepo must be set',
			service.sourceBranch === 'staging' ? null : 'sourceBranch must be staging',
			service.sourceRootDirectory ? null : 'sourceRootDirectory must be set',
			service.dockerfilePath ? null : 'dockerfilePath must be set',
		].filter((issue): issue is string => Boolean(issue));
		if (issues.length > 0) {
			throw new Error(`${label}: API Railway staging services must use GitHub Dockerfile source builds (${issues.join('; ')}).`);
		}
		return;
	}
	if (normalizedScope === 'prod') {
		const issues = [
			serviceName === expectedServiceName && /-production(?:-|$)/u.test(serviceName) ? null : `serviceName must be ${expectedServiceName}`,
			service.sourceMode === 'image' ? null : 'sourceMode must be image',
			isImmutableRailwayImageRef(service.imageRef) ? null : 'imageRef must be an immutable released image tag',
			service.sourceRepo ? 'sourceRepo must be empty' : null,
			service.sourceBranch ? 'sourceBranch must be empty' : null,
			service.sourceCommit ? 'sourceCommit must be empty' : null,
			service.sourceRootDirectory ? 'sourceRootDirectory must be empty' : null,
			service.dockerfilePath ? 'dockerfilePath must be empty' : null,
			service.buildCommand ? 'buildCommand must be empty' : null,
			service.startCommand ? 'startCommand must be empty' : null,
		].filter((issue): issue is string => Boolean(issue));
		if (issues.length > 0) {
			throw new Error(`${label}: API Railway production services must use released Docker image sources (${issues.join('; ')}).`);
		}
	}
}
