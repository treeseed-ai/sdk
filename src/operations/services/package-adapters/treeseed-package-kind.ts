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
import { branchSlug } from './beam-package-adapter.ts';
import { stringRecord, stringValue } from './deployment-source-mode-for-branch.ts';

export type TreeseedPackageKind = 'node-typescript' | 'beam-elixir-rust';

export type TreeseedPackageCommand = {
	label: string;
	command: string;
	args: string[];
	cwd: string;
};

export type TreeseedPackageAdapter = {
	id: string;
	name: string;
	kind: TreeseedPackageKind;
	dir: string;
	relativeDir: string;
	version: string | null;
	publishTarget: string | null;
	manifestPath: string | null;
	versionSource: string | null;
	verifyCommands: {
		fast: TreeseedPackageCommand | null;
		local: TreeseedPackageCommand | null;
		release: TreeseedPackageCommand | null;
	};
	artifacts: Array<{
		provider: 'npm' | 'docker';
		name: string;
		tags?: string[];
		dockerfile?: string | null;
		context?: string | null;
		target?: string | null;
		role?: string | null;
		architectures?: string[];
	}>;
	capabilities: {
		save: boolean;
		verify: boolean;
		publish: boolean;
		deploy: boolean;
		localOnly: boolean;
	};
	releaseChecks: Array<{
		kind: 'npm-pack-plan' | 'github-workflow' | 'docker-manifest';
		name: string;
		detail: string;
	}>;
	metadata: Record<string, unknown>;
};

export type TreeseedPackageManifestValidation = {
	packageId: string;
	path: string;
	manifestPath: string | null;
	ok: boolean;
	errors: string[];
	warnings: string[];
};

export type TreeseedPackageManifest = {
	id?: unknown;
	name?: unknown;
	kind?: unknown;
	type?: unknown;
	versionSource?: unknown;
	image?: unknown;
	repository?: unknown;
	verify?: unknown;
	releaseGate?: unknown;
	hostedVerifyWorkflow?: unknown;
	hostedVerifyTimeoutSeconds?: unknown;
	artifacts?: unknown;
	dockerImages?: unknown;
	capacityProvider?: unknown;
	publishTarget?: unknown;
	deploymentSource?: unknown;
	githubEnvironments?: unknown;
	requiredSecrets?: unknown;
	requiredVariables?: unknown;
	workflowTemplateVersion?: unknown;
	projectArchitecture?: unknown;
	capabilities?: unknown;
};

export type TreeseedPackageDevelopmentImagePlan = {
	package: {
		id: string;
		name: string;
		path: string;
		kind: TreeseedPackageKind;
		version: string | null;
		publishTarget: string | null;
		metadata: Record<string, unknown>;
	};
	repository: string;
	workflow: string;
	branch: string;
	refs: {
		imageName: string;
		branch: string;
		branchSlug: string;
		sha: string;
		shortSha: string;
		immutableTag: string | null;
		movingTag: string | null;
			imageRef: string | null;
			movingImageRef: string | null;
			archImageRefs: string[];
			roleImages?: Array<{
				role: string;
				imageName: string;
				target: string | null;
				immutableRef: string | null;
				movingRef: string | null;
				archImageRefs: string[];
			}>;
		};
	hosting: {
		app: string;
		environment: string;
		overrideEnvVar: string;
		override: Record<string, string>;
		command: string;
	} | null;
	deploymentSource: {
		environment: string;
		mode: 'git' | 'image';
		repository: string;
		commitSha: string;
		imagePublicationRequired: boolean;
	};
};

export type TreeseedPackageImageWorkflowOptions = {
	root?: string;
	packageId: string;
	branch?: string | null;
	workflow?: string | null;
	execute?: boolean;
	syncConfig?: boolean;
	env?: NodeJS.ProcessEnv;
};

export type TreeseedPackageWorkflowTemplateKind = 'npm-publish' | 'docker-image' | 'release-gate';

export type TreeseedPackageWorkflowSyncResult = {
	packageId: string;
	path: string;
	workflow: string;
	template: TreeseedPackageWorkflowTemplateKind;
	exists: boolean;
	changed: boolean;
	written: boolean;
};

export function readJsonFile(filePath: string) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function readStructuredFile(filePath: string) {
	try {
		const raw = readFileSync(filePath, 'utf8');
		return filePath.endsWith('.yaml') || filePath.endsWith('.yml')
			? (parseYaml(raw) as Record<string, unknown>)
			: JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function readPackageJsonVersion(filePath: string) {
	const packageJson = readJsonFile(filePath);
	return typeof packageJson?.version === 'string' ? packageJson.version : null;
}

export function normalizeGitHubRepositorySlug(value: unknown) {
	const raw = typeof value === 'string'
		? value
		: value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>).url
			: null;
	if (typeof raw !== 'string' || !raw.trim()) return null;
	const normalized = raw
		.trim()
		.replace(/^git\+/u, '')
		.replace(/^ssh:\/\/git@github\.com[:/]/u, '')
		.replace(/^git@github\.com:/u, '')
		.replace(/^https:\/\/github\.com\//u, '')
		.replace(/\.git$/u, '')
		.replace(/\/$/u, '');
	return /^[^/\s]+\/[^/\s]+$/u.test(normalized) ? normalized : null;
}

export function readMixProjectVersion(filePath: string) {
	if (!existsSync(filePath)) return null;
	const source = readFileSync(filePath, 'utf8');
	const match = source.match(/\bversion:\s*"([^"]+)"/u);
	return match?.[1] ?? null;
}

export function commandFromScript(dir: string, script: unknown, label: string): TreeseedPackageCommand | null {
	if (typeof script !== 'string' || !script.trim()) return null;
	const trimmed = script.trim();
	if (trimmed.startsWith('scripts/')) {
		return { label, command: 'bash', args: [trimmed], cwd: dir };
	}
	return { label, command: 'bash', args: ['-lc', trimmed], cwd: dir };
}

export function normalizePackageSlug(id: string) {
	const raw = id.startsWith('@treeseed/') ? id.slice('@treeseed/'.length) : id;
	return raw.toLowerCase()
		.replace(/^treeseed-/u, '')
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '') || 'package';
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

export function normalizeTreeseedPackageProjectArchitecture(value: unknown, packageId: string): SeedProjectArchitecture | null {
	const record = stringRecord(value);
	if (Object.keys(record).length === 0) return null;
	const publishTarget = stringRecord(record.contentPublishTarget);
	const packageSlug = normalizePackageSlug(packageId);
	const targetKind = enumValue<SeedContentPublishTargetKind>(publishTarget.kind, SEED_CONTENT_PUBLISH_TARGETS, 'cloudflare_r2');
	return {
		topology: enumValue<SeedProjectTopology>(record.topology, SEED_PROJECT_TOPOLOGIES, 'single_repository_site'),
		rootPath: stringValue(record.rootPath) ?? '.',
		sitePath: stringValue(record.sitePath) ?? 'docs',
		contentPath: stringValue(record.contentPath) ?? 'docs',
		contentRuntimeSource: enumValue<SeedContentRuntimeSource>(record.contentRuntimeSource, SEED_CONTENT_RUNTIME_SOURCES, 'r2_published_manifest'),
		localContentMaterialization: enumValue<SeedLocalContentMaterialization>(record.localContentMaterialization, SEED_LOCAL_CONTENT_MATERIALIZATIONS, 'none'),
		contentPublishTarget: {
			kind: targetKind,
			...(stringValue(publishTarget.bucket) ? { bucket: stringValue(publishTarget.bucket)! } : {}),
			prefix: stringValue(publishTarget.prefix) ?? `packages/${packageSlug}`,
			...(stringValue(publishTarget.manifestPath) ? { manifestPath: stringValue(publishTarget.manifestPath)! } : {}),
		},
	};
}

export function docsSiteReadiness(dir: string, architecture: SeedProjectArchitecture | null) {
	if (!architecture) return null;
	const diagnostic = inspectTreeseedContentStructure({ projectRoot: dir, architecture });
	const readiness = diagnostic.status === 'ready'
		? 'ready'
		: diagnostic.status === 'unsupported_structure'
			? 'unsupported_structure'
			: 'site_not_prepared';
	return {
		status: readiness,
		diagnostic,
	};
}
