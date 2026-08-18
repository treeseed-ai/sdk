import { runRepositoryGit } from '../operations/git-runner.ts';
import { resolveRepositoryIdentity } from '../../../repositories/repository-identity.ts';

export function parseGitHubRepositoryFromRemote(remoteUrl: string | null | undefined) {
	if (!remoteUrl) return null;
	try {
		const identity = resolveRepositoryIdentity(remoteUrl);
		return identity.provider === 'github' ? `${identity.owner}/${identity.repository}` : null;
	} catch {
		return null;
	}
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
