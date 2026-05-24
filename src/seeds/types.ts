export const SEED_ENVIRONMENTS = ['local', 'staging', 'prod'] as const;

export type SeedEnvironment = typeof SEED_ENVIRONMENTS[number];
export type SeedDiagnosticSeverity = 'error' | 'warning';
export type SeedPlanActionType = 'create' | 'update' | 'unchanged' | 'skip' | 'delete' | 'error';
export type SeedResourceKind =
	| 'team'
	| 'repositoryHost'
	| 'project'
	| 'hubRepository'
	| 'capacityProvider'
	| 'capacityLane'
	| 'capacityGrant'
	| 'workPolicy'
	| 'product'
	| 'catalogArtifact';

export type SeedDiagnostic = {
	severity: SeedDiagnosticSeverity;
	code: string;
	message: string;
	path?: string;
};

export type SeedResourceBase = {
	key: string;
	environments?: SeedEnvironment[];
};

export type SeedManifest = {
	name: string;
	version: 1;
	description?: string;
	defaultEnvironments?: SeedEnvironment[];
	environments: SeedEnvironment[];
	resources: SeedManifestResources;
};

export type SeedManifestResources = {
	teams: SeedTeamResource[];
	repositoryHosts: SeedRepositoryHostResource[];
	projects: SeedProjectResource[];
	hubRepositories: SeedHubRepositoryResource[];
	products: SeedProductResource[];
	catalogArtifacts: SeedCatalogArtifactResource[];
	capacityProviders: SeedCapacityProviderResource[];
	capacityGrants: SeedCapacityGrantResource[];
	workPolicies: SeedWorkPolicyResource[];
	agentPools: Record<string, unknown>[];
};

export type SeedTeamResource = SeedResourceBase & {
	slug: string;
	name?: string;
	displayName?: string;
	logoUrl?: string;
	profileSummary?: string;
	metadata?: Record<string, unknown>;
};

export type SeedProjectRepository = {
	role: string;
	provider: string;
	owner: string;
	name: string;
	gitUrl: string;
	defaultBranch?: string;
	checkoutPath?: string;
	submodulePath?: string;
	webUrl?: string;
};

export type SeedProjectResource = SeedResourceBase & {
	team: string;
	slug: string;
	name: string;
	description?: string;
	kind?: string;
	repository: SeedProjectRepository;
	metadata?: Record<string, unknown>;
};

export type SeedRepositoryHostResource = SeedResourceBase & {
	team: string;
	provider: string;
	name: string;
	ownership?: string;
	accountLabel?: string;
	organizationOrOwner: string;
	defaultVisibility?: string;
	softwareRepositoryNameTemplate?: string;
	contentRepositoryNameTemplate?: string;
	branchPolicy?: Record<string, unknown>;
	workflowPolicy?: Record<string, unknown>;
	allowedProjectKinds?: string[];
	status?: string;
	credentialRef?: string;
	metadata?: Record<string, unknown>;
};

export type SeedHubRepositoryResource = SeedResourceBase & {
	project: string;
	role: string;
	repositoryHost?: string;
	provider: string;
	owner: string;
	name: string;
	gitUrl: string;
	defaultBranch?: string;
	currentBranch?: string;
	submodulePath?: string;
	status?: string;
	accessPolicy?: Record<string, unknown>;
	releasePolicy?: Record<string, unknown>;
	publishPolicy?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};

export type SeedProductResource = SeedResourceBase & {
	team: string;
	kind: string;
	slug: string;
	title: string;
	summary?: string;
	visibility?: string;
	listingEnabled?: boolean;
	offerMode?: string;
	manifestKey?: string;
	artifactKey?: string;
	searchText?: string;
	metadata?: Record<string, unknown>;
};

export type SeedCatalogArtifactResource = SeedResourceBase & {
	product: string;
	version: string;
	kind: string;
	contentKey: string;
	manifestKey?: string;
	publishedAt?: string;
	metadata?: Record<string, unknown>;
};

export type SeedCapacityLaneResource = SeedResourceBase & {
	name: string;
	businessModel?: string;
	modelFamily?: string;
	modelClass?: string;
	regionPolicy?: string;
	unit?: string;
	scarcityLevel?: string;
	hardLimits?: Record<string, unknown>;
	routingPolicy?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};

export type SeedCapacityProviderRegistrationApiKey = {
	createIfMissing?: boolean;
	name?: string;
	scopes?: string[];
	expiresAt?: string;
};

export type SeedCapacityProviderRegistration = {
	apiKey?: SeedCapacityProviderRegistrationApiKey;
};

export type SeedExecutionProviderNativeLimitResource = {
	id?: string;
	scope?: string;
	limitScope?: string;
	nativeUnit?: string;
	limitAmount: number;
	reserveBufferPercent?: number;
	resetCadence?: string;
	resetAt?: string;
	confidence?: string;
	source?: string;
	metadata?: Record<string, unknown>;
};

export type SeedExecutionProviderResource = {
	id?: string;
	name: string;
	kind: string;
	status?: string;
	nativeUnit: string;
	quotaVisibility?: string;
	maxConcurrentWorkers?: number;
	resetCadence?: string;
	config?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	nativeLimits?: SeedExecutionProviderNativeLimitResource[];
};

export type SeedCapacityProviderResource = SeedResourceBase & {
	team: string;
	name: string;
	kind?: string;
	provider: string;
	billingScope?: string;
	creditBudgetMode?: 'static' | 'hybrid' | 'derived' | string;
	monthlyCreditBudget?: number;
	dailyCreditBudget?: number;
	maxConcurrentWorkdays?: number;
	maxConcurrentWorkers?: number;
	capacityModel?: Record<string, unknown>;
	registration?: SeedCapacityProviderRegistration;
	metadata?: Record<string, unknown>;
	lanes?: SeedCapacityLaneResource[];
	executionProviders?: SeedExecutionProviderResource[];
};

export type SeedCapacityGrantResource = SeedResourceBase & {
	provider: string;
	lane?: string;
	team: string;
	project?: string;
	environment?: SeedEnvironment;
	grantScope?: string;
	dailyCreditLimit?: number;
	weeklyCreditLimit?: number;
	monthlyCreditLimit?: number;
	dailyUsdLimit?: number;
	weeklyQuotaMinutes?: number;
	monthlyProviderUnits?: number;
	portfolioAllocationPercent?: number;
	reservePoolPercent?: number;
	maxDailyProjectCredits?: number;
	emergencyOverride?: boolean;
	priorityWeight?: number;
	overflowPolicy?: string;
	state?: string;
	metadata?: Record<string, unknown>;
};

export type SeedWorkPolicyResource = SeedResourceBase & {
	project: string;
	environment: SeedEnvironment;
	enabled?: boolean;
	startCron?: string;
	durationMinutes?: number;
	maxRunners?: number;
	maxWorkersPerRunner?: number;
	dailyCreditBudget?: number;
	maxQueuedTasks?: number;
	maxQueuedCredits?: number;
	autoscale?: Record<string, unknown>;
	creditWeights?: unknown[];
	metadata?: Record<string, unknown>;
};

export type NormalizedSeedResource = {
	kind: SeedResourceKind;
	key: string;
	label: string;
	environments: SeedEnvironment[];
	payload: Record<string, unknown>;
	parentKey?: string;
};

export type SeedPlanAction = NormalizedSeedResource & {
	action: SeedPlanActionType;
	reason?: string;
	existing?: Record<string, unknown> | null;
};

export type SeedPlanSummary = Record<SeedPlanActionType, number>;

export type SeedCurrentResource = {
	key: string;
	kind: SeedResourceKind;
	payload: Record<string, unknown>;
	existing?: Record<string, unknown> | null;
};

export type SeedPlan = {
	ok: boolean;
	seed: string;
	version: 1;
	mode: 'plan' | 'validate' | 'apply';
	environments: SeedEnvironment[];
	summary: SeedPlanSummary;
	actions: SeedPlanAction[];
	diagnostics: SeedDiagnostic[];
	manifestPath: string;
};
