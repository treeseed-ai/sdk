import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { headCommit } from './git-workflow.ts';

export interface TreeseedVerificationCacheEntry {
	key: string;
	repoName: string;
	repoPath: string;
	headSha: string;
	command: string;
	status: 'passed' | 'failed';
	createdAt: string;
	durationMs: number;
	logsPath?: string | null;
}

export interface TreeseedVerificationCacheInput {
	workspaceRoot: string;
	repoName: string;
	repoPath: string;
	command: string;
	verifyMode: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function sha256(value: string | Buffer) {
	return createHash('sha256').update(value).digest('hex');
}

function fileHash(path: string) {
	if (!existsSync(path)) return null;
	return sha256(readFileSync(path));
}

function cacheEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	const value = String(env.TREESEED_VERIFY_CACHE ?? '').trim().toLowerCase();
	if (value === '0' || value === 'false' || value === 'off') return false;
	if (env.GITHUB_ACTIONS === 'true') return value === '1' || value === 'true' || value === 'on';
	return true;
}

export function treeseedVerificationCacheKey(input: TreeseedVerificationCacheInput) {
	const headSha = headCommit(input.repoPath);
	const payload = {
		repoPath: resolve(input.repoPath),
		headSha,
		packageJson: fileHash(resolve(input.repoPath, 'package.json')),
		packageLock: fileHash(resolve(input.repoPath, 'package-lock.json')),
		command: input.command,
		nodeMajor: process.versions.node.split('.')[0],
		verifyMode: input.verifyMode,
	};
	return { key: sha256(JSON.stringify(payload)), headSha };
}

function cachePath(input: TreeseedVerificationCacheInput, key: string) {
	return resolve(input.workspaceRoot, '.treeseed', 'cache', 'verification', `${key}.json`);
}

export function readTreeseedVerificationCache(input: TreeseedVerificationCacheInput): TreeseedVerificationCacheEntry | null {
	if (!cacheEnabled(input.env)) return null;
	const { key, headSha } = treeseedVerificationCacheKey(input);
	const path = cachePath(input, key);
	if (!existsSync(path)) return null;
	try {
		const entry = JSON.parse(readFileSync(path, 'utf8')) as TreeseedVerificationCacheEntry;
		if (entry.key !== key || entry.headSha !== headSha || entry.status !== 'passed') return null;
		return entry;
	} catch {
		return null;
	}
}

export function writeTreeseedVerificationCache(input: TreeseedVerificationCacheInput, durationMs: number) {
	if (!cacheEnabled(input.env)) return null;
	const { key, headSha } = treeseedVerificationCacheKey(input);
	const path = cachePath(input, key);
	const entry: TreeseedVerificationCacheEntry = {
		key,
		repoName: input.repoName,
		repoPath: resolve(input.repoPath),
		headSha,
		command: input.command,
		status: 'passed',
		createdAt: new Date().toISOString(),
		durationMs,
		logsPath: null,
	};
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
	return entry;
}
