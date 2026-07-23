
import { AgentActivityExecutionConfig, AgentActivityPlanningIntent, AgentActivityPromptConfig, AgentActivityType, AgentBranchPolicy, AgentContentAccessPolicy, AgentOutputContract, AgentQuestionPolicy, AgentToolPolicy, EngineeringHandlerKind, ExecutionProviderKind, ExecutionProviderPressure, ExecutionProviderQuotaVisibility, ExecutionResourceNeedKind } from './agent-trigger-kinds.ts';

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
