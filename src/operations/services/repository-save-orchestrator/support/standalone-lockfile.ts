import { copyFileSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { PackageDependencyReference } from '../../packages/package-reference-policy.ts';
import { normalizeGitRemoteForDependency } from '../../packages/package-reference-policy.ts';
import { runCapturedCommand } from '../runtime/with-short-process-temp-env.ts';
import type { RepositorySaveNode,RepositorySaveOptions } from './repo-kind.ts';
import { emitProgress } from './repo-kind.ts';

type LocalGitRepository = { sourcePath: string; remoteUrl: string };

export const STANDALONE_LOCKFILE_RESOLUTION_TIMEOUT_MS = 10 * 60_000;

function localGitResolutionEnv(references: Array<PackageDependencyReference | LocalGitRepository>) {
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

function declaredDependencySpec(packageJson: Record<string, unknown>, packageName: string) {
	for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
		const dependencies = packageJson[field];
		if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
		const spec = (dependencies as Record<string, unknown>)[packageName];
		if (typeof spec === 'string') return spec;
	}
	return null;
}

function validateFinalizedGitReferences(node: RepositorySaveNode, references: PackageDependencyReference[]) {
	const lockfilePath = resolve(node.path, 'package-lock.json');
	if (!existsSync(lockfilePath)) throw new Error('standalone lockfile missing');
	const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8')) as Record<string, unknown>;
	const packages = lockfile.packages;
	if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
		throw new Error('standalone lockfile packages map missing');
	}
	const entries = packages as Record<string, Record<string, unknown>>;
	const rootEntry = entries[''];
	if (!rootEntry) throw new Error('standalone lockfile root package entry missing');
	for (const reference of references) {
		const expectedSpec = reference.manifestSpec ?? reference.spec;
		if (declaredDependencySpec(node.packageJson ?? {}, reference.packageName) !== expectedSpec) continue;
		if (declaredDependencySpec(rootEntry, reference.packageName) !== expectedSpec) {
			throw new Error(`standalone lockfile root entry is stale for ${reference.packageName}`);
		}
		const commit = expectedSpec.slice(expectedSpec.lastIndexOf('#') + 1);
		const dependencyEntries = Object.entries(entries)
			.filter(([key]) => key === `node_modules/${reference.packageName}` || key.endsWith(`/node_modules/${reference.packageName}`))
			.map(([, entry]) => entry);
		if (dependencyEntries.length === 0) {
			throw new Error(`standalone lockfile entry missing for ${reference.packageName}`);
		}
		for (const entry of dependencyEntries) {
			if (typeof entry.resolved !== 'string' || !entry.resolved.endsWith(`#${commit}`)) {
				throw new Error(`standalone lockfile resolved commit is stale for ${reference.packageName}`);
			}
			if (reference.version && entry.version !== reference.version) {
				throw new Error(`standalone lockfile version is stale for ${reference.packageName}`);
			}
			}
		}
	}

export function validateStandaloneGitDependencyLockfile(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'onProgress' | 'deferPushUntilVerified'>,
	references: PackageDependencyReference[] = [],
	repositories: LocalGitRepository[] = [],
) {
	const lockfilePath = resolve(node.path, 'package-lock.json');
	const lockfileExists = existsSync(lockfilePath);
	const previousLockfile = lockfileExists ? readFileSync(lockfilePath, 'utf8') : null;
	if (references.length > 0) {
		validateFinalizedGitReferences(node, references);
		emitProgress(options, node, 'lockfile', 'Validated exact finalized Git references before resolving their complete dependency closure.');
	}
	if (options.deferPushUntilVerified === true) {
		if (!lockfileExists) throw new Error('standalone lockfile missing');
		emitProgress(options, node, 'lockfile', references.length > 0
			? 'Validated the synchronized local dependency closure without recursively preparing unpublished Git dependencies.'
			: 'Skipped dependency-closure resolution because this atomic package has no finalized internal Git dependencies.');
		return true;
	}
	const isolatedRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-lockfile-'));
	const validateArgs = references.length > 0
		? ['install', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund']
		: ['ci', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund'];
	try {
		if (!lockfileExists) throw new Error('standalone lockfile missing');
		copyFileSync(resolve(node.path, 'package.json'), resolve(isolatedRoot, 'package.json'));
		copyFileSync(lockfilePath, resolve(isolatedRoot, 'package-lock.json'));
		runCapturedCommand(node, options, 'lockfile', 'npm', validateArgs, {
			cwd: isolatedRoot,
			env: localGitResolutionEnv([...references, ...repositories]),
			timeoutMs: STANDALONE_LOCKFILE_RESOLUTION_TIMEOUT_MS,
		});
		copyFileSync(resolve(isolatedRoot, 'package-lock.json'), lockfilePath);
	} catch (error) {
		if (previousLockfile !== null) writeFileSync(lockfilePath, previousLockfile, 'utf8');
		throw error;
	} finally {
		rmSync(isolatedRoot, { recursive: true, force: true });
	}
	emitProgress(options, node, 'lockfile', references.length > 0
		? 'Resolved and validated the complete standalone dependency closure from finalized local package commits.'
		: 'Validated the standalone lockfile against the committed package manifest.');
	return true;
}
