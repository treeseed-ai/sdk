import { resolveTreeseedWorkflowState } from './workflow-state.ts';
import { listTaskBranches } from './operations/services/git-workflow.ts';
import { resolveTreeseedWorkflowPaths } from './workflow/policy.ts';
import {
	TreeseedWorkflowError,
	type TreeseedWorkflowErrorCode,
	workflowClose,
	workflowConfig,
	workflowDestroy,
	workflowDev,
	workflowExport,
	workflowRecover,
	workflowRelease,
	workflowResume,
	workflowSave,
	workflowStage,
	workflowStatus,
	workflowSwitch,
	workflowTasks,
} from './workflow/operations.ts';

export type TreeseedWorkflowOperationId =
	| 'status'
	| 'config'
	| 'tasks'
	| 'switch'
	| 'dev'
	| 'save'
	| 'close'
	| 'stage'
	| 'release'
	| 'resume'
	| 'recover'
	| 'destroy'
	| 'export';

export type TreeseedWorkflowNextStep = {
	operation: string;
	reason?: string;
	input?: Record<string, unknown>;
};

export type TreeseedWorkflowFact = {
	label: string;
	value: string | number | boolean | null;
};

export type TreeseedWorkflowErrorDetail = {
	code: string;
	message: string;
	details?: Record<string, unknown> | null;
};

export type TreeseedWorkflowRecovery = {
	resumable: boolean;
	runId?: string | null;
	command?: string | null;
	message?: string | null;
	recoverCommand?: string | null;
	resumeCommand?: string | null;
	lock?: Record<string, unknown> | null;
};

export type TreeseedWorkflowExecutionMode = 'execute' | 'plan';

export type TreeseedWorkflowContext = {
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

export type TreeseedWorkflowResult<TPayload = Record<string, unknown>> = {
	schemaVersion: 1;
	kind: 'treeseed.workflow.result';
	command: TreeseedWorkflowOperationId;
	executionMode: TreeseedWorkflowExecutionMode;
	runId: string | null;
	ok: boolean;
	operation: TreeseedWorkflowOperationId;
	summary?: string;
	facts?: TreeseedWorkflowFact[];
	payload: TPayload;
	result: TPayload;
	nextSteps?: TreeseedWorkflowNextStep[];
	recovery?: TreeseedWorkflowRecovery | null;
	errors?: TreeseedWorkflowErrorDetail[];
};

export type TreeseedTaskBranchMetadata = ReturnType<typeof listTaskBranches>[number] & {
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

export type TreeseedWorkflowWorkstreamSummary = {
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

export type TreeseedSaveInput = {
	message?: string;
	hotfix?: boolean;
	verify?: boolean;
	refreshPreview?: boolean;
	preview?: boolean;
	rebase?: boolean;
	bump?: 'major' | 'minor' | 'patch';
	devVersionStrategy?: 'prerelease';
	devDependencyReferenceMode?: 'git-tag' | 'registry-prerelease';
	gitDependencyProtocol?: 'preserve-origin' | 'https' | 'ssh';
	verifyMode?: 'action-first' | 'local-only' | 'skip';
	commitMessageMode?: 'auto' | 'cloudflare' | 'generated' | 'fallback';
	plan?: boolean;
	dryRun?: boolean;
};

export type TreeseedCloseInput = {
	message: string;
	deletePreview?: boolean;
	deleteBranch?: boolean;
	autoSave?: boolean;
	plan?: boolean;
	dryRun?: boolean;
};

export type TreeseedStageInput = {
	message: string;
	waitForStaging?: boolean;
	deletePreview?: boolean;
	deleteBranch?: boolean;
	autoSave?: boolean;
	plan?: boolean;
	dryRun?: boolean;
};

export type TreeseedSwitchInput = {
	branch?: string;
	branchName?: string;
	preview?: boolean;
	createIfMissing?: boolean;
	baseBranch?: string;
	plan?: boolean;
	dryRun?: boolean;
};

export type TreeseedConfigScope = 'all' | 'local' | 'staging' | 'prod';
export type TreeseedBootstrapSystem = 'all' | 'github' | 'data' | 'web' | 'api' | 'agents';
export type TreeseedBootstrapExecution = 'parallel' | 'sequential';

export type TreeseedConfigInput = {
	target?: TreeseedConfigScope[] | TreeseedConfigScope;
	environment?: TreeseedConfigScope[] | TreeseedConfigScope;
	systems?: TreeseedBootstrapSystem[] | TreeseedBootstrapSystem;
	skipUnavailable?: boolean;
	bootstrapExecution?: TreeseedBootstrapExecution;
	syncProviders?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	sync?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	bootstrap?: boolean;
	preflight?: boolean;
	updates?: Array<{ scope: Exclude<TreeseedConfigScope, 'all'>; entryId: string; value: string; reused?: boolean }>;
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

export type TreeseedExportInput = {
	directory?: string;
};

export type TreeseedReleaseInput = {
	bump: 'major' | 'minor' | 'patch';
	devTagCleanup?: 'safe-after-release' | 'off';
	gitDependencyProtocol?: 'preserve-origin' | 'https' | 'ssh';
	plan?: boolean;
	dryRun?: boolean;
};

export type TreeseedResumeInput = {
	runId: string;
};

export type TreeseedRecoverInput = {
	runId?: string;
};

export type TreeseedDestroyInput = {
	target?: 'local' | 'staging' | 'prod';
	environment?: 'local' | 'staging' | 'prod';
	confirm?: boolean | string;
	dryRun?: boolean;
	plan?: boolean;
	destroyRemote?: boolean;
	destroyLocal?: boolean;
	force?: boolean;
	removeBuildArtifacts?: boolean;
};

export type TreeseedWorkflowDevInput = {
	watch?: boolean;
	port?: number | string;
	background?: boolean;
	stdio?: 'inherit' | 'pipe';
};

function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

export { TreeseedWorkflowError };
export type { TreeseedWorkflowErrorCode };

export class TreeseedWorkflowSdk {
	constructor(private readonly context: TreeseedWorkflowContext = {}) {}

	private helpers() {
		const context = {
			transport: 'sdk' as const,
			...this.context,
		};
		return {
			context,
			cwd: () => resolveTreeseedWorkflowPaths(context.cwd ?? process.cwd()).cwd,
			write: context.write ?? defaultWrite,
			runStatus: async () => this.status(),
			runTasks: async () => this.tasks(),
		};
	}

	async execute(operation: TreeseedWorkflowOperationId, input: Record<string, unknown> = {}) {
		switch (operation) {
			case 'status':
				return this.status();
			case 'tasks':
				return this.tasks();
			case 'config':
				return this.config(input as TreeseedConfigInput);
			case 'switch':
				return this.switchTask(input as TreeseedSwitchInput);
			case 'dev':
				return this.dev(input as TreeseedWorkflowDevInput);
			case 'save':
				return this.save(input as TreeseedSaveInput);
			case 'close':
				return this.close(input as TreeseedCloseInput);
			case 'stage':
				return this.stage(input as TreeseedStageInput);
			case 'release':
				return this.release(input as TreeseedReleaseInput);
			case 'resume':
				return this.resume(input as TreeseedResumeInput);
			case 'recover':
				return this.recover(input as TreeseedRecoverInput);
			case 'destroy':
				return this.destroy(input as TreeseedDestroyInput);
			case 'export':
				return this.export(input as TreeseedExportInput);
			default:
				throw new Error(`Unsupported workflow operation "${operation}".`);
		}
	}

	async status(): Promise<TreeseedWorkflowResult<ReturnType<typeof resolveTreeseedWorkflowState>>> {
		return workflowStatus(this.helpers());
	}

	async tasks(): Promise<TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[]; workstreams: TreeseedWorkflowWorkstreamSummary[] }>> {
		return workflowTasks(this.helpers());
	}

	async config(input: TreeseedConfigInput = {}): Promise<TreeseedWorkflowResult> {
		return workflowConfig(this.helpers(), input);
	}

	async switchTask(input: TreeseedSwitchInput): Promise<TreeseedWorkflowResult> {
		return workflowSwitch(this.helpers(), input);
	}

	async dev(input: TreeseedWorkflowDevInput = {}): Promise<TreeseedWorkflowResult> {
		return workflowDev(this.helpers(), input);
	}

	async save(input: TreeseedSaveInput): Promise<TreeseedWorkflowResult> {
		return workflowSave(this.helpers(), input);
	}

	async close(input: TreeseedCloseInput): Promise<TreeseedWorkflowResult> {
		return workflowClose(this.helpers(), input);
	}

	async stage(input: TreeseedStageInput): Promise<TreeseedWorkflowResult> {
		return workflowStage(this.helpers(), input);
	}

	async release(input: TreeseedReleaseInput): Promise<TreeseedWorkflowResult> {
		return workflowRelease(this.helpers(), input);
	}

	async resume(input: TreeseedResumeInput): Promise<TreeseedWorkflowResult> {
		return workflowResume(this.helpers(), input);
	}

	async recover(input: TreeseedRecoverInput = {}): Promise<TreeseedWorkflowResult> {
		return workflowRecover(this.helpers(), input);
	}

	async destroy(input: TreeseedDestroyInput): Promise<TreeseedWorkflowResult> {
		return workflowDestroy(this.helpers(), input);
	}

	async export(input: TreeseedExportInput = {}): Promise<TreeseedWorkflowResult> {
		return workflowExport(this.helpers(), input);
	}
}
