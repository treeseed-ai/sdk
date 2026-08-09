import { spawnSync } from 'node:child_process';
import { existsSync,lstatSync,readFileSync,readdirSync,rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join,resolve } from 'node:path';

export type LocalCleanupMode = 'standard' | 'aggressive';

export type LocalCleanupAction = {
	id: string;
	kind: 'directory' | 'docker' | 'npm-cache';
	path?: string;
	command?: string[];
	status: 'planned' | 'removed' | 'skipped' | 'blocked' | 'failed';
	beforeBytes?: number;
	afterBytes?: number;
	exitCode?: number | null;
	error?: string;
};

export type LocalCleanupReport = {
	ok: boolean;
	mode: LocalCleanupMode;
	root: string;
	startedAt: string;
	completedAt: string;
	beforeBytes: number;
	afterBytes: number;
	reclaimedBytes: number;
	actions: LocalCleanupAction[];
};

export type ProjectCleanupReport = LocalCleanupReport & {
	scope: 'project';
	executionMode: 'plan' | 'live';
	blockers: string[];
};

function directoryBytes(path: string): number {
	if (!existsSync(path)) return 0;
	const stat = lstatSync(path, { throwIfNoEntry: false });
	if (!stat) return 0;
	if (stat.isSymbolicLink()) return stat.size;
	if (!stat.isDirectory()) return stat.size;
	let total = stat.size;
	try {
		for (const entry of readdirSync(path)) total += directoryBytes(join(path, entry));
	} catch {
		return total;
	}
	return total;
}

function removeDirectory(root: string, relativePath: string): LocalCleanupAction {
	const path = join(root, relativePath);
	return removeDirectoryPath(relativePath, path);
}

function removeDirectoryPath(id: string, path: string): LocalCleanupAction {
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

const PROJECT_STANDARD_TARGETS = [
	'.treeseed/tmp',
	'.treeseed/cache',
	'.treeseed/scenes/runs',
	'.treeseed/scenes/render',
	'.treeseed/scenes/matrix',
	'.treeseed/logs',
	'.treeseed/exports',
	'.treeseed/workplans',
	'.treeseed/guarantees/runs',
	'.treeseed/generated/hosted-artifacts',
	'.treeseed/npm-cache',
	'coverage',
	'.astro',
	'.vite',
];

const PROJECT_ROOT_BUILD_TARGETS = ['dist'];

const PROJECT_AGGRESSIVE_PACKAGE_TARGETS = [
	'node_modules',
	'target',
	'_build',
	'deps',
	'apps/api/_build',
	'apps/api/deps',
	'packages/rust-sdk/target',
	'packages/elixir-sdk/_build',
	'packages/elixir-sdk/deps',
	'tools/treedx_profiler/_build',
	'tools/treedx_profiler/deps',
];

function projectCleanupTargets(root: string, mode: LocalCleanupMode) {
	const repositories = [root, ...workspaceRepositoryRoots(root)];
	const targets = repositories.flatMap((repositoryRoot) => PROJECT_STANDARD_TARGETS.map((relativePath) => ({
		id: repositoryRoot === root ? relativePath : `${repositoryRoot.slice(root.length + 1)}:${relativePath}`,
		path: join(repositoryRoot, relativePath),
	})));
	for (const relativePath of PROJECT_ROOT_BUILD_TARGETS) targets.push({
		id: relativePath,
		path: join(root, relativePath),
	});
	if (mode === 'aggressive') {
		targets.push({ id: '.treeseed/local-treedx', path: join(root, '.treeseed', 'local-treedx') });
		for (const repositoryRoot of repositories.filter((entry) => entry !== root)) {
			for (const relativePath of PROJECT_AGGRESSIVE_PACKAGE_TARGETS) targets.push({
				id: `${repositoryRoot.slice(root.length + 1)}:${relativePath}`,
				path: join(repositoryRoot, relativePath),
			});
		}
		const workflowRuns = join(root, '.treeseed', 'workflow', 'runs');
		if (existsSync(workflowRuns)) for (const entry of readdirSync(workflowRuns, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name.startsWith('archived-')) targets.push({
				id: `.treeseed/workflow/runs/${entry.name}`,
				path: join(workflowRuns, entry.name),
			});
		}
	}
	return targets;
}

function latestTreeMtime(path: string): number {
	const stat = lstatSync(path, { throwIfNoEntry: false });
	if (!stat) return 0;
	let latest = stat.mtimeMs;
	if (!stat.isDirectory() || stat.isSymbolicLink()) return latest;
	try {
		for (const entry of readdirSync(path)) latest = Math.max(latest, latestTreeMtime(join(path, entry)));
	} catch {
		return latest;
	}
	return latest;
}

function activeSceneRuns(root: string, now: number, graceMs: number) {
	const blockers: string[] = [];
	for (const repositoryRoot of [root, ...workspaceRepositoryRoots(root)]) {
		const runsRoot = join(repositoryRoot, '.treeseed', 'scenes', 'runs');
		if (!existsSync(runsRoot)) continue;
		for (const scene of readdirSync(runsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
			const sceneRoot = join(runsRoot, scene.name);
			for (const run of readdirSync(sceneRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
				const runRoot = join(sceneRoot, run.name);
				const runPath = join(runRoot, 'run.json');
				let finished = false;
				try {
					const record = JSON.parse(readFileSync(runPath, 'utf8')) as { finishedAt?: unknown };
					finished = typeof record.finishedAt === 'string' && record.finishedAt.length > 0;
				} catch {
					finished = false;
				}
				if (!finished && now - latestTreeMtime(runRoot) < graceMs) blockers.push(runRoot);
			}
		}
	}
	return blockers;
}

export function planProjectCleanup(input: {
	root: string;
	mode?: LocalCleanupMode;
	now?: Date;
	activeSceneGraceMs?: number;
}): ProjectCleanupReport {
	const root = resolve(input.root);
	const mode = input.mode ?? 'standard';
	const startedAt = (input.now ?? new Date()).toISOString();
	const blockers = activeSceneRuns(root, (input.now ?? new Date()).getTime(), input.activeSceneGraceMs ?? 15 * 60_000);
	const actions = projectCleanupTargets(root, mode).map(({ id, path }): LocalCleanupAction => {
		const beforeBytes = directoryBytes(path);
		return { id, kind: 'directory', path, status: beforeBytes > 0 ? 'planned' : 'skipped', beforeBytes, afterBytes: beforeBytes };
	});
	for (const path of blockers) actions.push({ id: `active-scene:${path.slice(root.length + 1)}`, kind: 'directory', path, status: 'blocked', error: 'Recent unfinished scene run.' });
	const beforeBytes = actions.reduce((total, action) => total + (action.status === 'planned' ? action.beforeBytes ?? 0 : 0), 0);
	return { ok: blockers.length === 0, scope: 'project', executionMode: 'plan', mode, root, startedAt, completedAt: new Date().toISOString(), beforeBytes, afterBytes: beforeBytes, reclaimedBytes: 0, blockers, actions };
}

export function runProjectCleanup(input: {
	root: string;
	mode?: LocalCleanupMode;
	now?: Date;
	activeSceneGraceMs?: number;
}): ProjectCleanupReport {
	const plan = planProjectCleanup(input);
	if (!plan.ok) return { ...plan, executionMode: 'live' };
	const actions = plan.actions.map((action) => action.status === 'planned' && action.path
		? removeDirectoryPath(action.id, action.path)
		: action);
	const afterBytes = actions.reduce((total, action) => total + (action.afterBytes ?? 0), 0);
	return {
		...plan,
		ok: actions.every((action) => action.status !== 'failed'),
		executionMode: 'live',
		completedAt: new Date().toISOString(),
		afterBytes,
		reclaimedBytes: Math.max(0, plan.beforeBytes - afterBytes),
		actions,
	};
}

function runCleanupCommand(id: string, kind: 'docker' | 'npm-cache', command: string[], cwd: string): LocalCleanupAction {
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

export function pruneRecoveryCaches(input: {
	root: string;
	mode?: LocalCleanupMode;
	docker?: boolean;
	npmCache?: boolean;
	npmCacheRoot?: string;
}): LocalCleanupReport {
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
	const actions: LocalCleanupAction[] = [];
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
