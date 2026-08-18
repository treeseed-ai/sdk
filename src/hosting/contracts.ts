import type { DeployConfig } from '../platform/support/contracts.ts';
import type { DiscoveredApplication } from './apps.ts';

export type HostingEnvironment = 'local' | 'staging' | 'prod';

export type HostCapability =
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

export type ServicePlacement =
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

export type HostingAction = 'noop' | 'create' | 'update' | 'verify' | 'rename' | 'adopt' | 'reattach' | 'retain' | 'delete' | 'blocked';
export type HostingStatus = 'unknown' | 'pending' | 'ready' | 'degraded' | 'blocked';

export interface HostCapabilityDescriptor {
	id: HostCapability;
	environments: HostingEnvironment[];
}

export interface HostAdapterOperationInput {
	environment: HostingEnvironment;
	unit: HostingUnit;
	graph: HostingGraph;
	planOnly?: boolean;
}

export interface HostAdapterOperationResult {
	status: HostingStatus;
	locators: Record<string, string | null>;
	state: Record<string, unknown>;
	warnings: string[];
}

export interface HostAdapter {
	id: string;
	label: string;
	capabilities: HostCapabilityDescriptor[];
	refresh(input: HostAdapterOperationInput): Promise<HostAdapterOperationResult> | HostAdapterOperationResult;
	diff(input: HostAdapterOperationInput & { observed: HostAdapterOperationResult }): Promise<HostingUnitPlan> | HostingUnitPlan;
	apply(input: HostAdapterOperationInput & { plan: HostingUnitPlan }): Promise<HostAdapterOperationResult> | HostAdapterOperationResult;
	verify(input: HostAdapterOperationInput & { observed: HostAdapterOperationResult }): Promise<HostingVerification> | HostingVerification;
	status(input: HostAdapterOperationInput): Promise<HostAdapterOperationResult> | HostAdapterOperationResult;
}

export interface ServiceTypeAdapter {
	id: string;
	label: string;
	placement: ServicePlacement;
	requiredCapabilities: HostCapability[];
	composes?: string[];
	defaultHostByEnvironment?: Partial<Record<HostingEnvironment, string>>;
	describe?(unit: HostingUnit): string;
}

export interface HostingEnvironmentBinding {
	hostId: string;
	projectGroupId?: string;
	enabled?: boolean;
	config?: Record<string, unknown>;
}

export interface ServiceInstanceSpec {
	id: string;
	label: string;
	serviceType: string;
	placement?: ServicePlacement;
	dependencies?: string[];
	projectGroupId?: string;
	config?: Record<string, unknown>;
	secretRefs?: string[];
	variableRefs?: string[];
	environments?: Partial<Record<HostingEnvironment, HostingEnvironmentBinding>>;
	metadata?: Record<string, unknown>;
}

export interface HostProjectGroup {
	id: string;
	label: string;
	hostId: string;
	environments: Partial<Record<HostingEnvironment, {
		projectName?: string;
		projectId?: string;
		environmentName?: string;
		environmentId?: string;
		sharedAcrossEnvironments?: boolean;
	}>>;
	metadata?: Record<string, unknown>;
}

export interface ApplicationHostingProfile {
	id: string;
	label: string;
	description?: string;
	services: ServiceInstanceSpec[];
	projectGroups?: HostProjectGroup[];
	metadata?: Record<string, unknown>;
}

export interface HostingGraphInput {
	tenantRoot: string;
	environment: HostingEnvironment;
	env?: Record<string, string | undefined>;
	configRoot?: string;
	appId?: string;
	deployConfig?: DeployConfig;
	hostAdapters?: Record<string, HostAdapter>;
	serviceTypeAdapters?: Record<string, ServiceTypeAdapter>;
	profiles?: ApplicationHostingProfile[];
	filter?: HostingGraphFilter;
}

export interface HostingGraphFilter {
	serviceIds?: string[];
	placements?: ServicePlacement[];
	hosts?: string[];
}

export interface HostingUnit {
	id: string;
	label: string;
	serviceType: ServiceTypeAdapter;
	placement: ServicePlacement;
	host: HostAdapter;
	environment: HostingEnvironment;
	projectGroup: HostProjectGroup | null;
	dependencies: string[];
	requiredCapabilities: HostCapability[];
	config: Record<string, unknown>;
	secretRefs: string[];
	variableRefs: string[];
	metadata: Record<string, unknown>;
	application?: Pick<DiscoveredApplication, 'id' | 'root' | 'relativeRoot' | 'configPath' | 'roles'>;
}

export interface HostingGraph {
	tenantRoot: string;
	environment: HostingEnvironment;
	deployConfig: DeployConfig;
	applications?: DiscoveredApplication[];
	hosts: Record<string, HostAdapter>;
	serviceTypes: Record<string, ServiceTypeAdapter>;
	profiles: ApplicationHostingProfile[];
	projectGroups: Record<string, HostProjectGroup>;
	units: HostingUnit[];
	placements: HostingPlacementSummary[];
	warnings: string[];
}

export interface HostingUnitPlan {
	unitId: string;
	action: HostingAction;
	reasons: string[];
	before: Record<string, unknown>;
	after: Record<string, unknown>;
	warnings: string[];
	actions?: HostingAction[];
	retainedResources?: unknown[];
	blockedDrift?: unknown[];
	providerLimitations?: unknown[];
}

export interface HostingVerificationCheck {
	key: string;
	label: string;
	ok: boolean;
	expected?: unknown;
	observed?: unknown;
	issues: string[];
}

export interface HostingVerification {
	unitId: string;
	status: HostingStatus;
	verified: boolean;
	checks: HostingVerificationCheck[];
	warnings: string[];
}

export interface HostingPlan {
	environment: HostingEnvironment;
	planOnly: boolean;
	units: Array<{
		unit: HostingUnit;
		observed: HostAdapterOperationResult;
		plan: HostingUnitPlan;
		verification: HostingVerification;
	}>;
	placements: HostingPlacementSummary[];
	warnings: string[];
}

export interface HostingPlacementSummary {
	placement: ServicePlacement;
	label: string;
	serviceIds: string[];
	hostIds: string[];
	status: HostingStatus;
	advanced: boolean;
}

export interface PersistedHostingLocator {
	unitId: string;
	serviceType: string;
	hostId: string;
	environment: HostingEnvironment;
	projectGroupId: string | null;
	locators: Record<string, string | null>;
	updatedAt: string;
}
