import { runTreeseedGit } from '../operations/services/git-runner.ts';
import { configuredLiveAcceptanceValue, type LiveAcceptanceEnv } from './live-acceptance-values.ts';

export function parseGitHubRepository(value: string) {
	const raw = value.trim()
		.replace(/^https?:\/\/github\.com\//iu, '')
		.replace(/^git@github\.com:/iu, '')
		.replace(/^ssh:\/\/git@github\.com\//iu, '')
		.replace(/\.git$/iu, '')
		.replace(/^\/+|\/+$/gu, '');
	const [owner, repo, ...extra] = raw.split('/').filter(Boolean);
	if (!owner || !repo || extra.length > 0) throw new Error(`Invalid GitHub repository "${value}". Expected owner/name.`);
	return `${owner}/${repo}`;
}

export function resolveCurrentGitHubRepository(cwd: string, env: LiveAcceptanceEnv) {
	const configured = configuredLiveAcceptanceValue(env, ['TREESEED_REPOSITORY', 'GITHUB_REPOSITORY']);
	if (configured) return parseGitHubRepository(configured);
	const remote = runTreeseedGit(['config', '--get', 'remote.origin.url'], { cwd, mode: 'read' }).stdout.trim();
	return parseGitHubRepository(remote);
}

export async function githubRequest(path: string, token: string, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const response = await fetchImpl(`https://api.github.com${path}`, {
		...init,
		headers: {
			Accept: 'application/vnd.github+json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...(init.headers ?? {}),
		},
	});
	const payload = await response.json().catch(() => ({})) as { message?: string };
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}${payload.message ? `: ${payload.message}` : ''}`);
	return payload;
}
