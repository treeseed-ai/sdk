export type TreeseedOperationGroup =
	| 'Workflow'
	| 'Local Development'
	| 'Validation'
	| 'Release Utilities'
	| 'Utilities'
	| 'Passthrough';

export type TreeseedOperationId =
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
	| 'services.mailpitUp'
	| 'services.mailpitDown'
	| 'services.mailpitLogs'
	| 'data.d1MigrateLocal'
	| 'content.cleanupMarkdown'
	| 'content.cleanupMarkdownCheck'
	| 'project.export'
	| 'tools.astro'
	| 'tools.syncDevvars'
	| 'tools.starlightPatch'
	| 'agents.run';

export type TreeseedOperationProviderId = 'default';

export type TreeseedOperationMetadata = {
	id: TreeseedOperationId;
	name: string;
	aliases: string[];
	group: TreeseedOperationGroup;
	summary: string;
	description: string;
	provider: TreeseedOperationProviderId;
	related?: string[];
};

export type TreeseedOperationRequest = {
	operationName: string;
	input?: Record<string, unknown>;
};

export type TreeseedOperationResult<TPayload = Record<string, unknown>> = {
	operation: TreeseedOperationId;
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

export type TreeseedOperationWriter = (output: string, stream?: 'stdout' | 'stderr') => void;
export type TreeseedOperationPrompt = (message: string) => Promise<string> | string;
export type TreeseedOperationConfirm = (message: string, expected: string) => Promise<boolean> | boolean;
export type TreeseedOperationSpawn = (
	command: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		stdio?: 'inherit';
	},
) => { status?: number | null };

export type TreeseedOperationContext = {
	cwd: string;
	env: NodeJS.ProcessEnv;
	write?: TreeseedOperationWriter;
	spawn?: TreeseedOperationSpawn;
	outputFormat?: 'human' | 'json';
	prompt?: TreeseedOperationPrompt;
	confirm?: TreeseedOperationConfirm;
	transport?: 'sdk' | 'cli' | 'api';
};

export type TreeseedOperationFailureCode =
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

export class TreeseedOperationError extends Error {
	code: TreeseedOperationFailureCode;
	operation: string;
	details?: Record<string, unknown>;
	exitCode?: number;

	constructor(
		operation: string,
		code: TreeseedOperationFailureCode,
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

export interface TreeseedOperationImplementation<
	TInput extends Record<string, unknown> = Record<string, unknown>,
	TPayload = Record<string, unknown>,
> {
	readonly metadata: TreeseedOperationMetadata;
	execute(input: TInput, context: TreeseedOperationContext): Promise<TreeseedOperationResult<TPayload>>;
}

export interface TreeseedOperationProvider {
	readonly id: TreeseedOperationProviderId | string;
	listOperations(): TreeseedOperationImplementation[];
	findOperation(name: string | null | undefined): TreeseedOperationImplementation | null;
}
