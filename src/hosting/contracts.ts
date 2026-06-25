import type { TreeseedDeployConfig } from '../platform/contracts.ts';
import type { TreeseedDiscoveredApplication } from './apps.ts';

export type TreeseedHostingEnvironment = 'local' | 'staging' | 'prod';

export type TreeseedHostCapability =
	| 'project'
	| 'environment'
	| 'container'
	| 'volume'
	| 'database'
	| 'domain'
	| 'dns'
	| 'object-store'
	| 'web-site'
	| 'source-repository'
	| 'workflow'
	| 'email-relay'
	| 'scheduled-job'
	| 'process'
	| 'secret'
	| 'variable'
	| 'deployment'
	| 'health'
	| 'logs'
	| 'port'
	| 'hot-reload';

export type TreeseedServicePlacement =
	| 'web'
	| 'api'
	| 'database'
	| 'knowledge-library'
	| 'runner-capacity'
	| 'repository'
	| 'content-storage'
	| 'email'
	| 'operations'
	| 'custom';

export type TreeseedHostingAction = 'noop' | 'create' | 'update' | 'verify' | 'rename' | 'adopt' | 'reattach' | 'retain' | 'delete' | 'blocked';
export type TreeseedHostingStatus = 'unknown' | 'pending' | 'ready' | 'degraded' | 'blocked';

export interface TreeseedHostCapabilityDescriptor {
	id: TreeseedHostCapability;
	environments: TreeseedHostingEnvironment[];
}

export interface TreeseedHostAdapterOperationInput {
	environment: TreeseedHostingEnvironment;
	unit: TreeseedHostingUnit;
	graph: TreeseedHostingGraph;
	dryRun?: boolean;
}

export interface TreeseedHostAdapterOperationResult {
	status: TreeseedHostingStatus;
	locators: Record<string, string | null>;
	state: Record<string, unknown>;
	warnings: string[];
}

export interface TreeseedHostAdapter {
	id: string;
	label: string;
	capabilities: TreeseedHostCapabilityDescriptor[];
	refresh(input: TreeseedHostAdapterOperationInput): Promise<TreeseedHostAdapterOperationResult> | TreeseedHostAdapterOperationResult;
	diff(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): Promise<TreeseedHostingUnitPlan> | TreeseedHostingUnitPlan;
	apply(input: TreeseedHostAdapterOperationInput & { plan: TreeseedHostingUnitPlan }): Promise<TreeseedHostAdapterOperationResult> | TreeseedHostAdapterOperationResult;
	verify(input: TreeseedHostAdapterOperationInput & { observed: TreeseedHostAdapterOperationResult }): Promise<TreeseedHostingVerification> | TreeseedHostingVerification;
	status(input: TreeseedHostAdapterOperationInput): Promise<TreeseedHostAdapterOperationResult> | TreeseedHostAdapterOperationResult;
}

export interface TreeseedServiceTypeAdapter {
	id: string;
	label: string;
	placement: TreeseedServicePlacement;
	requiredCapabilities: TreeseedHostCapability[];
	composes?: string[];
	defaultHostByEnvironment?: Partial<Record<TreeseedHostingEnvironment, string>>;
	describe?(unit: TreeseedHostingUnit): string;
}

export interface TreeseedHostingEnvironmentBinding {
	hostId: string;
	projectGroupId?: string;
	enabled?: boolean;
	config?: Record<string, unknown>;
}

export interface TreeseedServiceInstanceSpec {
	id: string;
	label: string;
	serviceType: string;
	placement?: TreeseedServicePlacement;
	dependencies?: string[];
	projectGroupId?: string;
	config?: Record<string, unknown>;
	secretRefs?: string[];
	variableRefs?: string[];
	environments?: Partial<Record<TreeseedHostingEnvironment, TreeseedHostingEnvironmentBinding>>;
	metadata?: Record<string, unknown>;
}

export interface TreeseedHostProjectGroup {
	id: string;
	label: string;
	hostId: string;
	environments: Partial<Record<TreeseedHostingEnvironment, {
		projectName?: string;
		projectId?: string;
		environmentName?: string;
		environmentId?: string;
		sharedAcrossEnvironments?: boolean;
	}>>;
	metadata?: Record<string, unknown>;
}

export interface TreeseedApplicationHostingProfile {
	id: string;
	label: string;
	description?: string;
	services: TreeseedServiceInstanceSpec[];
	projectGroups?: TreeseedHostProjectGroup[];
	metadata?: Record<string, unknown>;
}

export interface TreeseedHostingGraphInput {
	tenantRoot: string;
	environment: TreeseedHostingEnvironment;
	configRoot?: string;
	appId?: string;
	deployConfig?: TreeseedDeployConfig;
	hostAdapters?: Record<string, TreeseedHostAdapter>;
	serviceTypeAdapters?: Record<string, TreeseedServiceTypeAdapter>;
	profiles?: TreeseedApplicationHostingProfile[];
	filter?: TreeseedHostingGraphFilter;
}

export interface TreeseedHostingGraphFilter {
	serviceIds?: string[];
	placements?: TreeseedServicePlacement[];
	hosts?: string[];
}

export interface TreeseedHostingUnit {
	id: string;
	label: string;
	serviceType: TreeseedServiceTypeAdapter;
	placement: TreeseedServicePlacement;
	host: TreeseedHostAdapter;
	environment: TreeseedHostingEnvironment;
	projectGroup: TreeseedHostProjectGroup | null;
	dependencies: string[];
	requiredCapabilities: TreeseedHostCapability[];
	config: Record<string, unknown>;
	secretRefs: string[];
	variableRefs: string[];
	metadata: Record<string, unknown>;
	application?: Pick<TreeseedDiscoveredApplication, 'id' | 'root' | 'relativeRoot' | 'configPath' | 'roles'>;
}

export interface TreeseedHostingGraph {
	tenantRoot: string;
	environment: TreeseedHostingEnvironment;
	deployConfig: TreeseedDeployConfig;
	applications?: TreeseedDiscoveredApplication[];
	hosts: Record<string, TreeseedHostAdapter>;
	serviceTypes: Record<string, TreeseedServiceTypeAdapter>;
	profiles: TreeseedApplicationHostingProfile[];
	projectGroups: Record<string, TreeseedHostProjectGroup>;
	units: TreeseedHostingUnit[];
	placements: TreeseedHostingPlacementSummary[];
	warnings: string[];
}

export interface TreeseedHostingUnitPlan {
	unitId: string;
	action: TreeseedHostingAction;
	reasons: string[];
	before: Record<string, unknown>;
	after: Record<string, unknown>;
	warnings: string[];
	actions?: TreeseedHostingAction[];
	retainedResources?: unknown[];
	blockedDrift?: unknown[];
	providerLimitations?: unknown[];
}

export interface TreeseedHostingVerificationCheck {
	key: string;
	label: string;
	ok: boolean;
	expected?: unknown;
	observed?: unknown;
	issues: string[];
}

export interface TreeseedHostingVerification {
	unitId: string;
	status: TreeseedHostingStatus;
	verified: boolean;
	checks: TreeseedHostingVerificationCheck[];
	warnings: string[];
}

export interface TreeseedHostingPlan {
	environment: TreeseedHostingEnvironment;
	dryRun: boolean;
	units: Array<{
		unit: TreeseedHostingUnit;
		observed: TreeseedHostAdapterOperationResult;
		plan: TreeseedHostingUnitPlan;
		verification: TreeseedHostingVerification;
	}>;
	placements: TreeseedHostingPlacementSummary[];
	warnings: string[];
}

export interface TreeseedHostingApplyResult {
	environment: TreeseedHostingEnvironment;
	dryRun: boolean;
	selectedApps?: string[];
	selectedSystems?: string[];
	skippedSystems?: Array<{ system: string; reason: string }>;
	transport?: Record<string, Record<string, string>>;
	results: Array<{
		unit: TreeseedHostingUnit;
		plan: TreeseedHostingUnitPlan;
		result: TreeseedHostAdapterOperationResult;
		verification: TreeseedHostingVerification;
	}>;
	placements: TreeseedHostingPlacementSummary[];
	warnings: string[];
}

export interface TreeseedHostingPlacementSummary {
	placement: TreeseedServicePlacement;
	label: string;
	serviceIds: string[];
	hostIds: string[];
	status: TreeseedHostingStatus;
	advanced: boolean;
}

export interface TreeseedPersistedHostingLocator {
	unitId: string;
	serviceType: string;
	hostId: string;
	environment: TreeseedHostingEnvironment;
	projectGroupId: string | null;
	locators: Record<string, string | null>;
	updatedAt: string;
}
