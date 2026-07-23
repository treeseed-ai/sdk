import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../git-runner.ts';
import {
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
	type GitRemoteWriteMode,
} from '../git-remote-policy.ts';
import {
	generateRepositoryCommitMessage,
	type CommitMessageDependencyUpdate,
	type CommitMessageContext,
	type CommitMessagePackageChange,
	type CommitMessageProvider,
	type CommitMessageProviderMode,
	type CommitMessageSubmodulePointer,
} from '../commit-message-provider.ts';
import {
	createPackageDependencyReference,
	type DevDependencyReferenceMode,
	type GitDependencyProtocol,
	normalizeGitRemoteForDependency,
	type PackageDependencyReference,
	type RewrittenDevReference,
	updateInternalDependencySpecs,
} from '../package-reference-policy.ts';
import {
	PRODUCTION_BRANCH,
	branchExists,
	checkoutBranch,
	headCommit,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
} from '../git-workflow.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	repoRoot,
} from '../workspace-save.ts';
import {
	hasCompleteTreeseedPackageCheckout,
	run,
	sortWorkspacePackages,
	workspacePackages,
} from '../workspace-tools.ts';
import { collectDeploymentLockfileWorkspaceIssues, ensureLocalWorkspaceLinks } from '../workspace-dependency-mode.ts';
import {
	createBuildWarningSummary,
	formatAllowedBuildWarnings,
	type BuildWarningPolicyOptions,
} from '../build-warning-policy.js';
import {
	readTreeseedVerificationCache,
	writeTreeseedVerificationCache,
} from '../verification-cache.ts';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageCommand,
} from '../package-adapters.ts';
import {
	discoverTreeseedManagedRepositories,
	parseGitmodulesPaths,
	readTreeseedTemplateRepositoryManifest,
	type TreeseedManagedRepositoryKind,
} from '../managed-repositories.ts';
import { RepositorySaveError, RepositorySaveNode, RepositorySaveOptions, emitProgress, prefixedOutput, progressPrefix, readJson } from './repo-kind.ts';

export function withShortProcessTempEnv(env: NodeJS.ProcessEnv = {}) {
	const merged = { ...process.env, ...env };
	if (process.platform === 'win32') {
		return merged;
	}
	const shortTemp = tmpdir();
	const tempKeys = ['TMPDIR', 'TMP', 'TEMP'] as const;
	for (const key of tempKeys) {
		const value = merged[key];
		if (value && value.length > shortTemp.length) {
			merged[key] = shortTemp;
		}
	}
	return merged;
}

export function npmCacheForCwd(cwd: string) {
	const cacheDir = resolve(cwd, '.treeseed', 'cache', 'npm');
	mkdirSync(cacheDir, { recursive: true });
	return cacheDir;
}

export function npmWorkflowEnv(env: NodeJS.ProcessEnv = {}, cwd = process.cwd()) {
	const npmCache = env.npm_config_cache
		?? env.NPM_CONFIG_CACHE
		?? npmCacheForCwd(cwd);
	return withShortProcessTempEnv({
		...env,
		NPM_CONFIG_CACHE: npmCache,
		npm_config_audit: env.npm_config_audit ?? process.env.npm_config_audit ?? 'false',
		npm_config_cache: npmCache,
		npm_config_fetch_retries: env.npm_config_fetch_retries ?? process.env.npm_config_fetch_retries ?? '2',
		npm_config_fund: env.npm_config_fund ?? process.env.npm_config_fund ?? 'false',
		npm_config_foreground_scripts: env.npm_config_foreground_scripts ?? process.env.npm_config_foreground_scripts ?? 'true',
		npm_config_loglevel: env.npm_config_loglevel ?? process.env.npm_config_loglevel ?? 'warn',
		npm_config_maxsockets: env.npm_config_maxsockets ?? process.env.npm_config_maxsockets ?? '4',
		npm_config_prefer_offline: env.npm_config_prefer_offline ?? process.env.npm_config_prefer_offline ?? 'true',
		npm_config_progress: env.npm_config_progress ?? process.env.npm_config_progress ?? 'false',
	});
}

export function npmCommandForSpawn(args: string[]) {
	if (process.platform === 'win32') {
		return { command: 'npm', args };
	}
	return {
		command: 'bash',
		args: [
			'-lc',
			'ulimit -n 65535 2>/dev/null || ulimit -n 32768 2>/dev/null || ulimit -n 16384 2>/dev/null || true; exec npm "$@"',
			'npm-fd-guard',
			...args,
		],
	};
}

export function displayCommand(command: string, args: string[]) {
	return command === 'npm' ? `npm ${args.join(' ')}` : `${command} ${args.join(' ')}`;
}

export function runCapturedCommand(
	node: Pick<RepositorySaveNode, 'name' | 'path'>,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	phase: string,
	command: string,
	args: string[],
	commandOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; emitOutputOnSuccess?: boolean } = {},
) {
	const cwd = commandOptions.cwd ?? node.path;
	const spawnCommand = command === 'npm' ? npmCommandForSpawn(args) : { command, args };
	emitProgress(options, node, phase, `$ ${displayCommand(command, args)}`);
	const result = spawnSync(spawnCommand.command, spawnCommand.args, {
		cwd,
		env: command === 'npm' ? npmWorkflowEnv(commandOptions.env, cwd) : withShortProcessTempEnv(commandOptions.env),
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: commandOptions.timeoutMs,
	});
	const stdout = result.stdout?.trim() ?? '';
	const stderr = result.stderr?.trim() ?? '';
	if (commandOptions.emitOutputOnSuccess !== false) {
		if (stdout) emitProgress(options, node, phase, stdout);
		if (stderr) emitProgress(options, node, phase, stderr, 'stderr');
	}
	if (result.status !== 0) {
		const message =
			(result.error?.message ? `${result.error.message}\n` : '')
			+ (
				prefixedOutput(node, phase, stderr)
				|| prefixedOutput(node, phase, stdout)
				|| `${progressPrefix(node, phase)} ${displayCommand(command, args)} failed`
			);
		throw new RepositorySaveError(message, {
			details: {
				failingRepo: node.name,
				phase,
				command: displayCommand(command, args),
			},
		});
	}
	return stdout;
}

export function npmLockfilePackageCount(repoDir: string) {
	try {
		const lockfile = readJson(resolve(repoDir, 'package-lock.json'));
		const packages = lockfile.packages;
		if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
			return Math.max(0, Object.keys(packages).filter((entry) => entry !== '').length);
		}
		const dependencies = lockfile.dependencies;
		if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
			return Object.keys(dependencies).length;
		}
	} catch {
		// Fall through to an unknown count. Lockfile validation still owns failure reporting.
	}
	return null;
}

export function isNoOpGitCommitError(error: unknown) {
	if (!(error instanceof RepositorySaveError)) return false;
	const command = typeof error.details?.command === 'string' ? error.details.command : '';
	if (!command.startsWith('git commit ')) return false;
	return /nothing to commit|no changes added to commit/u.test(error.message);
}

export function runQuietCommand(
	node: Pick<RepositorySaveNode, 'name' | 'path'>,
	phase: string,
	command: string,
	args: string[],
	commandOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
) {
	const cwd = commandOptions.cwd ?? node.path;
	const spawnCommand = command === 'npm' ? npmCommandForSpawn(args) : { command, args };
	const result = spawnSync(spawnCommand.command, spawnCommand.args, {
		cwd,
		env: command === 'npm' ? npmWorkflowEnv(commandOptions.env, cwd) : withShortProcessTempEnv(commandOptions.env),
		stdio: 'pipe',
		encoding: 'utf8',
		timeout: commandOptions.timeoutMs,
	});
	const stdout = result.stdout?.trim() ?? '';
	const stderr = result.stderr?.trim() ?? '';
	if (result.status !== 0) {
		throw new RepositorySaveError(
			[
				`${progressPrefix(node, phase)} ${displayCommand(command, args)} failed`,
				stderr || stdout,
			].filter(Boolean).join('\n'),
			{
				details: {
					failingRepo: node.name,
					phase,
					command: displayCommand(command, args),
				},
			},
		);
	}
	return stdout;
}

export async function runStreamingCommand(
	node: Pick<RepositorySaveNode, 'name' | 'path'>,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	phase: string,
	command: string,
	args: string[],
	commandOptions: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; buildWarningPolicy?: BuildWarningPolicyOptions | false } = {},
) {
	const cwd = commandOptions.cwd ?? node.path;
	const spawnCommand = command === 'npm' ? npmCommandForSpawn(args) : { command, args };
	emitProgress(options, node, phase, `$ ${displayCommand(command, args)}`);
	return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
		const child = spawn(spawnCommand.command, spawnCommand.args, {
			cwd,
			env: command === 'npm' ? npmWorkflowEnv(commandOptions.env, cwd) : withShortProcessTempEnv(commandOptions.env),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let stdoutRemainder = '';
		let stderrRemainder = '';
		let settled = false;
		const warningSummary = commandOptions.buildWarningPolicy === false ? null : createBuildWarningSummary();
		const flush = (chunk: string, stream: 'stdout' | 'stderr') => {
			const combined = stream === 'stdout' ? stdoutRemainder + chunk : stderrRemainder + chunk;
			const parts = combined.split(/\r?\n/u);
			const complete = parts.slice(0, -1);
			if (stream === 'stdout') stdoutRemainder = parts.at(-1) ?? '';
			else stderrRemainder = parts.at(-1) ?? '';
			for (const line of complete) {
				const classified = warningSummary?.record(line, commandOptions.buildWarningPolicy || undefined);
				if (classified?.kind === 'allowed') {
					continue;
				}
				emitProgress(options, node, phase, line, stream);
			}
		};
		const timeout = commandOptions.timeoutMs
			? setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill('SIGTERM');
				reject(new Error(`${progressPrefix(node, phase)} ${displayCommand(command, args)} timed out after ${commandOptions.timeoutMs}ms`));
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
			if (stdoutRemainder) {
				const classified = warningSummary?.record(stdoutRemainder, commandOptions.buildWarningPolicy || undefined);
				if (classified?.kind !== 'allowed') emitProgress(options, node, phase, stdoutRemainder);
			}
			if (stderrRemainder) {
				const classified = warningSummary?.record(stderrRemainder, commandOptions.buildWarningPolicy || undefined);
				if (classified?.kind !== 'allowed') emitProgress(options, node, phase, stderrRemainder, 'stderr');
			}
			if (code === 0) {
				if (warningSummary) {
					for (const line of formatAllowedBuildWarnings(warningSummary.allowedWarnings)) {
						emitProgress(options, node, phase, line);
					}
				}
				resolvePromise({ stdout, stderr });
				return;
			}
			reject(new RepositorySaveError(
				prefixedOutput(node, phase, stderr)
				|| prefixedOutput(node, phase, stdout)
				|| `${progressPrefix(node, phase)} ${displayCommand(command, args)} failed with exit code ${code ?? 'unknown'}`,
				{
					details: {
						failingRepo: node.name,
						phase,
						command: displayCommand(command, args),
					},
				},
			));
		});
	});
}

export function packageScripts(packageJson: Record<string, unknown> | null) {
	const scripts = packageJson?.scripts;
	return scripts && typeof scripts === 'object' && !Array.isArray(scripts)
		? Object.fromEntries(Object.entries(scripts).map(([key, value]) => [key, String(value)]))
		: {};
}
