import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { workspacePackages, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { resolveLaunchEnvironment } from '../configuration/config-runtime.ts';
import { resolveGitHubCredentialForRepository } from '../configuration/github-credentials.ts';
import {
	createGitHubApiClient,
	getLatestGitHubWorkflowRun,
} from '../repositories/github-api.ts';
import { resolveDockerhubToken, resolveDockerhubUsername } from '../../../configuration/service-credentials.ts';
import { inspectContentStructure } from '../../../platform/content/content-runtime-source.ts';
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
import { PackageAdapter, PackageManifestValidation, PackageWorkflowTemplateKind, docsSiteReadiness, normalizePackageSlug } from './package-kind.ts';
import { discoverPackageAdapters } from './plan-package-development-image.ts';
import { stringArray, stringRecord, stringValue } from './deployment-source-mode-for-branch.ts';

export function validatePackageManifests(root = workspaceRoot()): PackageManifestValidation[] {
	return discoverPackageAdapters(root).map((adapter) => {
		const errors: string[] = [];
		const warnings: string[] = [];
		if (!adapter.manifestPath || adapter.manifestPath.endsWith('package.json')) {
			errors.push('missing treeseed.package.yaml');
		}
		if (!adapter.id.trim()) errors.push('missing package id');
		if (!adapter.name.trim()) errors.push('missing package name');
		if (!['node-typescript', 'beam-elixir-rust'].includes(adapter.kind)) {
			errors.push(`unsupported package kind ${adapter.kind}`);
		}
		if (adapter.verifyCommands.local == null) {
			errors.push('missing local verification command');
		}
		if (!adapter.metadata.projectArchitecture) {
			warnings.push('package does not declare projectArchitecture metadata');
		}
			if (adapter.releaseChecks.length === 0) {
			warnings.push('package declares no release checks');
		}
		const hasDockerArtifact = adapter.artifacts.some((artifact) => artifact.provider === 'docker');
		if (hasDockerArtifact) {
			const deploymentSource = stringRecord(adapter.metadata.deploymentSource);
			if (stringValue(deploymentSource.staging) !== 'git') {
				errors.push('docker package must declare deploymentSource.staging: git');
			}
			if (adapter.capabilities.localOnly && adapter.capabilities.deploy) {
				errors.push('local-only package cannot declare hosted deployment capability');
			}
			if (stringValue(deploymentSource.prod) !== 'image') {
				errors.push('docker package must declare deploymentSource.prod: image');
			}
			const architectures = stringArray(adapter.metadata.dockerImageArchitectures);
			if (!architectures.includes('amd64') || !architectures.includes('arm64')) {
				errors.push('docker package must declare amd64 and arm64 architectures');
			}
		}
		for (const artifact of adapter.artifacts) {
			if (artifact.provider === 'docker' && !artifact.name.startsWith('treeseed/')) {
				errors.push(`docker artifact ${artifact.name} must publish under treeseed/*`);
			}
		}
		return {
			packageId: adapter.id,
			path: adapter.relativeDir,
			manifestPath: adapter.manifestPath,
			ok: errors.length === 0,
			errors,
			warnings,
		};
	});
}

export function derivePackageProjectResources(
	root = workspaceRoot(),
	options: { team?: string } = {},
): SeedProjectResource[] {
	const team = options.team ?? 'team:treeseed';
	return discoverPackageAdapters(root)
		.map((adapter): SeedProjectResource | null => {
			const architecture = adapter.metadata.projectArchitecture as SeedProjectArchitecture | undefined;
			const repository = stringValue(adapter.metadata.repository);
			if (!architecture || !repository) return null;
			const [owner, name] = repository.split('/');
			if (!owner || !name) return null;
			const slug = normalizePackageSlug(adapter.id);
			return {
				key: `project:treeseed/${slug}`,
				team,
				slug,
				name: adapter.name,
				description: `${adapter.name} first-party package project.`,
				kind: 'package',
				repository: {
					role: 'primary',
					provider: 'github',
					owner,
					name,
					gitUrl: `https://github.com/${owner}/${name}.git`,
					defaultBranch: 'main',
					checkoutPath: adapter.relativeDir,
				},
				architecture,
				metadata: {
					packageId: adapter.id,
					packagePath: adapter.relativeDir,
					visibility: 'public',
					docsSiteReadiness: stringValue(adapter.metadata.docsSiteReadiness) ?? 'site_not_prepared',
					releaseOwnership: 'treeseed.package.yaml',
				},
			};
		})
		.filter((entry): entry is SeedProjectResource => Boolean(entry));
}

export function workflowNameForTemplate(adapter: PackageAdapter, template: PackageWorkflowTemplateKind) {
	const publishWorkflow = 'publish.yml';
	const configuredReleaseGate = stringValue(adapter.metadata.hostedVerifyWorkflow)?.replace(/^\.github\/workflows\//u, '') ?? 'verify.yml';
	if (template === 'docker-image') return publishWorkflow;
	if (template === 'release-gate') {
		return configuredReleaseGate === publishWorkflow
			? 'release-gate.yml'
			: configuredReleaseGate;
	}
	return publishWorkflow;
}
