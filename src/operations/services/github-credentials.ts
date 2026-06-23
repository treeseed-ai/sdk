import { TREESEED_GITHUB_TOKEN_ENV, resolveTreeseedGitHubToken } from '../../service-credentials.ts';

export type TreeseedGitHubCredentialResolution = {
	repository: string;
	envName: string;
	configured: boolean;
	fallbackUsed: boolean;
	source: 'repository' | 'fallback' | 'missing';
	token: string | null;
};

function cleanRepositorySlug(repository: string) {
	const raw = String(repository ?? '').trim()
		.replace(/^https?:\/\/github\.com\//iu, '')
		.replace(/^git@github\.com:/iu, '')
		.replace(/^ssh:\/\/git@github\.com\//iu, '')
		.replace(/\.git$/iu, '')
		.replace(/^\/+|\/+$/gu, '');
	const [owner, repo, ...extra] = raw.split('/').filter(Boolean);
	if (!owner || !repo || extra.length > 0) {
		throw new Error(`Invalid GitHub repository "${repository}". Expected owner/name.`);
	}
	return `${owner}/${repo}`;
}

export function githubRepositoryCredentialEnvName(repository: string) {
	const slug = cleanRepositorySlug(repository);
	const suffix = slug
		.toUpperCase()
		.replace(/[^A-Z0-9]+/gu, '_')
		.replace(/^_+|_+$/gu, '')
		.replace(/_+/gu, '_');
	return `TREESEED_GITHUB_TOKEN_${suffix}`;
}

function configuredValue(values: Record<string, string | undefined> | undefined, key: string) {
	const value = values?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function resolveGitHubCredentialForRepository(
	repository: string,
	{
		values,
		env = process.env,
	}: {
		values?: Record<string, string | undefined>;
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	} = {},
): TreeseedGitHubCredentialResolution {
	const normalizedRepository = cleanRepositorySlug(repository);
	const envName = githubRepositoryCredentialEnvName(normalizedRepository);
	const repositoryToken = configuredValue(values, envName) || configuredValue(env, envName);
	if (repositoryToken) {
		return {
			repository: normalizedRepository,
			envName,
			configured: true,
			fallbackUsed: false,
			source: 'repository',
			token: repositoryToken,
		};
	}
	const fallbackToken = resolveTreeseedGitHubToken(values ?? {})
		|| resolveTreeseedGitHubToken(env);
	if (fallbackToken) {
		return {
			repository: normalizedRepository,
			envName,
			configured: true,
			fallbackUsed: true,
			source: 'fallback',
			token: fallbackToken,
		};
	}
	return {
		repository: normalizedRepository,
		envName,
		configured: false,
		fallbackUsed: false,
		source: 'missing',
		token: null,
	};
}
