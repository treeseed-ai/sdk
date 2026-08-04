import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PackageAdapter } from '../../package-adapters/package-kind.ts';
import type { RepositoryChangeKind } from './repo-kind.ts';
import { runGit } from './repo-kind.ts';

function normalizedPath(value: string | null | undefined) {
	return String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function nullSeparated(value: string) {
	return value.split('\0').map(normalizedPath).filter(Boolean);
}

export function repositoryChangedPaths(repoDir: string) {
	const tracked = nullSeparated(runGit(['diff', '--name-only', '-z', 'HEAD', '--'], {
		cwd: repoDir,
		capture: true,
	}));
	const untracked = nullSeparated(runGit(['ls-files', '--others', '--exclude-standard', '-z', '--'], {
		cwd: repoDir,
		capture: true,
	}));
	return [...new Set([...tracked, ...untracked])].sort();
}

export function classifyRepositoryChanges(paths: string[], contentPath: string | null): RepositoryChangeKind {
	if (paths.length === 0) return 'clean';
	const root = normalizedPath(contentPath);
	if (!root) return 'code';
	const content = paths.filter((path) => path === root || path.startsWith(`${root}/`)).length;
	if (content === paths.length) return 'content';
	return content > 0 ? 'mixed' : 'code';
}

export function contentPathForRepository(input: {
	adapter: PackageAdapter | null;
	relativePath: string;
	repoDir: string;
}) {
	const architecture = input.adapter?.metadata.projectArchitecture;
	if (architecture && typeof architecture === 'object' && !Array.isArray(architecture)) {
		const record = architecture as Record<string, unknown>;
		const target = record.contentPublishTarget;
		const publishable = record.contentRuntimeSource !== 'none'
			&& target && typeof target === 'object' && !Array.isArray(target);
		const declared = typeof record.contentPath === 'string' ? normalizedPath(record.contentPath) : '';
		if (publishable && declared) return declared;
	}
	// Market's project architecture is seed-owned; its canonical local content root is src/content.
	if (input.relativePath === '.' && existsSync(resolve(input.repoDir, 'src/content'))) return 'src/content';
	return null;
}
