import { resolveWorkflowState, type WorkflowStatusOptions } from './workflow-state.ts';
import { listTaskBranches } from './services/operations/git-workflow.ts';
import type { GitHubActionsVerificationReport } from './services/repositories/github-actions-verification.ts';
import { resolveWorkflowPaths } from '../workflow/policy.ts';
import {
	WorkflowError,
	type WorkflowErrorCode,
	workflowClose,
	workflowCi,
	workflowConfig,
	workflowDestroy,
	workflowDev,
	workflowExport,
	workflowRecover,
	workflowReleaseCandidate,
	workflowProof,
	workflowRelease,
	workflowResume,
	workflowSave,
	workflowStage,
	workflowStatus,
	workflowSwitch,
	workflowTasks,
	workflowUpdate,
} from '../workflow/operations.ts';

export type WorkflowOperationId =
	| 'status'
	| 'ci'
	| 'config'
	| 'tasks'
	| 'switch'
	| 'dev'
	| 'save'
	| 'update'
	| 'close'
	| 'stage'
	| 'release-candidate'
	| 'proof'
	| 'release'
	| 'resume'
	| 'recover'
	| 'destroy'
	| 'export';

export type WorkflowNextStep = {
	operation: string;
	reason?: string;
	input?: Record<string, unknown>;
};

export type WorkflowFact = {
	label: string;
	value: string | number | boolean | null;
};

export type WorkflowErrorDetail = {
	code: string;
	message: string;
	details?: Record<string, unknown> | null;
};

export type WorkflowRecovery = {
	resumable: boolean;
	runId?: string | null;
	command?: string | null;
	message?: string | null;
	recoverCommand?: string | null;
	resumeCommand?: string | null;
	lock?: Record<string, unknown> | null;
	localCleanup?: Record<string, unknown> | null;
};

export type WorkflowExecutionMode = 'execute' | 'plan';
export type WorkflowWorktreeMode = 'auto' | 'on' | 'off';
export type WorkflowCiMode = 'auto' | 'hosted' | 'off';
export type WorkflowVerifyMode = 'fast' | 'local' | 'hosted' | 'both' | 'skip';
export type WorkflowReleaseCandidateMode = 'hybrid' | 'strict' | 'skip';
export type ReleaseCandidateVerifyDriver = 'auto' | 'local' | 'action';
export type WorkflowStageVerifyMode = 'action' | 'local' | 'none';
export type WorkflowStageCiMode = 'off' | 'hosted';
export type WorkflowStageCleanupMode = 'success' | 'manual';

export type TasksInput = {
	cleanupMerged?: 'plan' | 'live';
};

export type WorkflowContext = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	write?: (output: string, stream?: 'stdout' | 'stderr') => void;
	prompt?: (message: string) => Promise<string> | string;
	confirm?: (message: string, expected: string) => Promise<boolean> | boolean;
	transport?: 'sdk' | 'cli' | 'api';
	workflow?: {
		resumeRunId?: string;
	};
};

export type WorkflowResult<TPayload = Record<string, unknown>> = {
	schemaVersion: 1;
	kind: 'treeseed.workflow.result';
	command: WorkflowOperationId;
	executionMode: WorkflowExecutionMode;
	runId: string | null;
	ok: boolean;
	operation: WorkflowOperationId;
	summary?: string;
	facts?: WorkflowFact[];
	payload: TPayload;
	result: TPayload;
	nextSteps?: WorkflowNextStep[];
	recovery?: WorkflowRecovery | null;
	errors?: WorkflowErrorDetail[];
};

export type TaskBranchMetadata = ReturnType<typeof listTaskBranches>[number] & {
	ageDays: number | null;
	dirtyCurrent: boolean;
	preview: {
		enabled: boolean;
		url: string | null;
		lastDeploymentTimestamp: string | null;
	};
	packages?: Array<{
		name: string;
		path: string;
		local: boolean;
		remote: boolean;
		current: boolean;
		head: string | null;
		pointer: string | null;
		aligned: boolean;
	}>;
};

export type WorkflowWorkstreamSummary = {
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
};

export type SaveInput = {
	message?: string;
	hotfix?: boolean;
	verify?: boolean;
	refreshPreview?: boolean;
	preview?: boolean;
	rebase?: boolean;
	bump?: 'major' | 'minor' | 'patch';
	devVersionStrategy?: 'prerelease';
	devDependencyReferenceMode?: 'git-commit';
	gitDependencyProtocol?: 'preserve-origin' | 'https' | 'ssh';
	gitRemoteWriteMode?: 'ssh-pushurl' | 'off';
	verifyMode?: 'action-first' | 'local-only' | 'skip' | WorkflowVerifyMode;
	ciMode?: WorkflowCiMode;
	lane?: 'fast' | 'promotion';
	worktreeMode?: WorkflowWorktreeMode;
	commitMessageMode?: 'auto' | 'cloudflare' | 'generated' | 'fallback';
	workspaceLinks?: 'auto' | 'off';
	releaseCandidate?: WorkflowReleaseCandidateMode;
	verifyDeployedResources?: boolean;
	skipCleanup?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	plan?: boolean;
};

export type UpdateInput = {
	from?: string;
	strategy?: 'merge' | 'ff-only';
	push?: boolean;
	worktreeMode?: WorkflowWorktreeMode;
	workspaceLinks?: 'auto' | 'off';
	adoptChanges?: boolean;
	plan?: boolean;
};

export type CiInput = {
	failed?: boolean;
	logs?: boolean;
	includeLogs?: boolean;
	logLines?: number | string;
	scope?: 'workspace' | 'root' | 'packages';
	workflow?: string | string[];
	workflows?: string | string[];
	branch?: string;
	strict?: boolean;
};

export type CiResult = GitHubActionsVerificationReport & {
	mode: 'root-only' | 'recursive-workspace';
	branch: string | null;
	scope: 'workspace' | 'root' | 'packages';
	strict: boolean;
	hasFailures: boolean;
	hasPending: boolean;
	exitCode: number;
};

export type CloseInput = {
	message: string;
	deletePreview?: boolean;
	deleteBranch?: boolean;
	autoSave?: boolean;
	worktreeMode?: WorkflowWorktreeMode;
	workspaceLinks?: 'auto' | 'off';
	plan?: boolean;
};

export type StageInput = {
	message: string;
	updateFrom?: string;
	verifyMode?: WorkflowStageVerifyMode;
	cleanupMode?: WorkflowStageCleanupMode;
	waitForStaging?: boolean;
	deletePreview?: boolean;
	deleteBranch?: boolean;
	autoSave?: boolean;
	ciMode?: WorkflowStageCiMode | WorkflowCiMode;
	async?: boolean;
	releaseCandidate?: WorkflowReleaseCandidateMode;
	worktreeMode?: WorkflowWorktreeMode;
	workspaceLinks?: 'auto' | 'off';
	verifyDeployedResources?: boolean;
	skipCleanup?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	plan?: boolean;
};

export type ReleaseCandidateInput = {
	mode?: WorkflowReleaseCandidateMode;
	verifyDriver?: ReleaseCandidateVerifyDriver;
	package?: string | string[];
	keepWorkspace?: boolean;
	plan?: boolean;
};

export type ProofInput = {
	action?: 'plan' | 'run' | 'status' | 'failures' | 'explain' | 'clean';
	target?: 'local' | 'staging' | 'prod';
	driver?: 'local' | 'act' | 'github-hosted' | 'railway-live' | 'cloudflare-live' | 'reconcile-live';
	subject?: string | null;
	last?: boolean;
	olderThan?: string | null;
	plan?: boolean;
};

export type SwitchInput = {
	branch?: string;
	branchName?: string;
	preview?: boolean;
	createIfMissing?: boolean;
	baseBranch?: string;
	worktreeMode?: WorkflowWorktreeMode;
	workspaceLinks?: 'auto' | 'off';
	plan?: boolean;
};

export type ConfigScope = 'all' | 'local' | 'staging' | 'prod';
export type BootstrapSystem = 'all' | 'github' | 'data' | 'web' | 'api' | 'agents';
export type BootstrapExecution = 'parallel' | 'sequential';

export type ConfigInput = {
	target?: ConfigScope[] | ConfigScope;
	environment?: ConfigScope[] | ConfigScope;
	systems?: BootstrapSystem[] | BootstrapSystem;
	skipUnavailable?: boolean;
	bootstrapExecution?: BootstrapExecution;
	syncProviders?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	sync?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	bootstrap?: boolean;
	preflight?: boolean;
	updates?: Array<{ scope: Exclude<ConfigScope, 'all'>; entryId: string; value: string; reused?: boolean }>;
	repair?: boolean;
	printEnv?: boolean;
	printEnvOnly?: boolean;
	showSecrets?: boolean;
	rotateMachineKey?: boolean;
	connectMarket?: boolean;
	marketBaseUrl?: string;
	marketTeamId?: string;
	marketTeamSlug?: string;
	marketProjectId?: string;
	marketProjectSlug?: string;
	marketProjectApiBaseUrl?: string;
	marketAccessToken?: string;
	rotateRunnerToken?: boolean;
	installMissingTooling?: boolean;
	nonInteractive?: boolean;
};

export type ExportInput = {
	directory?: string;
	worktreeMode?: WorkflowWorktreeMode;
};

export type ReleaseInput = {
	bump: 'major' | 'minor' | 'patch';
	repairVersionLine?: boolean;
	targetVersionLine?: string;
	gitDependencyProtocol?: 'preserve-origin' | 'https' | 'ssh';
	gitRemoteWriteMode?: 'ssh-pushurl' | 'off';
	ciMode?: WorkflowCiMode;
	worktreeMode?: WorkflowWorktreeMode;
	workspaceLinks?: 'auto' | 'off';
	verifyDeployedResources?: boolean;
	fresh?: boolean;
	skipCleanup?: boolean;
	sceneArtifacts?: 'full' | 'screenshots';
	plan?: boolean;
};

export type ResumeInput = {
	runId: string;
};

export type RecoverInput = {
	runId?: string;
	pruneStale?: boolean;
	obsoleteRunId?: string;
	obsoleteReason?: string;
};

export type DestroyInput = {
	target?: 'local' | 'staging' | 'prod';
	environment?: 'local' | 'staging' | 'prod';
	confirm?: boolean | string;
	plan?: boolean;
	destroyRemote?: boolean;
	destroyLocal?: boolean;
	force?: boolean;
	deleteData?: boolean;
	sweep?: boolean;
	removeBuildArtifacts?: boolean;
};

export type WorkflowDevInput = {
	watch?: boolean;
	port?: number | string;
	background?: boolean;
	stdio?: 'inherit' | 'pipe';
	workspaceLinks?: 'auto' | 'off';
	plan?: boolean;
	json?: boolean;
};

function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

export { WorkflowError };
export type { WorkflowErrorCode };

export class WorkflowSdk {
	constructor(private readonly context: WorkflowContext = {}) {}

	private helpers() {
		const context = {
			transport: 'sdk' as const,
			...this.context,
		};
		return {
			context,
			cwd: () => resolveWorkflowPaths(context.cwd ?? process.cwd()).cwd,
			write: context.write ?? defaultWrite,
			runStatus: async () => this.status(),
			runTasks: async () => this.tasks(),
		};
	}

	async execute(operation: WorkflowOperationId, input: Record<string, unknown> = {}) {
		switch (operation) {
			case 'status':
				return this.status(input as WorkflowStatusOptions);
			case 'ci':
				return this.ci(input as CiInput);
			case 'tasks':
				return this.tasks(input as TasksInput);
			case 'config':
				return this.config(input as ConfigInput);
			case 'switch':
				return this.switchTask(input as SwitchInput);
			case 'dev':
				return this.dev(input as WorkflowDevInput);
			case 'save':
				return this.save(input as SaveInput);
			case 'update':
				return this.update(input as UpdateInput);
			case 'close':
				return this.close(input as CloseInput);
			case 'stage':
				return this.stage(input as StageInput);
			case 'release-candidate':
				return this.releaseCandidate(input as ReleaseCandidateInput);
			case 'proof':
				return this.proof(input as ProofInput);
			case 'release':
				return this.release(input as ReleaseInput);
			case 'resume':
				return this.resume(input as ResumeInput);
			case 'recover':
				return this.recover(input as RecoverInput);
			case 'destroy':
				return this.destroy(input as DestroyInput);
			case 'export':
				return this.export(input as ExportInput);
			default:
				throw new Error(`Unsupported workflow operation "${operation}".`);
		}
	}

	async status(input: WorkflowStatusOptions = {}): Promise<WorkflowResult<ReturnType<typeof resolveWorkflowState>>> {
		return workflowStatus(this.helpers(), input);
	}

	async ci(input: CiInput = {}): Promise<WorkflowResult<CiResult>> {
		return workflowCi(this.helpers(), input);
	}

	async tasks(input: TasksInput = {}): Promise<WorkflowResult<{ tasks: TaskBranchMetadata[]; workstreams: WorkflowWorkstreamSummary[]; branchCleanup?: unknown }>> {
		return workflowTasks(this.helpers(), input);
	}

	async config(input: ConfigInput = {}): Promise<WorkflowResult> {
		return workflowConfig(this.helpers(), input);
	}

	async switchTask(input: SwitchInput): Promise<WorkflowResult> {
		return workflowSwitch(this.helpers(), input);
	}

	async dev(input: WorkflowDevInput = {}): Promise<WorkflowResult> {
		return workflowDev(this.helpers(), input);
	}

	async save(input: SaveInput): Promise<WorkflowResult> {
		return workflowSave(this.helpers(), input);
	}

	async update(input: UpdateInput = {}): Promise<WorkflowResult> {
		return workflowUpdate(this.helpers(), input);
	}

	async close(input: CloseInput): Promise<WorkflowResult> {
		return workflowClose(this.helpers(), input);
	}

	async stage(input: StageInput): Promise<WorkflowResult> {
		return workflowStage(this.helpers(), input);
	}

	async releaseCandidate(input: ReleaseCandidateInput = {}): Promise<WorkflowResult> {
		return workflowReleaseCandidate(this.helpers(), input);
	}

	async proof(input: ProofInput = {}): Promise<WorkflowResult> {
		return workflowProof(this.helpers(), input);
	}

	async release(input: ReleaseInput): Promise<WorkflowResult> {
		return workflowRelease(this.helpers(), input);
	}

	async resume(input: ResumeInput): Promise<WorkflowResult> {
		return workflowResume(this.helpers(), input);
	}

	async recover(input: RecoverInput = {}): Promise<WorkflowResult> {
		return workflowRecover(this.helpers(), input);
	}

	async destroy(input: DestroyInput): Promise<WorkflowResult> {
		return workflowDestroy(this.helpers(), input);
	}

	async export(input: ExportInput = {}): Promise<WorkflowResult> {
		return workflowExport(this.helpers(), input);
	}
}
