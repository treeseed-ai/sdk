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
	actions?: import('../content-operations.ts').TreeseedContentAction[];
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

export interface AgentActivityProfile {
	activityType?: AgentActivityType;
	enabled: boolean;
	handler: EngineeringHandlerKind;
	prompt: AgentActivityPromptConfig;
	branchPolicy: AgentBranchPolicy;
	contentAccess?: AgentContentAccessPolicy;
	tools: AgentToolPolicy;
	outputs: AgentOutputContract;
	planningIntent?: AgentActivityPlanningIntent;
	questionPolicy?: AgentQuestionPolicy;
	execution?: AgentActivityExecutionConfig;
}

export type AgentActivityProfilesConfiguration = Partial<Record<AgentActivityType, AgentActivityProfile>>;

export interface AgentCapability {
	id: string;
	description?: string;
	produces?: string[];
	requires?: string[];
	reviews?: string[];
	metadata?: Record<string, unknown>;
}

export interface AgentDefinitionIdentity {
	purpose: string;
	responsibilities: string[];
	durableInstructions: string;
}

export interface AgentDefinition {
	slug: string;
	title: string;
	agentClass: string;
	template?: string;
	identity: AgentDefinitionIdentity;
	capabilities: AgentCapability[];
	activityProfiles: Partial<Record<AgentActivityType, AgentActivityProfile>>;
}

export interface AgentExecutionConfig {
	provider?: string;
	model?: string;
	approvalPolicy?: 'never' | 'on_request' | 'always' | string;
	sandboxMode?: 'read_only' | 'workspace_write' | string;
	reasoningEffort?: 'low' | 'medium' | 'high' | string;
	allowedPaths?: string[];
	forbiddenPaths?: string[];
	worktree?: {
		enabled?: boolean;
		root?: string;
		branchPrefix?: string;
	};
	maxConcurrency: number;
	timeoutSeconds: number;
	cooldownSeconds: number;
	leaseSeconds: number;
	retryLimit: number;
	branchPrefix: string;
	providerProfile?: AgentProviderProfile;
}

export type AgentProviderFallbackPolicy =
	| 'allow_substitution'
	| 'require_same_model_class'
	| 'fail_if_unavailable'
	| 'ask_for_approval';

export interface AgentExecutionProviderPreference {
	providerId?: string;
	provider?: string;
	model?: string;
	modelClass?: string;
	weight: number;
	reason?: string;
}

export interface AgentProviderFallback {
	providerId?: string;
	provider?: string;
	model?: string;
	modelClass?: string;
	maxQualityPenalty?: number;
}

export interface AgentProviderProfile {
	requiredCapabilities: string[];
	preferredExecutionProviders: AgentExecutionProviderPreference[];
	acceptableFallbacks: AgentProviderFallback[];
	disallowedProviders?: string[];
	disallowedRegions?: string[];
	fallbackPolicy: AgentProviderFallbackPolicy;
}

export interface ExecutionResourceNeed {
	kind: ExecutionResourceNeedKind;
	operations: string[];
	paths?: string[];
	required?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ExecutionCapabilityDemand {
	required: string[];
	preferred?: string[];
	mode: 'planning' | 'acting';
	resourceNeeds?: ExecutionResourceNeed[];
	outputTypes?: string[];
	metadata?: Record<string, unknown>;
}

export interface ExecutionCapabilitySupply {
	capacityProviderId: string;
	executionProviderId: string;
	kind: ExecutionProviderKind;
	capabilities: string[];
	aliases?: string[];
	grants: string[];
	availability?: Record<string, unknown>;
	pressure?: ExecutionProviderPressure;
	maxConcurrentAssignments?: number;
	nativeUnit?: string;
	quotaVisibility?: ExecutionProviderQuotaVisibility;
	metadata?: Record<string, unknown>;
}

export interface AgentExpectedOutput {
	type: string;
	required: boolean;
	description?: string;
	schema?: Record<string, unknown>;
}

export interface AgentWorkPackageConstraints {
	mode: 'planning' | 'acting';
	requiredCapabilities: string[];
	allowedPaths?: string[];
	forbiddenPaths?: string[];
	allowedOperations?: string[];
	deadline?: string | null;
	maxAttempts?: number | null;
	metadata?: Record<string, unknown>;
}

export type AgentHandlerAlgorithmKind = EngineeringHandlerKind;
export type AgentWorkPackageKind = AgentHandlerAlgorithmKind | string;

export interface AgentInputSelector {
	source: string;
	path?: string;
	required?: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentOutputTemplate {
	type: string;
	template?: string;
	required?: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentReviewCriterion {
	id: string;
	description: string;
	required?: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentPlanningPolicy {
	prioritization?: string;
	maxCandidates?: number;
	metadata?: Record<string, unknown>;
}

export interface AgentReportTemplate {
	kind: string;
	title?: string;
	sections?: string[];
	metadata?: Record<string, unknown>;
}

export interface AgentHandlerConfig {
	workPackageKind?: AgentWorkPackageKind;
	domain?: string;
	inputSelectors?: AgentInputSelector[];
	outputTemplates?: AgentOutputTemplate[];
	reviewCriteria?: AgentReviewCriterion[];
	planningPolicy?: AgentPlanningPolicy;
	reportTemplate?: AgentReportTemplate;
	delegation?: {
		required?: boolean;
		allowedProviderKinds?: string[];
		reason?: string;
	};
	resourceNeeds?: ExecutionResourceNeed[];
	metadata?: Record<string, unknown>;
}

export interface AgentWorkPackage {
	kind: AgentWorkPackageKind;
	title: string;
	summary: string;
	instructions: string;
	context: Record<string, unknown>;
	expectedOutputs: AgentExpectedOutput[];
	constraints: AgentWorkPackageConstraints;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderDescriptor {
	id: string;
	kind: ExecutionProviderKind;
	capabilities: string[];
	capabilityAliases?: string[];
	nativeUnit: string;
	quotaVisibility: ExecutionProviderQuotaVisibility;
	maxConcurrentAssignments: number;
	supportsAsync: boolean;
	supportsCancel: boolean;
	supportsResume: boolean;
	supportsUsage: boolean;
	supportsArtifacts: boolean;
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderObserveInput {
	capacityProviderId?: string | null;
	executionProviderId?: string | null;
	runnerId?: string | null;
	activeAssignmentIds?: string[];
	metadata?: Record<string, unknown>;
}

export interface ExecutionProviderObservation {
	descriptor?: ExecutionProviderDescriptor;
	supply?: ExecutionCapabilitySupply;
	pressure?: ExecutionProviderPressure;
	available?: boolean;
	activeAssignmentCount?: number;
	blockedReason?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ExecutionPreparationResult {
	accepted: boolean;
	summary: string;
	retryable?: boolean;
	code?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ExecutionRunRef {
	assignmentId: string;
	executionProviderId?: string | null;
	runId: string;
	externalRef?: string | null;
	externalUrl?: string | null;
	leaseToken?: string | null;
	runnerId?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ExecutionUsageActual {
	kind: string;
	unit: string;
	amount: number;
	source?: string | null;
	partial?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ExecutionArtifactRef {
	kind: string;
	name?: string | null;
	uri?: string | null;
	externalUrl?: string | null;
	mediaType?: string | null;
	digest?: string | null;
	metadata?: Record<string, unknown>;
}

export interface ExecutionWorkspaceContext {
	repoRoot?: string | null;
	workspaceId?: string | null;
	accessMode?: string | null;
	allowedPaths?: string[];
	forbiddenPaths?: string[];
	capabilityHandleIds?: string[];
	metadata?: Record<string, unknown>;
}

export interface ExecutionRunSnapshot {
	status: ExecutionRunStatus;
	summary: string;
	runId?: string | null;
	externalRef?: string | null;
	externalUrl?: string | null;
	outputs?: Record<string, unknown>;
	usage?: ExecutionUsageActual[];
	artifacts?: ExecutionArtifactRef[];
	retryable?: boolean;
	code?: string | null;
	metadata?: Record<string, unknown>;
}

export interface AgentTriggerPolicy {
	maxRunsPerCycle?: number;
	messageBatchSize?: number;
}

export interface AgentCliOptions {
	model?: string;
	allowTools?: AgentCliAllowTool[];
	additionalArgs?: string[];
}

export interface AgentRuntimeSpec {
	slug: string;
	handler: AgentHandlerKind;
	activityType?: AgentActivityType;
	activityProfiles?: Partial<Record<AgentActivityType, AgentActivityProfile>>;
	branchPolicy?: AgentBranchPolicy;
	questionPolicy?: AgentQuestionPolicy;
	identity?: AgentDefinitionIdentity;
	projectAgentClassId?: string;
	projectAgentClassSlug?: string;
	activityConfig?: AgentHandlerConfig;
	enabled: boolean;
	systemPrompt: string;
	persona: string;
	cli: AgentCliOptions;
	triggers: AgentTriggerConfig[];
	triggerPolicy?: AgentTriggerPolicy;
	permissions: AgentPermissionConfig[];
	permissionPolicy?: AgentPermissionPolicy;
	tools: AgentToolPolicy;
	contentAccess?: AgentContentAccessPolicy;
	context?: {
		queries?: import('../graph/context-query-contracts.ts').DeclarativeContextQuery[];
	};
	execution: AgentExecutionConfig;
	outputs: AgentOutputContract;
}

export interface AgentMessageRecord {
	[key: string]: unknown;
	id: number;
	type: string;
	status: AgentMessageStatus;
	payloadJson: string;
	relatedModel: string | null;
	relatedId: string | null;
	priority: number;
	availableAt: string;
	claimedBy: string | null;
	claimedAt: string | null;
	leaseExpiresAt: string | null;
	attempts: number;
	maxAttempts: number;
	createdAt: string;
	updatedAt: string;
}

export interface AgentRunRecord {
	[key: string]: unknown;
	runId: string;
	agentSlug: string;
	triggerSource: string;
	status: AgentRunStatus;
	selectedItemKey: string | null;
	selectedMessageId: number | null;
	branchName: string | null;
	prUrl: string | null;
	summary: string | null;
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
}

export interface ContentLeaseRecord {
	[key: string]: unknown;
	model: string;
	itemKey: string;
	claimedBy: string;
	claimedAt: string;
	leaseExpiresAt: string;
	token: string;
}
