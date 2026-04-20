import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
	ensureTreeseedSecretSessionForConfig,
	ensureTreeseedActVerificationTooling,
	ensureTreeseedGitignoreEntries,
	finalizeTreeseedConfig,
	getTreeseedMachineConfigPaths,
	inspectTreeseedKeyAgentStatus,
	loadTreeseedMachineConfig,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedMachineEnvironmentValues,
	resolveTreeseedRemoteSession,
	rotateTreeseedMachineKey,
	setTreeseedRemoteSession,
	writeTreeseedMachineConfig,
} from '../operations/services/config-runtime.ts';
import { ControlPlaneClient } from '../control-plane-client.ts';
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
	assertCleanWorktrees,
	assertFeatureBranch,
	branchExists,
	checkoutBranch,
	checkoutTaskBranchFromStaging,
	createDeprecatedTaskTag,
	deleteLocalBranch,
	deleteRemoteBranch,
	ensureLocalBranchTracking,
	gitWorkflowRoot,
	headCommit,
	listTaskBranches,
	mergeBranchIntoTarget,
	mergeStagingIntoMain,
	prepareReleaseBranches,
	PRODUCTION_BRANCH,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
	squashMergeBranchIntoStaging,
	syncBranchWithOrigin,
	waitForStagingAutomation,
} from '../operations/services/git-workflow.ts';
import { waitForGitHubWorkflowCompletion } from '../operations/services/github-automation.ts';
import { loadCliDeployConfig, packageScriptPath, resolveWranglerBin } from '../operations/services/runtime-tools.ts';
import { runTenantDeployPreflight, runWorkspaceSavePreflight } from '../operations/services/save-deploy-preflight.ts';
import { collectCliPreflight } from '../operations/services/workspace-preflight.ts';
import {
	applyWorkspaceVersionChanges,
	assertWorkspaceVersionConsistency,
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
import {
	hasCompleteTreeseedPackageCheckout,
	changedWorkspacePackages,
	publishableWorkspacePackages,
	run,
	sortWorkspacePackages,
	workspacePackages,
	workspaceRoot,
} from '../operations/services/workspace-tools.ts';
import { resolveTreeseedWorkflowState } from '../workflow-state.ts';
import {
	acquireWorkflowLock,
	createWorkflowRunJournal,
	generateWorkflowRunId,
	inspectWorkflowLock,
	listInterruptedWorkflowRuns,
	listWorkflowRunJournals,
	readWorkflowRunJournal,
	refreshWorkflowLock,
	releaseWorkflowLock,
	updateWorkflowRunJournal,
	type TreeseedWorkflowRunCommand,
	type TreeseedWorkflowRunJournal,
	type TreeseedWorkflowRunStep,
} from './runs.ts';
import {
	checkedOutWorkspacePackageRepos,
	resolveTreeseedWorkflowSession,
	type TreeseedWorkflowMode,
	type TreeseedWorkflowSession,
} from './session.ts';
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
	TreeseedRecoverInput,
	TreeseedResumeInput,
	TreeseedSaveInput,
	TreeseedStageInput,
	TreeseedSwitchInput,
	TreeseedTaskBranchMetadata,
	TreeseedWorkflowContext,
	TreeseedWorkflowDevInput,
	TreeseedWorkflowExecutionMode,
	TreeseedWorkflowFact,
	TreeseedWorkflowNextStep,
	TreeseedWorkflowOperationId,
	TreeseedWorkflowRecovery,
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
	| 'unsupported_state'
	| 'workflow_locked'
	| 'resume_unavailable'
	| 'workflow_contract_missing';

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

type WorkflowRepoReport = {
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
};

function createRepoReport(name: string, path: string, branch: string | null, dirty: boolean): WorkflowRepoReport {
	return {
		name,
		path,
		branch,
		dirty,
		created: false,
		resumed: false,
		merged: false,
		verified: false,
		committed: false,
		pushed: false,
		deletedLocal: false,
		deletedRemote: false,
		tagName: null,
		commitSha: branch ? headCommit(path) : null,
		skippedReason: null,
		publishWait: null,
	};
}

function createWorkspaceRootRepoReport(root: string) {
	const gitRoot = repoRoot(root);
	return createRepoReport('@treeseed/market', gitRoot, currentBranch(gitRoot) || null, hasMeaningfulChanges(gitRoot));
}

function createWorkspacePackageReports(root: string) {
	return checkedOutWorkspacePackageRepos(root).map((pkg) =>
		createRepoReport(pkg.name, pkg.dir, currentBranch(pkg.dir) || null, hasMeaningfulChanges(pkg.dir)));
}

function findReportByName(reports: WorkflowRepoReport[], name: string) {
	return reports.find((report) => report.name === name) ?? null;
}

function findReportByPath(reports: WorkflowRepoReport[], path: string) {
	return reports.find((report) => report.path === path) ?? null;
}

function assertWorkspaceClean(root: string) {
	const repoDirs = [repoRoot(root), ...checkedOutWorkspacePackageRepos(root).map((pkg) => pkg.dir)];
	assertCleanWorktrees(repoDirs);
	return repoDirs;
}

function buildWorkflowResult<TPayload>(
	operation: TreeseedWorkflowOperationId,
	cwd: string,
	payload: TPayload,
	options: {
		nextSteps?: TreeseedWorkflowNextStep[];
		executionMode?: TreeseedWorkflowExecutionMode;
		runId?: string | null;
		summary?: string;
		facts?: TreeseedWorkflowFact[];
		recovery?: TreeseedWorkflowRecovery | null;
		errors?: Array<{ code: string; message: string; details?: Record<string, unknown> | null }>;
		includeFinalState?: boolean;
	} = {},
): TreeseedWorkflowResult<TPayload & { finalState?: WorkflowStatePayload }> {
	const resolvedPayload = (options.includeFinalState ?? true)
		? {
			...(payload as Record<string, unknown>),
			finalState: resolveWorkflowStateSnapshot(cwd),
		}
		: payload;
	return {
		schemaVersion: 1,
		kind: 'treeseed.workflow.result',
		command: operation,
		executionMode: options.executionMode ?? 'execute',
		runId: options.runId ?? null,
		ok: true,
		operation,
		summary: options.summary,
		facts: options.facts,
		payload: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload },
		result: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload },
		nextSteps: options.nextSteps,
		recovery: options.recovery ?? null,
		errors: options.errors ?? [],
	};
}

function normalizeExecutionMode(input: { plan?: boolean; dryRun?: boolean } | undefined): TreeseedWorkflowExecutionMode {
	return input?.plan === true || input?.dryRun === true ? 'plan' : 'execute';
}

function submodulePointerForRef(repoDir: string, ref: string, relativeDir: string) {
	try {
		const output = run('git', ['ls-tree', ref, relativeDir], { cwd: repoDir, capture: true }).trim();
		if (!output) {
			return null;
		}
		const match = output.match(/^[0-9]{6}\s+commit\s+([0-9a-f]{40})\t/u);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
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
	return buildWorkflowResult('status', cwd, state, {
		nextSteps: createNextSteps(state.recommendations),
		includeFinalState: false,
	});
}

function createTasksResult(cwd: string): TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[]; workstreams: Array<{
	id: string;
	title: string;
	linkedDirectRefs: Array<{ model: 'objective' | 'question' | 'note'; id: string }>;
	branch: string;
	local: boolean;
	remote: boolean;
	current: boolean;
	previewUrl: string | null;
	lastSaveAt: string | null;
	verificationResult: 'ready' | 'needs_attention' | 'unknown';
	stagingCandidate: boolean;
	archived: boolean;
}> }> {
	const tenantRoot = cwd;
	const repoDir = gitWorkflowRoot(tenantRoot);
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const dirty = gitStatusPorcelain(repoDir).length > 0;
	const tasks = listTaskBranches(repoDir).map((branch) => {
		const previewState = loadDeployState(tenantRoot, deployConfig, {
			target: createBranchPreviewDeployTarget(branch.name),
		});
		const packages = checkedOutWorkspacePackageRepos(tenantRoot).map((pkg) => {
			const packageBranches = listTaskBranches(pkg.dir);
			const match = packageBranches.find((candidate) => candidate.name === branch.name) ?? null;
			const pointer = submodulePointerForRef(repoDir, branch.name, pkg.relativeDir);
			return {
				name: pkg.name,
				path: pkg.relativeDir,
				local: match?.local === true,
				remote: match?.remote === true,
				current: match?.current === true,
				head: match?.head ?? null,
				pointer,
				aligned: pointer != null && match?.head != null ? pointer === match.head : match != null,
			};
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
			packages,
		};
	});
	const workstreams = tasks.map((task) => ({
		id: task.name,
		title: task.name.replace(/^task\//u, '').replace(/[-_]+/gu, ' '),
		linkedDirectRefs: [],
		branch: task.name,
		local: task.local,
		remote: task.remote,
		current: task.current,
		previewUrl: task.preview.url,
		lastSaveAt: task.lastCommitDate ?? null,
		verificationResult: task.dirtyCurrent ? 'needs_attention' : task.head ? 'ready' : 'unknown',
		stagingCandidate: task.name === STAGING_BRANCH,
		archived: false,
	}));
	return buildWorkflowResult('tasks', cwd, { tasks, workstreams }, { includeFinalState: false });
}

function normalizeOptionalString(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function connectTreeseedMarketProject(
	helpers: WorkflowOperationHelpers,
	tenantRoot: string,
	input: TreeseedConfigInput,
	context: {
		scopes: ReturnType<typeof normalizeConfigScopes>;
		sync: TreeseedConfigInput['sync'];
		repairs: unknown[];
		preflight: ReturnType<typeof collectCliPreflight>;
		toolHealth: ReturnType<typeof ensureTreeseedActVerificationTooling>;
	},
) {
	const machineConfig = loadTreeseedMachineConfig(tenantRoot) as Record<string, any>;
	const marketSettings = machineConfig.settings?.market && typeof machineConfig.settings.market === 'object'
		? machineConfig.settings.market as Record<string, unknown>
		: {};
	const remoteSettings = machineConfig.settings?.remote && typeof machineConfig.settings.remote === 'object'
		? machineConfig.settings.remote as Record<string, any>
		: { activeHostId: 'official', executionMode: 'prefer-local', hosts: [] };

	const baseUrl = normalizeOptionalString(input.marketBaseUrl)
		?? normalizeOptionalString(marketSettings.baseUrl)
		?? normalizeOptionalString(remoteSettings.hosts?.find?.((entry: Record<string, unknown>) => entry?.official === true)?.baseUrl)
		?? normalizeOptionalString(remoteSettings.hosts?.find?.((entry: Record<string, unknown>) => entry?.id === remoteSettings.activeHostId)?.baseUrl);
	if (!baseUrl) {
		workflowError(
			'config',
			'validation_failed',
			'Treeseed config --connect-market requires a market base URL. Pass --market-base-url or configure an authenticated remote host first.',
		);
	}

	const hostId = normalizeOptionalString(marketSettings.hostId) ?? 'knowledge-coop';
	const activeRemoteSession = resolveTreeseedRemoteSession(tenantRoot, hostId)
		?? resolveTreeseedRemoteSession(tenantRoot, remoteSettings.activeHostId)
		?? resolveTreeseedRemoteSession(tenantRoot, 'official');
	const accessToken = normalizeOptionalString(input.marketAccessToken) ?? normalizeOptionalString(activeRemoteSession?.accessToken);
	if (!accessToken) {
		workflowError(
			'config',
			'validation_failed',
			'Treeseed config --connect-market requires a market access token. Authenticate to the Knowledge Coop control-plane first or pass --market-access-token.',
		);
	}

	const projectId = normalizeOptionalString(input.marketProjectId) ?? normalizeOptionalString(marketSettings.projectId);
	if (!projectId) {
		workflowError(
			'config',
			'validation_failed',
			'Treeseed config --connect-market requires --market-project-id or an existing settings.market.projectId value.',
		);
	}

	const teamId = normalizeOptionalString(input.marketTeamId) ?? normalizeOptionalString(marketSettings.teamId);
	const projectSlug = normalizeOptionalString(input.marketProjectSlug)
		?? normalizeOptionalString(marketSettings.projectSlug)
		?? normalizeOptionalString(machineConfig.project?.slug)
		?? projectId;
	const teamSlug = normalizeOptionalString(input.marketTeamSlug) ?? normalizeOptionalString(marketSettings.teamSlug);
	const projectApiBaseUrl = normalizeOptionalString(input.marketProjectApiBaseUrl) ?? normalizeOptionalString(marketSettings.projectApiBaseUrl);

	const client = new ControlPlaneClient({
		baseUrl,
		accessToken,
	});

	const connectionResult = await client.upsertProjectConnection(projectId, {
		mode: 'hybrid',
		projectApiBaseUrl,
		executionOwner: 'project_runner',
		metadata: {
			pairingSource: 'treeseed_config_connect_market',
			tenantRoot,
			tenantSlug: normalizeOptionalString(machineConfig.project?.slug),
			repoSlug: normalizeOptionalString(machineConfig.project?.slug),
			teamId,
			teamSlug,
			projectSlug,
			connectedAt: new Date().toISOString(),
		},
		rotateRunnerToken: input.rotateRunnerToken === true,
	});

	const hosts = Array.isArray(remoteSettings.hosts) ? [...remoteSettings.hosts] : [];
	const updatedHost = {
		id: hostId,
		label: 'Knowledge Coop',
		baseUrl,
		official: false,
	};
	const existingHostIndex = hosts.findIndex((entry) =>
		String(entry?.id ?? '') === hostId || String(entry?.baseUrl ?? '').replace(/\/+$/u, '') === baseUrl.replace(/\/+$/u, ''),
	);
	if (existingHostIndex >= 0) {
		hosts.splice(existingHostIndex, 1, {
			...hosts[existingHostIndex],
			...updatedHost,
		});
	} else {
		hosts.unshift(updatedHost);
	}

	if (normalizeOptionalString(input.marketAccessToken)) {
		setTreeseedRemoteSession(tenantRoot, {
			hostId,
			accessToken,
			refreshToken: activeRemoteSession?.refreshToken ?? '',
			expiresAt: activeRemoteSession?.expiresAt ?? '',
			principal: activeRemoteSession?.principal ?? null,
		});
	}

	const runnerHostId = `market-runner:${projectId}`;
	if (connectionResult.runnerToken) {
		setTreeseedRemoteSession(tenantRoot, {
			hostId: runnerHostId,
			accessToken: connectionResult.runnerToken,
			refreshToken: '',
			expiresAt: '',
			principal: {
				id: `runner:${projectId}`,
				displayName: 'Knowledge Coop Project Runner',
				scopes: [],
				roles: ['project_runner'],
				permissions: [],
				metadata: { projectId },
			},
		});
	}

	machineConfig.settings.remote = {
		...remoteSettings,
		activeHostId: hostId,
		hosts,
	};
	machineConfig.settings.market = {
		baseUrl,
		hostId,
		teamId,
		teamSlug,
		projectId,
		projectSlug,
		projectApiBaseUrl: connectionResult.connection?.projectApiBaseUrl ?? projectApiBaseUrl ?? null,
		connectionMode: connectionResult.connection?.mode ?? 'hybrid',
		executionOwner: connectionResult.connection?.executionOwner ?? 'project_runner',
		runnerHostId,
		runnerReady: Boolean(connectionResult.runnerToken || resolveTreeseedRemoteSession(tenantRoot, runnerHostId)?.accessToken),
		runnerRegisteredAt: connectionResult.connection?.runnerRegisteredAt ?? null,
		runnerLastSeenAt: connectionResult.connection?.runnerLastSeenAt ?? null,
		launchPhase: null,
		lastSuccessfulPhase: null,
		githubRepository: null,
		workflowBootstrapReady: false,
		approvalBlockers: [],
		connectedAt: new Date().toISOString(),
	};
	writeTreeseedMachineConfig(tenantRoot, machineConfig);

	const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	return buildWorkflowResult(
		'config',
		tenantRoot,
		{
			mode: 'connect-market',
			scopes: context.scopes,
			sync: context.sync,
			configPath,
			keyPath,
			repairs: context.repairs,
			preflight: context.preflight,
			toolHealth: context.toolHealth,
			market: machineConfig.settings.market,
			connection: connectionResult.connection,
			runnerTokenIssued: Boolean(connectionResult.runnerToken),
		},
		{
			summary: 'Knowledge Coop project pairing completed.',
			nextSteps: createNextSteps([
				{ operation: 'status', reason: 'Confirm the new market connection, runner health, and current workstream posture.' },
				{ operation: 'tasks', reason: 'Inspect the branch-backed workstreams that will now sync into the Knowledge Coop UI.' },
			]),
		},
	);
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

type ActiveWorkflowRun = {
	runId: string;
	session: TreeseedWorkflowSession;
	journal: TreeseedWorkflowRunJournal;
	resumed: boolean;
};

function workflowSessionSnapshot(session: TreeseedWorkflowSession): TreeseedWorkflowRunJournal['session'] {
	return {
		root: session.root,
		mode: session.mode,
		branchName: session.branchName,
		repos: [session.rootRepo, ...session.packageRepos].map((repo) => ({
			name: repo.name,
			path: repo.path,
			branchName: repo.branchName,
		})),
	};
}

function nextPendingJournalStep(journal: TreeseedWorkflowRunJournal) {
	return journal.steps.find((step) => step.status === 'pending') ?? null;
}

async function executeJournalStep<T extends Record<string, unknown> | null>(
	root: string,
	runId: string,
	stepId: string,
	action: () => Promise<T> | T,
) {
	const current = readWorkflowRunJournal(root, runId);
	const step = current?.steps.find((entry) => entry.id === stepId) ?? null;
	if (!current || !step) {
		throw new Error(`Unknown workflow step "${stepId}" for run ${runId}.`);
	}
	if (step.status === 'completed') {
		return (step.data ?? null) as T;
	}
	const data = await Promise.resolve(action());
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		steps: journal.steps.map((entry) =>
			entry.id === stepId
				? {
					...entry,
					status: 'completed',
					completedAt: new Date().toISOString(),
					data: data ?? null,
				}
				: entry),
	}));
	refreshWorkflowLock(root, runId);
	return data;
}

function skipJournalStep(root: string, runId: string, stepId: string, data: Record<string, unknown> | null = null) {
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		steps: journal.steps.map((entry) =>
			entry.id === stepId
				? {
					...entry,
					status: 'skipped',
					completedAt: new Date().toISOString(),
					data,
				}
				: entry),
	}));
	refreshWorkflowLock(root, runId);
}

function acquireWorkflowRun(
	operation: TreeseedWorkflowRunCommand,
	session: TreeseedWorkflowSession,
	input: Record<string, unknown>,
	steps: Omit<TreeseedWorkflowRunStep, 'status' | 'completedAt' | 'data'>[],
	context: TreeseedWorkflowContext,
) {
	const resumeRunId = context.workflow?.resumeRunId;
	if (resumeRunId) {
		const existing = readWorkflowRunJournal(session.root, resumeRunId);
		if (!existing || existing.command !== operation) {
			workflowError(operation, 'resume_unavailable', `Treeseed ${operation} cannot resume run ${resumeRunId}.`, {
				details: { runId: resumeRunId, command: operation },
			});
		}
		const lockResult = acquireWorkflowLock(session.root, operation, resumeRunId);
		if (!lockResult.acquired) {
			workflowError(operation, 'workflow_locked', `Treeseed ${operation} is blocked by active run ${lockResult.lock.runId}.`, {
				details: {
					lock: lockResult.lock,
					recovery: {
						resumable: true,
						runId: lockResult.lock.runId,
						command: lockResult.lock.command,
						recoverCommand: 'treeseed recover',
						resumeCommand: `treeseed resume ${lockResult.lock.runId}`,
					},
				},
			});
		}
		return {
			runId: resumeRunId,
			session,
			journal: existing,
			resumed: true,
		} satisfies ActiveWorkflowRun;
	}

	const runId = generateWorkflowRunId(operation);
	const lockResult = acquireWorkflowLock(session.root, operation, runId);
	if (!lockResult.acquired) {
		workflowError(operation, 'workflow_locked', `Treeseed ${operation} is blocked by active run ${lockResult.lock.runId}.`, {
			details: {
				lock: lockResult.lock,
				recovery: {
					resumable: true,
					runId: lockResult.lock.runId,
					command: lockResult.lock.command,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${lockResult.lock.runId}`,
				},
			},
		});
	}
	const journal = createWorkflowRunJournal(session.root, {
		runId,
		command: operation,
		input,
		session: workflowSessionSnapshot(session),
		steps,
	});
	return {
		runId,
		session,
		journal,
		resumed: false,
	} satisfies ActiveWorkflowRun;
}

function completeWorkflowRun(root: string, runId: string, result: Record<string, unknown>) {
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		status: 'completed',
		result,
		failure: null,
	}));
	releaseWorkflowLock(root, runId);
}

function failWorkflowRun(
	root: string,
	runId: string,
	error: unknown,
	recovery?: TreeseedWorkflowRecovery | null,
) {
	const message = error instanceof Error ? error.message : String(error);
	const code = error instanceof TreeseedWorkflowError ? error.code : 'unsupported_state';
	const details = error instanceof TreeseedWorkflowError
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
			code,
			message,
			details,
			at: new Date().toISOString(),
		},
	}));
	releaseWorkflowLock(root, runId);
}

function validatePackageReleaseWorkflows(root: string, packageNames: string[]) {
	if (process.env.TREESEED_GITHUB_AUTOMATION_MODE === 'stub') {
		return;
	}
	const missing = checkedOutWorkspacePackageRepos(root)
		.filter((pkg) => packageNames.includes(pkg.name))
		.filter((pkg) => !existsSync(resolve(pkg.dir, '.github', 'workflows', 'publish.yml')))
		.map((pkg) => pkg.name);
	if (missing.length > 0) {
		workflowError('release', 'workflow_contract_missing', `Treeseed release requires .github/workflows/publish.yml in: ${missing.join(', ')}.`, {
			details: {
				missing,
			},
		});
	}
}

function validateStagingWorkflowContracts(root: string) {
	if (process.env.TREESEED_GITHUB_AUTOMATION_MODE === 'stub' || process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return;
	}
	const missing: string[] = [];
	for (const fileName of ['verify.yml', 'deploy.yml']) {
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

function assertSessionBranchSafety(
	operation: TreeseedWorkflowRunCommand,
	session: TreeseedWorkflowSession,
	{
		requireCleanPackages = false,
		requireCurrentBranch = false,
		allowPackageReposWithoutOrigin = false,
	}: {
		requireCleanPackages?: boolean;
		requireCurrentBranch?: boolean;
		allowPackageReposWithoutOrigin?: boolean;
	} = {},
) {
	const detached = session.packageRepos.filter((repo) => repo.detached).map((repo) => repo.name);
	if (detached.length > 0) {
		workflowError(operation, 'validation_failed', `Detached package heads detected: ${detached.join(', ')}.`, {
			details: { detached },
		});
	}
	if (requireCleanPackages) {
		const dirty = session.packageRepos.filter((repo) => repo.dirty).map((repo) => repo.name);
		if (dirty.length > 0) {
			workflowError(operation, 'validation_failed', `Dirty package repos block ${operation}: ${dirty.join(', ')}.`, {
				details: { dirty },
			});
		}
	}
	if (requireCurrentBranch && session.branchName) {
		const missing = session.packageRepos
			.filter((repo) => repo.branchName !== session.branchName)
			.map((repo) => ({ name: repo.name, branchName: repo.branchName }));
		if (missing.length > 0) {
			workflowError(operation, 'validation_failed', `Package branch alignment is required for ${operation}.`, {
				details: { expectedBranch: session.branchName, repos: missing },
			});
		}
	}
	const missingOriginRepos = [
		session.rootRepo,
		...(allowPackageReposWithoutOrigin ? [] : session.packageRepos),
	]
		.filter((repo) => !repo.hasOriginRemote)
		.map((repo) => repo.name);
	if (missingOriginRepos.length > 0 && operation !== 'destroy') {
		workflowError(operation, 'validation_failed', `Missing origin remote on: ${missingOriginRepos.join(', ')}.`, {
			details: { missingOrigin: missingOriginRepos },
		});
	}
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
	const root = workspaceRoot(tenantRoot);
	const repoDir = gitWorkflowRoot(root);
	const before = resolveRepoState(repoDir);
	const packageDirty = checkedOutWorkspacePackageRepos(root).some((pkg) => hasMeaningfulChanges(pkg.dir));
	if (!before.dirtyWorktree && !packageDirty) {
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

function checkoutOrCreateSaveBranch(repoDir: string, branch: string) {
	const current = currentBranch(repoDir);
	if (current === branch) {
		return current;
	}
	if (branchExists(repoDir, branch)) {
		checkoutBranch(repoDir, branch);
		return branch;
	}
	if (remoteBranchExists(repoDir, branch)) {
		run('git', ['checkout', '-b', branch, `origin/${branch}`], { cwd: repoDir });
		return branch;
	}
	run('git', ['checkout', '-b', branch], { cwd: repoDir });
	return branch;
}

function runPackageVerifyLocal(pkgDir: string) {
	run('npm', ['run', 'verify:local'], { cwd: pkgDir });
}

function branchNeedsSync(repoDir: string, branch: string) {
	if (!remoteBranchExists(repoDir, branch)) {
		return true;
	}
	const localHead = run('git', ['rev-parse', 'HEAD'], { cwd: repoDir, capture: true }).trim();
	const remoteHead = run('git', ['rev-parse', `origin/${branch}`], { cwd: repoDir, capture: true }).trim();
	return localHead !== remoteHead;
}

function savePackageRepo(
	report: WorkflowRepoReport,
	message: string,
	branch: string,
	shouldVerify: boolean,
) {
	checkoutOrCreateSaveBranch(report.path, branch);
	report.branch = currentBranch(report.path);
	report.dirty = hasMeaningfulChanges(report.path);
	const needsSync = branchNeedsSync(report.path, branch);

	if (!report.dirty && !needsSync) {
		report.skippedReason = 'clean';
		report.commitSha = run('git', ['rev-parse', 'HEAD'], { cwd: report.path, capture: true }).trim();
		return report;
	}

	if (shouldVerify && report.dirty) {
		runPackageVerifyLocal(report.path);
		report.verified = true;
	}

	if (report.dirty) {
		run('git', ['add', '-A'], { cwd: report.path });
		run('git', ['commit', '-m', message], { cwd: report.path });
		report.committed = true;
	}
	report.commitSha = run('git', ['rev-parse', 'HEAD'], { cwd: report.path, capture: true }).trim();
	const branchSync = syncCurrentBranchToOrigin('save', report.path, branch);
	report.pushed = branchSync.pushed === true;
	if (!report.dirty && needsSync) {
		report.skippedReason = 'sync-only';
	}
	return report;
}

function createSaveFailure(
	message: string,
	repos: WorkflowRepoReport[],
	rootRepo: WorkflowRepoReport | null,
	failingRepo: WorkflowRepoReport | null,
	error: unknown,
): never {
	const rendered = error instanceof Error ? error.message : String(error);
	const code = error instanceof TreeseedWorkflowError ? error.code : 'unsupported_state';
	const exitCode = error instanceof TreeseedWorkflowError ? error.exitCode : undefined;
	throw new TreeseedWorkflowError('save', code, `${message}\n${rendered}`, {
		details: {
			partialFailure: {
				message,
				failingRepo: failingRepo?.name ?? null,
				repos,
				rootRepo,
				error: rendered,
			},
		},
		exitCode,
	});
}

function ensureLocalTaskBranch(repoDir: string, branchName: string) {
	if (!branchExists(repoDir, branchName) && !remoteBranchExists(repoDir, branchName)) {
		return false;
	}
	if (!branchExists(repoDir, branchName) && remoteBranchExists(repoDir, branchName)) {
		ensureLocalBranchTracking(repoDir, branchName);
	}
	if (currentBranch(repoDir) !== branchName) {
		checkoutBranch(repoDir, branchName);
	}
	return true;
}

function cleanupTaskBranchReport(
	report: WorkflowRepoReport,
	branchName: string,
	message: string,
	{ deleteBranch = true, targetBranch = STAGING_BRANCH } = {},
) {
	if (!ensureLocalTaskBranch(report.path, branchName)) {
		report.skippedReason = 'branch-missing';
		return report;
	}

	const deprecatedTag = createDeprecatedTaskTag(report.path, branchName, message);
	report.tagName = deprecatedTag.tagName;
	report.commitSha = deprecatedTag.head;
	report.deletedRemote = deleteBranch ? deleteRemoteBranch(report.path, branchName) : false;
	syncBranchWithOrigin(report.path, targetBranch);
	if (deleteBranch) {
		deleteLocalBranch(report.path, branchName);
		report.deletedLocal = true;
	}
	report.branch = currentBranch(report.path) || targetBranch;
	report.dirty = hasMeaningfulChanges(report.path);
	return report;
}

function syncAllCheckedOutPackageRepos(root: string, branchName: string) {
	for (const pkg of checkedOutWorkspacePackageRepos(root)) {
		syncBranchWithOrigin(pkg.dir, branchName);
	}
}

function collectReleasePackageSelection(root: string) {
	const publishable = sortWorkspacePackages(
		publishableWorkspacePackages(root).filter((pkg) => pkg.name?.startsWith('@treeseed/')),
	);
	const changed = changedWorkspacePackages({
		root,
		baseRef: PRODUCTION_BRANCH,
		includeDependents: false,
		packages: publishable,
	});
	const selected = changedWorkspacePackages({
		root,
		baseRef: PRODUCTION_BRANCH,
		includeDependents: true,
		packages: publishable,
	});
	const changedNames = changed.map((pkg) => pkg.name);
	const selectedNames = selected.map((pkg) => pkg.name);
	const dependents = selected
		.filter((pkg) => !changedNames.includes(pkg.name))
		.map((pkg) => pkg.name);
	return {
		changed: changedNames,
		dependents,
		selected: selectedNames,
		publishable,
	};
}

function hasStagedChanges(repoDir: string) {
	return run('git', ['diff', '--cached', '--name-only'], { cwd: repoDir, capture: true }).trim().length > 0;
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
			const connectMarketFlag = input.connectMarket === true;
			const nonInteractive = input.nonInteractive === true;
			const repairs = input.repair === false ? [] : (resolveTreeseedWorkflowState(tenantRoot).deployConfigPresent ? applyTreeseedSafeRepairs(tenantRoot) : []);
			const toolHealth = ensureTreeseedActVerificationTooling({
				tenantRoot,
				installIfMissing: input.installMissingTooling === true,
				env: helpers.context.env,
				write: (line: string) => maybePrint(helpers.write, line),
			});
			const secretSession = (printEnvOnly && !revealSecrets)
				? {
					status: inspectTreeseedKeyAgentStatus(tenantRoot),
					createdWrappedKey: false,
					migratedWrappedKey: false,
					unlockSource: 'existing-session' as const,
				}
				: await ensureTreeseedSecretSessionForConfig({
					tenantRoot,
					interactive: false,
					env: helpers.context.env,
					createIfMissing: true,
					allowMigration: true,
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
				return buildWorkflowResult(
					'config',
					tenantRoot,
					{
						mode: 'print-env-only',
						scopes,
						sync,
						secretsRevealed: revealSecrets,
						reports,
						repairs,
						preflight,
						toolHealth,
						context: contextSnapshot,
						secretSession,
					},
					{
						nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Initialize the selected environment after reviewing the generated values.', input: { environment: scopes } },
						]),
					},
				);
			}

			if (rotateMachineKeyFlag) {
				const result = rotateTreeseedMachineKey(tenantRoot);
				return buildWorkflowResult(
					'config',
					tenantRoot,
					{
						mode: 'rotate-machine-key',
						scopes,
						sync,
						keyPath: result.keyPath,
						repairs,
						preflight,
						toolHealth,
						context: contextSnapshot,
						secretSession,
					},
					{
						nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Inspect the regenerated local environment after the machine key rotation.', input: { environment: ['local'], printEnvOnly: true } },
						]),
					},
				);
			}

			if (connectMarketFlag) {
				return connectTreeseedMarketProject(helpers, tenantRoot, input, {
					scopes,
					sync,
					repairs,
					preflight,
					toolHealth,
				});
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
			if (!explicitUpdates && !nonInteractive) {
				workflowError(
					'config',
					'validation_failed',
					'Treeseed config requires interactive input or explicit updates. Re-run in a TTY, or use --non-interactive/--json from the CLI when you want resolved values applied automatically.',
				);
			}
			const autoUpdates = scopes.flatMap((scope) =>
				contextSnapshot.entriesByScope[scope].map((entry) => ({
					scope,
					entryId: entry.id,
					value: entry.effectiveValue,
					reused: entry.currentValue.length > 0 || entry.suggestedValue.length > 0,
				})),
			);
			maybePrint(helpers.write, 'Saving resolved configuration values to machine config...');
			const applyResult = applyTreeseedConfigValues({
				tenantRoot,
				updates: explicitUpdates ?? autoUpdates,
			});
			const finalizeResult = finalizeTreeseedConfig({
				tenantRoot,
				scopes,
				sync,
				env: helpers.context.env,
				onProgress: (line) => maybePrint(helpers.write, line),
			});
			const refreshedContext = collectTreeseedConfigContext({
				tenantRoot,
				scopes,
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
					secretSession,
					context: refreshedContext,
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
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('switch', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const session = resolveTreeseedWorkflowSession(root);
			const branchName = String(input.branch ?? input.branchName ?? '').trim();
			if (!branchName) {
				workflowError('switch', 'validation_failed', 'Treeseed switch requires a branch name.');
			}
			const preview = input.preview === true;
			const executionMode = normalizeExecutionMode(input);
			const mode = session.mode;
			const repoDir = session.gitRoot;
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			let previewResult: Record<string, unknown> | null = null;
			const dirtyRepos = [rootRepo, ...packageReports].filter((repo) => repo.dirty).map((repo) => repo.name);

			if (executionMode === 'plan') {
				for (const report of [rootRepo, ...packageReports]) {
					const local = branchExists(report.path, branchName);
					const remote = remoteBranchExists(report.path, branchName);
					report.created = !local && !remote;
					report.resumed = local || remote;
				}
				return buildWorkflowResult(
					'switch',
					root,
					{
						mode,
						branchName,
						rootRepo,
						repos: packageReports,
						previewRequested: preview,
						blockers: dirtyRepos.length > 0 ? [`Clean worktrees required: ${dirtyRepos.join(', ')}`] : [],
						plannedSteps: [
							{ id: 'switch-root', description: `Switch market repo to ${branchName}` },
							...packageReports.map((report) => ({ id: `switch-${report.name}`, description: `Mirror ${branchName} into ${report.name}` })),
							...(preview ? [{ id: 'preview', description: `Provision or refresh preview for ${branchName}` }] : []),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'switch', reason: 'Run without --plan to create or resume the task branch.', input: { branch: branchName, preview } },
						]),
					},
				);
			}

			if (mode === 'recursive-workspace') {
				assertWorkspaceClean(root);
				assertSessionBranchSafety('switch', session);
			} else {
				assertCleanWorktree(root);
			}
			const workflowRun = acquireWorkflowRun(
				'switch',
				session,
				{ branch: branchName, preview },
				[
					{ id: 'switch-root', description: `Switch market repo to ${branchName}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true },
					...packageReports.map((report) => ({
						id: `switch-${report.name}`,
						description: `Mirror ${branchName} into ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch: branchName,
						resumable: true,
					})),
					...(preview ? [{ id: 'preview', description: `Provision or refresh preview ${branchName}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true }] : []),
				],
				helpers.context,
			);

			try {
				const rootSwitch = await executeJournalStep(root, workflowRun.runId, 'switch-root', () =>
					checkoutTaskBranchFromStaging(repoDir, branchName, {
						createIfMissing: input.createIfMissing !== false,
						pushIfCreated: true,
					}),
				);
				rootRepo.branch = currentBranch(repoDir) || branchName;
				rootRepo.created = rootSwitch.created;
				rootRepo.resumed = rootSwitch.resumed;
				rootRepo.commitSha = headCommit(repoDir);
				rootRepo.pushed = rootSwitch.created;

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					const packageSwitch = await executeJournalStep(root, workflowRun.runId, `switch-${report.name}`, () =>
						checkoutTaskBranchFromStaging(pkg.dir, branchName, {
							createIfMissing: input.createIfMissing !== false,
							pushIfCreated: false,
						}),
					);
					report.branch = currentBranch(pkg.dir) || branchName;
					report.created = packageSwitch.created;
					report.resumed = packageSwitch.resumed;
					report.commitSha = headCommit(pkg.dir);
					report.dirty = hasMeaningfulChanges(pkg.dir);
				}

				const stateAfterSwitch = resolveTreeseedWorkflowState(root);
				if (preview) {
					previewResult = await executeJournalStep(root, workflowRun.runId, 'preview', () =>
						deployBranchPreview(root, branchName, helpers.context, { initialize: !stateAfterSwitch.preview.enabled }),
					) ?? null;
				}

				const state = resolveTreeseedWorkflowState(root);
				const payload = {
					mode,
					branchName,
					created: rootRepo.created,
					resumed: rootRepo.resumed,
					repos: packageReports,
					rootRepo,
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
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'switch',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							state.preview.enabled
								? { operation: 'save', reason: 'Persist and verify the current task branch, then refresh its preview deployment.', input: { message: 'describe your change', preview: true } }
								: { operation: 'dev', reason: 'Start the local development environment for this task branch.' },
							{ operation: 'stage', reason: 'Merge the task into staging once the task branch is verified.', input: { message: 'describe the resolution' } },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'switch',
					message: `Resume the interrupted switch for ${branchName}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
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
			const env = resolveTreeseedLaunchEnvironment({
				tenantRoot,
				scope: 'local',
				baseEnv: { ...process.env, ...(helpers.context.env ?? {}) },
			});
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
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('save', helpers.cwd());
			const message = ensureMessage('save', input.message, 'a commit message');
			const optionsHotfix = input.hotfix === true;
			const root = workspaceRoot(tenantRoot);
			const session = resolveTreeseedWorkflowSession(root);
			const gitRoot = session.gitRoot;
			const branch = session.branchName;
			const scope = branch === STAGING_BRANCH ? 'staging' : branch === PRODUCTION_BRANCH ? 'prod' : 'local';
			const beforeState = resolveTreeseedWorkflowState(root);
			const recursiveWorkspace = session.mode === 'recursive-workspace';
			const mode = session.mode;
			const executionMode = normalizeExecutionMode(input);

			applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope, override: true });

			if (!branch) {
				workflowError('save', 'validation_failed', 'Treeseed save requires an active git branch.');
			}
			if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
				workflowError('save', 'unsupported_state', 'Treeseed save is blocked on main unless --hotfix is explicitly set.');
			}

			const packageReports = createWorkspacePackageReports(root);
			const rootRepo = createRepoReport('@treeseed/market', gitRoot, branch, hasMeaningfulChanges(gitRoot));
			const blockers: string[] = [];

			if (executionMode === 'plan') {
				if (!session.rootRepo.hasOriginRemote) {
					blockers.push('Market repo is missing origin remote.');
				}
				if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
					blockers.push('Main saves require --hotfix.');
				}
				if (recursiveWorkspace) {
					try {
						assertWorkspaceVersionConsistency(root);
					} catch (error) {
						blockers.push(error instanceof Error ? error.message : String(error));
					}
				}
				return buildWorkflowResult(
					'save',
					root,
					{
						mode,
						branch,
						scope,
						hotfix: optionsHotfix,
						message,
						repos: packageReports,
						rootRepo,
						blockers,
						plannedSteps: [
							...packageReports.map((report) => ({ id: `save-${report.name}`, description: `Verify, commit, and push ${report.name}` })),
							...(input.verify !== false ? [{ id: 'verify-root', description: 'Run market workspace verification' }] : []),
							{ id: 'commit-root', description: 'Commit market repo changes if present' },
							{ id: 'sync-root', description: `Push ${branch} to origin` },
							...((beforeState.branchRole === 'feature' && (input.preview === true || beforeState.preview.enabled))
								? [{ id: 'preview', description: `Refresh preview deployment for ${branch}` }]
								: []),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'save', reason: 'Run without --plan to persist the workspace checkpoint.', input: { message, hotfix: optionsHotfix, preview: input.preview === true } },
						]),
					},
				);
			}

			assertSessionBranchSafety('save', session, {
				allowPackageReposWithoutOrigin: true,
			});
			try {
				originRemoteUrl(gitRoot);
			} catch {
				workflowError('save', 'validation_failed', 'Treeseed save requires an origin remote.');
			}

			const workflowRun = acquireWorkflowRun(
				'save',
				session,
				{
					message,
					hotfix: optionsHotfix,
					preview: input.preview === true,
					refreshPreview: input.refreshPreview !== false,
					verify: input.verify !== false,
				},
				[
					...packageReports.map((report) => ({
						id: `save-${report.name}`,
						description: `Save ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch,
						resumable: true,
					})),
					...(input.verify !== false ? [{
						id: 'verify-root',
						description: 'Verify market workspace',
						repoName: rootRepo.name,
						repoPath: rootRepo.path,
						branch,
						resumable: true,
					}] : []),
					{
						id: 'commit-root',
						description: 'Commit market workspace changes',
						repoName: rootRepo.name,
						repoPath: rootRepo.path,
						branch,
						resumable: true,
					},
					{
						id: 'sync-root',
						description: `Push ${branch} to origin`,
						repoName: rootRepo.name,
						repoPath: rootRepo.path,
						branch,
						resumable: true,
					},
					...((beforeState.branchRole === 'feature' && (input.preview === true || (input.refreshPreview !== false && beforeState.preview.enabled)))
						? [{
							id: 'preview',
							description: `Refresh preview ${branch}`,
							repoName: rootRepo.name,
							repoPath: rootRepo.path,
							branch,
							resumable: true,
						}]
						: []),
				],
				helpers.context,
			);

			try {
			if (recursiveWorkspace) {
				assertWorkspaceVersionConsistency(root);
				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					try {
						const step = readWorkflowRunJournal(root, workflowRun.runId)?.steps.find((entry) => entry.id === `save-${report.name}`) ?? null;
						const resumePendingSync = workflowRun.resumed
							&& step?.status === 'pending'
							&& branchNeedsSync(report.path, branch);
						if (!report.dirty && !resumePendingSync) {
							report.skippedReason = 'clean';
							skipJournalStep(root, workflowRun.runId, `save-${report.name}`, {
								skippedReason: 'clean',
							});
							continue;
						}
						const savedReport = await executeJournalStep(root, workflowRun.runId, `save-${report.name}`, () =>
							savePackageRepo(report, message, branch, input.verify !== false));
						Object.assign(report, savedReport);
					} catch (error) {
						createSaveFailure(
							`Treeseed save stopped while saving workspace package ${pkg.name}.`,
							packageReports,
							rootRepo,
							report,
							error,
						);
					}
				}
			}

			if (input.verify !== false) {
				try {
					await executeJournalStep(root, workflowRun.runId, 'verify-root', () => {
						runWorkspaceSavePreflight({ cwd: root });
						rootRepo.verified = true;
						return {
							verified: true,
						};
					});
				} catch (error) {
					createSaveFailure(
						'Treeseed save stopped while verifying the market workspace.',
						packageReports,
						rootRepo,
						null,
						error,
					);
				}
			}

			const hadMeaningfulChanges = hasMeaningfulChanges(gitRoot);
			let head = run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim();
			let commitCreated = false;

			if (hadMeaningfulChanges) {
				const commitResult = await executeJournalStep(root, workflowRun.runId, 'commit-root', () => {
					run('git', ['add', '-A'], { cwd: gitRoot });
					run('git', ['commit', '-m', message], { cwd: gitRoot });
					return {
						commitSha: run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim(),
					};
				});
				head = String(commitResult?.commitSha ?? head);
				commitCreated = true;
				rootRepo.committed = true;
			} else {
				skipJournalStep(root, workflowRun.runId, 'commit-root', {
					skippedReason: 'clean',
				});
			}
			rootRepo.commitSha = head;

			let branchSync;
			try {
				branchSync = await executeJournalStep(root, workflowRun.runId, 'sync-root', () =>
					syncCurrentBranchToOrigin('save', gitRoot, branch));
			} catch (error) {
				createSaveFailure(
					'Treeseed save stopped while syncing the market repository.',
					packageReports,
					rootRepo,
					rootRepo,
					error,
				);
			}
			rootRepo.pushed = branchSync.pushed === true;
			if (input.verify !== false) {
				rootRepo.verified = true;
			}
			if (!hadMeaningfulChanges) {
				rootRepo.skippedReason = 'clean';
			}

			let previewAction: Record<string, unknown> = { status: 'skipped' };
			if (beforeState.branchRole === 'feature' && branch) {
				if (input.preview === true) {
					previewAction = {
						status: beforeState.preview.enabled ? 'refreshed' : 'created',
						details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
							deployBranchPreview(root, branch, helpers.context, { initialize: !beforeState.preview.enabled })),
					};
				} else if (input.refreshPreview !== false && beforeState.preview.enabled) {
					previewAction = {
						status: 'refreshed',
						details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
							deployBranchPreview(root, branch, helpers.context, { initialize: false })),
					};
				}
			}

				const payload = {
					mode,
					branch,
					scope,
					hotfix: optionsHotfix,
					message,
					commitSha: head,
					commitCreated,
					noChanges: !hadMeaningfulChanges,
					branchSync,
					repos: packageReports,
					rootRepo,
					partialFailure: null,
					previewAction,
					mergeConflict: null,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'save',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							branch === STAGING_BRANCH
								? { operation: 'release', reason: 'Promote the validated staging branch into production.', input: { bump: 'patch' } }
								: branch === PRODUCTION_BRANCH
									? { operation: 'status', reason: 'Inspect production state after the explicit hotfix save.' }
									: { operation: 'stage', reason: 'Merge the verified task branch into staging.', input: { message: 'describe the resolution' } },
						]),
					},
				);
			} catch (error) {
				const failingRepo = packageReports.find((report) => report.dirty && report.pushed !== true) ?? rootRepo;
				const wrappedError = error instanceof TreeseedWorkflowError && error.details?.partialFailure != null
					? error
					: new TreeseedWorkflowError(
						'save',
						error instanceof TreeseedWorkflowError ? error.code : 'unsupported_state',
						error instanceof Error ? error.message : String(error),
						{
							details: {
								...(error instanceof TreeseedWorkflowError ? (error.details ?? {}) : {}),
								partialFailure: {
									message: 'Treeseed save stopped before the workspace could finish syncing.',
									failingRepo: failingRepo.name,
									repos: packageReports,
									rootRepo,
									error: error instanceof Error ? error.message : String(error),
								},
							},
							exitCode: error instanceof TreeseedWorkflowError ? error.exitCode : undefined,
						},
					);
				failWorkflowRun(root, workflowRun.runId, wrappedError, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'save',
					message: `Resume the interrupted save on ${branch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw wrappedError;
			}
		});
	} catch (error) {
		toError('save', error);
	}
}

export async function workflowClose(helpers: WorkflowOperationHelpers, input: TreeseedCloseInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('close', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const message = ensureMessage('close', input.message, 'a close reason');
			const executionMode = normalizeExecutionMode(input);
			const session = resolveTreeseedWorkflowSession(root);
			if (executionMode === 'plan') {
				const branchName = session.branchName;
				const blockers = session.branchRole !== 'feature'
					? ['Close only applies to task branches.']
					: [];
				return buildWorkflowResult(
					'close',
					root,
					{
						mode: session.mode,
						branchName,
						message,
						autoSaveRequired: session.rootRepo.dirty || session.packageRepos.some((repo) => repo.dirty),
						repos: createWorkspacePackageReports(root),
						rootRepo: createWorkspaceRootRepoReport(root),
						blockers,
						plannedSteps: [
							{ id: 'preview-cleanup', description: `Destroy preview resources for ${branchName ?? '(current task)'}` },
							{ id: 'cleanup-root', description: `Archive and delete ${branchName ?? '(current task)'} in market` },
							...checkedOutWorkspacePackageRepos(root).map((pkg) => ({
								id: `cleanup-${pkg.name}`,
								description: `Archive and delete ${branchName ?? '(current task)'} in ${pkg.name}`,
							})),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'close', reason: 'Run without --plan to archive and delete the task branch.', input: { message } },
						]),
					},
				);
			}
			const autoSave = await maybeAutoSaveCurrentTaskBranch(helpers, 'close', {
				message,
				autoSave: input.autoSave,
			});
			const activeSession = resolveTreeseedWorkflowSession(root);
			const featureBranch = assertFeatureBranch(root);
			const mode = activeSession.mode;
			const repoDir = activeSession.gitRoot;
			assertSessionBranchSafety('close', activeSession);
			if (mode === 'recursive-workspace') {
				assertWorkspaceClean(root);
			} else {
				assertCleanWorktree(root);
			}

			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			const workflowRun = acquireWorkflowRun(
				'close',
				activeSession,
				{ message, deletePreview: input.deletePreview !== false, deleteBranch: input.deleteBranch !== false },
				[
					{ id: 'preview-cleanup', description: `Destroy preview resources for ${featureBranch}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'cleanup-root', description: `Archive ${featureBranch} in market`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					...packageReports.map((report) => ({
						id: `cleanup-${report.name}`,
						description: `Archive ${featureBranch} in ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch: featureBranch,
						resumable: true,
					})),
				],
				helpers.context,
			);

			try {
				const previewCleanup = input.deletePreview === false
					? (skipJournalStep(root, workflowRun.runId, 'preview-cleanup', { performed: false }), { performed: false })
					: await executeJournalStep(root, workflowRun.runId, 'preview-cleanup', () => destroyPreviewIfPresent(root, featureBranch));
				const rootCleanup = await executeJournalStep(root, workflowRun.runId, 'cleanup-root', () => {
					const deprecatedTag = createDeprecatedTaskTag(repoDir, featureBranch, `close: ${message}`);
					const deletedRemote = input.deleteBranch === false ? false : deleteRemoteBranch(repoDir, featureBranch);
					syncBranchWithOrigin(repoDir, STAGING_BRANCH);
					if (input.deleteBranch !== false) {
						deleteLocalBranch(repoDir, featureBranch);
					}
					return {
						deprecatedTag,
						deletedRemote,
						deletedLocal: input.deleteBranch !== false,
						branch: currentBranch(repoDir) || STAGING_BRANCH,
						dirty: hasMeaningfulChanges(repoDir),
					};
				});
				rootRepo.tagName = String(rootCleanup?.deprecatedTag?.tagName ?? null);
				rootRepo.commitSha = String(rootCleanup?.deprecatedTag?.head ?? rootRepo.commitSha ?? '');
				rootRepo.deletedRemote = rootCleanup?.deletedRemote === true;
				rootRepo.deletedLocal = rootCleanup?.deletedLocal === true;
				rootRepo.branch = typeof rootCleanup?.branch === 'string' ? rootCleanup.branch : (currentBranch(repoDir) || STAGING_BRANCH);
				rootRepo.dirty = rootCleanup?.dirty === true;

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					const cleanup = await executeJournalStep(root, workflowRun.runId, `cleanup-${report.name}`, () =>
						cleanupTaskBranchReport(report, featureBranch, `close: ${message}`, {
							deleteBranch: input.deleteBranch !== false,
							targetBranch: STAGING_BRANCH,
						}));
					Object.assign(report, cleanup);
				}

				const payload = {
					mode,
					branchName: featureBranch,
					message,
					autoSaved: autoSave.performed,
					autoSaveResult: autoSave.save,
					deprecatedTag: rootCleanup?.deprecatedTag ?? null,
					repos: packageReports,
					rootRepo,
					previewCleanup,
					remoteDeleted: rootRepo.deletedRemote,
					localDeleted: rootRepo.deletedLocal,
					finalBranch: currentBranch(repoDir) || STAGING_BRANCH,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'close',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'tasks', reason: 'Inspect the remaining task branches after closing this one.' },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'close',
					message: `Resume the interrupted close for ${featureBranch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('close', error);
	}
}

export async function workflowStage(helpers: WorkflowOperationHelpers, input: TreeseedStageInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('stage', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const message = ensureMessage('stage', input.message, 'a resolution message');
			const executionMode = normalizeExecutionMode(input);
			const initialSession = resolveTreeseedWorkflowSession(root);
			if (executionMode === 'plan') {
				const blockers: string[] = [];
				try {
					validateStagingWorkflowContracts(root);
				} catch (error) {
					blockers.push(error instanceof Error ? error.message : String(error));
				}
				return buildWorkflowResult(
					'stage',
					root,
					{
						mode: initialSession.mode,
						branchName: initialSession.branchName,
						mergeTarget: STAGING_BRANCH,
						mergeStrategy: 'squash',
						message,
						autoSaveRequired: initialSession.rootRepo.dirty || initialSession.packageRepos.some((repo) => repo.dirty),
						blockers,
						rootRepo: createWorkspaceRootRepoReport(root),
						repos: createWorkspacePackageReports(root),
						plannedSteps: [
							...checkedOutWorkspacePackageRepos(root).map((pkg) => ({
								id: `merge-${pkg.name}`,
								description: `Squash-merge ${initialSession.branchName ?? '(current task)'} into ${pkg.name} staging`,
							})),
							{ id: 'merge-root', description: `Squash-merge ${initialSession.branchName ?? '(current task)'} into market staging` },
							{ id: 'wait-staging', description: 'Wait for staging automation' },
							{ id: 'preview-cleanup', description: 'Destroy preview resources' },
							{ id: 'cleanup-root', description: 'Archive and delete the task branch from market' },
							...checkedOutWorkspacePackageRepos(root).map((pkg) => ({
								id: `cleanup-${pkg.name}`,
								description: `Archive and delete the task branch from ${pkg.name}`,
							})),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'stage', reason: 'Run without --plan to promote the task branch into staging.', input: { message } },
						]),
					},
				);
			}
			const autoSave = await maybeAutoSaveCurrentTaskBranch(helpers, 'stage', {
				message,
				autoSave: input.autoSave,
			});
			const session = resolveTreeseedWorkflowSession(root);
			const featureBranch = assertFeatureBranch(root);
			const mode = session.mode;
			assertSessionBranchSafety('stage', session);
			if (mode === 'recursive-workspace') {
				assertWorkspaceClean(root);
			} else {
				assertCleanWorktree(root);
			}
			validateStagingWorkflowContracts(root);
			runWorkspaceSavePreflight({ cwd: root });
			const repoDir = session.gitRoot;
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			const workflowRun = acquireWorkflowRun(
				'stage',
				session,
				{ message, waitForStaging: input.waitForStaging !== false, deletePreview: input.deletePreview !== false, deleteBranch: input.deleteBranch !== false },
				[
					...packageReports.map((report) => ({
						id: `merge-${report.name}`,
						description: `Merge ${featureBranch} into ${report.name} staging`,
						repoName: report.name,
						repoPath: report.path,
						branch: featureBranch,
						resumable: true,
					})),
					{ id: 'merge-root', description: `Merge ${featureBranch} into market staging`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'wait-staging', description: 'Wait for staging automation', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'preview-cleanup', description: 'Destroy preview resources', repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'cleanup-root', description: `Archive ${featureBranch} in market`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					...packageReports.map((report) => ({
						id: `cleanup-${report.name}`,
						description: `Archive ${featureBranch} in ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch: featureBranch,
						resumable: true,
					})),
				],
				helpers.context,
			);

			try {
				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					if (!ensureLocalTaskBranch(pkg.dir, featureBranch)) {
						report.skippedReason = 'branch-missing';
						skipJournalStep(root, workflowRun.runId, `merge-${report.name}`, { skippedReason: 'branch-missing' });
						continue;
					}
					try {
						const mergeResult = await executeJournalStep(root, workflowRun.runId, `merge-${report.name}`, () =>
							squashMergeBranchIntoStaging(pkg.dir, featureBranch, message, { pushTarget: true }));
						report.merged = mergeResult.committed;
						report.committed = mergeResult.committed;
						report.pushed = mergeResult.pushed;
						report.commitSha = mergeResult.commitSha;
						report.branch = STAGING_BRANCH;
						checkoutBranch(pkg.dir, featureBranch);
						report.branch = featureBranch;
					} catch (error) {
						const reportData = collectMergeConflictReport(pkg.dir);
						throw new TreeseedWorkflowError('stage', 'merge_conflict', formatMergeConflictReport(reportData, pkg.dir, STAGING_BRANCH), {
							details: { branch: featureBranch, packageName: pkg.name, report: reportData, originalError: error instanceof Error ? error.message : String(error) },
							exitCode: 12,
						});
					}
				}

				try {
					const rootMerge = await executeJournalStep(root, workflowRun.runId, 'merge-root', () => {
						assertCleanWorktree(root);
						syncBranchWithOrigin(repoDir, STAGING_BRANCH);
						run('git', ['merge', '--squash', featureBranch], { cwd: repoDir });
						if (mode === 'recursive-workspace') {
							syncAllCheckedOutPackageRepos(root, STAGING_BRANCH);
						}
						if (hasStagedChanges(repoDir) || hasMeaningfulChanges(repoDir)) {
							run('git', ['add', '-A'], { cwd: repoDir });
							run('git', ['commit', '-m', message], { cwd: repoDir });
						}
						pushBranch(repoDir, STAGING_BRANCH);
						return {
							commitSha: headCommit(repoDir),
							branch: currentBranch(repoDir) || STAGING_BRANCH,
							committed: hasMeaningfulChanges(repoDir) ? false : true,
						};
					});
					rootRepo.merged = true;
					rootRepo.committed = true;
					rootRepo.commitSha = String(rootMerge?.commitSha ?? headCommit(repoDir));
					rootRepo.pushed = true;
					rootRepo.branch = typeof rootMerge?.branch === 'string' ? rootMerge.branch : (currentBranch(repoDir) || STAGING_BRANCH);
				} catch (error) {
					const report = collectMergeConflictReport(repoDir);
					throw new TreeseedWorkflowError('stage', 'merge_conflict', formatMergeConflictReport(report, repoDir, STAGING_BRANCH), {
						details: { branch: featureBranch, report, originalError: error instanceof Error ? error.message : String(error) },
						exitCode: 12,
					});
				}

				const stagingWait = input.waitForStaging === false
					? (skipJournalStep(root, workflowRun.runId, 'wait-staging', { status: 'skipped', reason: 'disabled' }), { status: 'skipped', reason: 'disabled' })
					: await executeJournalStep(root, workflowRun.runId, 'wait-staging', () => waitForStagingAutomation(repoDir));
				const previewCleanup = input.deletePreview === false
					? (skipJournalStep(root, workflowRun.runId, 'preview-cleanup', { performed: false }), { performed: false })
					: await executeJournalStep(root, workflowRun.runId, 'preview-cleanup', () => destroyPreviewIfPresent(root, featureBranch));
				const rootCleanup = await executeJournalStep(root, workflowRun.runId, 'cleanup-root', () => {
					const deprecatedTag = createDeprecatedTaskTag(repoDir, featureBranch, `stage: ${message}`);
					const deletedRemote = input.deleteBranch === false ? false : deleteRemoteBranch(repoDir, featureBranch);
					if (input.deleteBranch !== false) {
						deleteLocalBranch(repoDir, featureBranch);
					}
					return {
						deprecatedTag,
						deletedRemote,
						deletedLocal: input.deleteBranch !== false,
						branch: currentBranch(repoDir) || STAGING_BRANCH,
					};
				});
				rootRepo.tagName = String(rootCleanup?.deprecatedTag?.tagName ?? rootRepo.tagName ?? '');
				rootRepo.commitSha = String(rootCleanup?.deprecatedTag?.head ?? rootRepo.commitSha ?? '');
				rootRepo.deletedRemote = rootCleanup?.deletedRemote === true;
				rootRepo.deletedLocal = rootCleanup?.deletedLocal === true;
				rootRepo.branch = typeof rootCleanup?.branch === 'string' ? rootCleanup.branch : (currentBranch(repoDir) || STAGING_BRANCH);

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					const cleanup = await executeJournalStep(root, workflowRun.runId, `cleanup-${report.name}`, () =>
						cleanupTaskBranchReport(report, featureBranch, `stage: ${message}`, {
							deleteBranch: input.deleteBranch !== false,
							targetBranch: STAGING_BRANCH,
						}));
					Object.assign(report, cleanup);
				}

				const payload = {
					mode,
					branchName: featureBranch,
					mergeTarget: STAGING_BRANCH,
					mergeStrategy: 'squash',
					message,
					autoSaved: autoSave.performed,
					autoSaveResult: autoSave.save,
					deprecatedTag: rootCleanup?.deprecatedTag ?? null,
					repos: packageReports,
					rootRepo,
					stagingWait,
					previewCleanup,
					remoteDeleted: rootRepo.deletedRemote,
					localDeleted: rootRepo.deletedLocal,
					finalBranch: currentBranch(repoDir) || STAGING_BRANCH,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'stage',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'release', reason: 'Promote the updated staging branch into production when ready.', input: { bump: 'patch' } },
							{ operation: 'status', reason: 'Inspect staging readiness after the task branch merge.' },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'stage',
					message: `Resume the interrupted stage for ${featureBranch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('stage', error);
	}
}

export async function workflowRelease(helpers: WorkflowOperationHelpers, input: TreeseedReleaseInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const level = input.bump ?? 'patch';
			const root = resolveProjectRootOrThrow('release', helpers.cwd());
			const session = resolveTreeseedWorkflowSession(root);
			const gitRoot = session.gitRoot;
			const mode = session.mode;
			const executionMode = normalizeExecutionMode(input);
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			const packageSelection = session.packageSelection;
			const selectedPackageNames = new Set(packageSelection.selected);
			const blockers: string[] = [];
			if (session.branchName !== STAGING_BRANCH) {
				blockers.push('Release must start from staging.');
			}
			if (mode === 'recursive-workspace') {
				try {
					assertWorkspaceVersionConsistency(root);
					validatePackageReleaseWorkflows(root, packageSelection.selected);
				} catch (error) {
					blockers.push(error instanceof Error ? error.message : String(error));
				}
			}
			const versionPlan = planWorkspaceReleaseBump(level, root, mode === 'recursive-workspace' ? { selectedPackageNames } : {});
			const plannedVersions = Object.fromEntries(versionPlan.versions.entries());
			if (executionMode === 'plan') {
				return buildWorkflowResult(
					'release',
					root,
					{
						mode,
						mergeStrategy: 'merge-commit',
						level,
						stagingBranch: STAGING_BRANCH,
						productionBranch: PRODUCTION_BRANCH,
						packageSelection,
						plannedVersions,
						repos: packageReports,
						rootRepo,
						plannedSteps: [
							...packageReports.filter((report) => selectedPackageNames.has(report.name)).map((report) => ({
								id: `release-${report.name}`,
								description: `Release ${report.name} from staging to main and tag ${plannedVersions[report.name] ?? '(planned)'}`,
							})),
							{ id: 'release-root', description: `Release market ${plannedVersions['@treeseed/market'] ?? '(planned)'}` },
						],
						blockers,
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'release', reason: 'Run without --plan to promote staging into production.', input: { bump: level } },
						]),
					},
				);
			}

			if (blockers.length > 0) {
				workflowError('release', 'validation_failed', blockers.join('\n'), {
					details: { blockers },
				});
			}

			assertSessionBranchSafety('release', session);
			prepareReleaseBranches(root);
			applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope: 'staging', override: true });
			runWorkspaceSavePreflight({ cwd: root });
			const workflowRun = acquireWorkflowRun(
				'release',
				session,
				{ bump: level },
				[
					...packageReports.filter((report) => selectedPackageNames.has(report.name)).map((report) => ({
						id: `release-${report.name}`,
						description: `Release ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch: STAGING_BRANCH,
						resumable: true,
					})),
					{ id: 'release-root', description: 'Release market repo', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
				],
				helpers.context,
			);

			try {
				if (mode === 'root-only') {
					const rootRelease = await executeJournalStep(root, workflowRun.runId, 'release-root', () => {
						applyWorkspaceVersionChanges(versionPlan);
						const rootVersion = bumpRootPackageJson(root, level);
						run('git', ['checkout', STAGING_BRANCH], { cwd: gitRoot });
						run('git', ['add', '-A'], { cwd: gitRoot });
						run('git', ['commit', '-m', `release: ${level} bump`], { cwd: gitRoot });
						pushBranch(gitRoot, STAGING_BRANCH);
						const released = mergeStagingIntoMain(root);
						run('git', ['tag', '-a', rootVersion, '-m', `release: ${rootVersion}`], { cwd: gitRoot });
						run('git', ['push', 'origin', rootVersion], { cwd: gitRoot });
						syncBranchWithOrigin(gitRoot, STAGING_BRANCH);
						return {
							rootVersion,
							releasedCommit: released.commitSha,
						};
					});
					rootRepo.committed = true;
					rootRepo.pushed = true;
					rootRepo.merged = true;
					rootRepo.branch = PRODUCTION_BRANCH;
					rootRepo.commitSha = String(rootRelease?.releasedCommit ?? headCommit(gitRoot));
					rootRepo.tagName = String(rootRelease?.rootVersion ?? '');
					const payload = {
						mode,
						mergeStrategy: 'merge-commit',
						level,
						rootVersion: String(rootRelease?.rootVersion ?? ''),
						releaseTag: String(rootRelease?.rootVersion ?? ''),
						releasedCommit: String(rootRelease?.releasedCommit ?? rootRepo.commitSha ?? ''),
						stagingBranch: STAGING_BRANCH,
						productionBranch: PRODUCTION_BRANCH,
						touchedPackages: [...versionPlan.touched],
						packageSelection: { changed: [], dependents: [], selected: [] },
						publishWait: [],
						repos: [],
						rootRepo,
						finalBranch: currentBranch(gitRoot) || STAGING_BRANCH,
						pushStatus: { stagingPushed: true, productionPushed: true, tagPushed: true },
					};
					completeWorkflowRun(root, workflowRun.runId, payload);
					return buildWorkflowResult('release', root, payload, {
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'status', reason: 'Inspect release readiness and production state after the promotion.' },
						]),
					});
				}

				assertWorkspaceVersionConsistency(root);
				validatePackageReleaseWorkflows(root, packageSelection.selected);
				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					if (selectedPackageNames.has(pkg.name)) {
						prepareReleaseBranches(pkg.dir);
					}
				}
				applyWorkspaceVersionChanges(versionPlan);
				const publishWait: Array<Record<string, unknown>> = [];

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report || !selectedPackageNames.has(pkg.name)) {
						if (report) {
							report.skippedReason = 'unchanged';
						}
						continue;
					}
					const releasedPackage = await executeJournalStep(root, workflowRun.runId, `release-${report.name}`, () => {
						checkoutBranch(pkg.dir, STAGING_BRANCH);
						if (hasMeaningfulChanges(pkg.dir)) {
							run('git', ['add', '-A'], { cwd: pkg.dir });
							run('git', ['commit', '-m', `release: ${versionPlan.versions.get(pkg.name)}`], { cwd: pkg.dir });
						}
						pushBranch(pkg.dir, STAGING_BRANCH);
						const mergeResult = mergeBranchIntoTarget(pkg.dir, {
							sourceBranch: STAGING_BRANCH,
							targetBranch: PRODUCTION_BRANCH,
							message: `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`,
							pushTarget: true,
						});
						const tagName = String(versionPlan.versions.get(pkg.name));
						run('git', ['tag', '-a', tagName, '-m', `release: ${tagName}`], { cwd: pkg.dir });
						run('git', ['push', 'origin', tagName], { cwd: pkg.dir });
						const publish = waitForGitHubWorkflowCompletion(pkg.dir, {
							workflow: 'publish.yml',
							headSha: mergeResult.commitSha,
							branch: PRODUCTION_BRANCH,
						});
						syncBranchWithOrigin(pkg.dir, STAGING_BRANCH);
						return {
							commitSha: mergeResult.commitSha,
							tagName,
							publish,
						};
					});
					report.committed = true;
					report.pushed = true;
					report.merged = true;
					report.tagName = String(releasedPackage?.tagName ?? '');
					report.commitSha = String(releasedPackage?.commitSha ?? report.commitSha ?? '');
					report.publishWait = (releasedPackage?.publish as Record<string, unknown> | undefined) ?? null;
					report.branch = STAGING_BRANCH;
					publishWait.push({
						name: report.name,
						...(releasedPackage?.publish as Record<string, unknown> | undefined ?? {}),
					});
				}

				const rootRelease = await executeJournalStep(root, workflowRun.runId, 'release-root', () => {
					const rootVersion = bumpRootPackageJson(root, level);
					run('git', ['checkout', STAGING_BRANCH], { cwd: gitRoot });
					run('git', ['add', '-A'], { cwd: gitRoot });
					run('git', ['commit', '-m', `release: ${level} bump`], { cwd: gitRoot });
					pushBranch(gitRoot, STAGING_BRANCH);
					const released = mergeBranchIntoTarget(root, {
						sourceBranch: STAGING_BRANCH,
						targetBranch: PRODUCTION_BRANCH,
						message: `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`,
						pushTarget: false,
					});
					for (const pkg of checkedOutWorkspacePackageRepos(root)) {
						if (selectedPackageNames.has(pkg.name)) {
							syncBranchWithOrigin(pkg.dir, PRODUCTION_BRANCH);
						}
					}
					run('git', ['add', '-A'], { cwd: gitRoot });
					if (hasMeaningfulChanges(gitRoot)) {
						run('git', ['commit', '-m', 'release: sync package main heads'], { cwd: gitRoot });
					}
					run('git', ['tag', '-a', rootVersion, '-m', `release: ${rootVersion}`], { cwd: gitRoot });
					run('git', ['push', 'origin', PRODUCTION_BRANCH], { cwd: gitRoot });
					run('git', ['push', 'origin', rootVersion], { cwd: gitRoot });
					syncAllCheckedOutPackageRepos(root, STAGING_BRANCH);
					syncBranchWithOrigin(gitRoot, STAGING_BRANCH);
					return {
						rootVersion,
						releasedCommit: headCommit(gitRoot),
					};
				});
				rootRepo.committed = true;
				rootRepo.pushed = true;
				rootRepo.merged = true;
				rootRepo.branch = PRODUCTION_BRANCH;
				rootRepo.commitSha = String(rootRelease?.releasedCommit ?? headCommit(gitRoot));
				rootRepo.tagName = String(rootRelease?.rootVersion ?? '');
				const payload = {
					mode,
					mergeStrategy: 'merge-commit',
					level,
					rootVersion: String(rootRelease?.rootVersion ?? ''),
					releaseTag: String(rootRelease?.rootVersion ?? ''),
					releasedCommit: String(rootRelease?.releasedCommit ?? rootRepo.commitSha ?? ''),
					stagingBranch: STAGING_BRANCH,
					productionBranch: PRODUCTION_BRANCH,
					touchedPackages: packageSelection.selected,
					packageSelection,
					publishWait,
					repos: packageReports,
					rootRepo,
					finalBranch: currentBranch(gitRoot) || STAGING_BRANCH,
					pushStatus: {
						stagingPushed: true,
						productionPushed: true,
						tagPushed: true,
					},
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'release',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'status', reason: 'Inspect release readiness and production state after the promotion.' },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'release',
					message: `Resume the interrupted release on ${STAGING_BRANCH}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('release', error);
	}
}

export async function workflowResume(helpers: WorkflowOperationHelpers, input: TreeseedResumeInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('resume', helpers.cwd());
			const runId = String(input.runId ?? '').trim();
			if (!runId) {
				workflowError('resume', 'validation_failed', 'Treeseed resume requires a run id.');
			}
			const journal = readWorkflowRunJournal(root, runId);
			if (!journal) {
				workflowError('resume', 'resume_unavailable', `Treeseed resume could not find run ${runId}.`, {
					details: { runId },
				});
			}
			if (journal.status === 'completed') {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is already completed.`, {
					details: { runId, status: journal.status },
				});
			}
			if (!journal.resumable) {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is not resumable.`, {
					details: { runId, status: journal.status },
				});
			}
			const resumedHelpers: WorkflowOperationHelpers = {
				...helpers,
				context: {
					...helpers.context,
					workflow: {
						...(helpers.context.workflow ?? {}),
						resumeRunId: runId,
					},
				},
			};
			switch (journal.command) {
				case 'switch':
					return workflowSwitch(resumedHelpers, journal.input as unknown as TreeseedSwitchInput);
				case 'save':
					return workflowSave(resumedHelpers, journal.input as unknown as TreeseedSaveInput);
				case 'close':
					return workflowClose(resumedHelpers, journal.input as unknown as TreeseedCloseInput);
				case 'stage':
					return workflowStage(resumedHelpers, journal.input as unknown as TreeseedStageInput);
				case 'release':
					return workflowRelease(resumedHelpers, journal.input as unknown as TreeseedReleaseInput);
				case 'destroy':
					return workflowDestroy(resumedHelpers, journal.input as unknown as TreeseedDestroyInput);
				default:
					workflowError('resume', 'resume_unavailable', `Run ${runId} uses unsupported command ${journal.command}.`, {
						details: { runId, command: journal.command },
					});
			}
		});
	} catch (error) {
		toError('resume', error);
	}
}

export async function workflowRecover(helpers: WorkflowOperationHelpers, input: TreeseedRecoverInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('recover', helpers.cwd());
			const lock = inspectWorkflowLock(root);
			const journals = listWorkflowRunJournals(root);
			const interruptedRuns = listInterruptedWorkflowRuns(root).map((journal) => ({
				runId: journal.runId,
				command: journal.command,
				status: journal.status,
				createdAt: journal.createdAt,
				updatedAt: journal.updatedAt,
				nextStep: nextPendingJournalStep(journal)?.description ?? null,
				failure: journal.failure,
				resumeCommand: `treeseed resume ${journal.runId}`,
			}));
			const selectedRun = input.runId ? readWorkflowRunJournal(root, input.runId) : null;
			return buildWorkflowResult(
				'recover',
				root,
				{
					lock,
					interruptedRuns,
					selectedRun,
					runCount: journals.length,
				},
				{
					includeFinalState: false,
					nextSteps: createNextSteps([
						...(interruptedRuns.length > 0
							? [{ operation: 'resume', reason: 'Resume the most recent interrupted workflow run.', input: { runId: interruptedRuns[0].runId } }]
							: [{ operation: 'status', reason: 'No interrupted runs were found; inspect current workflow state instead.' }]),
					]),
				},
			);
		});
	} catch (error) {
		toError('recover', error);
	}
}

export async function workflowDestroy(helpers: WorkflowOperationHelpers, input: TreeseedDestroyInput) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('destroy', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const session = resolveTreeseedWorkflowSession(root);
			const scope = String(input.environment ?? input.target ?? '');
			if (!scope) {
				workflowError('destroy', 'validation_failed', 'Treeseed destroy requires an environment target.');
			}
			const executionMode = normalizeExecutionMode(input);
			const target = createPersistentDeployTarget(scope);
			const dryRun = executionMode === 'plan';
			const force = input.force === true;
			const destroyRemote = input.destroyRemote !== false;
			const destroyLocal = input.destroyLocal !== false;
			const removeBuildArtifacts = input.removeBuildArtifacts === true;
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });
			assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose: 'destroy' });
			const deployConfig = validateDestroyPrerequisites(tenantRoot, { requireRemote: executionMode === 'execute' && destroyRemote });
			const state = loadDeployState(tenantRoot, deployConfig, { target });
			const expectedConfirmation = deployConfig.slug;
			const payload = {
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
				plannedSteps: [
					...(destroyRemote ? [{ id: 'destroy-remote', description: `Destroy remote ${scope} resources` }] : []),
					...(destroyLocal ? [{ id: 'cleanup-local', description: `Clean local ${scope} state${removeBuildArtifacts ? ' and build artifacts' : ''}` }] : []),
				],
				remoteResult: null,
			};

			if (executionMode === 'plan') {
				return buildWorkflowResult(
					'destroy',
					tenantRoot,
					payload,
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'destroy', reason: 'Run without --plan to destroy the selected environment.', input: { environment: scope, force, removeBuildArtifacts } },
							{ operation: 'status', reason: 'Confirm the current environment state before making destructive changes.' },
						]),
					},
				);
			}

			const workflowRun = acquireWorkflowRun(
				'destroy',
				session,
				{
					environment: scope,
					force,
					destroyRemote,
					destroyLocal,
					removeBuildArtifacts,
				},
				[
					...(destroyRemote
						? [{
							id: 'destroy-remote',
							description: `Destroy remote ${scope} resources`,
							repoName: session.rootRepo.name,
							repoPath: session.rootRepo.path,
							branch: session.branchName,
							resumable: false,
						}]
						: []),
					...(destroyLocal
						? [{
							id: 'cleanup-local',
							description: `Clean local ${scope} state${removeBuildArtifacts ? ' and build artifacts' : ''}`,
							repoName: session.rootRepo.name,
							repoPath: session.rootRepo.path,
							branch: session.branchName,
							resumable: false,
						}]
						: []),
				],
				helpers.context,
			);

			try {
				const confirmed = await Promise.resolve(resolveDestroyConfirmation(helpers.context, expectedConfirmation, input));
				if (!confirmed) {
					workflowError('destroy', 'confirmation_required', `Destroy confirmation required. Re-run with confirm="${expectedConfirmation}".`);
				}

				const remoteResult = destroyRemote
					? await executeJournalStep(root, workflowRun.runId, 'destroy-remote', () =>
						destroyCloudflareResources(tenantRoot, { dryRun: false, force, target }) as Record<string, unknown>)
					: null;
				if (!destroyRemote) {
					skipJournalStep(root, workflowRun.runId, 'destroy-remote', { skippedReason: 'destroyRemote=false' });
				}

				if (destroyLocal) {
					await executeJournalStep(root, workflowRun.runId, 'cleanup-local', () => {
						cleanupDestroyedState(tenantRoot, { target, removeBuildArtifacts });
						return {
							cleaned: true,
							removeBuildArtifacts,
						};
					});
				} else {
					skipJournalStep(root, workflowRun.runId, 'cleanup-local', { skippedReason: 'destroyLocal=false' });
				}

				const resultPayload = {
					...payload,
					dryRun: false,
					remoteResult,
				};
				completeWorkflowRun(root, workflowRun.runId, resultPayload);
				return buildWorkflowResult(
					'destroy',
					tenantRoot,
					resultPayload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'config', reason: 'Recreate the destroyed environment before using it again.', input: { environment: [scope] } },
							{ operation: 'status', reason: 'Confirm the environment teardown state and any remaining local runtime setup.' },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: false,
					runId: workflowRun.runId,
					command: 'destroy',
					message: `Inspect the failed destroy run for ${scope} before retrying manually.`,
					recoverCommand: 'treeseed recover',
				});
				throw error;
			}
		});
	} catch (error) {
		toError('destroy', error);
	}
}
