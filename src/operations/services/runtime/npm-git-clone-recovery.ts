import { rmSync } from 'node:fs';
import { basename,dirname,resolve } from 'node:path';

export function staleNpmGitClonePath(detail: string) {
	const match = /destination path '([^']+)' already exists/u.exec(detail);
	if (!match?.[1]) return null;
	const matchedPath = resolve(match[1]);
	const cloneRoot = basename(matchedPath) === '.git' ? dirname(matchedPath) : matchedPath;
	if (!basename(cloneRoot).startsWith('git-clone')) return null;
	if (basename(dirname(cloneRoot)) !== 'tmp' || basename(dirname(dirname(cloneRoot))) !== '_cacache') return null;
	return cloneRoot;
}

export function runWithStaleNpmGitCloneRetry<T>(input: {
	run: () => T;
	failureDetail: (result: T) => string | null;
	onRetry?: (clonePath: string) => void;
}) {
	let result = input.run();
	const detail = input.failureDetail(result);
	const clonePath = detail ? staleNpmGitClonePath(detail) : null;
	if (!clonePath) return { result,retriedPath: null };
	input.onRetry?.(clonePath);
	rmSync(clonePath, { recursive: true,force: true });
	result = input.run();
	return { result,retriedPath: clonePath };
}
