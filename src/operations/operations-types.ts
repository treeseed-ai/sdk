export type OperationGroup =
	| 'Workflow'
	| 'Local Development'
	| 'Validation'
	| 'Release Utilities'
	| 'Utilities'
	| 'Passthrough';

export type OperationId =
	| 'workspace.status'
	| 'workspace.doctor'
	| 'branch.tasks'
	| 'branch.switch'
	| 'branch.save'
	| 'branch.close'
	| 'branch.stage'
	| 'deploy.release'
	| 'deploy.rollback'
	| 'deploy.destroy'
	| 'workspace.resume'
	| 'workspace.recover'
	| 'template.list'
	| 'template.show'
	| 'template.validate'
	| 'template.sync'
	| 'project.init'
	| 'project.config'
	| 'local.dev'
	| 'local.devWatch'
	| 'local.build'
	| 'local.check'
	| 'local.preview'
	| 'local.lint'
	| 'local.test'
	| 'validation.testUnit'
	| 'validation.preflight'
	| 'validation.authCheck'
	| 'auth.login'
	| 'auth.logout'
	| 'auth.whoami'
	| 'release.testE2e'
	| 'release.testE2eLocal'
	| 'release.testE2eStaging'
	| 'release.testE2eFull'
	| 'release.testFast'
	| 'release.verify'
	| 'release.publishChanged'
	| 'data.d1MigrateLocal'
	| 'content.cleanupMarkdown'
	| 'content.cleanupMarkdownCheck'
	| 'project.export'
	| 'tools.astro'
	| 'tools.syncDevvars'
	| 'tools.starlightPatch'
	| 'agents.run';

export type OperationProviderId = 'default';

export type OperationMetadata = {
	id: OperationId;
	name: string;
	aliases: string[];
	group: OperationGroup;
	summary: string;
	description: string;
	provider: OperationProviderId;
	related?: string[];
};

export type OperationRequest = {
	operationName: string;
	input?: Record<string, unknown>;
};

export type OperationResult<TPayload = Record<string, unknown>> = {
	operation: OperationId;
	ok: boolean;
	payload?: TPayload | null;
	meta?: Record<string, unknown>;
	nextSteps?: Array<{
		operation: string;
		reason?: string;
		input?: Record<string, unknown>;
	}>;
	exitCode?: number;
	stdout?: string[];
	stderr?: string[];
	report?: Record<string, unknown> | null;
};

export type OperationWriter = (output: string, stream?: 'stdout' | 'stderr') => void;
export type OperationPrompt = (message: string) => Promise<string> | string;
export type OperationConfirm = (message: string, expected: string) => Promise<boolean> | boolean;
export type OperationSpawn = (
	command: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		stdio?: 'inherit' | 'pipe';
		timeout?: number;
		killSignal?: NodeJS.Signals;
	},
) => { status?: number | null };

export type OperationContext = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write?: OperationWriter;
	onProgress?: (event: Record<string, unknown>) => void | Promise<void>;
	spawn?: OperationSpawn;
	outputFormat?: 'human' | 'json';
	prompt?: OperationPrompt;
	confirm?: OperationConfirm;
	transport?: 'sdk' | 'cli' | 'api';
};

export type OperationFailureCode =
	| 'validation_failed'
	| 'merge_conflict'
	| 'missing_runtime_auth'
	| 'deployment_timeout'
	| 'confirmation_required'
	| 'unsupported_transport'
	| 'unsupported_state'
	| 'workflow_locked'
	| 'resume_unavailable'
	| 'workflow_contract_missing'
	| 'provider_resolution_failed';

export class OperationError extends Error {
	code: OperationFailureCode;
	operation: string;
	details?: Record<string, unknown>;
	exitCode?: number;

	constructor(
		operation: string,
		code: OperationFailureCode,
		message: string,
		options: { details?: Record<string, unknown>; exitCode?: number } = {},
	) {
		super(message);
		this.name = 'TreeseedOperationError';
		this.operation = operation;
		this.code = code;
		this.details = options.details;
		this.exitCode = options.exitCode;
	}
}

export interface OperationImplementation<
	TInput extends Record<string, unknown> = Record<string, unknown>,
	TPayload = Record<string, unknown>,
> {
	readonly metadata: OperationMetadata;
	execute(input: TInput, context: OperationContext): Promise<OperationResult<TPayload>>;
}

export interface OperationProvider {
	readonly id: OperationProviderId | string;
	listOperations(): OperationImplementation[];
	findOperation(name: string | null | undefined): OperationImplementation | null;
}
