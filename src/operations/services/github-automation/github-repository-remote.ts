import { runRepositoryGit } from '../operations/git-runner.ts';

export function parseGitHubRepositoryFromRemote(remoteUrl: string | null | undefined) {
	if (!remoteUrl) return null;
	const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u);
	if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
	const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/u);
	return httpsMatch ? `${httpsMatch[1]}/${httpsMatch[2]}` : null;
}

export function resolveGitHubRepositorySlug(tenantRoot: string) {
	const result = runRepositoryGit(['remote', 'get-url', 'origin'], {
		cwd: tenantRoot,
		mode: 'read',
		allowFailure: true,
	});
	const remoteUrl = result.stdout.trim();
	const repository = parseGitHubRepositoryFromRemote(remoteUrl);
	if (!repository) {
		throw new Error(`Unable to determine GitHub repository from origin remote "${remoteUrl}".`);
	}
	return repository;
}

export function maybeResolveGitHubRepositorySlug(tenantRoot: string) {
	try {
		return resolveGitHubRepositorySlug(tenantRoot);
	} catch {
		return null;
	}
}
