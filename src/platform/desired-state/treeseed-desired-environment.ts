import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageAdapter,
} from '../../operations/services/package-adapters.ts';
import { redactCapacityProviderEnv, validateAndDigestCapacityProviderManifest } from '../../capacity-provider.ts';
import { workspaceRoot } from '../../operations/services/workspace-tools.ts';
import {
	checkedOutTemplateRepositories,
	type TreeseedTemplateRepositoryManifest,
} from '../../operations/services/managed-repositories.ts';
import { deriveTreeseedDesiredUnits } from '../../reconcile/desired-state.ts';
import type { TreeseedDesiredUnit, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../../reconcile/contracts.ts';
import {
	buildProjectLocalContentResources,
	type TreeseedLocalContentMode,
} from '../local-content-materialization.ts';
import { localTreeDxSeedDigest } from '../local-treedx-seed.ts';


export type TreeseedDesiredEnvironment = 'local' | 'staging' | 'prod';

export type TreeseedPackageUnit = {
	id: string;
	name: string;
	kind: string;
	path: string;
	version: string | null;
	publishTarget: string | null;
	manifestPath: string | null;
	repository: string | null;
	releaseCapability: 'npm' | 'image' | 'deploy-only' | 'none';
	requiredSecrets: string[];
	requiredVariables: string[];
	githubEnvironments: string[];
};

export type TreeseedTemplateUnit = {
	id: string;
	name: string;
	category: string;
	path: string;
	version: string | null;
	repository: string | null;
	manifestPath: string | null;
	releaseTag: string | null;
	recordPath: string;
};

export type TreeseedDesiredResourceKind =
	| 'package-manifest'
	| 'template-manifest'
	| 'package-workflow'
	| 'package-image'
	| 'github-environment'
	| 'github-secret-binding'
	| 'github-variable-binding'
	| 'docker-image-build'
	| 'cloudflare-resource'
	| 'railway-project'
	| 'railway-environment'
	| 'railway-service'
	| 'railway-volume'
	| 'railway-domain'
	| 'local-process'
	| 'local-docker-compose'
	| 'local-treedx'
	| 'local-content-materialization'
	| 'local-seed-bootstrap'
	| 'capacity-provider'
	| 'branch-preview'
	| 'branch-preview-cleanup'
	| 'workflow-gate'
	| 'save-gate'
	| 'release-gate';

export type TreeseedDesiredResource = {
	id: string;
	kind: TreeseedDesiredResourceKind;
	provider: string;
	environment: TreeseedDesiredEnvironment;
	packageId: string | null;
	serviceId: string | null;
	logicalName: string;
	dependencies: string[];
	spec: Record<string, unknown>;
	source: {
		type: 'reconcile-unit' | 'package-adapter';
		id: string;
	};
};

export function resolveLocalGitCommonDir(tenantRoot: string) {
	const dotGitPath = resolvePath(tenantRoot, '.git');
	if (!existsSync(dotGitPath)) return '';
	try {
		if (statSync(dotGitPath).isDirectory()) return dotGitPath;
		const stat = readFileSync(dotGitPath, 'utf8');
		const match = /^gitdir:\s*(.+)\s*$/imu.exec(stat);
		if (!match?.[1]) return dotGitPath;
		const gitDir = resolvePath(tenantRoot, match[1].trim());
		const commonDirPath = resolvePath(gitDir, 'commondir');
		if (existsSync(commonDirPath)) {
			const commonDir = readFileSync(commonDirPath, 'utf8').trim();
			if (commonDir) return resolvePath(gitDir, commonDir);
		}
		const marker = `${resolvePath('/').replace(/\/$/u, '')}.git/worktrees/`;
		const normalized = gitDir.replace(/\\/gu, '/');
		const markerIndex = normalized.indexOf('/.git/worktrees/');
		if (markerIndex >= 0) return normalized.slice(0, markerIndex + '/.git'.length);
		if (normalized.includes(marker)) return normalized.slice(0, normalized.indexOf(marker) + '/.git'.length);
		return dirname(gitDir);
	} catch {
		return '';
	}
}

export type TreeseedDesiredResourceEdge = {
	from: string;
	to: string;
	reason: 'depends-on' | 'releases' | 'hosts';
};

export type TreeseedDesiredResourceGraph = {
	workspaceId: string;
	environment: TreeseedDesiredEnvironment;
	packages: TreeseedPackageUnit[];
	templates: TreeseedTemplateUnit[];
	resources: TreeseedDesiredResource[];
	edges: TreeseedDesiredResourceEdge[];
	fingerprints: Record<string, string>;
};

export const INTERNAL_PACKAGE_DEPENDENCY_FIELDS = [
	'dependencies',
	'optionalDependencies',
	'peerDependencies',
	'devDependencies',
] as const;

export function hashJson(value: unknown) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function reconcileIdentityForGraph(workspaceId: string, environment: TreeseedDesiredEnvironment): TreeseedDesiredUnit['identity'] {
	return {
		teamId: workspaceId,
		projectId: workspaceId,
		slug: workspaceId,
		environment,
		deploymentKey: `${workspaceId}:${environment}`,
		environmentKey: environment,
	};
}

export function environmentFromTarget(target: TreeseedReconcileTarget): TreeseedDesiredEnvironment {
	if (target.kind === 'persistent') return target.scope;
	return 'staging';
}

export function packageReleaseCapability(adapter: TreeseedPackageAdapter): TreeseedPackageUnit['releaseCapability'] {
	if (!adapter.capabilities.publish) return adapter.releaseChecks.length > 0 ? 'deploy-only' : 'none';
	if (adapter.artifacts.some((artifact) => artifact.provider === 'docker')) return 'image';
	if (adapter.artifacts.some((artifact) => artifact.provider === 'npm')) return 'npm';
	if (adapter.releaseChecks.length > 0) return 'deploy-only';
	return 'none';
}

export function packageUnitFromAdapter(adapter: TreeseedPackageAdapter): TreeseedPackageUnit {
	return {
		id: adapter.id,
		name: adapter.name,
		kind: adapter.kind,
		path: adapter.relativeDir,
		version: adapter.version,
		publishTarget: adapter.publishTarget,
		manifestPath: adapter.manifestPath,
		repository: typeof adapter.metadata.repository === 'string' ? adapter.metadata.repository : null,
		releaseCapability: packageReleaseCapability(adapter),
		requiredSecrets: Array.isArray(adapter.metadata.requiredSecrets) ? adapter.metadata.requiredSecrets : [],
		requiredVariables: Array.isArray(adapter.metadata.requiredVariables) ? adapter.metadata.requiredVariables : [],
		githubEnvironments: Array.isArray(adapter.metadata.githubEnvironments) ? adapter.metadata.githubEnvironments : [],
	};
}

export const PRODUCTION_ONLY_GITHUB_SECRET_NAMES = new Set([
	'NPM_TOKEN',
	'PYPI_API_TOKEN',
	'CARGO_REGISTRY_TOKEN',
	'HEX_API_KEY',
]);

export function packageRequiredSecretsForGitHubEnvironment(adapter: TreeseedPackageAdapter, environmentName: string) {
	const requiredSecrets = Array.isArray(adapter.metadata.requiredSecrets) ? adapter.metadata.requiredSecrets : [];
	const isProduction = environmentName === 'production';
	return requiredSecrets.filter((secretName): secretName is string => {
		if (typeof secretName !== 'string' || !secretName.trim()) return false;
		return isProduction || !PRODUCTION_ONLY_GITHUB_SECRET_NAMES.has(secretName);
	});
}

export function packageRequiredVariablesForGitHubEnvironment(adapter: TreeseedPackageAdapter, _environmentName: string) {
	return (Array.isArray(adapter.metadata.requiredVariables) ? adapter.metadata.requiredVariables : [])
		.filter((variableName): variableName is string => typeof variableName === 'string' && Boolean(variableName.trim()));
}

export function packageUnitRequiredSecretsForGitHubEnvironment(pkg: TreeseedPackageUnit, environmentName: string) {
	const isProduction = environmentName === 'production';
	return pkg.requiredSecrets.filter((secretName) => isProduction || !PRODUCTION_ONLY_GITHUB_SECRET_NAMES.has(secretName));
}

export function templateReleaseTag(manifest: TreeseedTemplateRepositoryManifest) {
	return manifest.version ? `${manifest.release.tagPrefix}${manifest.id}/v${manifest.version}` : null;
}

export function templateUnitFromRepository(repo: ReturnType<typeof checkedOutTemplateRepositories>[number]): TreeseedTemplateUnit {
	const manifest = repo.templateManifest!;
	return {
		id: manifest.id,
		name: manifest.name,
		category: manifest.category,
		path: repo.relativeDir,
		version: manifest.version,
		repository: manifest.repository,
		manifestPath: manifest.manifestPath,
		releaseTag: templateReleaseTag(manifest),
		recordPath: manifest.release.recordPath,
	};
}

export function stringRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringArray(value: unknown) {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

export function workflowName(value: unknown, fallback: string) {
	return (typeof value === 'string' && value.trim() ? value.trim() : fallback).replace(/^\.github\/workflows\//u, '');
}

export function packageShortSha(adapter: TreeseedPackageAdapter) {
	const envSha = process.env.GITHUB_SHA;
	if (typeof envSha === 'string' && /^[a-f0-9]{7,40}$/iu.test(envSha)) return envSha.slice(0, 12).toLowerCase();
	return createHash('sha256').update(`${adapter.id}:${adapter.dir}:${adapter.version ?? ''}`).digest('hex').slice(0, 12);
}

export function materializeDockerImageTags(tags: string[], adapter: TreeseedPackageAdapter, branch: string) {
	const shortSha = packageShortSha(adapter);
	const branchSlug = branch.replace(/[^A-Za-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'branch';
	return tags.map((tag) => tag
		.replace(/<short-sha>/gu, shortSha)
		.replace(/<branch-slug>/gu, branchSlug)
		.replace(/<branch>/gu, branchSlug)
		.replace(/<version>/gu, String(adapter.version ?? 'latest').replace(/[^A-Za-z0-9_.-]+/gu, '-')));
}

export function dockerPlatforms(artifactArchitectures: unknown, adapterArchitectures: unknown) {
	const architectures = stringArray(artifactArchitectures).length > 0
		? stringArray(artifactArchitectures)
		: stringArray(adapterArchitectures);
	const normalized = architectures.length > 0 ? architectures : ['amd64', 'arm64'];
	return normalized.map((arch) => arch.startsWith('linux/') ? arch : `linux/${arch}`);
}

export function localDockerPlatform() {
	if (process.arch === 'arm64') return 'linux/arm64';
	if (process.arch === 'arm') return 'linux/arm/v7';
	return 'linux/amd64';
}
