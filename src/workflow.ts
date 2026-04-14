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
	workflowRelease,
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
	| 'destroy'
	| 'export';

export type TreeseedWorkflowNextStep = {
	operation: string;
	reason?: string;
	input?: Record<string, unknown>;
};

export type TreeseedWorkflowContext = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	write?: (output: string, stream?: 'stdout' | 'stderr') => void;
	prompt?: (message: string) => Promise<string> | string;
	confirm?: (message: string, expected: string) => Promise<boolean> | boolean;
	transport?: 'sdk' | 'cli' | 'api';
};

export type TreeseedWorkflowResult<TPayload = Record<string, unknown>> = {
	ok: boolean;
	operation: TreeseedWorkflowOperationId;
	payload: TPayload;
	nextSteps?: TreeseedWorkflowNextStep[];
};

export type TreeseedTaskBranchMetadata = ReturnType<typeof listTaskBranches>[number] & {
	ageDays: number | null;
	dirtyCurrent: boolean;
	preview: {
		enabled: boolean;
		url: string | null;
		lastDeploymentTimestamp: string | null;
	};
};

export type TreeseedSaveInput = {
	message: string;
	hotfix?: boolean;
	verify?: boolean;
	refreshPreview?: boolean;
	preview?: boolean;
	rebase?: boolean;
};

export type TreeseedCloseInput = {
	message: string;
	deletePreview?: boolean;
	deleteBranch?: boolean;
	autoSave?: boolean;
};

export type TreeseedStageInput = {
	message: string;
	waitForStaging?: boolean;
	deletePreview?: boolean;
	deleteBranch?: boolean;
	autoSave?: boolean;
};

export type TreeseedSwitchInput = {
	branch?: string;
	branchName?: string;
	preview?: boolean;
	createIfMissing?: boolean;
	baseBranch?: string;
};

export type TreeseedConfigScope = 'all' | 'local' | 'staging' | 'prod';

export type TreeseedConfigInput = {
	target?: TreeseedConfigScope[] | TreeseedConfigScope;
	environment?: TreeseedConfigScope[] | TreeseedConfigScope;
	syncProviders?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	sync?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	updates?: Array<{ scope: Exclude<TreeseedConfigScope, 'all'>; entryId: string; value: string; reused?: boolean }>;
	repair?: boolean;
	printEnv?: boolean;
	printEnvOnly?: boolean;
	showSecrets?: boolean;
	rotateMachineKey?: boolean;
	nonInteractive?: boolean;
};

export type TreeseedExportInput = {
	directory?: string;
};

export type TreeseedReleaseInput = { bump: 'major' | 'minor' | 'patch' };

export type TreeseedDestroyInput = {
	target?: 'local' | 'staging' | 'prod';
	environment?: 'local' | 'staging' | 'prod';
	confirm?: boolean | string;
	dryRun?: boolean;
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

	async tasks(): Promise<TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[] }>> {
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

	async destroy(input: TreeseedDestroyInput): Promise<TreeseedWorkflowResult> {
		return workflowDestroy(this.helpers(), input);
	}

	async export(input: TreeseedExportInput = {}): Promise<TreeseedWorkflowResult> {
		return workflowExport(this.helpers(), input);
	}
}
