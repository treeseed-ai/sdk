import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export type TreeseedLocalCleanupMode = 'standard' | 'aggressive';

export type TreeseedLocalCleanupAction = {
	id: string;
	kind: 'directory' | 'docker' | 'npm-cache';
	path?: string;
	command?: string[];
	status: 'removed' | 'skipped' | 'failed';
	beforeBytes?: number;
	afterBytes?: number;
	exitCode?: number | null;
	error?: string;
};

export type TreeseedLocalCleanupReport = {
	ok: boolean;
	mode: TreeseedLocalCleanupMode;
	root: string;
	startedAt: string;
	completedAt: string;
	beforeBytes: number;
	afterBytes: number;
	reclaimedBytes: number;
	actions: TreeseedLocalCleanupAction[];
};

function directoryBytes(path: string): number {
	if (!existsSync(path)) return 0;
	const stat = statSync(path, { throwIfNoEntry: false });
	if (!stat) return 0;
	if (!stat.isDirectory()) return stat.size;
	let total = stat.size;
	for (const entry of readdirSync(path)) total += directoryBytes(join(path, entry));
	return total;
}

function removeDirectory(root: string, relativePath: string): TreeseedLocalCleanupAction {
	const path = join(root, relativePath);
	return removeDirectoryPath(relativePath, path);
}

function removeDirectoryPath(id: string, path: string): TreeseedLocalCleanupAction {
	const beforeBytes = directoryBytes(path);
	if (!existsSync(path)) return { id, kind: 'directory', path, status: 'skipped', beforeBytes: 0, afterBytes: 0 };
	try {
		rmSync(path, { recursive: true, force: true });
		return { id, kind: 'directory', path, status: 'removed', beforeBytes, afterBytes: directoryBytes(path) };
	} catch (error) {
		return { id, kind: 'directory', path, status: 'failed', beforeBytes, afterBytes: directoryBytes(path), error: error instanceof Error ? error.message : String(error) };
	}
}

function workspaceRepositoryRoots(root: string) {
	const packagesRoot = join(root, 'packages');
	if (!existsSync(packagesRoot)) return [];
	return readdirSync(packagesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(packagesRoot, entry.name))
		.filter((path) =>
			existsSync(join(path, '.git'))
			|| existsSync(join(path, 'package.json'))
			|| existsSync(join(path, 'treeseed.package.yaml')));
}

function runCleanupCommand(id: string, kind: 'docker' | 'npm-cache', command: string[], cwd: string): TreeseedLocalCleanupAction {
	const result = spawnSync(command[0]!, command.slice(1), { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 });
	const exitCode = result.status ?? null;
	return {
		id,
		kind,
		command,
		status: exitCode === 0 ? 'removed' : 'failed',
		exitCode,
		...(exitCode === 0 ? {} : { error: (result.stderr || result.stdout || result.error?.message || 'cleanup command failed').trim() }),
	};
}

export function runTreeseedLocalCleanup(input: {
	root: string;
	mode?: TreeseedLocalCleanupMode;
	docker?: boolean;
	npmCache?: boolean;
	npmCacheRoot?: string;
}): TreeseedLocalCleanupReport {
	const root = resolve(input.root);
	const mode = input.mode ?? 'standard';
	const startedAt = new Date().toISOString();
	const npmCacheRoot = resolve(input.npmCacheRoot
		?? process.env.npm_config_cache
		?? process.env.NPM_CONFIG_CACHE
		?? join(homedir(), '.npm'));
	const npmTemporaryDownloads = join(npmCacheRoot, '_cacache', 'tmp');
	const repositoryRoots = [root, ...workspaceRepositoryRoots(root)];
	const beforeBytes = repositoryRoots.reduce((total, repositoryRoot) =>
		total + directoryBytes(join(repositoryRoot, '.treeseed')), 0) + directoryBytes(npmTemporaryDownloads);
	const actions: TreeseedLocalCleanupAction[] = [];
	const directoryTargets = mode === 'aggressive'
		? [
			'.treeseed/tmp',
			'.treeseed/cache',
			'.treeseed/scenes/render',
		]
		: ['.treeseed/tmp', '.treeseed/cache', '.treeseed/scenes/render'];
	for (const repositoryRoot of repositoryRoots) {
		const repositoryId = repositoryRoot === root ? '' : `${repositoryRoot.slice(root.length + 1)}:`;
		for (const target of directoryTargets) {
			actions.push(removeDirectoryPath(`${repositoryId}${target}`, join(repositoryRoot, target)));
		}
	}
	actions.push(removeDirectoryPath('npm-cache-temporary-downloads', npmTemporaryDownloads));
	if (input.docker === true && mode === 'aggressive') {
		actions.push(runCleanupCommand('docker-builder-prune', 'docker', ['docker', 'builder', 'prune', '--all', '--force'], root));
		actions.push(runCleanupCommand('docker-image-prune', 'docker', ['docker', 'image', 'prune', '--all', '--force'], root));
	}
	if (input.npmCache === true) actions.push(runCleanupCommand('npm-cache-clean', 'npm-cache', ['npm', 'cache', 'clean', '--force'], root));
	const afterBytes = repositoryRoots.reduce((total, repositoryRoot) =>
		total + directoryBytes(join(repositoryRoot, '.treeseed')), 0) + directoryBytes(npmTemporaryDownloads);
	const completedAt = new Date().toISOString();
	return { ok: actions.every((entry) => entry.status !== 'failed'), mode, root, startedAt, completedAt, beforeBytes, afterBytes, reclaimedBytes: Math.max(0, beforeBytes - afterBytes), actions };
}
