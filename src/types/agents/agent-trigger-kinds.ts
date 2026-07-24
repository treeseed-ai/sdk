


export const AGENT_TRIGGER_KINDS = ['schedule', 'message', 'follow', 'startup'] as const;

export const AGENT_PERMISSION_OPERATIONS = [
	'get',
	'read',
	'search',
	'follow',
	'pick',
	'create',
	'update',
] as const;

export const AGENT_MESSAGE_STATUSES = [
	'pending',
	'claimed',
	'completed',
	'failed',
	'dead_letter',
] as const;

export const AGENT_RUN_STATUSES = ['running', 'completed', 'failed', 'waiting'] as const;

export const AGENT_HANDLER_KINDS = [
	'writer',
	'actor',
	'estimate',
	'releaser',
	'reporter',
] as const;

export const AGENT_ACTIVITY_TYPES = [
	'planning',
	'estimating',
	'acting',
	'reviewing',
	'reporting',
] as const;

export const ENGINEERING_HANDLER_KINDS = [
	'writer',
	'actor',
	'estimate',
	'releaser',
	'reporter',
] as const;

export const AGENT_CLI_ALLOW_TOOLS = [
	'shell(git)',
	'shell(npm)',
	'web',
] as const;

export const EXECUTION_RESOURCE_NEED_KINDS = [
	'repository',
	'treedx_workspace',
	'workflow',
	'secret',
	'external_issue',
	'external_job',
] as const;

export const EXECUTION_PROVIDER_KINDS = [
	'ai_model',
	'human_issue_queue',
	'deterministic_workflow',
	'local_process',
] as const;

export const BUILT_IN_AGENT_EXECUTION_PROVIDER_IDS = [
	'codex',
	'copilot',
	'jira',
	'github_issues',
	'discord',
	'workflow',
] as const;

export const EXECUTION_RUN_STATUSES = [
	'accepted',
	'running',
	'waiting',
	'blocked',
	'completed',
	'returned',
	'failed',
	'cancelled',
] as const;

export const EXECUTION_PROVIDER_PRESSURE_STATES = [
	'idle',
	'normal',
	'busy',
	'throttled',
	'exhausted',
] as const;

export const EXECUTION_PROVIDER_QUOTA_VISIBILITIES = [
	'opaque',
	'partial',
	'exact',
] as const;

export type AgentTriggerKind = (typeof AGENT_TRIGGER_KINDS)[number];

export type AgentPermissionOperation = (typeof AGENT_PERMISSION_OPERATIONS)[number];

export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export type AgentHandlerKind = string;

export type AgentActivityType = (typeof AGENT_ACTIVITY_TYPES)[number];

export type EngineeringHandlerKind = (typeof ENGINEERING_HANDLER_KINDS)[number];

export type AgentCliAllowTool = (typeof AGENT_CLI_ALLOW_TOOLS)[number];

export type ExecutionResourceNeedKind = (typeof EXECUTION_RESOURCE_NEED_KINDS)[number] | string;

export type ExecutionProviderKind = (typeof EXECUTION_PROVIDER_KINDS)[number] | string;

export type BuiltInAgentExecutionProviderId = (typeof BUILT_IN_AGENT_EXECUTION_PROVIDER_IDS)[number];

export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];

export type ExecutionProviderPressure = (typeof EXECUTION_PROVIDER_PRESSURE_STATES)[number];

export type ExecutionProviderQuotaVisibility = (typeof EXECUTION_PROVIDER_QUOTA_VISIBILITIES)[number];

export interface AgentTriggerConfig {
	type: AgentTriggerKind;
	cron?: string;
	messageTypes?: string[];
	models?: string[];
	sinceField?: string;
	runOnStart?: boolean;
}

export interface AgentPermissionConfig {
	model: string;
	operations: AgentPermissionOperation[];
}

export interface AgentContentPermission {
	model: string;
	operations: Array<'read' | 'create' | 'update' | 'link' | 'comment' | string>;
	filters?: Record<string, unknown>;
}

export interface AgentModePermissionPolicy {
	content?: {
		read?: AgentContentPermission[];
		write?: AgentContentPermission[];
	};
	repository?: {
		readPaths?: string[];
		writePaths?: string[];
		allowCodeMutation?: boolean;
	};
	network?: {
		allowWeb?: boolean;
		allowedDomains?: string[];
	};
	shell?: {
		allowCommands?: boolean;
		allowedCommands?: string[];
		deniedCommands?: string[];
	};
}

export interface AgentPermissionPolicy {
	modes?: {
		planning?: AgentModePermissionPolicy;
		acting?: AgentModePermissionPolicy;
	};
}

export interface AgentOutputContract {
	messageTypes: string[];
	modelMutations: string[];
}

export interface AgentToolPolicy {
	allowed: string[];
	denied?: string[];
}

export interface AgentContentScope {
	models: string[];
	actions?: import('../../operations/content-operations.ts').ContentAction[];
	books?: string[];
	paths?: string[];
	relations?: string[];
}

export interface AgentContentAccessPolicy {
	read?: AgentContentScope;
	write?: AgentContentScope;
	commit?: {
		allowed: boolean;
	};
}

export type AgentBranchPolicy =
	| { kind: 'read-only'; base: 'main' | 'staging' }
	| { kind: 'main-planning-content'; base: 'main' }
	| { kind: 'staging-content'; base: 'staging' }
	| {
		kind: 'assignment-feature';
		base: 'staging';
		target: 'staging';
		prefix?: string;
		branchNameTemplate?: string;
		worktree?: 'new' | 'reuse';
		updateBaseBeforeRun?: boolean;
		mergeTargetBeforeSave?: boolean;
	}
	| { kind: 'staging-release'; base: 'staging'; target: 'main' };

export type AgentQuestionAnswerPolicy =
	| { kind: 'team-human'; teamId?: string; requiredRoles?: string[] }
	| { kind: 'human-or-agent'; teamId?: string; allowedRoles?: string[]; allowedAgentClasses?: string[] }
	| { kind: 'specific-human'; teamMemberId: string }
	| { kind: 'specific-agent'; projectId: string; agentSlug: string };

export interface AgentQuestionPolicy {
	defaultAnswerPolicy?: AgentQuestionAnswerPolicy;
	blockExecutionWhenCreated?: boolean;
}

export interface AgentActivityPromptConfig {
	system: string;
	task?: string;
	templates?: Record<string, string>;
}

export interface AgentActivityExecutionConfig {
	providerPreference?: string[];
	maxRuntimeSeconds?: number;
	maxRetries?: number;
	verificationRequired?: boolean;
	allowedPaths?: string[];
	forbiddenPaths?: string[];
}

export interface AgentActivityPlanningIntent {
	objective?: string;
	artifactKind?: string;
	subjectModel?: string;
	subjectId?: string | null;
	includeWorkdayArtifacts?: boolean;
}
