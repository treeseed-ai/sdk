import type { SeedProjectArchitecture, SeedProjectContentPublishTarget } from '../../seeds/types.ts';
import { GITHUB_TOKEN_ENV } from '../../configuration/service-credentials.ts';
import {
	githubRepositoryCredentialEnvName,
	resolveGitHubCredentialForRepository,
} from '../../operations/services/configuration/github-credentials.ts';

export { githubRepositoryCredentialEnvName } from '../../operations/services/configuration/github-credentials.ts';

export type RepositoryImportProvider = 'github';
export type RepositoryImportVisibility = 'public' | 'private';

export interface GitHubRepositoryObservation {
	provider?: RepositoryImportProvider | string;
	owner?: string;
	name?: string;
	repository?: string;
	defaultBranch?: string;
	visibility?: RepositoryImportVisibility | string;
	htmlUrl?: string;
	cloneUrl?: string;
	files?: string[];
	directories?: string[];
	manifests?: Record<string, unknown>;
}

export interface RepositoryImportInput {
	team: string;
	repository: string;
	observation?: GitHubRepositoryObservation;
	rootPath?: string;
	sitePath?: string;
	contentPath?: string | null;
	visibility?: RepositoryImportVisibility | string;
	credentialRef?: string;
	contentPublishTarget?: SeedProjectContentPublishTarget;
	env?: Record<string, string | undefined>;
}

export interface RepositoryImportDiagnostic {
	severity: 'info' | 'warning' | 'error';
	code: string;
	message: string;
	path?: string;
}

export interface RepositoryImportPathCandidates {
	rootPath: string[];
	sitePath: string[];
	contentPath: string[];
	manifests: string[];
}

export interface RepositoryImportPlan {
	ok: boolean;
	provider: RepositoryImportProvider;
	team: string;
	repository: {
		owner: string;
		name: string;
		slug: string;
		defaultBranch: string;
		visibility: RepositoryImportVisibility;
		htmlUrl: string;
		cloneUrl: string;
	};
	credentialRef: string;
	credential: {
		ref: string;
		configured: boolean;
		source: 'repository' | 'fallback' | 'missing' | 'explicit';
		repositoryScopedRef: string;
	};
	architecture: SeedProjectArchitecture;
	candidates: RepositoryImportPathCandidates;
	diagnostics: RepositoryImportDiagnostic[];
	plannedRecords: {
		project: {
			slug: string;
			name: string;
			visibility: RepositoryImportVisibility;
		};
		hubRepository: {
			role: 'software';
			provider: 'github';
			owner: string;
			name: string;
			url: string;
			defaultBranch: string;
			credentialRef: string;
		};
		contentSource: {
			contentRuntimeSource: SeedProjectArchitecture['contentRuntimeSource'];
			contentPath: string | null;
			contentPublishTarget: SeedProjectContentPublishTarget | null;
		};
		treeDxLibrary: {
			libraryId: string;
			contentPath: string | null;
		};
	};
}

const SITE_PATH_CANDIDATES = ['.', 'docs', 'site', 'apps/web'] as const;
const CONTENT_PATH_CANDIDATES = ['src/content', 'docs/src/content', 'docs', 'content'] as const;
const KNOWN_MANIFESTS = ['treeseed.site.yaml', 'treeseed.package.yaml', 'src/manifest.yaml'] as const;

function trim(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

function unique(values: string[]) {
	return [...new Set(values.filter(Boolean))];
}

function normalizeRepoSlug(repository: string) {
	const raw = String(repository ?? '').trim()
		.replace(/^https?:\/\/github\.com\//iu, '')
		.replace(/^git@github\.com:/iu, '')
		.replace(/^ssh:\/\/git@github\.com\//iu, '')
		.replace(/\.git$/iu, '')
		.replace(/^\/+|\/+$/gu, '');
	const [owner, name, ...extra] = raw.split('/').filter(Boolean);
	if (!owner || !name || extra.length > 0) {
		throw new Error(`Invalid GitHub repository "${repository}". Expected owner/name.`);
	}
	return { owner, name, slug: `${owner}/${name}` };
}

function slugifyProject(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		|| 'project';
}

function titleFromRepositoryName(name: string) {
	return name
		.split(/[-_\s]+/gu)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(' ') || name;
}

function normalizePathList(values: unknown) {
	if (!Array.isArray(values)) return [];
	return unique(values.map((entry) => trim(entry).replace(/^\/+|\/+$/gu, '') || '.'));
}

function pathExists(path: string, files: Set<string>, directories: Set<string>) {
	if (path === '.') return true;
	return files.has(path) || directories.has(path) || [...files].some((entry) => entry.startsWith(`${path}/`));
}

function hasFile(path: string, files: Set<string>) {
	return files.has(path);
}

function hasAnyFileUnder(path: string, files: Set<string>, pattern: RegExp) {
	const prefix = path === '.' ? '' : `${path}/`;
	return [...files].some((entry) => entry.startsWith(prefix) && pattern.test(entry.slice(prefix.length)));
}

function assertNoSecretMaterial(value: unknown, path = 'input') {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return;
	const forbiddenKeys = new Set([
		'plaintext',
		'plainText',
		'value',
		'raw',
		'rawSecret',
		'secretValue',
		'unencrypted',
		'token',
		'accessToken',
		'privateKey',
		'sshPrivateKey',
		'passphrase',
		'password',
		'derivedKey',
		'decrypted',
		'decryptedPayload',
		'decryptedSecret',
		'credentialValue',
	]);
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (key === 'env') continue;
		if (forbiddenKeys.has(key)) {
			throw new Error(`Repository import ${path} cannot include plaintext credentials, tokens, or secret material.`);
		}
		if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
			assertNoSecretMaterial(nested, `${path}.${key}`);
		}
	}
}

function selectSitePath(files: Set<string>, directories: Set<string>, override: string, diagnostics: RepositoryImportDiagnostic[]) {
	if (override) return override;
	const candidates = SITE_PATH_CANDIDATES.filter((candidate) => {
		if (candidate === '.') {
			return hasFile('treeseed.site.yaml', files)
				|| hasFile('package.json', files)
				|| hasAnyFileUnder('src/pages', files, /.+/u)
				|| hasAnyFileUnder('src/routes', files, /.+/u)
				|| hasFile('astro.config.ts', files)
				|| hasFile('astro.config.ts', files);
		}
		return pathExists(candidate, files, directories)
			&& (
				hasFile(`${candidate}/treeseed.site.yaml`, files)
				|| hasFile(`${candidate}/package.json`, files)
				|| hasFile(`${candidate}/astro.config.ts`, files)
				|| hasFile(`${candidate}/astro.config.ts`, files)
				|| hasAnyFileUnder(`${candidate}/src/pages`, files, /.+/u)
				|| hasAnyFileUnder(candidate, files, /\.(md|mdx)$/iu)
			);
	});
	if (candidates.includes('docs')) return 'docs';
	if (candidates.length > 0) return candidates[0]!;
	diagnostics.push({
		severity: 'warning',
		code: 'site_path_assumed_root',
		message: 'No obvious site path was observed; import will use sitePath "." without restructuring the repository.',
	});
	return '.';
}

function selectContentPath(files: Set<string>, directories: Set<string>, override: string, sitePath: string, diagnostics: RepositoryImportDiagnostic[]) {
	if (override) return override;
	const candidates = CONTENT_PATH_CANDIDATES.filter((candidate) => {
		if (!pathExists(candidate, files, directories)) return false;
		if (candidate.endsWith('src/content')) return true;
		return hasAnyFileUnder(candidate, files, /\.(md|mdx|json|ya?ml)$/iu);
	});
	if (sitePath === 'docs' && candidates.includes('docs/src/content')) return 'docs/src/content';
	if (candidates.includes('src/content')) return 'src/content';
	if (sitePath === 'docs' && candidates.includes('docs')) return 'docs';
	if (candidates.length > 0) return candidates[0]!;
	diagnostics.push({
		severity: 'info',
		code: 'content_path_not_observed',
		message: 'No local content path was observed; hosted runtime can use TreeDX/R2 content sources until content is materialized.',
	});
	return '';
}

function discoverCandidates(files: Set<string>, directories: Set<string>): RepositoryImportPathCandidates {
	return {
		rootPath: ['.'],
		sitePath: SITE_PATH_CANDIDATES.filter((candidate) => pathExists(candidate, files, directories)),
		contentPath: CONTENT_PATH_CANDIDATES.filter((candidate) => pathExists(candidate, files, directories)),
		manifests: KNOWN_MANIFESTS.filter((manifest) => hasFile(manifest, files)),
	};
}

function normalizeCredentialRef(input: RepositoryImportInput, repositorySlug: string) {
	const explicit = trim(input.credentialRef);
	const repositoryScopedEnvName = githubRepositoryCredentialEnvName(repositorySlug);
	if (explicit) {
		if (!explicit.startsWith('env:TREESEED_GITHUB_TOKEN')) {
			throw new Error('Repository import credentialRef must be an env:TREESEED_GITHUB_TOKEN reference.');
		}
		return {
			credentialRef: explicit,
			credential: {
				ref: explicit,
				configured: Boolean(input.env?.[explicit.slice(4)]),
				source: 'explicit' as const,
				repositoryScopedRef: `env:${repositoryScopedEnvName}`,
			},
		};
	}
	const resolution = resolveGitHubCredentialForRepository(repositorySlug, { env: input.env ?? process.env });
	const envName = resolution.source === 'repository' ? resolution.envName : GITHUB_TOKEN_ENV;
	return {
		credentialRef: `env:${envName}`,
		credential: {
			ref: `env:${envName}`,
			configured: resolution.configured,
			source: resolution.source,
			repositoryScopedRef: `env:${repositoryScopedEnvName}`,
		},
	};
}

export function planRepositoryImport(input: RepositoryImportInput): RepositoryImportPlan {
	assertNoSecretMaterial({
		...input,
		env: undefined,
	});
	assertNoSecretMaterial(input.observation ?? {}, 'observation');
	const team = trim(input.team);
	if (!team) throw new Error('Repository import requires a team slug or id.');
	const repo = normalizeRepoSlug(input.repository);
	const observation = input.observation ?? {};
	const observedRepo = normalizeRepoSlug(trim(observation.repository) || `${trim(observation.owner) || repo.owner}/${trim(observation.name) || repo.name}`);
	const owner = observedRepo.owner;
	const name = observedRepo.name;
	const repositorySlug = `${owner}/${name}`;
	const files = new Set(normalizePathList(observation.files));
	const directories = new Set(normalizePathList(observation.directories));
	for (const manifest of Object.keys(observation.manifests ?? {})) {
		files.add(manifest);
	}
	const diagnostics: RepositoryImportDiagnostic[] = [];
	if (observation.provider && observation.provider !== 'github') {
		throw new Error(`Unsupported repository import provider "${observation.provider}". GitHub is the only v1 import provider.`);
	}
	const candidates = discoverCandidates(files, directories);
	if (candidates.sitePath.length > 1) {
		diagnostics.push({
			severity: 'warning',
			code: 'ambiguous_site_path',
			message: `Multiple site path candidates were observed: ${candidates.sitePath.join(', ')}. Override with --site-path if needed.`,
		});
	}
	const rootPath = trim(input.rootPath) || '.';
	const sitePath = selectSitePath(files, directories, trim(input.sitePath), diagnostics);
	const contentPath = selectContentPath(files, directories, trim(input.contentPath), sitePath, diagnostics);
	const contentPublishTarget = input.contentPublishTarget ?? {
		kind: 'cloudflare_r2' as const,
		manifestPath: `teams/${slugifyProject(team)}/projects/${slugifyProject(name)}/published/common.json`,
	};
	const architecture: SeedProjectArchitecture = {
		topology: 'single_repository_site',
		rootPath,
		sitePath,
		...(contentPath ? { contentPath } : {}),
		contentRuntimeSource: 'r2_published_manifest',
		localContentMaterialization: contentPath ? 'existing_path' : 'none',
		contentPublishTarget,
		requiresLocalContentForCi: false,
		requiresLocalContentForDeploy: false,
	};
	const credential = normalizeCredentialRef(input, repositorySlug);
	if (!credential.credential.configured) {
		diagnostics.push({
			severity: 'warning',
			code: 'github_credential_missing',
			message: `No configured GitHub token was observed for ${credential.credential.repositoryScopedRef} or env:${GITHUB_TOKEN_ENV}. The import plan is safe, but execute may require credentials.`,
		});
	}
	const visibility = trim(input.visibility || observation.visibility) === 'private' ? 'private' : 'public';
	const htmlUrl = trim(observation.htmlUrl) || `https://github.com/${repositorySlug}`;
	const cloneUrl = trim(observation.cloneUrl) || `${htmlUrl}.git`;
	return {
		ok: true,
		provider: 'github',
		team,
		repository: {
			owner,
			name,
			slug: repositorySlug,
			defaultBranch: trim(observation.defaultBranch) || 'main',
			visibility,
			htmlUrl,
			cloneUrl,
		},
		credentialRef: credential.credentialRef,
		credential: credential.credential,
		architecture,
		candidates,
		diagnostics,
		plannedRecords: {
			project: {
				slug: slugifyProject(name),
				name: titleFromRepositoryName(name),
				visibility,
			},
			hubRepository: {
				role: 'software',
				provider: 'github',
				owner,
				name,
				url: htmlUrl,
				defaultBranch: trim(observation.defaultBranch) || 'main',
				credentialRef: credential.credentialRef,
			},
			contentSource: {
				contentRuntimeSource: architecture.contentRuntimeSource,
				contentPath: architecture.contentPath ?? null,
				contentPublishTarget,
			},
			treeDxLibrary: {
				libraryId: `${slugifyProject(team)}/${slugifyProject(name)}`,
				contentPath: architecture.contentPath ?? null,
			},
		},
	};
}
