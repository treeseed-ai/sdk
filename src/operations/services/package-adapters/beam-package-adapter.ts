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
import { TreeseedPackageAdapter, commandFromScript, docsSiteReadiness, normalizeTreeseedPackageProjectArchitecture, readMixProjectVersion } from './treeseed-package-kind.ts';
import { manifestDockerArtifacts, positiveIntegerValue, readTreeseedPackageManifest, stringArray, stringRecord, stringValue, treeseedPackageManifestPath } from './deployment-source-mode-for-branch.ts';

export function beamPackageAdapter(root: string, dir: string): TreeseedPackageAdapter | null {
	const manifest = readTreeseedPackageManifest(dir);
	const hasMixProject = existsSync(resolve(dir, 'apps/api/mix.exs')) || existsSync(resolve(dir, 'mix.exs'));
	if (!manifest && !hasMixProject) return null;
	const kind = typeof manifest?.kind === 'string' ? manifest.kind : 'beam-elixir-rust';
	if (kind !== 'beam-elixir-rust') return null;
	const id = typeof manifest?.id === 'string' && manifest.id.trim()
		? manifest.id.trim()
		: relative(resolve(root, 'packages'), dir).replaceAll('\\', '/');
	const name = typeof manifest?.name === 'string' && manifest.name.trim() ? manifest.name.trim() : id;
	const versionSourceRel = typeof manifest?.versionSource === 'string' && manifest.versionSource.trim()
		? manifest.versionSource.trim()
		: existsSync(resolve(dir, 'apps/api/mix.exs'))
			? 'apps/api/mix.exs'
			: 'mix.exs';
	const versionSource = resolve(dir, versionSourceRel);
	const image = typeof manifest?.image === 'string' && manifest.image.trim()
		? manifest.image.trim()
		: id === 'treedx'
			? 'treeseed/treedx'
			: null;
	const dockerArtifacts = manifestDockerArtifacts(manifest?.artifacts);
	const dockerImages = stringRecord(manifest?.dockerImages);
	const dockerImageReleaseWorkflow = stringValue(dockerImages.releaseWorkflow);
	const dockerImageArchitectures = stringArray(dockerImages.architectures);
	const releaseGateRecord = stringRecord(manifest?.releaseGate);
	const hostedVerifyTimeoutSeconds = positiveIntegerValue(releaseGateRecord.timeoutSeconds)
		?? positiveIntegerValue(manifest?.hostedVerifyTimeoutSeconds);
	const repository = stringValue(manifest?.repository) ?? (id === 'treedx' ? 'treeseed-ai/treedx' : null);
	const hostedVerifyWorkflow = stringValue(manifest?.hostedVerifyWorkflow)
		?? stringValue(releaseGateRecord.workflow)
		?? (existsSync(resolve(dir, '.github/workflows/release-gate.yml')) ? 'release-gate.yml' : null);
	const projectArchitecture = normalizeTreeseedPackageProjectArchitecture(manifest?.projectArchitecture, id);
	const docsReadiness = docsSiteReadiness(dir, projectArchitecture);
	const capabilityRecord = stringRecord(manifest?.capabilities);
	const localOnly = capabilityRecord.localOnly === true;
	const verify = manifest?.verify && typeof manifest.verify === 'object' && !Array.isArray(manifest.verify)
		? manifest.verify as Record<string, unknown>
		: {};
	const fast = verify.fast ?? (existsSync(resolve(dir, 'scripts/test-treedx-fast.sh')) ? 'scripts/test-treedx-fast.sh' : null);
	const local = verify.local ?? (existsSync(resolve(dir, 'scripts/test-all.sh')) ? 'scripts/test-all.sh' : null);
	const releaseGate = stringValue(manifest?.releaseGate)
		?? verify.release
		?? (existsSync(resolve(dir, 'scripts/release-gate.sh')) ? 'scripts/release-gate.sh' : null);
	const version = readMixProjectVersion(versionSource);
	const shaTag = 'sha-<short-sha>';
	return {
		id,
		name,
		kind: 'beam-elixir-rust',
		dir,
		relativeDir: relative(root, dir).replaceAll('\\', '/'),
		version,
		publishTarget: image,
		manifestPath: treeseedPackageManifestPath(dir),
		versionSource,
		verifyCommands: {
			fast: commandFromScript(dir, fast, 'fast'),
			local: commandFromScript(dir, local, 'local'),
			release: commandFromScript(dir, releaseGate, 'release'),
		},
		artifacts: dockerArtifacts.length > 0
			? dockerArtifacts.map((artifact) => ({
				provider: 'docker' as const,
				name: artifact.name,
				tags: version ? [version, shaTag] : [shaTag],
				dockerfile: artifact.dockerfile ?? 'Dockerfile',
				context: artifact.context ?? '.',
				target: artifact.target,
				role: artifact.role ?? id,
				architectures: artifact.architectures.length > 0
					? artifact.architectures
					: dockerImageArchitectures,
			}))
			: image ? [{
				provider: 'docker',
				name: image,
				tags: version ? [version, shaTag] : [shaTag],
				dockerfile: 'Dockerfile',
				context: '.',
				target: null,
				role: id,
				architectures: dockerImageArchitectures,
				}] : [],
		capabilities: {
			save: capabilityRecord.save !== false,
			verify: capabilityRecord.verify !== false,
			publish: capabilityRecord.publish !== false,
			deploy: !localOnly && capabilityRecord.deploy !== false,
			localOnly,
		},
		releaseChecks: dockerArtifacts.length > 0
			? dockerArtifacts.map((artifact) => ({ kind: 'docker-manifest' as const, name: `${artifact.name} Docker image manifest`, detail: `${artifact.name}:${version ?? '<version>'}` }))
			: image
				? [{ kind: 'docker-manifest', name: 'Docker image manifest', detail: `${image}:${version ?? '<version>'}` }]
			: [],
		metadata: {
			hasCargo: existsSync(resolve(dir, 'Cargo.toml')),
			hasDockerfile: existsSync(resolve(dir, 'Dockerfile')),
			repository,
			deploymentSource: stringRecord(manifest?.deploymentSource),
			dockerImageReleaseWorkflow: dockerImageReleaseWorkflow ? `.github/workflows/${dockerImageReleaseWorkflow}` : null,
			dockerImageArchitectures,
			imageHosting: stringRecord(dockerImages.hosting),
			versionSource: versionSourceRel,
			...(hostedVerifyWorkflow
				? {
					hostedVerifyWorkflow: hostedVerifyWorkflow.startsWith('.github/workflows/')
						? hostedVerifyWorkflow
						: `.github/workflows/${hostedVerifyWorkflow}`,
				}
				: {}),
			...(hostedVerifyTimeoutSeconds ? { hostedVerifyTimeoutSeconds } : {}),
			type: stringValue(manifest?.type) ?? null,
			githubEnvironments: stringArray(manifest?.githubEnvironments),
			requiredSecrets: stringArray(manifest?.requiredSecrets),
			requiredVariables: stringArray(manifest?.requiredVariables),
			workflowTemplateVersion: stringValue(manifest?.workflowTemplateVersion) ?? null,
			...(projectArchitecture
				? {
					projectArchitecture,
					docsSiteReadiness: docsReadiness?.status ?? 'site_not_prepared',
					docsSiteDiagnostic: docsReadiness?.diagnostic ?? null,
				}
				: {}),
		},
	};
}

export function gitOutput(cwd: string, args: string[]) {
	const result = runTreeseedGit(args, { cwd, mode: 'read' });
	return result.stdout.trim();
}

export function gitRevisionSha(cwd: string, revision: string) {
	try {
		return gitOutput(cwd, ['rev-parse', revision]);
	} catch (error) {
		if (/^[A-Za-z0-9._/-]+$/u.test(revision) && !revision.startsWith('origin/')) {
			try {
				return gitOutput(cwd, ['rev-parse', `origin/${revision}`]);
			} catch {
				// Report the original revision failure so the command reflects what the user requested.
			}
		}
		throw error;
	}
}

export function branchSlug(value: string) {
	const normalized = value.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 40);
	return normalized || 'branch';
}
