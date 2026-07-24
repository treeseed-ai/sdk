import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { headCommit } from '../operations/git-workflow.ts';

export interface VerificationCacheEntry {
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

export interface VerificationCacheInput {
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

export function VerificationCacheKey(input: VerificationCacheInput) {
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

function cachePath(input: VerificationCacheInput, key: string) {
	return resolve(input.workspaceRoot, '.treeseed', 'cache', 'verification', `${key}.json`);
}

export function readVerificationCache(input: VerificationCacheInput): VerificationCacheEntry | null {
	if (!cacheEnabled(input.env)) return null;
	const { key, headSha } = VerificationCacheKey(input);
	const path = cachePath(input, key);
	if (!existsSync(path)) return null;
	try {
		const entry = JSON.parse(readFileSync(path, 'utf8')) as VerificationCacheEntry;
		if (entry.key !== key || entry.headSha !== headSha || entry.status !== 'passed') return null;
		return entry;
	} catch {
		return null;
	}
}

export function writeVerificationCache(input: VerificationCacheInput, durationMs: number) {
	if (!cacheEnabled(input.env)) return null;
	const { key, headSha } = VerificationCacheKey(input);
	const path = cachePath(input, key);
	const entry: VerificationCacheEntry = {
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
