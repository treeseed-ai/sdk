import { copyFileSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { PackageDependencyReference } from '../../packages/package-reference-policy.ts';
import { normalizeGitRemoteForDependency } from '../../packages/package-reference-policy.ts';
import { runCapturedCommand } from '../runtime/with-short-process-temp-env.ts';
import type { RepositorySaveNode,RepositorySaveOptions } from './repo-kind.ts';
import { emitProgress } from './repo-kind.ts';

function localGitResolutionEnv(references: PackageDependencyReference[]) {
	const rewrites = references.flatMap((reference) => {
		if (!reference.sourcePath || !reference.remoteUrl) return [];
		const target = `file://${reference.sourcePath}`;
		const ssh = normalizeGitRemoteForDependency(reference.remoteUrl, 'ssh');
		const https = normalizeGitRemoteForDependency(reference.remoteUrl, 'https');
		return [...new Set([reference.remoteUrl, ssh?.replace(/^git\+ssh:/u, 'ssh:'), https?.replace(/^git\+https:/u, 'https:')])]
			.filter((source): source is string => Boolean(source))
			.map((source) => ({ key: `url.${target}.insteadOf`, value: source }));
	});
	const entries = [{ key: 'protocol.file.allow', value: 'always' }, ...rewrites];
	const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(entries.length) };
	entries.forEach((entry, index) => {
		env[`GIT_CONFIG_KEY_${index}`] = entry.key;
		env[`GIT_CONFIG_VALUE_${index}`] = entry.value;
	});
	return env;
}

function regenerateLockfile(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	isolatedRoot: string,
	references: PackageDependencyReference[],
) {
	copyFileSync(resolve(node.path, 'package.json'), resolve(isolatedRoot, 'package.json'));
	runCapturedCommand(node, options, 'lockfile', 'npm', [
		'install', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund',
	], {
		cwd: isolatedRoot,
		env: localGitResolutionEnv(references),
		timeoutMs: 15 * 60_000,
	});
}

export function validateStandaloneGitDependencyLockfile(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	references: PackageDependencyReference[] = [],
) {
	const lockfilePath = resolve(node.path, 'package-lock.json');
	const lockfileExists = existsSync(lockfilePath);
	const previousLockfile = lockfileExists ? readFileSync(lockfilePath, 'utf8') : null;
	const isolatedRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-lockfile-'));
	const validateArgs = ['ci', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund'];
	try {
		if (references.length > 0) {
			regenerateLockfile(node, options, isolatedRoot, references);
		} else {
			if (!lockfileExists) throw new Error('standalone lockfile missing');
			copyFileSync(resolve(node.path, 'package.json'), resolve(isolatedRoot, 'package.json'));
			copyFileSync(lockfilePath, resolve(isolatedRoot, 'package-lock.json'));
		}
		runCapturedCommand(node, options, 'lockfile', 'npm', validateArgs, {
			cwd: isolatedRoot,
			env: localGitResolutionEnv(references),
			timeoutMs: 5 * 60_000,
		});
		copyFileSync(resolve(isolatedRoot, 'package-lock.json'), lockfilePath);
	} catch (error) {
		if (previousLockfile !== null) writeFileSync(lockfilePath, previousLockfile, 'utf8');
		throw error;
	} finally {
		rmSync(isolatedRoot, { recursive: true, force: true });
	}
	emitProgress(options, node, 'lockfile', 'Validated the standalone lockfile against the committed package manifest.');
	return true;
}
