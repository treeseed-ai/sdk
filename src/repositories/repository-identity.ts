import { posix } from 'node:path';

export type RepositoryIdentityProvider = 'github' | 'git';

export interface RepositoryIdentity {
	provider: RepositoryIdentityProvider;
	host: string;
	owner: string;
	repository: string;
	canonicalKey: string;
	canonicalRemoteUrl: string;
	acceptedRemoteAliases: string[];
}

function withoutGitSuffix(value: string) {
	return value.replace(/\.git$/iu, '');
}

function normalizePath(value: string) {
	return withoutGitSuffix(value.replace(/^\/+|\/+$/gu, '')).replace(/\/{2,}/gu, '/');
}

function remoteParts(remoteUrl: string) {
	const raw = remoteUrl.trim().replace(/^git\+/u, '');
	const scp = raw.includes('://') ? null : raw.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u);
	if (scp && !/^[A-Za-z]:[\\/]/u.test(raw)) {
		return { host: scp[1]!.toLowerCase(), path: normalizePath(scp[2]!) };
	}
	try {
		const parsed = new URL(raw);
		if (parsed.protocol === 'file:') {
			return { host: 'local', path: normalizePath(parsed.pathname) };
		}
		return { host: parsed.hostname.toLowerCase(), path: normalizePath(parsed.pathname) };
	} catch {
		if (raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) {
			return { host: 'local', path: normalizePath(raw) };
		}
		return null;
	}
}

function resolveRelativeRemote(remoteUrl: string, baseRemoteUrl?: string | null) {
	if (!remoteUrl.startsWith('./') && !remoteUrl.startsWith('../')) return remoteUrl;
	if (!baseRemoteUrl) return remoteUrl;
	const base = remoteParts(baseRemoteUrl);
	if (!base) return remoteUrl;
	const path = posix.normalize(posix.join(`/${base.path}`, remoteUrl)).replace(/^\//u, '');
	return base.host === 'local' ? `/${path}` : `https://${base.host}/${path}`;
}

export function resolveRepositoryIdentity(remoteUrl: string, baseRemoteUrl?: string | null): RepositoryIdentity {
	const requested = remoteUrl.trim();
	if (!requested) throw new Error('Repository remote URL is required.');
	const resolved = resolveRelativeRemote(requested, baseRemoteUrl);
	const parts = remoteParts(resolved);
	if (!parts || !parts.path) throw new Error(`Unsupported repository remote URL "${requested}".`);
	const pathParts = parts.path.split('/').filter(Boolean);
	const repository = pathParts.pop();
	if (!repository) throw new Error(`Repository remote URL has no repository name: "${requested}".`);
	const owner = pathParts.join('/') || (parts.host === 'local' ? 'local' : 'unknown');
	const provider = parts.host === 'github.com' ? 'github' : 'git';
	const normalizedOwner = provider === 'github' ? owner.toLowerCase() : owner;
	const normalizedRepository = provider === 'github' ? repository.toLowerCase() : repository;
	const canonicalKey = `${parts.host}/${normalizedOwner}/${normalizedRepository}`;
	const canonicalRemoteUrl = parts.host === 'local'
		? `file:///${[normalizedOwner, normalizedRepository].filter((entry) => entry !== 'local').join('/')}.git`
		: `https://${parts.host}/${normalizedOwner}/${normalizedRepository}.git`;
	return {
		provider,
		host: parts.host,
		owner: normalizedOwner,
		repository: normalizedRepository,
		canonicalKey,
		canonicalRemoteUrl,
		acceptedRemoteAliases: [...new Set([requested, resolved, canonicalRemoteUrl])],
	};
}

export function repositoryIdentityKey(remoteUrl: string | null | undefined, baseRemoteUrl?: string | null) {
	if (!remoteUrl?.trim()) return null;
	try {
		return resolveRepositoryIdentity(remoteUrl, baseRemoteUrl).canonicalKey;
	} catch {
		return null;
	}
}
