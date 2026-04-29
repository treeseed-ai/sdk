import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { getGitHubAutomationMode } from './github-automation.ts';
import {
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
	type GitRemoteWriteMode,
} from './git-remote-policy.ts';
import {
	generateRepositoryCommitMessage,
	type CommitMessageContext,
	type CommitMessageProvider,
	type CommitMessageProviderMode,
} from './commit-message-provider.ts';
import {
	createDevTagMessage,
	createPackageDependencyReference,
	type DevDependencyReferenceMode,
	type GitDependencyProtocol,
	type PackageDependencyReference,
	updateInternalDependencySpecs,
} from './package-reference-policy.ts';
import {
	PRODUCTION_BRANCH,
	branchExists,
	checkoutBranch,
	headCommit,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
} from './git-workflow.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	repoRoot,
} from './workspace-save.ts';
import {
	hasCompleteTreeseedPackageCheckout,
	run,
	sortWorkspacePackages,
	workspacePackages,
} from './workspace-tools.ts';
import { collectDeploymentLockfileWorkspaceIssues } from './workspace-dependency-mode.ts';

export type RepoKind = 'package' | 'project';
export type RepoBranchMode = 'package-release-main' | 'package-dev-save' | 'project-save';
export type SaveVerifyMode = 'action-first' | 'local-only' | 'skip';
export type SaveCommitMessageMode = CommitMessageProviderMode;
export type SaveDevVersionStrategy = 'prerelease';
export type ReleaseBumpLevel = 'major' | 'minor' | 'patch';

export type RepositorySaveNode = {
	id: string;
	name: string;
	path: string;
	relativePath: string;
	kind: RepoKind;
	branch: string | null;
	branchMode: RepoBranchMode;
	packageJsonPath: string | null;
	packageJson: Record<string, unknown> | null;
	scripts: Record<string, string>;
	remoteUrl: string | null;
	dependencies: string[];
	dependents: string[];
	submoduleDependencies: string[];
	plannedVersion: string | null;
	plannedTag: string | null;
	plannedDependencySpec: string | null;
};

export type RepositorySaveReport = {
	name: string;
	path: string;
	branch: string | null;
	dirty: boolean;
	created: boolean;
	resumed: boolean;
	merged: boolean;
	verified: boolean;
	committed: boolean;
	pushed: boolean;
	deletedLocal: boolean;
	deletedRemote: boolean;
	tagName: string | null;
	commitSha: string | null;
	skippedReason: string | null;
	publishWait: Record<string, unknown> | null;
	version: string | null;
	dependencySpec: string | null;
	devTagMetadata: string | null;
	replacedDevTags: string[];
	branchMode: RepoBranchMode;
	verification: RepositoryVerificationResult | null;
	install: RepositoryInstallResult | null;
	lockfileValidation: RepositoryLockfileValidationResult | null;
	commitMessage: string | null;
	commitMessageProvider: 'cloudflare-workers-ai' | 'fallback' | null;
	commitMessageFallbackUsed: boolean;
	commitMessageError: string | null;
};

export type RepositoryVerificationResult = {
	mode: SaveVerifyMode;
	status: 'passed' | 'failed' | 'skipped';
	primary: 'verify:action' | 'verify:local' | null;
	fallbackUsed: boolean;
	error: string | null;
};

export type RepositoryInstallResult = {
	status: 'completed' | 'skipped';
	attempts: number;
	reason: string | null;
};

export type RepositoryLockfileValidationResult = {
	status: 'passed' | 'failed' | 'skipped';
	command: string | null;
	issues: string[];
	error: string | null;
};

export type RepositoryCommitMessageContext = CommitMessageContext;
export type RepositoryCommitMessageProvider = CommitMessageProvider;

export type RepositorySaveResult = {
	mode: 'root-only' | 'recursive-workspace';
	branch: string;
	scope: 'local' | 'staging' | 'prod';
	repos: RepositorySaveReport[];
	rootRepo: RepositorySaveReport;
	waves: string[][];
	plannedVersions: Record<string, string>;
};

export type RepositorySavePlanRepo = {
	id: string;
	name: string;
	path: string;
	relativePath: string;
	kind: RepoKind;
	currentBranch: string | null;
	targetBranch: string;
	branchMode: RepoBranchMode;
	dirty: boolean;
	dependencies: string[];
	dependents: string[];
	submoduleDependencies: string[];
	currentVersion: string | null;
	plannedVersion: string | null;
	plannedTag: string | null;
	plannedDependencySpec: string | null;
	remoteUrl: string | null;
	commands: string[];
	notes: string[];
};

export type RepositorySavePlanWave = {
	index: number;
	parallel: boolean;
	repos: string[];
	commands: Array<{
		repo: string;
		commands: string[];
	}>;
};

export type RepositorySavePlan = {
	mode: 'root-only' | 'recursive-workspace';
	branch: string;
	scope: 'local' | 'staging' | 'prod';
	devDependencyReferenceMode: DevDependencyReferenceMode;
	gitDependencyProtocol: GitDependencyProtocol;
	verifyMode: SaveVerifyMode;
	commitMessageMode: SaveCommitMessageMode;
	repos: RepositorySavePlanRepo[];
	rootRepo: RepositorySavePlanRepo;
	waves: RepositorySavePlanWave[];
	plannedVersions: Record<string, string>;
	plannedSteps: Array<{ id: string; description: string }>;
};

export type RepositorySaveOptions = {
	root: string;
	gitRoot: string;
	branch: string;
	message?: string;
	bump?: ReleaseBumpLevel;
	devVersionStrategy?: SaveDevVersionStrategy;
	devDependencyReferenceMode?: DevDependencyReferenceMode;
	gitDependencyProtocol?: GitDependencyProtocol;
	gitRemoteWriteMode?: GitRemoteWriteMode;
	verifyMode?: SaveVerifyMode;
	commitMessageMode?: SaveCommitMessageMode;
	commitMessageProvider?: RepositoryCommitMessageProvider;
	workflowRunId?: string | null;
	includeRoot?: boolean;
	stablePackageRelease?: boolean;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
};

type SaveState = {
	finalizedVersions: Map<string, string>;
	finalizedReferences: Map<string, PackageDependencyReference>;
	finalizedCommits: Map<string, string>;
	reports: Map<string, RepositorySaveReport>;
	remoteAccessChecked: Set<string>;
};

class RepositorySaveError extends Error {
	exitCode?: number;
	details?: Record<string, unknown>;

	constructor(message: string, options: { exitCode?: number; details?: Record<string, unknown> } = {}) {
		super(message);
		this.name = 'RepositorySaveError';
		this.exitCode = options.exitCode;
		this.details = options.details;
	}
}

function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function writeJson(filePath: string, value: Record<string, unknown>) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function progressPrefix(node: Pick<RepositorySaveNode, 'name'>, phase: string) {
	return `[${node.name}][${phase}]`;
}

function emitProgress(options: Pick<RepositorySaveOptions, 'onProgress'>, node: Pick<RepositorySaveNode, 'name'>, phase: string, message: string, stream: 'stdout' | 'stderr' = 'stdout') {
	const lines = String(message ?? '').split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
	for (const line of lines) {
		options.onProgress?.(`${progressPrefix(node, phase)} ${line}`, stream);
	}
}

function prefixedOutput(node: Pick<RepositorySaveNode, 'name'>, phase: string, output: string) {
	return String(output ?? '')
		.split(/\r?\n/u)
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => `${progressPrefix(node, phase)} ${line}`)
		.join('\n');
}

function runCapturedCommand(
	node: Pick<RepositorySaveNode, 'name' | 'path'>,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	phase: string,
	command: string,
	args: string[],
	commandOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
) {
	emitProgress(options, node, phase, `$ ${command} ${args.join(' ')}`);
	const result = spawnSync(command, args, {
		cwd: commandOptions.cwd ?? node.path,
		env: { ...process.env, ...(commandOptions.env ?? {}) },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: commandOptions.timeoutMs,
	});
	const stdout = result.stdout?.trim() ?? '';
	const stderr = result.stderr?.trim() ?? '';
	if (stdout) emitProgress(options, node, phase, stdout);
	if (stderr) emitProgress(options, node, phase, stderr, 'stderr');
	if (result.status !== 0) {
		const message =
			(result.error?.message ? `${result.error.message}\n` : '')
			+ (
				prefixedOutput(node, phase, stderr)
				|| prefixedOutput(node, phase, stdout)
				|| `${progressPrefix(node, phase)} ${command} ${args.join(' ')} failed`
			);
		throw new RepositorySaveError(message, {
			details: {
				failingRepo: node.name,
				phase,
				command: `${command} ${args.join(' ')}`,
			},
		});
	}
	return stdout;
}

function runQuietCommand(
	node: Pick<RepositorySaveNode, 'name' | 'path'>,
	phase: string,
	command: string,
	args: string[],
	commandOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
) {
	const result = spawnSync(command, args, {
		cwd: commandOptions.cwd ?? node.path,
		env: { ...process.env, ...(commandOptions.env ?? {}) },
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: commandOptions.timeoutMs,
	});
	const stdout = result.stdout?.trim() ?? '';
	const stderr = result.stderr?.trim() ?? '';
	if (result.status !== 0) {
		throw new RepositorySaveError(
			[
				`${progressPrefix(node, phase)} ${command} ${args.join(' ')} failed`,
				stderr || stdout,
			].filter(Boolean).join('\n'),
			{
				details: {
					failingRepo: node.name,
					phase,
					command: `${command} ${args.join(' ')}`,
				},
			},
		);
	}
	return stdout;
}

async function runStreamingCommand(
	node: Pick<RepositorySaveNode, 'name' | 'path'>,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	phase: string,
	command: string,
	args: string[],
	commandOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
) {
	emitProgress(options, node, phase, `$ ${command} ${args.join(' ')}`);
	return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: commandOptions.cwd ?? node.path,
			env: { ...process.env, ...(commandOptions.env ?? {}) },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let stdoutRemainder = '';
		let stderrRemainder = '';
		let settled = false;
		const flush = (chunk: string, stream: 'stdout' | 'stderr') => {
			const combined = stream === 'stdout' ? stdoutRemainder + chunk : stderrRemainder + chunk;
			const parts = combined.split(/\r?\n/u);
			const complete = parts.slice(0, -1);
			if (stream === 'stdout') stdoutRemainder = parts.at(-1) ?? '';
			else stderrRemainder = parts.at(-1) ?? '';
			for (const line of complete) {
				emitProgress(options, node, phase, line, stream);
			}
		};
		const timeout = commandOptions.timeoutMs
			? setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill('SIGTERM');
				reject(new Error(`${progressPrefix(node, phase)} ${command} ${args.join(' ')} timed out after ${commandOptions.timeoutMs}ms`));
			}, commandOptions.timeoutMs)
			: null;
		child.stdout?.on('data', (chunk: Buffer) => {
			const text = chunk.toString();
			stdout += text;
			flush(text, 'stdout');
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			flush(text, 'stderr');
		});
		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			reject(error);
		});
		child.on('close', (code) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (stdoutRemainder) emitProgress(options, node, phase, stdoutRemainder);
			if (stderrRemainder) emitProgress(options, node, phase, stderrRemainder, 'stderr');
			if (code === 0) {
				resolvePromise({ stdout, stderr });
				return;
			}
			reject(new RepositorySaveError(
				prefixedOutput(node, phase, stderr)
				|| prefixedOutput(node, phase, stdout)
				|| `${progressPrefix(node, phase)} ${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`,
				{
					details: {
						failingRepo: node.name,
						phase,
						command: `${command} ${args.join(' ')}`,
					},
				},
			));
		});
	});
}

function packageScripts(packageJson: Record<string, unknown> | null) {
	const scripts = packageJson?.scripts;
	return scripts && typeof scripts === 'object' && !Array.isArray(scripts)
		? Object.fromEntries(Object.entries(scripts).map(([key, value]) => [key, String(value)]))
		: {};
}

function classifyRepoKind(packageJson: Record<string, unknown> | null): RepoKind {
	if (typeof packageJson?.name !== 'string' || typeof packageJson?.version !== 'string') {
		return 'project';
	}
	if (packageJson.private === true) {
		return 'project';
	}
	const scripts = packageScripts(packageJson);
	const publishConfig = packageJson.publishConfig;
	return typeof scripts['release:publish'] === 'string'
		|| (publishConfig !== null && typeof publishConfig === 'object' && !Array.isArray(publishConfig))
		? 'package'
		: 'project';
}

function dependencyFields(packageJson: Record<string, unknown> | null) {
	if (!packageJson) return [];
	return ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
		.filter((field) => packageJson[field] && typeof packageJson[field] === 'object' && !Array.isArray(packageJson[field]));
}

function repoIdForPath(root: string, repoDir: string) {
	return relative(root, repoDir).replaceAll('\\', '/') || '.';
}

function isGitRepo(repoDir: string) {
	try {
		run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoDir, capture: true });
		return true;
	} catch {
		return false;
	}
}

function originRemoteUrlSafe(repoDir: string) {
	try {
		return originRemoteUrl(repoDir);
	} catch {
		return null;
	}
}

function ensureWritableRemote(node: RepositorySaveNode, options: RepositorySaveOptions) {
	if (!node.remoteUrl || (options.gitRemoteWriteMode ?? 'ssh-pushurl') === 'off') return;
	const result = ensureSshPushUrlForOrigin(node.path, node.remoteUrl, options.gitRemoteWriteMode ?? 'ssh-pushurl');
	if (result.changed && result.pushUrl) {
		emitProgress(options, node, 'remote', `Configured origin push URL ${result.pushUrl}; keeping ${node.remoteUrl} for reads.`);
	}
}

function repoDisplayName(repoDir: string, packageJson: Record<string, unknown> | null) {
	return typeof packageJson?.name === 'string' && packageJson.name.length > 0
		? packageJson.name
		: basename(repoDir);
}

function parseGitmodules(root: string) {
	const gitmodulesPath = resolve(root, '.gitmodules');
	if (!existsSync(gitmodulesPath)) {
		return [] as string[];
	}
	const source = readFileSync(gitmodulesPath, 'utf8');
	const paths: string[] = [];
	for (const match of source.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gmu)) {
		paths.push(match[1].replaceAll('\\', '/'));
	}
	return paths;
}

function slugBranch(branch: string) {
	return branch
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'dev';
}

function timestampLabel(date = new Date()) {
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/u, 'Z');
}

export function nextDevVersion(version: string, branch: string, date = new Date()) {
	return `${incrementVersion(version, 'patch')}-dev.${slugBranch(branch)}.${timestampLabel(date)}`;
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isStableSemverVersion(version: string) {
	return /^\d+\.\d+\.\d+$/u.test(version);
}

function isDevVersionForBranch(version: string, branch: string) {
	const branchSlug = escapeRegExp(slugBranch(branch));
	return new RegExp(`^\\d+\\.\\d+\\.\\d+-dev\\.${branchSlug}\\.\\d{8}T\\d{6}Z$`, 'u').test(version);
}

function packageVersionAtHead(node: RepositorySaveNode) {
	if (!node.packageJsonPath) return null;
	try {
		const source = run('git', ['show', 'HEAD:package.json'], { cwd: node.path, capture: true });
		const packageJson = JSON.parse(source) as Record<string, unknown>;
		return typeof packageJson.version === 'string' ? packageJson.version : null;
	} catch {
		return null;
	}
}

function packageVersionEligibleForBranch(node: RepositorySaveNode, version: string, options: RepositorySaveOptions) {
	return node.branchMode === 'package-release-main'
		? isStableSemverVersion(version)
		: isDevVersionForBranch(version, node.branch || options.branch);
}

function selectPackageVersion(node: RepositorySaveNode, options: RepositorySaveOptions) {
	const current = String(node.packageJson?.version ?? '0.0.0');
	if (node.branchMode === 'package-dev-save' && isDevVersionForBranch(current, node.branch || options.branch) && !tagExists(node.path, current)) {
		return { version: current, reused: true };
	}
	if (node.branchMode === 'package-release-main') {
		const headVersion = packageVersionAtHead(node);
		if (headVersion && current === incrementVersion(headVersion, options.bump ?? 'patch') && !tagExists(node.path, current)) {
			return { version: current, reused: true };
		}
	}
	return { version: planPackageVersion(node, options), reused: false };
}

function createReport(node: RepositorySaveNode): RepositorySaveReport {
	return {
		name: node.name,
		path: node.path,
		branch: node.branch,
		dirty: hasMeaningfulChanges(node.path),
		created: false,
		resumed: false,
		merged: false,
		verified: false,
		committed: false,
		pushed: false,
		deletedLocal: false,
		deletedRemote: false,
		tagName: null,
		commitSha: node.branch ? headCommit(node.path) : null,
		skippedReason: null,
		publishWait: null,
		version: typeof node.packageJson?.version === 'string' ? node.packageJson.version : null,
		dependencySpec: node.plannedDependencySpec,
		devTagMetadata: null,
		replacedDevTags: [],
		branchMode: node.branchMode,
		verification: null,
		install: null,
		lockfileValidation: null,
		commitMessage: null,
		commitMessageProvider: null,
		commitMessageFallbackUsed: false,
		commitMessageError: null,
	};
}

export function discoverRepositorySaveNodes(
	root: string,
	gitRoot = repoRoot(root),
	branch = currentBranch(gitRoot),
	options: { stablePackageRelease?: boolean } = {},
): RepositorySaveNode[] {
	const repoDirs = new Map<string, string>();
	repoDirs.set('.', gitRoot);

	if (hasCompleteTreeseedPackageCheckout(root)) {
		for (const pkg of workspacePackages(root)) {
			if (isGitRepo(pkg.dir)) {
				repoDirs.set(pkg.relativeDir, pkg.dir);
			}
		}
	}

	for (const submodulePath of parseGitmodules(root)) {
		const dir = resolve(root, submodulePath);
		if (existsSync(dir) && isGitRepo(dir)) {
			repoDirs.set(submodulePath, dir);
		}
	}

	const nodes = [...repoDirs.entries()].map(([relativePath, repoDir]) => {
		const packageJsonPath = resolve(repoDir, 'package.json');
		const packageJson = existsSync(packageJsonPath) ? readJson(packageJsonPath) : null;
		const kind = classifyRepoKind(packageJson);
		const repoBranch = relativePath === '.'
			? (currentBranch(repoDir) || branch || null)
			: (branch || currentBranch(repoDir) || null);
		const branchMode: RepoBranchMode = kind === 'project'
			? 'project-save'
			: options.stablePackageRelease === true && repoBranch === PRODUCTION_BRANCH
				? 'package-release-main'
				: 'package-dev-save';
		return {
			id: relativePath,
			name: repoDisplayName(repoDir, packageJson),
			path: repoDir,
			relativePath,
			kind,
			branch: repoBranch,
			branchMode,
			packageJsonPath: packageJson ? packageJsonPath : null,
			packageJson,
			scripts: packageScripts(packageJson),
			remoteUrl: originRemoteUrlSafe(repoDir),
			dependencies: [],
			dependents: [],
			submoduleDependencies: [],
			plannedVersion: null,
			plannedTag: null,
			plannedDependencySpec: null,
		} satisfies RepositorySaveNode;
	});

	return deriveRepositoryGraph(root, nodes);
}

function deriveRepositoryGraph(root: string, nodes: RepositorySaveNode[]) {
	const byPackageName = new Map(nodes
		.filter((node) => node.kind === 'package')
		.map((node) => [String(node.packageJson?.name), node]));
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const dependencies = new Map(nodes.map((node) => [node.id, new Set<string>()]));
	const dependents = new Map(nodes.map((node) => [node.id, new Set<string>()]));

	for (const node of nodes) {
		for (const field of dependencyFields(node.packageJson)) {
			const values = node.packageJson?.[field] as Record<string, unknown>;
			for (const depName of Object.keys(values)) {
				const dependency = byPackageName.get(depName);
				if (!dependency || dependency.id === node.id) continue;
				dependencies.get(node.id)?.add(dependency.id);
				dependents.get(dependency.id)?.add(node.id);
			}
		}

		for (const submodulePath of parseGitmodules(node.path)) {
			const absolute = resolve(node.path, submodulePath);
			const relativeToRoot = repoIdForPath(root, absolute);
			const dependency = byId.get(relativeToRoot);
			if (!dependency || dependency.id === node.id) continue;
			dependencies.get(node.id)?.add(dependency.id);
			dependents.get(dependency.id)?.add(node.id);
		}
	}

	return nodes.map((node) => ({
		...node,
		dependencies: [...(dependencies.get(node.id) ?? [])].sort(),
		dependents: [...(dependents.get(node.id) ?? [])].sort(),
		submoduleDependencies: [...(dependencies.get(node.id) ?? [])]
			.filter((id) => node.id === '.' || id.startsWith(`${node.id}/`))
			.sort(),
	}));
}

export function repositorySaveWaves(nodes: RepositorySaveNode[]) {
	const nodeIds = new Set(nodes.map((node) => node.id));
	const dependencies = new Map(nodes.map((node) => [node.id, new Set(node.dependencies.filter((id) => nodeIds.has(id)))]));
	const dependents = new Map(nodes.map((node) => [node.id, new Set(node.dependents.filter((id) => nodeIds.has(id)))]));
	const ready = [...nodes]
		.filter((node) => (dependencies.get(node.id)?.size ?? 0) === 0)
		.sort(compareNodes);
	const waves: RepositorySaveNode[][] = [];
	const processed = new Set<string>();

	while (ready.length > 0) {
		const wave = ready.splice(0).filter((node) => !processed.has(node.id));
		if (wave.length === 0) continue;
		waves.push(wave);
		for (const node of wave) {
			processed.add(node.id);
			for (const dependentId of dependents.get(node.id) ?? []) {
				const remaining = dependencies.get(dependentId);
				remaining?.delete(node.id);
				if (remaining && remaining.size === 0 && !processed.has(dependentId)) {
					const dependent = nodes.find((candidate) => candidate.id === dependentId);
					if (dependent) ready.push(dependent);
				}
			}
		}
		ready.sort(compareNodes);
	}

	if (processed.size !== nodes.length) {
		const unresolved = nodes
			.filter((node) => !processed.has(node.id))
			.map((node) => `${node.name} depends on ${(dependencies.get(node.id) ? [...dependencies.get(node.id)!] : []).join(', ')}`);
		throw new RepositorySaveError(`Repository dependency cycle detected:\n${unresolved.join('\n')}`, {
			details: { unresolved },
		});
	}

	return waves;
}

function compareNodes(left: RepositorySaveNode, right: RepositorySaveNode) {
	if (left.id === '.') return 1;
	if (right.id === '.') return -1;
	const sorted = sortWorkspacePackages([
		{ name: left.name, relativeDir: left.relativePath, dir: left.path, packageJson: left.packageJson ?? {} },
		{ name: right.name, relativeDir: right.relativePath, dir: right.path, packageJson: right.packageJson ?? {} },
	]);
	return sorted[0]?.name === left.name ? -1 : 1;
}

function runLimited<T>(items: T[], limit: number, action: (item: T) => Promise<void>) {
	let index = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (index < items.length) {
			const current = items[index++];
			await action(current);
		}
	});
	return Promise.all(workers);
}

function remoteBranchExistsSafe(repoDir: string, branch: string) {
	try {
		run('git', ['rev-parse', '--verify', `refs/remotes/origin/${branch}`], { cwd: repoDir, capture: true });
		return true;
	} catch {
		// Fall through to live remote discovery below.
	}
	try {
		return remoteBranchExists(repoDir, branch);
	} catch {
		return false;
	}
}

function checkoutCommandFor(repoDir: string, branch: string) {
	if (currentBranch(repoDir) === branch) return `git checkout ${branch} # already current`;
	if (branchExists(repoDir, branch)) return `git checkout ${branch}`;
	if (remoteBranchExistsSafe(repoDir, branch)) return `git checkout -b ${branch} origin/${branch}`;
	return `git checkout -b ${branch}`;
}

function checkoutOrCreateBranch(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string) {
	if (currentBranch(node.path) === branch) {
		emitProgress(options, node, 'branch', `Already on ${branch}.`);
		return;
	}
	if (branchExists(node.path, branch)) {
		runCapturedCommand(node, options, 'branch', 'git', ['checkout', branch]);
		return;
	}
	if (remoteBranchExistsSafe(node.path, branch)) {
		runCapturedCommand(node, options, 'branch', 'git', ['checkout', '-b', branch, `origin/${branch}`]);
		return;
	}
	runCapturedCommand(node, options, 'branch', 'git', ['checkout', '-b', branch]);
}

async function commitMessageFor(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	context: Pick<RepositoryCommitMessageContext, 'changedFiles' | 'diff' | 'plannedVersion' | 'plannedTag'>,
) {
	return generateRepositoryCommitMessage({
		repoName: node.name,
		repoPath: node.path,
		branch: node.branch || options.branch,
		kind: node.kind,
		branchMode: node.branchMode,
		userMessage: options.message?.trim() || undefined,
		...context,
	}, {
		mode: options.commitMessageMode ?? 'auto',
		provider: options.commitMessageProvider,
	});
}

function gitDiffSummary(repoDir: string) {
	const changedFiles = run('git', ['status', '--porcelain'], { cwd: repoDir, capture: true });
	const diff = run('git', ['diff', '--cached'], { cwd: repoDir, capture: true });
	return { changedFiles, diff };
}

function updateDependencyReferences(node: RepositorySaveNode, finalizedReferences: Map<string, PackageDependencyReference>) {
	if (!node.packageJson || !node.packageJsonPath) return [];
	const changed = updateInternalDependencySpecs(node.packageJson, finalizedReferences);
	if (changed.length > 0) {
		writeJson(node.packageJsonPath, node.packageJson);
	}
	return changed;
}

function planPackageVersion(node: RepositorySaveNode, options: RepositorySaveOptions) {
	if (!node.packageJson || !node.packageJsonPath) return null;
	const current = String(node.packageJson.version ?? '0.0.0');
	return node.branchMode === 'package-release-main'
		? incrementVersion(current, options.bump ?? 'patch')
		: nextDevVersion(current, options.branch);
}

function applyPackageVersion(node: RepositorySaveNode, version: string) {
	if (!node.packageJson || !node.packageJsonPath) return false;
	if (node.packageJson.version === version) return false;
	node.packageJson.version = version;
	writeJson(node.packageJsonPath, node.packageJson);
	return true;
}

function shouldSkipNetworkInstall() {
	return getGitHubAutomationMode() === 'stub' || process.env.TREESEED_SAVE_NPM_INSTALL_MODE === 'skip';
}

function shouldSkipGitDependencySmoke() {
	return shouldSkipNetworkInstall() || process.env.TREESEED_GIT_DEPENDENCY_SMOKE === 'skip';
}

function hasNpmLockfile(repoDir: string) {
	return existsSync(resolve(repoDir, 'package-lock.json')) || existsSync(resolve(repoDir, 'npm-shrinkwrap.json'));
}

async function runGitDependencySmoke(node: RepositorySaveNode, options: RepositorySaveOptions, reference: PackageDependencyReference) {
	if (reference.mode !== 'dev-git-tag' || shouldSkipGitDependencySmoke()) return;
	const installSpec = reference.installSpec ?? reference.spec;
	const tempRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-git-dep-smoke-'));
	const npmCacheRoot = resolve(tempRoot, '.npm-cache');
	try {
		emitProgress(options, node, 'smoke', `Installing ${installSpec} in a temporary project.`);
		writeFileSync(resolve(tempRoot, 'package.json'), JSON.stringify({
			name: 'treeseed-git-dependency-smoke',
			version: '0.0.0',
			private: true,
			type: 'module',
			dependencies: {
				[reference.packageName]: installSpec,
			},
		}, null, 2), 'utf8');
		try {
			await runStreamingCommand(node, options, 'smoke', 'npm', ['install', '--cache', npmCacheRoot], { cwd: tempRoot });
		} catch (error) {
			throw new RepositorySaveError([
				`Git dependency smoke install failed for ${reference.packageName}.`,
				`Spec: ${installSpec}`,
				error instanceof Error ? error.message : String(error),
			].join('\n'));
		}
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

async function runNpmInstallWithRetry(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'root' | 'onProgress'>,
	gitDependencyRefreshSpecs: string[] = [],
): Promise<RepositoryInstallResult> {
	if (shouldSkipNetworkInstall()) {
		emitProgress(options, node, 'install', 'Skipped npm install because network install mode is disabled.');
		return { status: 'skipped', attempts: 0, reason: 'stubbed' };
	}
	let lastError: string | null = null;
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	const args = rootWorkspaceInstall
		? (gitDependencyRefreshSpecs.length > 0 ? ['install', ...gitDependencyRefreshSpecs, '--force'] : ['install'])
		: (gitDependencyRefreshSpecs.length > 0
			? ['install', ...gitDependencyRefreshSpecs, '--force', '--workspaces=false']
			: ['install', '--workspaces=false']);
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		emitProgress(options, node, 'install', `npm ${args.join(' ')} attempt ${attempt}/5.`);
		try {
			await runStreamingCommand(node, options, 'install', 'npm', args);
			return { status: 'completed', attempts: attempt, reason: null };
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < 5) {
			emitProgress(options, node, 'install', 'npm install failed; retrying in 60 seconds.', 'stderr');
			spawnSync('sleep', ['60'], { stdio: 'ignore' });
		}
	}
	throw new RepositorySaveError(`npm install failed after 5 attempts.\n${lastError ?? ''}`);
}

function lockfileValidationCommand(node: Pick<RepositorySaveNode, 'path' | 'packageJson'>, options: Pick<RepositorySaveOptions, 'root'>) {
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	const args = rootWorkspaceInstall
		? ['ci', '--ignore-scripts', '--dry-run']
		: ['ci', '--ignore-scripts', '--dry-run', '--workspaces=false'];
	return { command: 'npm', args };
}

async function validateRepositoryLockfile(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'root' | 'onProgress'>,
): Promise<RepositoryLockfileValidationResult> {
	if (!hasNpmLockfile(node.path)) {
		return { status: 'skipped', command: null, issues: [], error: 'no npm lockfile' };
	}
	const issues = collectDeploymentLockfileWorkspaceIssues(node.path)
		.map((issue) => `${issue.filePath}: ${issue.packageName} ${issue.reason}`);
	if (issues.length > 0) {
		throw new RepositorySaveError([
			`Lockfile validation failed for ${node.name}.`,
			...issues,
		].join('\n'), {
			details: {
				failingRepo: node.name,
				phase: 'lockfile',
				issues,
			},
		});
	}
	const { command, args } = lockfileValidationCommand(node, options);
	const commandText = `${command} ${args.join(' ')}`;
	if (shouldSkipNetworkInstall()) {
		emitProgress(options, node, 'lockfile', `Skipped ${commandText} because network install mode is disabled.`);
		return { status: 'skipped', command: commandText, issues: [], error: 'stubbed' };
	}
	try {
		runCapturedCommand(node, options, 'lockfile', command, args, { timeoutMs: 120_000 });
		return { status: 'passed', command: commandText, issues: [], error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const result = { status: 'failed' as const, command: commandText, issues: [message], error: message };
		throw new RepositorySaveError([
			`Lockfile validation failed for ${node.name}.`,
			`Command: ${commandText}`,
			message,
		].join('\n'), {
			details: {
				failingRepo: node.name,
				phase: 'lockfile',
				command: commandText,
				issues: result.issues,
			},
		});
	}
}

function hasScript(node: RepositorySaveNode, scriptName: string) {
	return typeof node.scripts[scriptName] === 'string' && node.scripts[scriptName].length > 0;
}

async function runScript(node: RepositorySaveNode, options: RepositorySaveOptions, scriptName: string) {
	await runStreamingCommand(node, options, 'verify', 'npm', ['run', scriptName]);
}

async function runRepoVerification(node: RepositorySaveNode, options: RepositorySaveOptions, verifyMode: SaveVerifyMode): Promise<RepositoryVerificationResult> {
	if (verifyMode === 'skip' || getGitHubAutomationMode() === 'stub') {
		emitProgress(options, node, 'verify', getGitHubAutomationMode() === 'stub' ? 'Skipped verification in stub automation mode.' : 'Skipped verification by request.');
		return { mode: verifyMode, status: 'skipped', primary: null, fallbackUsed: false, error: getGitHubAutomationMode() === 'stub' ? 'stubbed' : null };
	}
	if (node.kind !== 'package') {
		emitProgress(options, node, 'verify', 'Skipped package verification for project repository.');
		return { mode: verifyMode, status: 'skipped', primary: null, fallbackUsed: false, error: null };
	}
	if (verifyMode === 'local-only') {
		if (!hasScript(node, 'verify:local')) {
			throw new RepositorySaveError(`Package ${node.name} is missing required verify:local script.`);
		}
		await runScript(node, options, 'verify:local');
		return { mode: verifyMode, status: 'passed', primary: 'verify:local', fallbackUsed: false, error: null };
	}
	if (!hasScript(node, 'verify:action') && !hasScript(node, 'verify:local')) {
		throw new RepositorySaveError(`Package ${node.name} is missing required verify:action or verify:local script.`);
	}
	if (hasScript(node, 'verify:action')) {
		try {
			await runScript(node, options, 'verify:action');
			return { mode: verifyMode, status: 'passed', primary: 'verify:action', fallbackUsed: false, error: null };
		} catch (error) {
			if (!hasScript(node, 'verify:local')) {
				throw error;
			}
			emitProgress(options, node, 'verify', 'verify:action failed; falling back to verify:local.', 'stderr');
			await runScript(node, options, 'verify:local');
			return {
				mode: verifyMode,
				status: 'passed',
				primary: 'verify:action',
				fallbackUsed: true,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
	await runScript(node, options, 'verify:local');
	return { mode: verifyMode, status: 'passed', primary: 'verify:local', fallbackUsed: true, error: null };
}

function pullRebaseFromOrigin(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string) {
	if (!remoteBranchExistsSafe(node.path, branch)) {
		emitProgress(options, node, 'rebase', `Skipped pull --rebase because origin/${branch} does not exist.`);
		return {
			remoteBranchExisted: false,
			pulledRebase: false,
		};
	}
	try {
		runCapturedCommand(node, options, 'rebase', 'git', ['pull', '--rebase', '--recurse-submodules=no', 'origin', branch]);
		return {
			remoteBranchExisted: true,
			pulledRebase: true,
		};
	} catch (error) {
		const report = collectMergeConflictReport(node.path);
		throw new RepositorySaveError(formatMergeConflictReport(report, node.path, branch), {
			exitCode: 12,
			details: { branch, report, originalError: error instanceof Error ? error.message : String(error) },
		});
	}
}

function pushCurrentBranch(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string) {
	ensureWritableRemote(node, options);
	if (remoteBranchExistsSafe(node.path, branch)) {
		runCapturedCommand(node, options, 'push', 'git', ['push', 'origin', branch]);
		return { createdRemoteBranch: false, pushed: true };
	}
	runCapturedCommand(node, options, 'push', 'git', ['push', '-u', 'origin', branch]);
	return { createdRemoteBranch: true, pushed: true };
}

function tagExists(repoDir: string, tagName: string) {
	try {
		run('git', ['rev-parse', '--verify', `refs/tags/${tagName}`], { cwd: repoDir, capture: true });
		return true;
	} catch {
		return false;
	}
}

function localTagCommit(repoDir: string, tagName: string) {
	try {
		return run('git', ['rev-list', '-n', '1', tagName], { cwd: repoDir, capture: true }).trim();
	} catch {
		return null;
	}
}

function remoteTagCommit(repoDir: string, tagName: string) {
	try {
		const output = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tagName}*`], { cwd: repoDir, capture: true });
		const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
		const dereferenced = lines.find((line) => line.endsWith(`refs/tags/${tagName}^{}`));
		const exact = lines.find((line) => line.endsWith(`refs/tags/${tagName}`));
		const selected = dereferenced ?? exact;
		return selected ? selected.split(/\s+/u)[0] ?? null : null;
	} catch {
		return null;
	}
}

function localTagMessage(repoDir: string, tagName: string) {
	try {
		return run('git', ['tag', '-l', tagName, '--format=%(contents)'], { cwd: repoDir, capture: true }).trim();
	} catch {
		return null;
	}
}

function tagState(repoDir: string, tagName: string) {
	const localCommit = localTagCommit(repoDir, tagName);
	const remoteCommit = remoteTagCommit(repoDir, tagName);
	return {
		tagName,
		localExists: localCommit != null,
		localCommit,
		remoteExists: remoteCommit != null,
		remoteCommit,
	};
}

function assertTagStateMatchesHead(node: RepositorySaveNode, tagName: string, state: ReturnType<typeof tagState>, head: string) {
	if (state.localCommit && state.localCommit !== head) {
		throw new RepositorySaveError(`Package ${node.name} tag ${tagName} points to ${state.localCommit.slice(0, 12)}, but ${node.name} HEAD is ${head.slice(0, 12)}. Refusing to move an existing tag.`, {
			details: {
				failingRepo: node.name,
				phase: 'tag',
				currentVersion: tagName,
				expectedTag: tagName,
				tagState: state,
			},
		});
	}
	if (state.remoteCommit && state.remoteCommit !== head) {
		throw new RepositorySaveError(`Remote tag ${tagName} for ${node.name} points to ${state.remoteCommit.slice(0, 12)}, but ${node.name} HEAD is ${head.slice(0, 12)}. Refusing to move an existing tag.`, {
			details: {
				failingRepo: node.name,
				phase: 'tag',
				currentVersion: tagName,
				expectedTag: tagName,
				tagState: state,
			},
		});
	}
}

function createPackageTagMessage(node: RepositorySaveNode, tagName: string, branch: string, workflowRunId?: string | null) {
	return tagName.includes('-dev.')
		? createDevTagMessage({
			packageName: node.name,
			version: tagName,
			branch,
			commitSha: headCommit(node.path),
			workflowRunId,
		})
		: `release: ${tagName}`;
}

function ensureRemoteAccessBeforeVerification(node: RepositorySaveNode, options: RepositorySaveOptions, state: SaveState) {
	if (shouldSkipRemoteAccessPreflight()) return;
	if (state.remoteAccessChecked.has(node.path)) return;
	ensureWritableRemote(node, options);
	const writeUrl = remoteWriteUrl(node.path) ?? 'origin';
	emitProgress(options, node, 'preflight', `Checking write remote access before verification (${writeUrl}).`);
	try {
		runQuietCommand(node, 'preflight', 'git', ['ls-remote', '--heads', writeUrl], { timeoutMs: 30_000 });
		state.remoteAccessChecked.add(node.path);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new RepositorySaveError([
			`Cannot access origin remote for ${node.name}; save would fail after verification when pushing branch or tags.`,
			'Fix Git authentication, then rerun `npx trsd save` to resume.',
			detail,
		].join('\n'), {
			exitCode: 13,
			details: {
				failingRepo: node.name,
				phase: 'preflight',
				originalError: detail,
			},
		});
	}
}

function shouldSkipRemoteAccessPreflight() {
	return getGitHubAutomationMode() === 'stub' || process.env.TREESEED_SAVE_REMOTE_PREFLIGHT === 'skip';
}

function localTreeseedTagWasCreatedByThisRun(node: RepositorySaveNode, tagName: string, workflowRunId?: string | null) {
	const message = localTagMessage(node.path, tagName);
	if (!message?.includes('treeseed-dev-tag: true')) return false;
	if (!workflowRunId) return true;
	return message.includes(`workflowRunId: ${workflowRunId}`);
}

function ensurePackageTagPushed(node: RepositorySaveNode, options: RepositorySaveOptions, tagName: string, branch: string, workflowRunId?: string | null) {
	let message: string | null = null;
	ensureWritableRemote(node, options);
	const head = headCommit(node.path);
	let state = tagState(node.path, tagName);
	assertTagStateMatchesHead(node, tagName, state, head);

	if (!state.localExists && state.remoteExists && state.remoteCommit === head) {
		runCapturedCommand(node, options, 'tag', 'git', ['fetch', 'origin', `refs/tags/${tagName}:refs/tags/${tagName}`]);
		state = tagState(node.path, tagName);
		assertTagStateMatchesHead(node, tagName, state, head);
	}

	if (!state.localExists) {
		message = createPackageTagMessage(node, tagName, branch, workflowRunId);
		runCapturedCommand(node, options, 'tag', 'git', ['tag', '-a', tagName, '-m', message]);
		state = tagState(node.path, tagName);
		assertTagStateMatchesHead(node, tagName, state, head);
	}

	if (!state.remoteExists) {
		runCapturedCommand(node, options, 'tag', 'git', ['push', 'origin', tagName]);
	} else {
		emitProgress(options, node, 'tag', `Remote tag ${tagName} already points at HEAD.`);
	}
	return message;
}

function refreshSubmodulePointers(node: RepositorySaveNode, finalizedCommits: Map<string, string>) {
	let changed = false;
	for (const [repoName] of finalizedCommits.entries()) {
		const childRelativePath = node.id === '.'
			? repoName
			: repoName.startsWith(`${node.id}/`)
				? repoName.slice(node.id.length + 1)
				: null;
		if (!childRelativePath) continue;
		const childPath = resolve(node.path, childRelativePath);
		if (!existsSync(childPath) || !isGitRepo(childPath)) continue;
		const status = run('git', ['status', '--porcelain', '--', childRelativePath], { cwd: node.path, capture: true });
		if (status.trim().length > 0) {
			changed = true;
		}
	}
	return changed;
}

function syncBranchBeforeSave(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string) {
	checkoutOrCreateBranch(node, options, branch);
}

function refreshRepositoryNodePackageMetadata(node: RepositorySaveNode) {
	const packageJsonPath = resolve(node.path, 'package.json');
	const packageJson = existsSync(packageJsonPath) ? readJson(packageJsonPath) : null;
	node.packageJsonPath = packageJson ? packageJsonPath : null;
	node.packageJson = packageJson;
	node.scripts = packageScripts(packageJson);
	node.remoteUrl = originRemoteUrlSafe(node.path);
	if (node.kind === 'package') {
		node.name = repoDisplayName(node.path, packageJson);
	}
}

function finalizePackageReference(node: RepositorySaveNode, version: string, options: RepositorySaveOptions) {
	const reference = createPackageDependencyReference({
		packageName: node.name,
		version,
		branchMode: node.branchMode === 'package-release-main' ? 'package-release-main' : 'package-dev-save',
		remoteUrl: node.remoteUrl,
		devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-tag',
		gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
	});
	node.plannedDependencySpec = reference.spec;
	return reference;
}

async function finalizeCleanPackageVersion(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	state: SaveState,
	report: RepositorySaveReport,
	branch: string,
) {
	const version = typeof node.packageJson?.version === 'string' ? node.packageJson.version : null;
	if (!version || !packageVersionEligibleForBranch(node, version, options)) {
		return false;
	}

	const head = headCommit(node.path);
	const currentTagState = tagState(node.path, version);
	assertTagStateMatchesHead(node, version, currentTagState, head);
	const remoteBranchExists = remoteBranchExistsSafe(node.path, branch);
	const finalizedRemotely = currentTagState.localCommit === head
		&& currentTagState.remoteCommit === head
		&& remoteBranchExists;

	report.version = version;
	report.tagName = version;
	report.commitSha = head;
	report.dependencySpec = finalizePackageReference(node, version, options).spec;
	state.finalizedVersions.set(node.name, version);
	state.finalizedReferences.set(node.name, finalizePackageReference(node, version, options));
	state.finalizedCommits.set(node.relativePath, head);

	if (finalizedRemotely) {
		report.pushed = true;
		report.skippedReason = 'already-finalized';
		report.publishWait = { recoveredPartialSave: true, remoteBranchExisted: true, tagAlreadyPushed: true };
		emitProgress(options, node, 'finalize', `Using existing finalized package version ${version}.`);
		return true;
	}

	emitProgress(options, node, 'finalize', `Finalizing interrupted package version ${version}.`);
	const rebase = pullRebaseFromOrigin(node, options, branch);
	if (currentTagState.localCommit === head && localTreeseedTagWasCreatedByThisRun(node, version, options.workflowRunId)) {
		emitProgress(options, node, 'verify', `Reusing verification from interrupted tag ${version}.`);
		report.verification = {
			mode: options.verifyMode ?? 'action-first',
			status: 'skipped',
			primary: null,
			fallbackUsed: false,
			error: 'verified-before-interruption',
		};
		report.verified = true;
	} else {
		ensureRemoteAccessBeforeVerification(node, options, state);
		report.verification = await runRepoVerification(node, options, options.verifyMode ?? 'action-first');
		report.verified = report.verification.status === 'passed';
	}
	const tagMessage = ensurePackageTagPushed(node, options, version, branch, options.workflowRunId);
	report.devTagMetadata = tagMessage?.includes('treeseed-dev-tag: true') ? tagMessage : null;
	const reference = finalizePackageReference(node, version, options);
	await runGitDependencySmoke(node, options, reference);
	report.dependencySpec = reference.spec;
	const push = pushCurrentBranch(node, options, branch);
	report.pushed = push.pushed;
	report.skippedReason = 'finalized-partial-save';
	report.commitSha = headCommit(node.path);
	state.finalizedCommits.set(node.relativePath, report.commitSha);
	report.publishWait = {
		...rebase,
		...push,
		recoveredPartialSave: true,
	};
	return true;
}

function branchModeLabel(branchMode: RepoBranchMode) {
	switch (branchMode) {
		case 'package-release-main':
			return 'stable package release';
		case 'package-dev-save':
			return 'dev package save';
		case 'project-save':
			return 'project save';
	}
}

function repoPlanCommands(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	plannedVersion: string | null,
	plannedDependencySpec: string | null,
	dependencyUpdates: string[],
) {
	const branch = node.branch || options.branch;
	const remoteExists = remoteBranchExistsSafe(node.path, branch);
	const commands = [
		checkoutCommandFor(node.path, branch),
	];
	const sshPushUrl = (options.gitRemoteWriteMode ?? 'ssh-pushurl') === 'off'
		? null
		: sshPushUrlForRemote(node.remoteUrl);
	if (sshPushUrl) {
		commands.push(`git remote set-url --push origin ${sshPushUrl} # keep ${node.remoteUrl} for reads`);
	}
	if (dependencyUpdates.length > 0) {
		commands.push(`update package.json internal dependencies: ${dependencyUpdates.join(', ')}`);
	}
	if (node.submoduleDependencies.length > 0) {
		commands.push(`refresh submodule pointers: ${node.submoduleDependencies.join(', ')}`);
	}
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	if (node.kind === 'package' && plannedVersion) {
		commands.push(`update package.json version to ${plannedVersion}`);
		commands.push('npm install --workspaces=false # explicitly refresh changed git-tag dependencies with --force; retry up to 5 times with 60s delay');
	} else if (node.kind === 'project' && dependencyUpdates.length > 0 && hasNpmLockfile(node.path)) {
		commands.push(rootWorkspaceInstall
			? 'npm install # refresh root workspace lockfile against the real checked-in manifest'
			: 'npm install --workspaces=false # refresh project lockfile after internal dependency updates');
	}
	if (hasNpmLockfile(node.path) && (node.kind === 'project' || plannedVersion || dependencyUpdates.length > 0 || node.submoduleDependencies.length > 0)) {
		commands.push(rootWorkspaceInstall
			? 'npm ci --ignore-scripts --dry-run # validate root manifest, workspaces, and lockfile before commit'
			: 'npm ci --ignore-scripts --dry-run --workspaces=false # validate deployment lockfile before commit');
	}
	commands.push('git add -A');
	commands.push('generate commit message # Cloudflare AI when configured, fallback otherwise');
	commands.push('git commit -m <generated-message>');
	commands.push(
		remoteExists
			? `git pull --rebase --recurse-submodules=no origin ${branch}`
			: `skip pull --rebase # origin/${branch} does not exist yet`,
	);
	if (node.kind === 'package') {
		const verifyMode = options.verifyMode ?? 'action-first';
		if (verifyMode === 'skip') {
			commands.push('skip package verification');
		} else if (verifyMode === 'local-only') {
			commands.push('npm run verify:local');
		} else {
			commands.push('npm run verify:action # fallback to npm run verify:local on failure');
		}
		if (plannedVersion) {
			commands.push(`git tag -a ${plannedVersion} -m <${plannedVersion.includes('-dev.') ? 'dev metadata' : 'release'}>`);
			commands.push(`git push origin ${plannedVersion}`);
			if (plannedDependencySpec && node.branchMode === 'package-dev-save') {
				commands.push(`smoke install ${plannedDependencySpec}`);
			}
		}
	} else {
		commands.push('skip package verification # project repository');
	}
	commands.push(remoteExists ? `git push origin ${branch}` : `git push -u origin ${branch}`);
	return commands;
}

export function planRepositorySave(options: RepositorySaveOptions): RepositorySavePlan {
	const scope = options.branch === STAGING_BRANCH ? 'staging' : options.branch === PRODUCTION_BRANCH ? 'prod' : 'local';
	const allNodes = discoverRepositorySaveNodes(options.root, options.gitRoot, options.branch, {
		stablePackageRelease: options.stablePackageRelease === true,
	});
	const nodes = options.includeRoot === false ? allNodes.filter((node) => node.id !== '.') : allNodes;
	const mode = nodes.some((node) => node.id !== '.') ? 'recursive-workspace' : 'root-only';
	const waves = repositorySaveWaves(nodes);
	const plannedVersions = new Map<string, string>();
	const plannedReferences = new Map<string, PackageDependencyReference>();
	const plans = new Map<string, RepositorySavePlanRepo>();

	for (const wave of waves) {
		for (const node of wave) {
			const dependencyUpdates = node.dependencies
				.map((id) => nodes.find((candidate) => candidate.id === id))
				.filter((candidate): candidate is RepositorySaveNode => Boolean(candidate))
				.map((dependency) => {
					const reference = plannedReferences.get(dependency.name);
					return reference ? `${dependency.name} -> ${reference.spec}` : null;
				})
				.filter((value): value is string => Boolean(value));
			const dependencyChanged = dependencyUpdates.length > 0;
			const submoduleChanged = node.submoduleDependencies.length > 0 && node.submoduleDependencies.some((id) => {
				const dependency = plans.get(id);
				return dependency?.dirty || Boolean(dependency?.plannedVersion);
			});
			const dirty = hasMeaningfulChanges(node.path);
			const packageNeedsVersion = node.kind === 'package' && (dirty || dependencyChanged || submoduleChanged);
			const currentVersion = typeof node.packageJson?.version === 'string' ? node.packageJson.version : null;
			const plannedVersion = packageNeedsVersion ? selectPackageVersion(node, options).version : null;
			let plannedDependencySpec: string | null = null;
			if (node.kind === 'package' && plannedVersion) {
				const reference = createPackageDependencyReference({
					packageName: node.name,
					version: plannedVersion,
					branchMode: node.branchMode === 'package-release-main' ? 'package-release-main' : 'package-dev-save',
					remoteUrl: node.remoteUrl,
					devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-tag',
					gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
				});
				plannedDependencySpec = reference.spec;
				plannedVersions.set(node.name, plannedVersion);
				plannedReferences.set(node.name, reference);
			}
			const current = currentBranch(node.path) || null;
			const branch = node.branch || options.branch;
			const notes = [
				`${branchModeLabel(node.branchMode)} on top-level ${options.branch}`,
				...(current && current !== branch ? [`current branch ${current} will be switched to ${branch}`] : []),
				...(node.kind === 'package' && plannedVersion?.includes('-dev.')
					? ['dev Git tag only; publish workflows reject prerelease/dev tags']
					: []),
			];
			const repoPlan: RepositorySavePlanRepo = {
				id: node.id,
				name: node.name,
				path: node.path,
				relativePath: node.relativePath,
				kind: node.kind,
				currentBranch: current,
				targetBranch: branch,
				branchMode: node.branchMode,
				dirty,
				dependencies: node.dependencies,
				dependents: node.dependents,
				submoduleDependencies: node.submoduleDependencies,
				currentVersion,
				plannedVersion,
				plannedTag: plannedVersion,
				plannedDependencySpec,
				remoteUrl: node.remoteUrl,
				commands: repoPlanCommands(node, options, plannedVersion, plannedDependencySpec, dependencyUpdates),
				notes,
			};
			plans.set(node.id, repoPlan);
		}
	}

	const rootNode = nodes.find((node) => node.id === '.') ?? allNodes.find((node) => node.id === '.');
	const rootRepo = rootNode ? plans.get(rootNode.id) : null;
	if (!rootRepo) {
		throw new RepositorySaveError('Unable to build repository save plan for root repository.');
	}
	const repoPlans = nodes
		.filter((node) => node.id !== '.')
		.sort(compareNodes)
		.map((node) => plans.get(node.id))
		.filter((plan): plan is RepositorySavePlanRepo => Boolean(plan));
	const wavePlans = waves.map((wave, index) => ({
		index: index + 1,
		parallel: wave.length > 1,
		repos: wave.map((node) => node.name),
		commands: wave.map((node) => ({
			repo: node.name,
			commands: plans.get(node.id)?.commands ?? [],
		})),
	}));
	return {
		mode,
		branch: options.branch,
		scope,
		devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-tag',
		gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
		verifyMode: options.verifyMode ?? 'action-first',
		commitMessageMode: options.commitMessageMode ?? 'auto',
		repos: repoPlans,
		rootRepo,
		waves: wavePlans,
		plannedVersions: Object.fromEntries(plannedVersions.entries()),
		plannedSteps: wavePlans.flatMap((wave) => wave.commands.map((entry) => ({
			id: `wave-${wave.index}-${entry.repo}`,
			description: `Wave ${wave.index}${wave.parallel ? ' parallel' : ''}: ${entry.repo}`,
		}))),
	};
}

export async function refreshAndValidateRootWorkspaceLockfileForSave(options: {
	root: string;
	gitRoot?: string;
	branch?: string | null;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}): Promise<{ install: RepositoryInstallResult | null; lockfileValidation: RepositoryLockfileValidationResult | null }> {
	const repoDir = options.gitRoot ?? options.root;
	const packageJsonPath = resolve(repoDir, 'package.json');
	const packageJson = existsSync(packageJsonPath) ? readJson(packageJsonPath) : null;
	const node: RepositorySaveNode = {
		id: '.',
		name: repoDisplayName(repoDir, packageJson),
		path: repoDir,
		relativePath: '.',
		kind: 'project',
		branch: options.branch ?? currentBranch(repoDir) ?? null,
		branchMode: 'project-save',
		packageJsonPath: packageJson ? packageJsonPath : null,
		packageJson,
		scripts: packageScripts(packageJson),
		remoteUrl: originRemoteUrlSafe(repoDir),
		dependencies: [],
		dependents: [],
		submoduleDependencies: [],
		plannedVersion: null,
		plannedTag: null,
		plannedDependencySpec: null,
	};
	if (!hasNpmLockfile(repoDir)) {
		return {
			install: null,
			lockfileValidation: { status: 'skipped', command: null, issues: [], error: 'no npm lockfile' },
		};
	}
	const install = await runNpmInstallWithRetry(node, { root: options.root, onProgress: options.onProgress });
	const lockfileValidation = await validateRepositoryLockfile(node, { root: options.root, onProgress: options.onProgress });
	return { install, lockfileValidation };
}

async function saveOneRepository(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	state: SaveState,
) {
	const report = state.reports.get(node.id) ?? createReport(node);
	state.reports.set(node.id, report);
	const branch = node.branch || options.branch;
	emitProgress(options, node, 'start', `Starting ${node.branchMode} on ${branch}.`);
	syncBranchBeforeSave(node, options, branch);
	node.branch = currentBranch(node.path) || branch;
	report.branch = node.branch;
	refreshRepositoryNodePackageMetadata(node);
	ensureWritableRemote(node, options);

	const dependencyUpdates = updateDependencyReferences(node, state.finalizedReferences);
	const dependencyChanged = dependencyUpdates.length > 0;
	const gitDependencyRefreshSpecs = dependencyUpdates
		.map((update) => state.finalizedReferences.get(update.packageName))
		.filter((reference): reference is PackageDependencyReference => Boolean(reference) && reference.mode === 'dev-git-tag')
		.map((reference) => `${reference.packageName}@${reference.installSpec ?? reference.spec}`);
	const submodulesChanged = refreshSubmodulePointers(node, state.finalizedCommits);
	const packageNeedsVersion = node.kind === 'package' && (hasMeaningfulChanges(node.path) || dependencyChanged || submodulesChanged);
	let plannedVersion: string | null = null;

	if (packageNeedsVersion) {
		const selection = selectPackageVersion(node, options);
		plannedVersion = selection.version;
		if (!plannedVersion) {
			throw new RepositorySaveError(`Unable to plan package version for ${node.name}.`);
		}
		if (selection.reused) {
			emitProgress(options, node, 'version', `Reusing existing interrupted save version ${plannedVersion}.`);
		} else {
			applyPackageVersion(node, plannedVersion);
		}
		node.plannedVersion = plannedVersion;
		node.plannedTag = plannedVersion;
		report.version = plannedVersion;
		report.tagName = plannedVersion;
		if (!selection.reused) {
			emitProgress(options, node, 'version', `Planned ${plannedVersion}.`);
		}
		const reference = finalizePackageReference(node, plannedVersion, options);
		report.dependencySpec = reference.spec;
		report.install = await runNpmInstallWithRetry(node, options, gitDependencyRefreshSpecs);
	} else if (node.kind === 'package') {
		report.version = String(node.packageJson?.version ?? report.version ?? '');
	} else if (node.kind === 'project' && dependencyChanged && hasNpmLockfile(node.path)) {
		report.install = await runNpmInstallWithRetry(node, options, gitDependencyRefreshSpecs);
	}

	if (hasNpmLockfile(node.path) && (node.kind === 'project' || packageNeedsVersion || dependencyChanged || submodulesChanged)) {
		report.lockfileValidation = await validateRepositoryLockfile(node, options);
	}

	const dirty = hasMeaningfulChanges(node.path);
	report.dirty = dirty;
	if (!dirty) {
		report.skippedReason = 'clean';
		report.commitSha = headCommit(node.path);
		emitProgress(options, node, 'clean', 'No meaningful changes to commit.');
		if (node.kind === 'package') {
			const finalized = await finalizeCleanPackageVersion(node, options, state, report, branch);
			if (finalized) {
				return report;
			}
		}
		if (node.id === '.') {
			const rebase = pullRebaseFromOrigin(node, options, branch);
			const push = pushCurrentBranch(node, options, branch);
			report.pushed = push.pushed;
			report.publishWait = {
				...rebase,
				...push,
			};
			report.commitSha = headCommit(node.path);
		}
		state.finalizedCommits.set(node.relativePath, report.commitSha);
		return report;
	}

	runCapturedCommand(node, options, 'commit', 'git', ['add', '-A']);
	const { changedFiles, diff } = gitDiffSummary(node.path);
	emitProgress(options, node, 'message', 'Generating commit message.');
	const messageResult = await commitMessageFor(node, options, {
		changedFiles,
		diff,
		plannedVersion: plannedVersion ?? report.version,
		plannedTag: node.plannedTag ?? report.tagName,
	});
	report.commitMessage = messageResult.message;
	report.commitMessageProvider = messageResult.provider;
	report.commitMessageFallbackUsed = messageResult.fallbackUsed;
	report.commitMessageError = messageResult.error;
	emitProgress(options, node, 'message', `${messageResult.provider}${messageResult.fallbackUsed ? ' fallback' : ''}: ${messageResult.message.split(/\r?\n/u)[0]}`);
	runCapturedCommand(node, options, 'commit', 'git', ['commit', '-m', messageResult.message]);
	report.committed = true;

	const rebase = pullRebaseFromOrigin(node, options, branch);
	const verifyMode = options.verifyMode ?? 'action-first';
	if (node.kind === 'package') {
		ensureRemoteAccessBeforeVerification(node, options, state);
	}
	report.verification = await runRepoVerification(node, options, verifyMode);
	report.verified = report.verification.status === 'passed';

	if (node.kind === 'package') {
		const version = plannedVersion ?? String((readJson(resolve(node.path, 'package.json')).version ?? report.version ?? ''));
		const tagMessage = ensurePackageTagPushed(node, options, version, branch, options.workflowRunId);
		report.tagName = version;
		report.version = version;
		report.devTagMetadata = tagMessage?.includes('treeseed-dev-tag: true') ? tagMessage : null;
		const reference = finalizePackageReference(node, version, options);
		await runGitDependencySmoke(node, options, reference);
		report.dependencySpec = reference.spec;
		state.finalizedVersions.set(node.name, version);
		state.finalizedReferences.set(node.name, reference);
	}
	const push = pushCurrentBranch(node, options, branch);
	report.pushed = push.pushed;
	report.commitSha = headCommit(node.path);
	report.skippedReason = null;
	state.finalizedCommits.set(node.relativePath, report.commitSha);
	report.publishWait = {
		...rebase,
		...push,
	};
	emitProgress(options, node, 'done', `Saved ${report.commitSha?.slice(0, 12) ?? 'current HEAD'}.`);
	return report;
}

export async function runRepositorySaveOrchestrator(options: RepositorySaveOptions): Promise<RepositorySaveResult> {
	const root = options.root;
	const gitRoot = options.gitRoot;
	const branch = options.branch;
	const scope = branch === STAGING_BRANCH ? 'staging' : branch === PRODUCTION_BRANCH ? 'prod' : 'local';
	const allNodes = discoverRepositorySaveNodes(root, gitRoot, branch, {
		stablePackageRelease: options.stablePackageRelease === true,
	});
	const nodes = options.includeRoot === false ? allNodes.filter((node) => node.id !== '.') : allNodes;
	const mode = nodes.some((node) => node.id !== '.') ? 'recursive-workspace' : 'root-only';
	const waves = repositorySaveWaves(nodes);
	const state: SaveState = {
		finalizedVersions: new Map(),
		finalizedReferences: new Map(),
		finalizedCommits: new Map(),
		reports: new Map(nodes.map((node) => [node.id, createReport(node)])),
		remoteAccessChecked: new Set(),
	};

	for (const wave of waves) {
		await runLimited(wave, 3, async (node) => {
			try {
				await saveOneRepository(node, options, state);
			} catch (error) {
				const existing = repositorySaveErrorDetails(error);
				throw new RepositorySaveError(error instanceof Error ? error.message : String(error), {
					exitCode: existing.exitCode,
					details: {
						...(existing.details ?? {}),
						partialFailure: {
							message: `Treeseed save stopped while saving ${node.name}.`,
							failingRepo: node.name,
							phase: typeof existing.details?.phase === 'string' ? existing.details.phase : null,
							currentVersion: typeof node.packageJson?.version === 'string' ? node.packageJson.version : null,
							expectedTag: node.plannedTag,
							tagState: node.plannedTag ? tagState(node.path, node.plannedTag) : null,
							nextCommand: `treeseed resume ${options.workflowRunId ?? '<run-id>'}`,
							repos: [...state.reports.entries()]
								.filter(([id]) => id !== '.')
								.map(([, report]) => report),
							rootRepo: state.reports.get('.') ?? null,
							error: error instanceof Error ? error.message : String(error),
						},
					},
				});
			}
		});
	}

	const rootNode = nodes.find((node) => node.id === '.') ?? allNodes.find((node) => node.id === '.');
	const rootReport = rootNode
		? (state.reports.get(rootNode.id) ?? createReport(rootNode))
		: createReport({
			id: '.',
			name: '@treeseed/market',
			path: gitRoot,
			relativePath: '.',
			kind: 'project',
			branch,
			branchMode: 'project-save',
			packageJsonPath: null,
			packageJson: null,
			scripts: {},
			remoteUrl: null,
			dependencies: [],
			dependents: [],
			submoduleDependencies: [],
			plannedVersion: null,
			plannedTag: null,
			plannedDependencySpec: null,
		});
	const packageReports = nodes
		.filter((node) => node.id !== '.')
		.sort(compareNodes)
		.map((node) => state.reports.get(node.id) ?? createReport(node));

	return {
		mode,
		branch,
		scope,
		repos: packageReports,
		rootRepo: rootReport,
		waves: waves.map((wave) => wave.map((node) => node.name)),
		plannedVersions: Object.fromEntries(state.finalizedVersions.entries()),
	};
}

export function repositorySaveErrorDetails(error: unknown) {
	if (error instanceof RepositorySaveError) {
		return {
			exitCode: error.exitCode,
			details: error.details,
		};
	}
	return {
		exitCode: undefined,
		details: undefined,
	};
}
