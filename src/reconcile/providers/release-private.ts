import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { findTreeseedPackageAdapter } from '../../operations/services/package-adapters.ts';
import { checkedOutTemplateRepositories } from '../../operations/services/managed-repositories.ts';
import { runTreeseedGitText } from '../../operations/services/git-runner.ts';
import type { TreeseedReconcileRunContext, TreeseedReconcileSelector, TreeseedReconcileTarget } from '../contracts.ts';

export async function runReleaseVerifyCommand(input: {
	tenantRoot: string;
	packageId: string;
	env?: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}) {
	const adapter = findTreeseedPackageAdapter(input.tenantRoot, input.packageId);
	if (!adapter) {
		throw new Error(`Package ${input.packageId} was not discovered.`);
	}
	const command = adapter.verifyCommands.release ?? adapter.verifyCommands.local;
	if (!command) {
		return {
			ok: true,
			skipped: true,
			reason: `${input.packageId} has no release verify command.`,
		};
	}
	const renderedCommand = [command.command, ...command.args].join(' ');
	input.onProgress?.(`Running ${input.packageId} release verification: ${renderedCommand}`);
	const started = Date.now();
	let stdout = '';
	let stderr = '';
	const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		const child = spawn(command.command, command.args, {
			cwd: command.cwd,
			env: { ...process.env, ...(input.env ?? {}) },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const heartbeat = setInterval(() => {
			input.onProgress?.(`Still running ${input.packageId} release verification after ${Math.round((Date.now() - started) / 1000)}s.`);
		}, 30_000);
		child.stdout?.on('data', (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on('data', (chunk) => {
			stderr += String(chunk);
		});
		child.on('error', (error) => {
			clearInterval(heartbeat);
			reject(error);
		});
		child.on('close', (status, signal) => {
			clearInterval(heartbeat);
			resolve({ status, signal });
		});
	});
	const elapsedSeconds = Math.round((Date.now() - started) / 1000);
	input.onProgress?.(`${input.packageId} release verification ${result.status === 0 ? 'passed' : 'failed'} in ${elapsedSeconds}s.`);
	return {
		ok: (result.status ?? 1) === 0,
		status: result.status,
		signal: result.signal,
		command,
		stdout,
		stderr,
	};
}

function runTemplateCommand(command: string, cwd: string, env?: NodeJS.ProcessEnv) {
	const result = spawnSync('bash', ['-lc', command], {
		cwd,
		env: { ...process.env, ...(env ?? {}) },
		encoding: 'utf8',
	});
	return {
		ok: (result.status ?? 1) === 0,
		status: result.status,
		command,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

export function runTemplateReleaseVerifyCommand(input: {
	tenantRoot: string;
	templateId: string;
	env?: NodeJS.ProcessEnv;
}) {
	const repo = checkedOutTemplateRepositories(input.tenantRoot)
		.find((candidate) => candidate.templateManifest?.id === input.templateId);
	if (!repo?.templateManifest) {
		throw new Error(`Template ${input.templateId} was not discovered.`);
	}
	const command = repo.templateManifest.verify.release ?? repo.templateManifest.verify.local;
	if (!command) {
		return {
			ok: true,
			skipped: true,
			reason: `${input.templateId} has no release verify command.`,
		};
	}
	return runTemplateCommand(command, repo.dir, input.env);
}

function gitText(repoDir: string, args: string[]) {
	return runTreeseedGitText(args, { cwd: repoDir, mode: 'mutate' }).trim();
}

function gitTextAllowFailure(repoDir: string, args: string[]) {
	try {
		return gitText(repoDir, args);
	} catch {
		return null;
	}
}

export function ensureTemplateReleaseTag(input: {
	tenantRoot: string;
	templateId: string;
	tagName: string;
}) {
	const repo = checkedOutTemplateRepositories(input.tenantRoot)
		.find((candidate) => candidate.templateManifest?.id === input.templateId);
	if (!repo?.templateManifest) {
		throw new Error(`Template ${input.templateId} was not discovered.`);
	}
	const head = gitText(repo.dir, ['rev-parse', 'HEAD']);
	const local = gitTextAllowFailure(repo.dir, ['rev-list', '-n', '1', input.tagName]);
	if (local && local !== head) {
		throw new Error(`Template tag ${input.tagName} already exists at ${local}, expected ${head}.`);
	}
	if (!local) {
		gitText(repo.dir, ['tag', '-a', input.tagName, head, '-m', `release: ${input.tagName}`]);
	}
	const remote = gitTextAllowFailure(repo.dir, ['ls-remote', 'origin', `refs/tags/${input.tagName}`])
		?.split(/\s+/u)[0] ?? null;
	if (remote && remote !== head) {
		throw new Error(`Remote template tag ${input.tagName} already exists at ${remote}, expected ${head}.`);
	}
	if (!remote && repo.hasOriginRemote) {
		gitText(repo.dir, ['push', 'origin', input.tagName]);
	}
	return {
		templateId: input.templateId,
		tagName: input.tagName,
		head,
		local: local ? 'existing' : 'created',
		remote: remote ? 'existing' : repo.hasOriginRemote ? 'pushed' : 'skipped-no-origin',
	};
}

export function writeReleaseRecord(input: {
	tenantRoot: string;
	recordPath: string;
	record: Record<string, unknown>;
}) {
	const absolutePath = resolve(input.tenantRoot, input.recordPath);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, `${JSON.stringify(input.record, null, 2)}\n`, 'utf8');
	return {
		path: absolutePath,
		record: input.record,
	};
}

export async function runHostedReconcileGate(input: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
	dryRun: boolean;
}) {
	const { reconcileTreeseedNestedTarget } = await import('../engine.ts');
	return reconcileTreeseedNestedTarget(input);
}

export async function runHostedVerifyGate(input: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
}) {
	const { verifyTreeseedNestedTarget } = await import('../engine.ts');
	return verifyTreeseedNestedTarget(input);
}
