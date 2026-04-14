import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
	applyTreeseedEnvironmentToProcess,
	applyTreeseedConfigValues,
	applyTreeseedSafeRepairs,
	assertTreeseedCommandEnvironment,
	checkTreeseedProviderConnections,
	collectTreeseedConfigContext,
	collectTreeseedPrintEnvReport,
	createDefaultTreeseedMachineConfig,
	ensureTreeseedActVerificationTooling,
	ensureTreeseedGitignoreEntries,
	finalizeTreeseedConfig,
	getTreeseedMachineConfigPaths,
	loadTreeseedMachineConfig,
	resolveTreeseedMachineEnvironmentValues,
	rotateTreeseedMachineKey,
	writeTreeseedLocalEnvironmentFiles,
	writeTreeseedMachineConfig,
} from '../operations/services/config-runtime.ts';
import { exportTreeseedCodebase } from '../operations/services/export-runtime.ts';
import {
	assertDeploymentInitialized,
	cleanupDestroyedState,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	destroyCloudflareResources,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
	provisionCloudflareResources,
	runRemoteD1Migrations,
	syncCloudflareSecrets,
	validateDeployPrerequisites,
	validateDestroyPrerequisites,
} from '../operations/services/deploy.ts';
import {
	assertCleanWorktree,
	assertFeatureBranch,
	branchExists,
	checkoutBranch,
	createDeprecatedTaskTag,
	createFeatureBranchFromStaging,
	currentManagedBranch,
	deleteLocalBranch,
	deleteRemoteBranch,
	ensureLocalBranchTracking,
	gitWorkflowRoot,
	listTaskBranches,
	mergeCurrentBranchIntoStaging,
	mergeStagingIntoMain,
	prepareReleaseBranches,
	PRODUCTION_BRANCH,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
	syncBranchWithOrigin,
	waitForStagingAutomation,
} from '../operations/services/git-workflow.ts';
import { loadCliDeployConfig, packageScriptPath, resolveWranglerBin } from '../operations/services/runtime-tools.ts';
import { runTenantDeployPreflight, runWorkspaceSavePreflight } from '../operations/services/save-deploy-preflight.ts';
import { collectCliPreflight } from '../operations/services/workspace-preflight.ts';
import {
	applyWorkspaceVersionChanges,
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	planWorkspaceReleaseBump,
	repoRoot,
} from '../operations/services/workspace-save.ts';
import { run, workspaceRoot } from '../operations/services/workspace-tools.ts';
import { resolveTreeseedWorkflowState } from '../workflow-state.ts';
import {
	classifyTreeseedBranchRole,
	resolveTreeseedWorkflowPaths,
} from './policy.ts';
import type {
	TreeseedCloseInput,
	TreeseedConfigInput,
	TreeseedDestroyInput,
	TreeseedExportInput,
	TreeseedReleaseInput,
	TreeseedSaveInput,
	TreeseedStageInput,
	TreeseedSwitchInput,
	TreeseedTaskBranchMetadata,
	TreeseedWorkflowContext,
	TreeseedWorkflowDevInput,
	TreeseedWorkflowNextStep,
	TreeseedWorkflowOperationId,
	TreeseedWorkflowResult,
} from '../workflow.ts';

type WorkflowWrite = NonNullable<TreeseedWorkflowContext['write']>;
type WorkflowStatePayload = ReturnType<typeof resolveTreeseedWorkflowState>;

export type TreeseedWorkflowErrorCode =
	| 'validation_failed'
	| 'merge_conflict'
	| 'missing_runtime_auth'
	| 'deployment_timeout'
	| 'confirmation_required'
	| 'unsupported_transport'
	| 'unsupported_state';

export class TreeseedWorkflowError extends Error {
	code: TreeseedWorkflowErrorCode;
	operation: TreeseedWorkflowOperationId;
	details?: Record<string, unknown>;
	exitCode?: number;

	constructor(
		operation: TreeseedWorkflowOperationId,
		code: TreeseedWorkflowErrorCode,
		message: string,
		options: { details?: Record<string, unknown>; exitCode?: number } = {},
	) {
		super(message);
		this.name = 'TreeseedWorkflowError';
		this.operation = operation;
		this.code = code;
		this.details = options.details;
		this.exitCode = options.exitCode;
	}
}

export type WorkflowOperationHelpers = {
	context: TreeseedWorkflowContext;
	cwd(): string;
	write: WorkflowWrite;
	runStatus(): Promise<TreeseedWorkflowResult<ReturnType<typeof resolveTreeseedWorkflowState>>>;
	runTasks(): Promise<TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[] }>>;
};

function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

function workflowError(
	operation: TreeseedWorkflowOperationId,
	code: TreeseedWorkflowErrorCode,
	message: string,
	options: { details?: Record<string, unknown>; exitCode?: number } = {},
): never {
	throw new TreeseedWorkflowError(operation, code, message, options);
}

function ageDays(lastCommitDate: string) {
	const timestamp = Date.parse(lastCommitDate);
	if (!Number.isFinite(timestamp)) return null;
	return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function withContextEnv<T>(env: NodeJS.ProcessEnv | undefined, action: () => T): T {
	if (!env) {
		return action();
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
		return action();
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

function runNodeScript(scriptName: string, context: TreeseedWorkflowContext, cwd: string, label: string) {
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

function renderWorkflowStep(step: TreeseedWorkflowNextStep): TreeseedWorkflowNextStep {
	return step;
}

function normalizeConfigScopes(input: TreeseedConfigInput) {
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

function resolveWorkflowStateSnapshot(cwd: string) {
	return resolveTreeseedWorkflowState(cwd);
}

function resolveProjectRootOrThrow(operation: TreeseedWorkflowOperationId, cwd: string) {
	const resolved = resolveTreeseedWorkflowPaths(cwd);
	if (!resolved.tenantRoot) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires a Treeseed project. Run the command from inside a tenant or initialize one first.`);
	}
	return resolved.cwd;
}

function resolveRepoState(repoDir: string) {
	const branchName = currentBranch(repoDir) || null;
	return {
		repoDir,
		branchName,
		branchRole: classifyTreeseedBranchRole(branchName, repoDir),
		dirtyWorktree: gitStatusPorcelain(repoDir).length > 0,
	};
}

function buildWorkflowResult<TPayload>(
	operation: TreeseedWorkflowOperationId,
	cwd: string,
	payload: TPayload,
	nextSteps?: TreeseedWorkflowNextStep[],
): TreeseedWorkflowResult<TPayload & { finalState: WorkflowStatePayload }> {
	return {
		ok: true,
		operation,
		payload: {
			...payload,
			finalState: resolveWorkflowStateSnapshot(cwd),
		},
		nextSteps,
	};
}

function ensureLocalReadinessOrThrow(operation: TreeseedWorkflowOperationId, tenantRoot: string) {
	const state = resolveWorkflowStateSnapshot(tenantRoot);
	if (!state.readiness.local.ready) {
		workflowError(
			operation,
			'validation_failed',
			[
				`Treeseed ${operation} requires the local environment to be configured.`,
				...state.readiness.local.blockers,
				'Run `treeseed config --environment local` first.',
			].join('\n'),
			{ details: { readiness: state.readiness.local } },
		);
	}
	return state;
}

function bumpRootPackageJson(root: string, level: string) {
	const packageJsonPath = resolve(root, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
	packageJson.version = incrementVersion(String(packageJson.version ?? '0.0.0'), level);
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	return String(packageJson.version);
}

function createNextSteps(steps: TreeseedWorkflowNextStep[]) {
	return steps.map(renderWorkflowStep);
}

function createStatusResult(cwd: string): TreeseedWorkflowResult<ReturnType<typeof resolveTreeseedWorkflowState>> {
	const state = resolveTreeseedWorkflowState(cwd);
	return {
		ok: true,
		operation: 'status',
		payload: state,
		nextSteps: createNextSteps(state.recommendations),
	};
}

function createTasksResult(cwd: string): TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[] }> {
	const tenantRoot = cwd;
	const repoDir = gitWorkflowRoot(tenantRoot);
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const dirty = gitStatusPorcelain(repoDir).length > 0;
	const tasks = listTaskBranches(repoDir).map((branch) => {
		const previewState = loadDeployState(tenantRoot, deployConfig, {
			target: createBranchPreviewDeployTarget(branch.name),
		});
		return {
			...branch,
			ageDays: ageDays(branch.lastCommitDate),
			dirtyCurrent: branch.current && dirty,
			preview: {
				enabled: previewState.previewEnabled === true || previewState.readiness?.initialized === true,
				url: previewState.lastDeployedUrl ?? null,
				lastDeploymentTimestamp: previewState.lastDeploymentTimestamp ?? null,
			},
		};
	});
	return { ok: true, operation: 'tasks', payload: { tasks } };
}

function maybePrint(write: WorkflowWrite, line: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!line) return;
	write(line, stream);
}

function ensureMessage(operation: TreeseedWorkflowOperationId, message: string | undefined, label: string) {
	const value = String(message ?? '').trim();
	if (!value) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires ${label}.`);
	}
	return value;
}

function toError(operation: TreeseedWorkflowOperationId, error: unknown): never {
	if (error instanceof TreeseedWorkflowError) {
		throw error;
	}
	if (error instanceof Error) {
		throw new TreeseedWorkflowError(operation, 'unsupported_state', error.message, {
			details: { name: error.name },
			exitCode: (error as { exitCode?: number }).exitCode,
		});
	}
	throw new TreeseedWorkflowError(operation, 'unsupported_state', String(error));
}

function previewStateFor(tenantRoot: string, branchName: string) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	return loadDeployState(tenantRoot, deployConfig, {
		target: createBranchPreviewDeployTarget(branchName),
	});
}

function deployBranchPreview(
	tenantRoot: string,
	branchName: string,
	context: TreeseedWorkflowContext,
	{ initialize }: { initialize: boolean },
) {
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging', override: true });
	assertTreeseedCommandEnvironment({ tenantRoot, scope: 'staging', purpose: 'deploy' });
	const target = createBranchPreviewDeployTarget(branchName);
	const existingState = previewStateFor(tenantRoot, branchName);

	if (initialize && !existingState.readiness?.initialized) {
		validateDeployPrerequisites(tenantRoot, { requireRemote: true });
		provisionCloudflareResources(tenantRoot, { target });
		syncCloudflareSecrets(tenantRoot, { target });
		runRemoteD1Migrations(tenantRoot, { target });
	} else {
		assertDeploymentInitialized(tenantRoot, { target });
		runRemoteD1Migrations(tenantRoot, { target });
	}

	runTenantDeployPreflight({ cwd: tenantRoot, scope: 'staging' });
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	runNodeScript('tenant-build', context, tenantRoot, 'tenant build');
	const deployResult = spawnSync(process.execPath, [resolveWranglerBin(), 'deploy', '--config', wranglerPath], {
		cwd: tenantRoot,
		env: { ...process.env, ...(context.env ?? {}) },
		stdio: 'inherit',
	});
	if ((deployResult.status ?? 1) !== 0) {
		workflowError('switch', 'unsupported_state', 'Preview deployment failed.', {
			exitCode: deployResult.status ?? 1,
			details: { branchName, wranglerPath },
		});
	}

	const state = finalizeDeploymentState(tenantRoot, { target });
	return {
		initialized: existingState.readiness?.initialized !== true,
		previewUrl: state.lastDeployedUrl ?? null,
		lastDeploymentTimestamp: state.lastDeploymentTimestamp ?? null,
		wranglerPath,
	};
}

function destroyPreviewIfPresent(tenantRoot: string, branchName: string) {
	const previewTarget = createBranchPreviewDeployTarget(branchName);
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const previewState = loadDeployState(tenantRoot, deployConfig, { target: previewTarget });
	if (previewState.readiness?.initialized) {
		applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging', override: true });
		validateDestroyPrerequisites(tenantRoot, { requireRemote: true });
		destroyCloudflareResources(tenantRoot, { target: previewTarget });
	}
	cleanupDestroyedState(tenantRoot, { target: previewTarget });
	return {
		performed: previewState.readiness?.initialized === true,
		state: previewState,
	};
}

function resolveDestroyConfirmation(
	context: TreeseedWorkflowContext,
	expected: string,
	input: TreeseedDestroyInput,
) {
	if (input.dryRun) {
		return true;
	}
	if (input.confirm === true) {
		return true;
	}
	if (typeof input.confirm === 'string') {
		return input.confirm === expected;
	}
	if (context.confirm) {
		return context.confirm(
			`Destroy Treeseed environment by confirming "${expected}"`,
			expected,
		);
	}
	return false;
}

function syncCurrentBranchToOrigin(operation: TreeseedWorkflowOperationId, repoDir: string, branch: string) {
	try {
		if (remoteBranchExists(repoDir, branch)) {
			run('git', ['pull', '--rebase', 'origin', branch], { cwd: repoDir });
			run('git', ['push', 'origin', branch], { cwd: repoDir });
			return {
				remoteBranchExisted: true,
				pulledRebase: true,
				pushed: true,
				createdRemoteBranch: false,
				conflicts: false,
			};
		}

		run('git', ['push', '-u', 'origin', branch], { cwd: repoDir });
		return {
			remoteBranchExisted: false,
			pulledRebase: false,
			pushed: true,
			createdRemoteBranch: true,
			conflicts: false,
		};
	} catch {
		const report = collectMergeConflictReport(repoDir);
		throw new TreeseedWorkflowError(operation, 'merge_conflict', formatMergeConflictReport(report, repoDir, branch), {
			details: { branch, report },
			exitCode: 12,
		});
	}
}

async function maybeAutoSaveCurrentTaskBranch(
	helpers: WorkflowOperationHelpers,
	operation: 'stage' | 'close',
	input: { message: string; autoSave?: boolean; verify?: boolean; preview?: boolean },
) {
	const tenantRoot = resolveProjectRootOrThrow(operation, helpers.cwd());
	const repoDir = gitWorkflowRoot(tenantRoot);
	const before = resolveRepoState(repoDir);
	if (!before.dirtyWorktree) {
		return { performed: false, save: null };
	}
	if (input.autoSave === false) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires a clean worktree or autoSave enabled.`);
	}

	const saveResult = await workflowSave(helpers, {
		message: operation === 'close' ? `close: ${input.message}` : input.message,
		verify: input.verify === true,
		refreshPreview: false,
		preview: input.preview,
	});
	return {
		performed: true,
		save: saveResult.payload,
	};
}

export async function workflowStatus(helpers: WorkflowOperationHelpers) {
	return withContextEnv(helpers.context.env, () => createStatusResult(helpers.cwd()));
}

export async function workflowTasks(helpers: WorkflowOperationHelpers) {
	return withContextEnv(helpers.context.env, () => createTasksResult(helpers.cwd()));
}

export async function workflowConfig(helpers: WorkflowOperationHelpers, input: TreeseedConfigInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('config', helpers.cwd());
			const scopes = normalizeConfigScopes(input);
			const sync = input.syncProviders ?? input.sync ?? 'all';
			const printEnv = input.printEnv === true;
			const revealSecrets = input.showSecrets === true;
			const printEnvOnly = input.printEnvOnly === true;
			const rotateMachineKeyFlag = input.rotateMachineKey === true;
			const repairs = input.repair === false ? [] : (resolveTreeseedWorkflowState(tenantRoot).deployConfigPresent ? applyTreeseedSafeRepairs(tenantRoot) : []);
			const toolHealth = ensureTreeseedActVerificationTooling({
				tenantRoot,
				installIfMissing: true,
				env: helpers.context.env,
				write: (line: string) => maybePrint(helpers.write, line),
			});

			ensureTreeseedGitignoreEntries(tenantRoot);
			const preflight = collectCliPreflight({ cwd: tenantRoot, requireAuth: false });
			const contextSnapshot = collectTreeseedConfigContext({
				tenantRoot,
				scopes,
				env: helpers.context.env,
			});

			if (printEnvOnly) {
				const reports = scopes.map((scope) => ({
					scope,
					environment: collectTreeseedPrintEnvReport({
						tenantRoot,
						scope,
						env: helpers.context.env,
						revealSecrets,
					}),
					provider: checkTreeseedProviderConnections({ tenantRoot, scope, env: helpers.context.env }),
				}));
				return {
					ok: true,
					operation: 'config',
					payload: {
						mode: 'print-env-only',
						scopes,
						sync,
						secretsRevealed: revealSecrets,
						reports,
						repairs,
						preflight,
						toolHealth,
					},
					nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Initialize the selected environment after reviewing the generated values.', input: { environment: scopes } },
					]),
				} satisfies TreeseedWorkflowResult<Record<string, unknown>>;
			}

			if (rotateMachineKeyFlag) {
				const result = rotateTreeseedMachineKey(tenantRoot);
				return {
					ok: true,
					operation: 'config',
					payload: {
						mode: 'rotate-machine-key',
						scopes,
						sync,
						keyPath: result.keyPath,
						repairs,
						preflight,
						toolHealth,
					},
					nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Inspect the regenerated local environment after the machine key rotation.', input: { environment: ['local'], printEnvOnly: true } },
					]),
				} satisfies TreeseedWorkflowResult<Record<string, unknown>>;
			}

			const explicitUpdates = Array.isArray((input as Record<string, unknown>).updates)
				? (input as Record<string, { scope: string; entryId: string; value: string; reused?: boolean }[]>).updates
					.map((update) => ({
						scope: update.scope as (typeof scopes)[number],
						entryId: String(update.entryId ?? ''),
						value: typeof update.value === 'string' ? update.value : '',
						reused: update.reused === true,
					}))
				: null;
			const autoUpdates = scopes.flatMap((scope) =>
				contextSnapshot.entriesByScope[scope].map((entry) => ({
					scope,
					entryId: entry.id,
					value: entry.effectiveValue,
					reused: entry.currentValue.length > 0 || entry.suggestedValue.length > 0,
				})),
			);
			const applyResult = applyTreeseedConfigValues({
				tenantRoot,
				updates: explicitUpdates ?? autoUpdates,
			});
			const finalizeResult = finalizeTreeseedConfig({
				tenantRoot,
				scopes,
				sync,
				env: helpers.context.env,
			});
			const reports = printEnv
				? scopes.map((scope) => ({
					scope,
					environment: collectTreeseedPrintEnvReport({
						tenantRoot,
						scope,
						env: helpers.context.env,
						revealSecrets,
					}),
					provider: finalizeResult.connectionChecks.find((report) => report.scope === scope) ?? checkTreeseedProviderConnections({ tenantRoot, scope, env: helpers.context.env }),
				}))
				: [];
			const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
			const state = resolveTreeseedWorkflowState(tenantRoot);
			return buildWorkflowResult(
				'config',
				tenantRoot,
				{
					mode: 'configure',
					scopes,
					sync,
					configPath,
					keyPath,
					repairs,
					preflight,
					toolHealth,
					context: contextSnapshot,
					result: {
						...applyResult,
						...finalizeResult,
					},
					reports,
					state,
					readiness: state.readiness,
				},
				createNextSteps([
					...(scopes.includes('local') ? [{ operation: 'dev', reason: 'Start the local Treeseed runtime on the initialized local environment.' }] : []),
					...(scopes.includes('staging') ? [{ operation: 'status', reason: 'Confirm staging readiness after initializing shared services.' }] : []),
					{ operation: 'switch', reason: 'Create or resume a task branch once the runtime foundation is ready.', input: { branch: 'feature/my-change', preview: true } },
				]),
			);
		});
	} catch (error) {
		toError('config', error);
	}
}

export async function workflowExport(helpers: WorkflowOperationHelpers, input: TreeseedExportInput = {}) {
	return await withContextEnv(helpers.context.env, async () => {
		const directory = resolve(helpers.context.cwd ?? helpers.cwd(), input.directory ?? '.');
		const exported = await exportTreeseedCodebase({ directory });
		return buildWorkflowResult('export', exported.tenantRoot, exported);
	});
}

export async function workflowSwitch(helpers: WorkflowOperationHelpers, input: TreeseedSwitchInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const tenantRoot = resolveProjectRootOrThrow('switch', helpers.cwd());
			const branchName = String(input.branch ?? input.branchName ?? '').trim();
			if (!branchName) {
				workflowError('switch', 'validation_failed', 'Treeseed switch requires a branch name.');
			}
			const preview = input.preview === true;
			const repoDir = gitWorkflowRoot(tenantRoot);
			const currentBranchName = currentManagedBranch(tenantRoot);
			let created = false;
			let resumed = false;
			let previewResult: Record<string, unknown> | null = null;

			if (currentBranchName === branchName) {
				resumed = true;
			} else if (!branchExists(repoDir, branchName) && !remoteBranchExists(repoDir, branchName)) {
				if (input.createIfMissing === false) {
					workflowError('switch', 'validation_failed', `Branch "${branchName}" does not exist locally or on origin.`);
				}
				const result = createFeatureBranchFromStaging(tenantRoot, branchName);
				pushBranch(result.repoDir, branchName, { setUpstream: true });
				created = true;
			} else {
				assertCleanWorktree(tenantRoot);
				ensureLocalBranchTracking(repoDir, branchName);
				checkoutBranch(repoDir, branchName);
				syncBranchWithOrigin(repoDir, branchName);
				resumed = true;
			}

			const stateAfterSwitch = resolveTreeseedWorkflowState(tenantRoot);
			if (preview && !stateAfterSwitch.preview.enabled) {
				previewResult = deployBranchPreview(tenantRoot, branchName, helpers.context, { initialize: true });
			}

			const state = resolveTreeseedWorkflowState(tenantRoot);
			return buildWorkflowResult(
				'switch',
				tenantRoot,
				{
					branchName,
					created,
					resumed,
					previewRequested: preview,
					preview: {
						enabled: state.preview.enabled,
						url: state.preview.url,
						lastDeploymentTimestamp: state.preview.lastDeploymentTimestamp,
					},
					previewResult,
					preconditions: {
						cleanWorktreeRequired: true,
						baseBranch: STAGING_BRANCH,
					},
				},
				createNextSteps([
					state.preview.enabled
						? { operation: 'save', reason: 'Persist and verify the current task branch, then refresh its preview deployment.', input: { message: 'describe your change', preview: true } }
						: { operation: 'dev', reason: 'Start the local development environment for this task branch.' },
					{ operation: 'stage', reason: 'Merge the task into staging once the task branch is verified.', input: { message: 'describe the resolution' } },
				]),
			);
		});
	} catch (error) {
		toError('switch', error);
	}
}

export async function workflowDev(helpers: WorkflowOperationHelpers, input: TreeseedWorkflowDevInput = {}) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			if (helpers.context.transport === 'api') {
				workflowError('dev', 'unsupported_transport', 'Treeseed dev is not supported over the HTTP workflow API.');
			}
			const tenantRoot = resolveProjectRootOrThrow('dev', helpers.cwd());
			const readiness = ensureLocalReadinessOrThrow('dev', tenantRoot);
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
			assertTreeseedCommandEnvironment({ tenantRoot, scope: 'local', purpose: 'dev' });
			const args = [packageScriptPath('tenant-dev')];
			if (input.watch) {
				args.push('--watch');
			}
			if (input.port !== undefined) {
				args.push('--port', String(input.port));
			}
			const env = { ...process.env, ...(helpers.context.env ?? {}) };
			if (input.background) {
				const child = spawn(process.execPath, args, {
					cwd: tenantRoot,
					env,
					stdio: input.stdio ?? 'inherit',
					detached: process.platform !== 'win32',
				});
				return buildWorkflowResult('dev', tenantRoot, {
					watch: input.watch === true,
					background: true,
					command: process.execPath,
					args,
					cwd: tenantRoot,
					pid: child.pid ?? null,
					exitCode: null,
					runtime: {
						mode: process.env.TREESEED_LOCAL_DEV_MODE ?? 'cloudflare',
						apiBaseUrl: process.env.TREESEED_API_BASE_URL ?? 'http://127.0.0.1:3000',
						webUrl: 'http://127.0.0.1:8787',
					},
					readiness: readiness.readiness.local,
				});
			}

			const result = spawnSync(process.execPath, args, {
				cwd: tenantRoot,
				env,
				stdio: input.stdio ?? 'inherit',
			});
			return buildWorkflowResult('dev', tenantRoot, {
				watch: input.watch === true,
				background: false,
				command: process.execPath,
				args,
				cwd: tenantRoot,
				pid: null,
				exitCode: result.status ?? 1,
				runtime: {
					mode: process.env.TREESEED_LOCAL_DEV_MODE ?? 'cloudflare',
					apiBaseUrl: process.env.TREESEED_API_BASE_URL ?? 'http://127.0.0.1:3000',
					webUrl: 'http://127.0.0.1:8787',
				},
				readiness: readiness.readiness.local,
			});
		});
	} catch (error) {
		toError('dev', error);
	}
}

export async function workflowSave(helpers: WorkflowOperationHelpers, input: TreeseedSaveInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const tenantRoot = resolveProjectRootOrThrow('save', helpers.cwd());
			const message = ensureMessage('save', input.message, 'a commit message');
			const optionsHotfix = input.hotfix === true;
			const root = workspaceRoot(tenantRoot);
			const gitRoot = repoRoot(root);
			const branch = currentBranch(gitRoot);
			const scope = branch === STAGING_BRANCH ? 'staging' : branch === PRODUCTION_BRANCH ? 'prod' : 'local';
			const beforeState = resolveTreeseedWorkflowState(root);

			applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope, override: true });

			if (!branch) {
				workflowError('save', 'validation_failed', 'Treeseed save requires an active git branch.');
			}
			if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
				workflowError('save', 'unsupported_state', 'Treeseed save is blocked on main unless --hotfix is explicitly set.');
			}

			try {
				originRemoteUrl(gitRoot);
			} catch {
				workflowError('save', 'validation_failed', 'Treeseed save requires an origin remote.');
			}

			if (input.verify !== false) {
				runWorkspaceSavePreflight({ cwd: root });
			}

			const hadMeaningfulChanges = hasMeaningfulChanges(gitRoot);
			let head = run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim();
			let commitCreated = false;

			if (hadMeaningfulChanges) {
				run('git', ['add', '-A'], { cwd: gitRoot });
				run('git', ['commit', '-m', message], { cwd: gitRoot });
				head = run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim();
				commitCreated = true;
			}

			const branchSync = syncCurrentBranchToOrigin('save', gitRoot, branch);

			let previewAction: Record<string, unknown> = { status: 'skipped' };
			if (beforeState.branchRole === 'feature' && branch) {
				if (input.preview === true) {
					previewAction = {
						status: beforeState.preview.enabled ? 'refreshed' : 'created',
						details: deployBranchPreview(root, branch, helpers.context, { initialize: !beforeState.preview.enabled }),
					};
				} else if (input.refreshPreview !== false && beforeState.preview.enabled) {
					previewAction = {
						status: 'refreshed',
						details: deployBranchPreview(root, branch, helpers.context, { initialize: false }),
					};
				}
			}

			return buildWorkflowResult(
				'save',
				root,
				{
					branch,
					scope,
					hotfix: optionsHotfix,
					message,
					commitSha: head,
					commitCreated,
					noChanges: !hadMeaningfulChanges,
					branchSync,
					previewAction,
					mergeConflict: null,
				},
				createNextSteps([
					branch === STAGING_BRANCH
						? { operation: 'release', reason: 'Promote the validated staging branch into production.', input: { bump: 'patch' } }
						: branch === PRODUCTION_BRANCH
							? { operation: 'status', reason: 'Inspect production state after the explicit hotfix save.' }
							: { operation: 'stage', reason: 'Merge the verified task branch into staging.', input: { message: 'describe the resolution' } },
				]),
			);
		});
	} catch (error) {
		toError('save', error);
	}
}

export async function workflowClose(helpers: WorkflowOperationHelpers, input: TreeseedCloseInput) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('close', helpers.cwd());
			const message = ensureMessage('close', input.message, 'a close reason');
			const autoSave = await maybeAutoSaveCurrentTaskBranch(helpers, 'close', {
				message,
				autoSave: input.autoSave,
			});
			const featureBranch = assertFeatureBranch(tenantRoot);
			const repoDir = gitWorkflowRoot(tenantRoot);
			assertCleanWorktree(tenantRoot);

			const previewCleanup = input.deletePreview === false
				? { performed: false }
				: destroyPreviewIfPresent(tenantRoot, featureBranch);
			const deprecatedTag = createDeprecatedTaskTag(repoDir, featureBranch, `close: ${message}`);
			const remoteDeleted = input.deleteBranch === false ? false : deleteRemoteBranch(repoDir, featureBranch);
			syncBranchWithOrigin(repoDir, STAGING_BRANCH);
			if (input.deleteBranch !== false) {
				deleteLocalBranch(repoDir, featureBranch);
			}

			return buildWorkflowResult(
				'close',
				tenantRoot,
				{
					branchName: featureBranch,
					message,
					autoSaved: autoSave.performed,
					autoSaveResult: autoSave.save,
					deprecatedTag,
					previewCleanup,
					remoteDeleted,
					localDeleted: input.deleteBranch !== false,
					finalBranch: currentBranch(repoDir) || STAGING_BRANCH,
				},
				createNextSteps([
					{ operation: 'tasks', reason: 'Inspect the remaining task branches after closing this one.' },
				]),
			);
		});
	} catch (error) {
		toError('close', error);
	}
}

export async function workflowStage(helpers: WorkflowOperationHelpers, input: TreeseedStageInput) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('stage', helpers.cwd());
			const message = ensureMessage('stage', input.message, 'a resolution message');
			const autoSave = await maybeAutoSaveCurrentTaskBranch(helpers, 'stage', {
				message,
				autoSave: input.autoSave,
			});
			const featureBranch = assertFeatureBranch(tenantRoot);
			runWorkspaceSavePreflight({ cwd: tenantRoot });
			let repoDir: string;
			try {
				repoDir = mergeCurrentBranchIntoStaging(tenantRoot, featureBranch);
			} catch (error) {
				const report = collectMergeConflictReport(gitWorkflowRoot(tenantRoot));
				throw new TreeseedWorkflowError('stage', 'merge_conflict', formatMergeConflictReport(report, gitWorkflowRoot(tenantRoot), STAGING_BRANCH), {
					details: { branch: featureBranch, report, originalError: error instanceof Error ? error.message : String(error) },
					exitCode: 12,
				});
			}
			const stagingWait = input.waitForStaging === false
				? { status: 'skipped', reason: 'disabled' }
				: waitForStagingAutomation(repoDir);
			const previewCleanup = input.deletePreview === false
				? { performed: false }
				: destroyPreviewIfPresent(tenantRoot, featureBranch);
			const deprecatedTag = createDeprecatedTaskTag(repoDir, featureBranch, `stage: ${message}`);
			const remoteDeleted = input.deleteBranch === false ? false : deleteRemoteBranch(repoDir, featureBranch);
			if (input.deleteBranch !== false) {
				deleteLocalBranch(repoDir, featureBranch);
			}

			return buildWorkflowResult(
				'stage',
				tenantRoot,
				{
					branchName: featureBranch,
					mergeTarget: STAGING_BRANCH,
					message,
					autoSaved: autoSave.performed,
					autoSaveResult: autoSave.save,
					deprecatedTag,
					stagingWait,
					previewCleanup,
					remoteDeleted,
					localDeleted: input.deleteBranch !== false,
					finalBranch: currentBranch(repoDir) || STAGING_BRANCH,
				},
				createNextSteps([
					{ operation: 'release', reason: 'Promote the updated staging branch into production when ready.', input: { bump: 'patch' } },
					{ operation: 'status', reason: 'Inspect staging readiness after the task branch merge.' },
				]),
			);
		});
	} catch (error) {
		toError('stage', error);
	}
}

export async function workflowRelease(helpers: WorkflowOperationHelpers, input: TreeseedReleaseInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const level = input.bump ?? 'patch';
			const root = resolveProjectRootOrThrow('release', helpers.cwd());
			const gitRoot = repoRoot(root);
			prepareReleaseBranches(root);
			applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope: 'staging', override: true });
			runWorkspaceSavePreflight({ cwd: root });
			const plan = planWorkspaceReleaseBump(level, root);
			applyWorkspaceVersionChanges(plan);
			const rootVersion = bumpRootPackageJson(root, level);

			run('git', ['checkout', STAGING_BRANCH], { cwd: gitRoot });
			run('git', ['add', '-A'], { cwd: gitRoot });
			run('git', ['commit', '-m', `release: ${level} bump`], { cwd: gitRoot });
			pushBranch(gitRoot, STAGING_BRANCH);
			mergeStagingIntoMain(root);
			const releasedCommit = run('git', ['rev-parse', PRODUCTION_BRANCH], { cwd: gitRoot, capture: true }).trim();
			run('git', ['tag', '-a', rootVersion, '-m', `release: ${rootVersion}`], { cwd: gitRoot });
			run('git', ['push', 'origin', rootVersion], { cwd: gitRoot });
			syncBranchWithOrigin(gitRoot, STAGING_BRANCH);

			return buildWorkflowResult(
				'release',
				root,
				{
					level,
					rootVersion,
					releaseTag: rootVersion,
					releasedCommit,
					stagingBranch: STAGING_BRANCH,
					productionBranch: PRODUCTION_BRANCH,
					touchedPackages: [...plan.touched],
					finalBranch: currentBranch(gitRoot) || STAGING_BRANCH,
					pushStatus: {
						stagingPushed: true,
						productionPushed: true,
						tagPushed: true,
					},
				},
				createNextSteps([
					{ operation: 'status', reason: 'Inspect release readiness and production state after the promotion.' },
				]),
			);
		});
	} catch (error) {
		toError('release', error);
	}
}

export async function workflowDestroy(helpers: WorkflowOperationHelpers, input: TreeseedDestroyInput) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			const tenantRoot = helpers.cwd();
			const scope = String(input.environment ?? input.target ?? '');
			if (!scope) {
				workflowError('destroy', 'validation_failed', 'Treeseed destroy requires an environment target.');
			}
			const target = createPersistentDeployTarget(scope);
			const dryRun = input.dryRun === true;
			const force = input.force === true;
			const destroyRemote = input.destroyRemote !== false;
			const destroyLocal = input.destroyLocal !== false;
			const removeBuildArtifacts = input.removeBuildArtifacts === true;
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });
			assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose: 'destroy' });
			const deployConfig = validateDestroyPrerequisites(tenantRoot, { requireRemote: !dryRun && destroyRemote });
			const state = loadDeployState(tenantRoot, deployConfig, { target });
			const expectedConfirmation = deployConfig.slug;
			const confirmed = await Promise.resolve(resolveDestroyConfirmation(helpers.context, expectedConfirmation, input));
			if (!confirmed) {
				workflowError('destroy', 'confirmation_required', `Destroy confirmation required. Re-run with confirm="${expectedConfirmation}".`);
			}

			const result = destroyRemote
				? destroyCloudflareResources(tenantRoot, { dryRun, force, target })
				: null;
			if (!dryRun && destroyLocal) {
				cleanupDestroyedState(tenantRoot, { target, removeBuildArtifacts });
			}

			return {
				ok: true,
				operation: 'destroy',
				payload: {
					scope,
					dryRun,
					force,
					destroyRemote,
					destroyLocal,
					removeBuildArtifacts,
					expectedConfirmation,
					stateSummary: {
						workerName: state.workerName,
						lastDeploymentTimestamp: state.lastDeploymentTimestamp ?? null,
					},
					remoteResult: result,
				},
				nextSteps: createNextSteps([
					{ operation: 'config', reason: 'Recreate the destroyed environment before using it again.', input: { environment: [scope] } },
					{ operation: 'status', reason: 'Confirm the environment teardown state and any remaining local runtime setup.' },
				]),
			};
		});
	} catch (error) {
		toError('destroy', error);
	}
}
