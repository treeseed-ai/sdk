import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectConfigSeedValues } from "../../../../operations/services/configuration/config-runtime.ts";
import { recordHostedDeploymentState } from "../../../../operations/services/hosting/deployment/deploy.ts";
import { PRODUCTION_BRANCH, STAGING_BRANCH } from "../../../../operations/services/operations/git-workflow.ts";
import { packageScriptPath } from "../../../../operations/services/agents/runtime-tools.ts";
import { currentBranch, gitStatusPorcelain } from "../../../../operations/services/treedx/workspaces/workspace-save.ts";
import { workspaceRoot } from "../../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { runRepositoryGit } from "../../../../operations/services/operations/git-runner.ts";
import { resolveWorkflowState } from "../../../../operations/workflow-state.ts";
import { runGuarantees } from "../../../../guarantees/index.ts";
import { classifyBranchRole, resolveWorkflowPaths } from "../../../policy.ts";
import type { ConfigInput, WorkflowContext, WorkflowNextStep, WorkflowOperationId } from "../../../../operations/workflow.ts";
import { WorkflowError, WorkflowErrorCode, WorkflowOperationHelpers } from '../../recovery/workflow-write.ts';
import { stringRecord } from '../../repositories/gates-for-saved-repository-reports.ts';

export async function runReleaseProductionGuarantees(
	root: string,
	helpers: WorkflowOperationHelpers,
	operation: Extract<WorkflowOperationId, 'release'>,
	sceneArtifacts?: 'full' | 'screenshots',
) {
	const environment = 'prod';
	if (process.env.TREESEED_WORKFLOW_RELEASE_GATES_MODE === 'skip') {
		return { ok: true, status: 'skipped' as const, environment, reason: 'release gates disabled' };
	}
	const env = {
		...helpers.context.env,
		...collectConfigSeedValues(root, environment, helpers.context.env),
	};
	env.TREESEED_ACCEPTANCE_SERVICE_ID ??= env.TREESEED_API_WEB_SERVICE_ID ?? env.TREESEED_WEB_SERVICE_ID;
	env.TREESEED_ACCEPTANCE_SERVICE_SECRET ??= env.TREESEED_API_WEB_SERVICE_SECRET ?? env.TREESEED_WEB_SERVICE_SECRET;
	if (!env.TREESEED_ACCEPTANCE_SERVICE_ID || !env.TREESEED_ACCEPTANCE_SERVICE_SECRET) {
		workflowError(operation, 'release_gate_failed', 'Final production release guarantees cannot run because production acceptance service credentials are missing.', {
			details: {
				environment,
				missing: [
					!env.TREESEED_ACCEPTANCE_SERVICE_ID ? 'TREESEED_ACCEPTANCE_SERVICE_ID' : null, 					!env.TREESEED_ACCEPTANCE_SERVICE_SECRET ? 'TREESEED_ACCEPTANCE_SERVICE_SECRET' : null,
				].filter((value): value is string => Boolean(value)),
			},
		});
	}
	helpers.write(`[${operation}][workflow] Running final production release guarantees against the fully deployed production environment.`);
	return await withContextEnv(env, async () => {
		const report = await runGuarantees({
			workspaceRoot: root,
			filter: { gate: 'smoke', status: 'active' },
			environment, 			evidenceTarget: 'release', 			sceneArtifacts,
		});
		if (!report.ok) {
			const diagnostics = report.diagnostics
				.filter((entry) => entry.severity === 'error')
				.slice(0, 20)
				.map((entry) => `${entry.code}: ${entry.message}${entry.sourcePath ? ` (${entry.sourcePath})` : ''}`);
			const failedGuarantees = report.results
				.filter((entry) => entry.status === 'failed' || entry.status === 'blocked')
				.slice(0, 20)
				.map((entry) => `${entry.id}: ${entry.status}`);
			workflowError(operation, 'release_gate_failed', [
				'Final production release guarantees failed after production deployment.', 				...failedGuarantees, 				...diagnostics,
				failedGuarantees.length === 0 && diagnostics.length === 0 ? `See ${report.outputRoot}` : null,
			].filter((line): line is string => Boolean(line)).join('\n'), {
				details: { environment, outputRoot: report.outputRoot, counts: report.counts, diagnostics: report.diagnostics },
			});
		}
		return {
			ok: report.ok, 			environment: report.environment, 			runId: report.runId, 			outputRoot: report.outputRoot, 			counts: report.counts,
		};
	});
}

export function recordHostedDeploymentStatesFromRootGates(
	root: string,
	rootRelease: Record<string, unknown> | null | undefined,
	workflowGates: unknown,
) {
	const gates = Array.isArray(workflowGates)
		? workflowGates.map((gate) => stringRecord(gate)).filter((gate): gate is Record<string, unknown> => Boolean(gate))
		: [];
	const releaseRecord = stringRecord(rootRelease) ?? {};
	const reports: Array<Record<string, unknown>> = [];
	const releaseTag = typeof releaseRecord.rootVersion === 'string' ? releaseRecord.rootVersion : null;
	for (const target of [
		{ scope: 'staging' as const, branch: STAGING_BRANCH, commit: releaseRecord.stagingCommit },
		{ scope: 'prod' as const, branch: releaseTag ?? PRODUCTION_BRANCH, commit: releaseRecord.releasedCommit },
	]) {
		const gate = gates.find((candidate) =>
			candidate.workflow === 'deploy.yml'
			&& candidate.branch === target.branch
			&& candidate.status === 'completed'
			&& candidate.conclusion === 'success');
		const timestamp = typeof gate?.updatedAt === 'string' && gate.updatedAt.trim() ? gate.updatedAt : null;
		if (!gate || !timestamp) {
			continue;
		}
		const state = recordHostedDeploymentState(root, {
			scope: target.scope, 			commit: typeof target.commit === 'string' ? target.commit : null, 			timestamp, 			workflow: gate.workflow, 			runId: gate.runId ?? null,
		});
		reports.push({
			scope: target.scope, 			branch: target.branch, 			commit: typeof target.commit === 'string' ? target.commit : null, 			timestamp: state.lastDeploymentTimestamp ?? timestamp, 			url: state.lastDeployedUrl ?? null, 			workflow: gate.workflow, 			runId: gate.runId ?? null,
		});
	}
	return reports;
}

export function ensureCommandReadiness(root: string) {
	if (process.env.TREESEED_COMMAND_READINESS_MODE === 'skip') {
		return {
			status: 'skipped', 			reason: 'disabled',
			checks: [],
			missing: [],
		};
	}
	const checks = [
		{ id: 'sdk', path: resolve(root, 'node_modules/@treeseed/sdk/package.json') },
		{ id: 'sdk-workflow-support', path: resolve(root, 'node_modules/@treeseed/sdk/dist/workflow-support.js') },
		{ id: 'core', path: resolve(root, 'node_modules/@treeseed/core/package.json') },
		{ id: 'agent-api', path: resolve(root, 'node_modules/@treeseed/agent/dist/api/index.js') },
		{ id: 'cli', path: resolve(root, 'node_modules/@treeseed/cli/package.json') },
		{ id: 'cli-entrypoint', path: resolve(root, 'node_modules/@treeseed/cli/dist/cli/main.js') },
		{ id: 'trsd-bin', path: resolve(root, 'node_modules/.bin/trsd') },
	];
	const missing = checks.filter((check) => !existsSync(check.path));
	const report = {
		status: missing.length === 0 ? 'passed' : 'failed',
		checks: checks.map((check) => ({ ...check, exists: existsSync(check.path) })),
		missing,
	};
	if (missing.length > 0) {
		workflowError('save', 'validation_failed', `Treeseed save restored workspace links, but command readiness failed.\n${missing.map((check) => `${check.id}: ${check.path}`).join('\n')}`, {
			details: report,
		});
	}
	return report;
}

export function ensureLocalStateExcluded(root: string) {
	const gitDir = runRepositoryGit(['rev-parse', '--git-dir'], { cwd: root, mode: 'read', allowFailure: true }).stdout.trim();
	if (!gitDir) return;
	const excludePath = resolve(root, gitDir, 'info', 'exclude');
	const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
	const requiredEntries = ['/.treeseed/config/', '/.treeseed/workflow/', '/.treeseed/state/', '/.treeseed/workspace-links.json'];
	const missing = requiredEntries.filter((entry) => !current.split(/\r?\n/u).includes(entry));
	if (missing.length === 0) return;
	mkdirSync(dirname(excludePath), { recursive: true });
	writeFileSync(
		excludePath,
		`${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${missing.join('\n')}\n`,
		'utf8',
	);
}

export function workflowError(
	operation: WorkflowOperationId,
	code: WorkflowErrorCode,
	message: string,
	options: { details?: Record<string, unknown>; exitCode?: number } = {},
): never {
	throw new WorkflowError(operation, code, message, options);
}

export function ageDays(lastCommitDate: string) {
	const timestamp = Date.parse(lastCommitDate);
	if (!Number.isFinite(timestamp)) return null;
	return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

export async function withContextEnv<T>(env: NodeJS.ProcessEnv | undefined, action: () => T | Promise<T>): Promise<T> {
	if (!env) {
		return await action();
	}

	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}

	try {
		return await action();
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

export function runNodeScript(scriptName: string, context: WorkflowContext, cwd: string, label: string) {
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName)], {
		cwd,
		env: { ...process.env, ...(context.env ?? {}) },
		stdio: 'inherit',
	});
	if (result.status !== 0) {
		throw new Error(`${label} failed.`);
	}
	return result;
}

export function renderWorkflowStep(step: WorkflowNextStep): WorkflowNextStep {
	return step;
}

export function normalizeConfigScopes(input: ConfigInput) {
	const requested = Array.isArray(input.target)
		? input.target
		: Array.isArray(input.environment)
			? input.environment
			: typeof input.target === 'string'
				? [input.target]
				: typeof input.environment === 'string'
					? [input.environment]
					: ['all'];

	if (requested.includes('all')) {
		return ['local', 'staging', 'prod'] as Array<'local' | 'staging' | 'prod'>;
	}

	return ['local', 'staging', 'prod'].filter((scope) => requested.includes(scope as never)) as Array<'local' | 'staging' | 'prod'>;
}

export function resolveWorkflowStateSnapshot(cwd: string) {
	return resolveWorkflowState(cwd);
}

export function resolveProjectRootOrThrow(operation: WorkflowOperationId, cwd: string) {
	const resolved = resolveWorkflowPaths(cwd);
	if (!resolved.tenantRoot) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires a Treeseed project. Run the command from inside a tenant or initialize one first.`);
	}
	return resolved.cwd;
}

export function resolveRepoState(repoDir: string) {
	const branchName = currentBranch(repoDir) || null;
	return {
		repoDir,
		branchName,
		branchRole: classifyBranchRole(branchName, repoDir),
		dirtyWorktree: gitStatusPorcelain(repoDir).length > 0,
	};
}

export type WorkflowRepoReport = {
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
	workflowGates: Array<Record<string, unknown>>;
	backMerge: Record<string, unknown> | null;
	changelog?: Record<string, unknown> | null;
	adminCommitSummary?: Record<string, unknown> | null;
};
