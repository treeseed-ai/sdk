import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { type GitHubActionsWorkflowGate } from "../../../operations/services/repositories/github-actions-verification.ts";
import { discoverPackageAdapters } from "../../../operations/services/reconciliation/package-adapters.ts";
import { collectInternalDevReferenceIssues } from "../../../operations/services/packages/package-reference-policy.ts";
import { run, workspaceRoot } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { releaseWorkflowLock, updateWorkflowRunJournal } from "../../runs.ts";
import { checkedOutWorkspacePackageRepos } from "../../session.ts";
import type { WorkflowRecovery } from "../../../operations/workflow.ts";
import { WorkflowError, runGit } from './workflow-write.ts';
import { workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { workflowFileExists } from '../projects/projects-core/connect-market-project.ts';
import { hostedDeployGate } from '../packages/normalize-release-candidate-mode.ts';

export function failWorkflowRun(
	root: string,
	runId: string,
	error: unknown,
	recovery?: WorkflowRecovery | null,
) {
	const message = error instanceof Error ? error.message : String(error);
	const code = error instanceof WorkflowError ? error.code : 'unsupported_state';
	const details = error instanceof WorkflowError
		? {
			...(error.details ?? {}),
			recovery: recovery ?? error.details?.recovery ?? null,
		}
		: recovery
			? { recovery }
			: null;
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		status: 'failed',
		failure: {
			code, 			message, 			details, 			at: new Date().toISOString(),
		},
	}));
	releaseWorkflowLock(root, runId);
}

export function validatePackageReleaseWorkflows(root: string, packageNames: string[]) {
	const missing = checkedOutWorkspacePackageRepos(root)
		.filter((pkg) => packageNames.includes(pkg.name))
		.map((pkg) => ({ pkg, workflow: releaseWorkflowForPackage(root, pkg.name) }))
		.filter((entry) => !existsSync(resolve(entry.pkg.dir, '.github/workflows', entry.workflow)))
		.map((entry) => `${entry.pkg.name} (${entry.workflow})`);
	if (missing.length > 0) {
		workflowError('release', 'workflow_contract_missing', `Treeseed release requires package release workflows in: ${missing.join(', ')}.`, {
			details: {
				missing,
			},
		});
	}
}

export function releaseWorkflowForPackage(root: string, packageName: string) {
	const adapter = discoverPackageAdapters(root).find((entry) => entry.id === packageName || entry.name === packageName);
	const configured = typeof adapter?.metadata?.dockerImageReleaseWorkflow === 'string'
		? adapter.metadata.dockerImageReleaseWorkflow
		: null;
	return configured && configured.trim()
		? configured.trim().replace(/^\.github\/workflows\//u, '')
		: 'publish.yml';
}

export function productionDeployWorkflowForPackage(root: string, packageName: string) {
	const adapter = discoverPackageAdapters(root).find((entry) => entry.id === packageName || entry.name === packageName);
	if (adapter?.capabilities.deploy !== true) {
		return null;
	}
	const repoPath = adapter?.dir;
	if (!repoPath || !existsSync(resolve(repoPath, 'treeseed.site.yaml'))) {
		return null;
	}
	if (!workflowFileExists(repoPath, 'deploy.yml')) {
		return null;
	}
	return 'deploy.yml';
}

export function tagCommitSha(repoDir: string, tagName: string) {
	try {
		return runGit(['rev-list', '-n', '1', tagName], { cwd: repoDir, capture: true }).trim();
	} catch {
		return '';
	}
}

export function productionPackageDeployGates(root: string, versions: Map<string, string>): GitHubActionsWorkflowGate[] {
	return discoverPackageAdapters(root).flatMap((adapter) => {
		const name = adapter.id;
		const version = versions.get(name);
		const path = adapter.dir;
		const workflow = productionDeployWorkflowForPackage(root, name);
		if (!name || !version || !path || !workflow) {
			return [];
		}
		const headSha = tagCommitSha(path, version);
		if (!headSha) {
			workflowError('release', 'github_workflow_failed', `${name} ${workflow} cannot be checked because release tag ${version} is missing locally.`, {
				details: { packageName: name, workflow, version, repoPath: path },
			});
		}
		return [hostedDeployGate({
			name, 			repoPath: path, 			workflow, 			branch: version, 			headSha,
		})];
	});
}

export async function prepareAdapterReleaseMetadata(root: string, pkg: { name: string; dir: string }, version: string) {
	const adapter = discoverPackageAdapters(root).find((entry) => entry.id === pkg.name || entry.name === pkg.name);
	if (adapter?.kind === 'beam-elixir-rust' && existsSync(resolve(pkg.dir, 'scripts', 'bump-release-version.ts'))) {
		const tsx = resolve(root, 'node_modules/.bin/tsx');
		if (!existsSync(tsx)) {
			throw new Error(`TreeSeed release requires the workspace tsx executable at ${tsx}. Run trsd install and restore workspace dependencies before retrying.`);
		}
		run(tsx, ['scripts/bump-release-version.ts', version], { cwd: pkg.dir });
		return { status: 'updated', adapter: adapter.id, command: `${tsx} scripts/bump-release-version.ts` };
	}
	if (existsSync(resolve(pkg.dir, 'package.json'))) {
		return {
			status: 'npm-install', 			adapter: adapter?.id ?? pkg.name, 			...await runReleaseNpmInstall(pkg.dir, { workspaceRoot: root }),
		};
	}
	return { status: 'skipped', adapter: adapter?.id ?? pkg.name, reason: 'no package metadata updater' };
}

export function validateStagingWorkflowContracts(root: string) {
	if (process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return;
	}
	const missing: string[] = [];
	for (const fileName of ['verify.yml']) {
		if (!existsSync(resolve(root, '.github', 'workflows', fileName))) {
			missing.push(fileName);
		}
	}
	if (missing.length > 0) {
		workflowError('stage', 'workflow_contract_missing', `Treeseed stage requires standardized root workflows: ${missing.join(', ')}.`, {
			details: { missing },
		});
	}
}

export function shouldSkipReleaseInstall() {
	return process.env.TREESEED_SAVE_NPM_INSTALL_MODE === 'skip';
}

export function npmCommandForWorkflowSpawn(args: string[]) {
	if (process.platform === 'win32') {
		return { command: 'npm', args };
	}
	return {
		command: 'bash',
		args: [
			'-lc', 			'ulimit -n 65535 2>/dev/null || ulimit -n 32768 2>/dev/null || ulimit -n 16384 2>/dev/null || true; exec npm "$@"', 			'npm-fd-guard', 			...args,
		],
	};
}

export function lockfileRootMatchesManifest(repoDir: string) {
	try {
		const manifest = JSON.parse(readFileSync(resolve(repoDir, 'package.json'), 'utf8')) as Record<string, any>;
		const lockfile = JSON.parse(readFileSync(resolve(repoDir, 'package-lock.json'), 'utf8')) as { packages?: Record<string, Record<string, any>> };
		const root = lockfile.packages?.[''];
		if (!root || root.version !== manifest.version) return false;
		for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
			const expected = manifest[field] ?? {};
			const observed = root[field] ?? {};
			if (JSON.stringify(expected) !== JSON.stringify(observed)) return false;
		}
		return true;
	} catch {
		return false;
	}
}

export function waitForReleaseInstall(
	command: string,
	args: string[],
	repoDir: string,
	attempt: number,
) {
	return new Promise<{ status: number | null; detail: string }>((resolvePromise) => {
		const startedAt = Date.now();
		let settled = false;
		const child = spawn(command, args, {
			cwd: repoDir,
			env: {
				...process.env, 				npm_config_audit: 'false', 				npm_config_fetch_retries: '2', 				npm_config_fund: 'false', 				npm_config_foreground_scripts: 'false', 				npm_config_loglevel: 'warn', 				npm_config_maxsockets: '4', 				npm_config_prefer_offline: 'true', 				npm_config_progress: 'false',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const output: Buffer[] = [];
		child.stdout?.on('data', (chunk) => output.push(Buffer.from(chunk)));
		child.stderr?.on('data', (chunk) => output.push(Buffer.from(chunk)));
		const heartbeat = setInterval(() => {
			process.stderr.write(`[release][restore] repository=${repoDir} phase=package-lock attempt=${attempt} elapsed=${Math.ceil((Date.now() - startedAt) / 1000)}s\n`);
		}, 15_000);
		child.once('close', (status) => {
			if (settled) return;
			settled = true;
			clearInterval(heartbeat);
			resolvePromise({ status, detail: Buffer.concat(output).toString('utf8').trim() });
		});
		child.once('error', (error) => {
			if (settled) return;
			settled = true;
			clearInterval(heartbeat);
			output.push(Buffer.from(error.message));
			resolvePromise({ status: null, detail: Buffer.concat(output).toString('utf8').trim() });
		});
	});
}

export async function runReleaseNpmInstall(repoDir: string, options: { workspaceRoot?: string } = {}) {
	if (shouldSkipReleaseInstall()) {
		return { status: 'skipped', reason: 'disabled' };
	}
	if (repoDir === options.workspaceRoot && lockfileRootMatchesManifest(repoDir)) {
		return { status: 'skipped', reason: 'root-lockfile-already-matches', attempts: 0 };
	}
	const baseArgs = ['install', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund'];
	const propagationDelaysMs = [15_000, 30_000, 60_000, 120_000, 180_000];
	const startedAt = Date.now();
	let lastDetail = '';
	for (let attempt = 1; attempt <= propagationDelaysMs.length + 1; attempt += 1) {
		const args = [...baseArgs, attempt === 1 ? '--prefer-offline' : '--prefer-online'];
		const spawnCommand = npmCommandForWorkflowSpawn(args);
		process.stderr.write(`[release][restore] repository=${repoDir} phase=package-lock attempt=${attempt} elapsed=${Math.ceil((Date.now() - startedAt) / 1000)}s\n`);
		const result = await waitForReleaseInstall(spawnCommand.command, spawnCommand.args, repoDir, attempt);
		if (result.status === 0) {
			return { status: 'completed', reason: null, attempts: attempt };
		}
		lastDetail = result.detail;
		const propagationDelayMs = propagationDelaysMs[attempt - 1];
		if (!/No matching version found|notarget|ETARGET|E404/u.test(lastDetail) || propagationDelayMs == null) break;
		let remainingMs = propagationDelayMs;
		while (remainingMs > 0) {
			process.stderr.write(`[release][restore] repository=${repoDir} phase=registry-propagation nextAttempt=${attempt + 1} remaining=${Math.ceil(remainingMs / 1000)}s elapsed=${Math.ceil((Date.now() - startedAt) / 1000)}s\n`);
			const sliceMs = Math.min(15_000, remainingMs);
			await new Promise((resolvePromise) => setTimeout(resolvePromise, sliceMs));
			remainingMs -= sliceMs;
		}
	}
	throw new Error(lastDetail || `npm ${baseArgs.join(' ')} failed`);
}

export function pathIsWithin(parent: string, candidate: string) {
	const path = relative(parent, candidate);
	return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export function assertNoInternalDevReferencesForRepo(root: string, repoDir: string, packageNames: Set<string>) {
	const issues = collectInternalDevReferenceIssues(root, packageNames)
		.filter((issue) => {
			if (!pathIsWithin(repoDir, issue.filePath)) return false;
			if (repoDir !== root) return true;
			return !relative(root, issue.filePath).includes('/');
		});
	if (issues.length === 0) return;
	const rendered = issues
		.map((issue) => `${issue.filePath}${issue.field ? ` ${issue.field}.${issue.dependencyName}` : ''}: ${issue.reason} ${issue.spec}`)
		.join('\n');
	throw new Error(`Stable release still contains internal Git/dev dependency references.\n${rendered}`);
}
