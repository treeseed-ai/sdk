import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
	applyTreeseedEnvironmentToProcess,
	assertTreeseedCommandEnvironment,
	checkTreeseedProviderConnections,
	createDefaultTreeseedMachineConfig,
	ensureTreeseedGitignoreEntries,
	formatTreeseedConfigEnvironmentReport,
	formatTreeseedProviderConnectionReport,
	getTreeseedMachineConfigPaths,
	loadTreeseedMachineConfig,
	resolveTreeseedMachineEnvironmentValues,
	rotateTreeseedMachineKey,
	runTreeseedConfigWizard,
	writeTreeseedLocalEnvironmentFiles,
	writeTreeseedMachineConfig,
} from '../operations/services/config-runtime.ts';
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
import type {
	TreeseedCloseInput,
	TreeseedConfigInput,
	TreeseedDestroyInput,
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

function runChild(command: string, args: string[], context: TreeseedWorkflowContext, cwd: string, label: string) {
	const result = spawnSync(command, args, {
		cwd,
		env: { ...process.env, ...(context.env ?? {}) },
		stdio: 'inherit',
	});
	if (result.status !== 0) {
		workflowError('dev', 'unsupported_state', `${label} failed.`, { exitCode: result.status ?? 1 });
	}
	return result;
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

type TreeseedRepairAction = {
	id: string;
	detail: string;
};

function dedupeRepairActions(actions: TreeseedRepairAction[]) {
	const seen = new Set<string>();
	return actions.filter((action) => {
		if (seen.has(action.id)) return false;
		seen.add(action.id);
		return true;
	});
}

function applyTreeseedSafeRepairs(tenantRoot: string): TreeseedRepairAction[] {
	const actions: TreeseedRepairAction[] = [];
	ensureTreeseedGitignoreEntries(tenantRoot);
	actions.push({ id: 'gitignore', detail: 'Ensured Treeseed gitignore entries are present.' });

	const envLocalPath = resolve(tenantRoot, '.env.local');
	const envLocalExamplePath = resolve(tenantRoot, '.env.local.example');
	if (!existsSync(envLocalPath) && existsSync(envLocalExamplePath)) {
		copyFileSync(envLocalExamplePath, envLocalPath);
		actions.push({ id: 'env-local', detail: 'Created .env.local from .env.local.example.' });
	}

	const deployConfig = loadCliDeployConfig(tenantRoot);
	const { configPath } = getTreeseedMachineConfigPaths(tenantRoot);
	if (!existsSync(configPath)) {
		const machineConfig = createDefaultTreeseedMachineConfig({
			tenantRoot,
			deployConfig,
			tenantConfig: undefined,
		});
		writeTreeseedMachineConfig(tenantRoot, machineConfig);
		actions.push({ id: 'machine-config', detail: 'Created the default Treeseed machine config.' });
	}

	resolveTreeseedMachineEnvironmentValues(tenantRoot, 'local');
	actions.push({ id: 'machine-key', detail: 'Ensured the Treeseed machine key exists.' });

	const machineConfig = loadTreeseedMachineConfig(tenantRoot);
	writeTreeseedMachineConfig(tenantRoot, machineConfig);
	writeTreeseedLocalEnvironmentFiles(tenantRoot);
	actions.push({ id: 'local-env', detail: 'Regenerated .env.local and .dev.vars from the current machine config.' });

	for (const scope of ['local', 'staging', 'prod'] as const) {
		const target = createPersistentDeployTarget(scope);
		const state = loadDeployState(tenantRoot, deployConfig, { target });
		if (state.readiness?.initialized || scope === 'local') {
			ensureGeneratedWranglerConfig(tenantRoot, { target });
			actions.push({ id: `wrangler-${scope}`, detail: `Regenerated the ${scope} generated Wrangler config.` });
		}
	}

	return dedupeRepairActions(actions);
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

export async function workflowStatus(helpers: WorkflowOperationHelpers) {
	return withContextEnv(helpers.context.env, () => createStatusResult(helpers.cwd()));
}

export async function workflowTasks(helpers: WorkflowOperationHelpers) {
	return withContextEnv(helpers.context.env, () => createTasksResult(helpers.cwd()));
}

export async function workflowConfig(helpers: WorkflowOperationHelpers, input: TreeseedConfigInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = helpers.cwd();
			const scopes = normalizeConfigScopes(input);
			const sync = input.syncProviders ?? input.sync ?? 'all';
			const printEnv = input.printEnv === true;
			const revealSecrets = input.showSecrets === true;
			const printEnvOnly = input.printEnvOnly === true;
			const rotateMachineKeyFlag = input.rotateMachineKey === true;
			const repairs = input.repair === false ? [] : (resolveTreeseedWorkflowState(tenantRoot).deployConfigPresent ? applyTreeseedSafeRepairs(tenantRoot) : []);

			ensureTreeseedGitignoreEntries(tenantRoot);
			const preflight = collectCliPreflight({ cwd: tenantRoot, requireAuth: false });

			if (printEnvOnly) {
				const reports = scopes.map((scope) => ({
					scope,
					environmentReport: formatTreeseedConfigEnvironmentReport({
						tenantRoot,
						scope,
						env: helpers.context.env,
						revealSecrets,
					}),
					providerReport: formatTreeseedProviderConnectionReport(
						checkTreeseedProviderConnections({ tenantRoot, scope, env: helpers.context.env }),
					),
				}));
				for (const report of reports) {
					maybePrint(helpers.write, report.environmentReport);
					maybePrint(helpers.write, report.providerReport);
				}
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
					},
					nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Inspect the regenerated local environment after the machine key rotation.', input: { environment: ['local'], printEnvOnly: true } },
					]),
				} satisfies TreeseedWorkflowResult<Record<string, unknown>>;
			}

			const wizardResult = await runTreeseedConfigWizard({
				tenantRoot,
				scopes,
				sync,
				authStatus: preflight.checks.auth,
				env: helpers.context.env,
				useInk: input.nonInteractive === true ? false : (process.stdin.isTTY && process.stdout.isTTY),
				printEnv,
				revealSecrets,
				write: (line: string) => maybePrint(helpers.write, line),
				prompt: async (message: string) => {
					if (input.nonInteractive === true) {
						return '';
					}
					return String(await (helpers.context.prompt?.(message) ?? ''));
				},
			});

			writeTreeseedLocalEnvironmentFiles(tenantRoot);
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
			const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
			const state = resolveTreeseedWorkflowState(tenantRoot);
			return {
				ok: true,
				operation: 'config',
				payload: {
					mode: 'configure',
					scopes,
					sync,
					configPath,
					keyPath,
					repairs,
					preflight,
					result: wizardResult,
					state,
				},
				nextSteps: createNextSteps([
					...(scopes.includes('local') ? [{ operation: 'dev', reason: 'Start the local Treeseed runtime on the initialized local environment.' }] : []),
					...(scopes.includes('staging') ? [{ operation: 'status', reason: 'Confirm staging readiness after initializing shared services.' }] : []),
					{ operation: 'switch', reason: 'Create or resume a task branch once the runtime foundation is ready.', input: { branch: 'feature/my-change', preview: true } },
				]),
			} satisfies TreeseedWorkflowResult<Record<string, unknown>>;
		});
	} catch (error) {
		toError('config', error);
	}
}

export async function workflowSwitch(helpers: WorkflowOperationHelpers, input: TreeseedSwitchInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const tenantRoot = helpers.cwd();
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
			return {
				ok: true,
				operation: 'switch',
				payload: {
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
					state,
				},
				nextSteps: createNextSteps([
					state.preview.enabled
						? { operation: 'save', reason: 'Persist and verify the current task branch, then refresh its preview deployment.', input: { message: 'describe your change' } }
						: { operation: 'dev', reason: 'Start the local development environment for this task branch.' },
					{ operation: 'stage', reason: 'Merge the task into staging once the task branch is verified.', input: { message: 'describe the resolution' } },
				]),
			};
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
			const tenantRoot = helpers.cwd();
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
				return {
					ok: true,
					operation: 'dev',
					payload: {
						watch: input.watch === true,
						background: true,
						command: process.execPath,
						args,
						cwd: tenantRoot,
						pid: child.pid ?? null,
						exitCode: null,
					},
				} satisfies TreeseedWorkflowResult<Record<string, unknown>>;
			}

			const result = spawnSync(process.execPath, args, {
				cwd: tenantRoot,
				env,
				stdio: input.stdio ?? 'inherit',
			});
			return {
				ok: (result.status ?? 1) === 0,
				operation: 'dev',
				payload: {
					watch: input.watch === true,
					background: false,
					command: process.execPath,
					args,
					cwd: tenantRoot,
					pid: null,
					exitCode: result.status ?? 1,
				},
			} satisfies TreeseedWorkflowResult<Record<string, unknown>>;
		});
	} catch (error) {
		toError('dev', error);
	}
}

export async function workflowSave(helpers: WorkflowOperationHelpers, input: TreeseedSaveInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const tenantRoot = helpers.cwd();
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

			if (!hasMeaningfulChanges(gitRoot)) {
				workflowError('save', 'validation_failed', 'Treeseed save found no meaningful repository changes to commit.');
			}

			run('git', ['add', '-A'], { cwd: gitRoot });
			run('git', ['commit', '-m', message], { cwd: gitRoot });
			const head = run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim();

			try {
				if (remoteBranchExists(gitRoot, branch)) {
					run('git', ['pull', '--rebase', 'origin', branch], { cwd: gitRoot });
					run('git', ['push', 'origin', branch], { cwd: gitRoot });
				} else {
					run('git', ['push', '-u', 'origin', branch], { cwd: gitRoot });
				}
			} catch {
				const report = collectMergeConflictReport(gitRoot);
				throw new TreeseedWorkflowError('save', 'merge_conflict', formatMergeConflictReport(report, gitRoot, branch), {
					details: { branch, report },
					exitCode: 12,
				});
			}

			let previewRefresh: Record<string, unknown> | null = null;
			if (input.refreshPreview !== false && beforeState.branchRole === 'feature' && beforeState.preview.enabled && branch) {
				previewRefresh = deployBranchPreview(root, branch, helpers.context, { initialize: false });
			}

			return {
				ok: true,
				operation: 'save',
				payload: {
					branch,
					scope,
					hotfix: optionsHotfix,
					message,
					commitSha: head,
					previewRefresh,
				},
				nextSteps: createNextSteps([
					branch === STAGING_BRANCH
						? { operation: 'release', reason: 'Promote the validated staging branch into production.', input: { bump: 'patch' } }
						: branch === PRODUCTION_BRANCH
							? { operation: 'status', reason: 'Inspect production state after the explicit hotfix save.' }
							: { operation: 'stage', reason: 'Merge the verified task branch into staging.', input: { message: 'describe the resolution' } },
				]),
			};
		});
	} catch (error) {
		toError('save', error);
	}
}

export async function workflowClose(helpers: WorkflowOperationHelpers, input: TreeseedCloseInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const tenantRoot = helpers.cwd();
			const message = ensureMessage('close', input.message, 'a close reason');
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

			return {
				ok: true,
				operation: 'close',
				payload: {
					branchName: featureBranch,
					message,
					deprecatedTag,
					previewCleanup,
					remoteDeleted,
					localDeleted: input.deleteBranch !== false,
				},
				nextSteps: createNextSteps([
					{ operation: 'tasks', reason: 'Inspect the remaining task branches after closing this one.' },
				]),
			};
		});
	} catch (error) {
		toError('close', error);
	}
}

export async function workflowStage(helpers: WorkflowOperationHelpers, input: TreeseedStageInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const tenantRoot = helpers.cwd();
			const message = ensureMessage('stage', input.message, 'a resolution message');
			const featureBranch = assertFeatureBranch(tenantRoot);
			runWorkspaceSavePreflight({ cwd: tenantRoot });
			const repoDir = mergeCurrentBranchIntoStaging(tenantRoot, featureBranch);
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

			return {
				ok: true,
				operation: 'stage',
				payload: {
					branchName: featureBranch,
					mergeTarget: STAGING_BRANCH,
					message,
					deprecatedTag,
					stagingWait,
					previewCleanup,
					remoteDeleted,
					localDeleted: input.deleteBranch !== false,
				},
				nextSteps: createNextSteps([
					{ operation: 'release', reason: 'Promote the updated staging branch into production when ready.', input: { bump: 'patch' } },
					{ operation: 'status', reason: 'Inspect staging readiness after the task branch merge.' },
				]),
			};
		});
	} catch (error) {
		toError('stage', error);
	}
}

export async function workflowRelease(helpers: WorkflowOperationHelpers, input: TreeseedReleaseInput) {
	try {
		return withContextEnv(helpers.context.env, () => {
			const level = input.bump ?? 'patch';
			const root = workspaceRoot(helpers.cwd());
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
			run('git', ['tag', '-a', rootVersion, '-m', `release: ${rootVersion}`], { cwd: gitRoot });
			run('git', ['push', 'origin', rootVersion], { cwd: gitRoot });

			return {
				ok: true,
				operation: 'release',
				payload: {
					level,
					rootVersion,
					releaseTag: rootVersion,
					stagingBranch: STAGING_BRANCH,
					productionBranch: PRODUCTION_BRANCH,
					touchedPackages: [...plan.touched],
				},
				nextSteps: createNextSteps([
					{ operation: 'status', reason: 'Inspect release readiness and production state after the promotion.' },
				]),
			};
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
