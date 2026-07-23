import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { workspacePackages, workspaceRoot } from '../workspace-tools.ts';
import { runTreeseedGit } from '../git-runner.ts';
import { resolveTreeseedLaunchEnvironment } from '../config-runtime.ts';
import { resolveGitHubCredentialForRepository } from '../github-credentials.ts';
import {
	createGitHubApiClient,
	getLatestGitHubWorkflowRun,
} from '../github-api.ts';
import { resolveTreeseedDockerhubToken, resolveTreeseedDockerhubUsername } from '../../../service-credentials.ts';
import { inspectTreeseedContentStructure } from '../../../platform/content-runtime-source.ts';
import type {
	SeedContentPublishTargetKind,
	SeedContentRuntimeSource,
	SeedLocalContentMaterialization,
	SeedProjectArchitecture,
	SeedProjectResource,
	SeedProjectTopology,
} from '../../../seeds/types.ts';
import {
	SEED_CONTENT_PUBLISH_TARGETS,
	SEED_CONTENT_RUNTIME_SOURCES,
	SEED_LOCAL_CONTENT_MATERIALIZATIONS,
	SEED_PROJECT_TOPOLOGIES,
} from '../../../seeds/types.ts';
import { TreeseedPackageAdapter, TreeseedPackageManifest, commandFromScript, docsSiteReadiness, normalizeGitHubRepositorySlug, normalizeTreeseedPackageProjectArchitecture, readStructuredFile } from './treeseed-package-kind.ts';

export function deploymentSourceModeForBranch(metadata: Record<string, unknown>, branch: string) {
	const source = stringRecord(metadata.deploymentSource);
	const normalizedBranch = branch === 'prod' || branch === 'production' || branch === 'main' ? 'prod' : branch === 'staging' ? 'staging' : 'local';
	const configured = stringValue(source[normalizedBranch]);
	return configured === 'git' || configured === 'image'
		? configured
		: normalizedBranch === 'prod'
			? 'image'
			: stringValue(source.staging) === 'git'
				? 'git'
				: null;
}

export function nodeTypeScriptAdapter(pkg: ReturnType<typeof workspacePackages>[number]): TreeseedPackageAdapter {
	const manifest = readTreeseedPackageManifest(pkg.dir);
	const scripts = pkg.packageJson?.scripts && typeof pkg.packageJson.scripts === 'object' && !Array.isArray(pkg.packageJson.scripts)
		? pkg.packageJson.scripts as Record<string, unknown>
		: {};
	const manifestVerify = manifest?.verify && typeof manifest.verify === 'object' && !Array.isArray(manifest.verify)
		? manifest.verify as Record<string, unknown>
		: {};
	const repository = stringValue(manifest?.repository) ?? normalizeGitHubRepositorySlug(pkg.packageJson?.repository);
	const id = stringValue(manifest?.id) ?? String(pkg.name);
	const name = stringValue(manifest?.name) ?? String(pkg.name);
	const dockerArtifacts = manifestDockerArtifacts(manifest?.artifacts);
	const dockerImages = stringRecord(manifest?.dockerImages);
	const dockerImageReleaseWorkflow = stringValue(dockerImages.releaseWorkflow);
	const dockerImageArchitectures = stringArray(dockerImages.architectures);
	const releaseGateRecord = stringRecord(manifest?.releaseGate);
	const hostedVerifyTimeoutSeconds = positiveIntegerValue(releaseGateRecord.timeoutSeconds)
		?? positiveIntegerValue(manifest?.hostedVerifyTimeoutSeconds);
	const publishTargetRaw = stringValue(manifest?.publishTarget);
	const publishTarget = dockerArtifacts.length > 0 && publishTargetRaw === 'docker'
		? dockerArtifacts[0]!.name
		: publishTargetRaw ?? 'npm';
	const hostedVerifyWorkflow = stringValue(manifest?.hostedVerifyWorkflow)
		?? stringValue(releaseGateRecord.workflow)
		?? (existsSync(resolve(pkg.dir, '.github/workflows/deploy.yml')) ? 'deploy.yml' : null);
	const projectArchitecture = normalizeTreeseedPackageProjectArchitecture(manifest?.projectArchitecture, id);
	const docsReadiness = docsSiteReadiness(pkg.dir, projectArchitecture);
	const verifyLocal = typeof scripts['verify:local'] === 'string'
		? 'verify:local'
		: typeof scripts.verify === 'string'
			? 'verify'
			: typeof scripts['verify:action'] === 'string'
				? 'verify:action'
					: null;
	const capabilityRecord = stringRecord(manifest?.capabilities);
	const localOnly = capabilityRecord.localOnly === true;
	const packageType = stringValue(manifest?.type);
	return {
		id,
		name,
		kind: 'node-typescript',
		dir: pkg.dir,
		relativeDir: pkg.relativeDir,
		version: typeof pkg.packageJson?.version === 'string' ? pkg.packageJson.version : null,
		publishTarget,
		manifestPath: treeseedPackageManifestPath(pkg.dir) ?? resolve(pkg.dir, 'package.json'),
		versionSource: resolve(pkg.dir, 'package.json'),
		verifyCommands: {
			fast: commandFromScript(pkg.dir, manifestVerify.fast, 'fast')
				?? (typeof scripts.verify === 'string' ? { label: 'verify', command: 'npm', args: ['run', 'verify'], cwd: pkg.dir } : null),
			local: commandFromScript(pkg.dir, manifestVerify.local, 'local')
				?? (verifyLocal ? { label: verifyLocal, command: 'npm', args: ['run', verifyLocal], cwd: pkg.dir } : null),
			release: commandFromScript(pkg.dir, manifestVerify.release, 'release')
				?? (typeof scripts['release:publish'] === 'string' ? { label: 'release:publish', command: 'npm', args: ['run', 'release:publish'], cwd: pkg.dir } : null),
		},
		artifacts: dockerArtifacts.length > 0
			? dockerArtifacts.map((artifact) => ({
				provider: 'docker' as const,
				name: artifact.name,
				dockerfile: artifact.dockerfile,
				context: artifact.context,
				target: artifact.target,
				role: artifact.role,
				architectures: artifact.architectures,
			}))
				: [{ provider: 'npm', name: String(pkg.name) }],
		capabilities: {
			save: capabilityRecord.save !== false,
			verify: capabilityRecord.verify !== false,
			publish: capabilityRecord.publish !== false,
			deploy: !localOnly && (capabilityRecord.deploy === true || packageType === 'hosted-service' || packageType === 'hosted-app'),
			localOnly,
		},
		releaseChecks: [
			{ kind: 'github-workflow', name: 'publish workflow', detail: dockerImageReleaseWorkflow ? `.github/workflows/${dockerImageReleaseWorkflow}` : '.github/workflows/publish.yml' },
			...(dockerArtifacts.length > 0
				? dockerArtifacts.map((artifact) => ({ kind: 'docker-manifest' as const, name: `${artifact.name} Docker image manifest`, detail: `${artifact.name}:<version>` }))
				: [{ kind: 'npm-pack-plan' as const, name: 'npm pack', detail: 'npm pack --plan' }]),
		],
		metadata: {
			...(repository ? { repository } : {}),
			deploymentSource: stringRecord(manifest?.deploymentSource),
			...(dockerArtifacts.length > 0
				? {
					dockerArtifacts,
					dockerImageReleaseWorkflow: dockerImageReleaseWorkflow ? `.github/workflows/${dockerImageReleaseWorkflow}` : '.github/workflows/publish.yml',
					dockerImageArchitectures,
					imageHosting: stringRecord(dockerImages.hosting),
				}
				: {}),
				type: packageType ?? null,
			githubEnvironments: stringArray(manifest?.githubEnvironments),
			requiredSecrets: stringArray(manifest?.requiredSecrets),
			requiredVariables: stringArray(manifest?.requiredVariables),
			workflowTemplateVersion: stringValue(manifest?.workflowTemplateVersion) ?? null,
			localDev: stringRecord(manifest?.localDev),
			capacityProvider: stringRecord(manifest?.capacityProvider),
			...(projectArchitecture
				? {
					projectArchitecture,
					docsSiteReadiness: docsReadiness?.status ?? 'site_not_prepared',
					docsSiteDiagnostic: docsReadiness?.diagnostic ?? null,
				}
				: {}),
			...(hostedVerifyWorkflow
				? {
					hostedVerifyWorkflow: hostedVerifyWorkflow.startsWith('.github/workflows/')
						? hostedVerifyWorkflow
						: `.github/workflows/${hostedVerifyWorkflow}`,
				}
				: {}),
			...(hostedVerifyTimeoutSeconds ? { hostedVerifyTimeoutSeconds } : {}),
			scripts,
		},
	};
}

export function treeseedPackageManifestPath(dir: string) {
	for (const fileName of ['treeseed.package.yaml', 'treeseed.package.yml', 'treeseed.package.json', '.treeseed-package.json']) {
		const filePath = resolve(dir, fileName);
		if (existsSync(filePath)) return filePath;
	}
	return null;
}

export function readTreeseedPackageManifest(dir: string): TreeseedPackageManifest | null {
	const filePath = treeseedPackageManifestPath(dir);
	return filePath ? readStructuredFile(filePath) as TreeseedPackageManifest | null : null;
}

export function stringRecord(value: unknown) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringValue(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function positiveIntegerValue(value: unknown) {
	const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function stringArray(value: unknown) {
	return Array.isArray(value) ? value.map((entry) => stringValue(entry)).filter((entry): entry is string => Boolean(entry)) : [];
}

export function manifestDockerArtifacts(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			const record = stringRecord(entry);
			if (stringValue(record.provider) !== 'docker') return null;
			const name = stringValue(record.name);
			if (!name) return null;
			return {
				provider: 'docker' as const,
				name,
				dockerfile: stringValue(record.dockerfile),
				context: stringValue(record.context),
				target: stringValue(record.target),
				role: stringValue(record.role),
				architectures: stringArray(record.architectures),
			};
		})
		.filter((entry): entry is {
			provider: 'docker';
			name: string;
			dockerfile: string | null;
			context: string | null;
			target: string | null;
			role: string | null;
			architectures: string[];
		} => Boolean(entry));
}
