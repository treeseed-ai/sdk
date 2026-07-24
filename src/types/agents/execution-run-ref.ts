
import { AgentActivityType, AgentBranchPolicy, AgentCliAllowTool, AgentContentAccessPolicy, AgentHandlerKind, AgentMessageStatus, AgentOutputContract, AgentPermissionConfig, AgentPermissionPolicy, AgentQuestionPolicy, AgentRunStatus, AgentToolPolicy, AgentTriggerConfig, ExecutionRunStatus } from './agent-trigger-kinds.ts';
import { AgentActivityProfile, AgentDefinitionIdentity, AgentExecutionConfig, AgentHandlerConfig } from './agent-activity-profile.ts';

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
		queries?: import('../../graph/context-query-contracts.ts').DeclarativeContextQuery[];
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
