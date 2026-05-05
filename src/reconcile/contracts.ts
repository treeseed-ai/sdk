import type { TreeseedDeployConfig } from '../platform/contracts.ts';

export type TreeseedReconcileProviderId = string;
export type TreeseedReconcileActionKind = 'noop' | 'create' | 'update' | 'reuse' | 'drift_correct' | 'destroy';
export type TreeseedReconcileStatusKind = 'pending' | 'ready' | 'drifted' | 'error';
export type TreeseedReconcileVerificationSource = 'cli' | 'api' | 'sdk' | 'derived';
export type TreeseedReconcileUnitType =
	| 'web-ui'
	| 'api-runtime'
	| 'manager-runtime'
	| 'worker-runtime'
	| 'workday-start-runtime'
	| 'workday-report-runtime'
	| 'edge-worker'
	| 'content-store'
	| 'queue'
	| 'database'
	| 'kv-form-guard'
	| 'pages-project'
	| 'custom-domain:web'
	| 'custom-domain:api'
	| 'dns-record'
	| 'railway-service:api'
	| 'railway-service:manager'
	| 'railway-service:worker'
	| 'railway-service:workday-start'
	| 'railway-service:workday-report';

export type TreeseedReconcileTarget =
	| { kind: 'persistent'; scope: 'local' | 'staging' | 'prod' }
	| { kind: 'branch'; branchName: string };

export type TreeseedReconcileUnitId = string;

export interface TreeseedReconcileIdentity {
	teamId: string;
	projectId: string;
	slug: string;
	environment: string;
	deploymentKey: string;
	environmentKey: string;
}

export interface TreeseedDesiredUnit {
	unitId: TreeseedReconcileUnitId;
	unitType: TreeseedReconcileUnitType;
	provider: TreeseedReconcileProviderId;
	identity: TreeseedReconcileIdentity;
	target: TreeseedReconcileTarget;
	logicalName: string;
	dependencies: TreeseedReconcileUnitId[];
	spec: Record<string, unknown>;
	secrets: Record<string, string | null | undefined>;
	metadata: Record<string, unknown>;
}

export interface TreeseedObservedUnitState {
	exists: boolean;
	status: TreeseedReconcileStatusKind;
	live: Record<string, unknown>;
	locators: Record<string, string | null>;
	warnings: string[];
}

export interface TreeseedUnitDiff {
	action: TreeseedReconcileActionKind;
	reasons: string[];
	before: Record<string, unknown>;
	after: Record<string, unknown>;
}

export interface TreeseedUnitPersistedState {
	unitId: TreeseedReconcileUnitId;
	unitType: TreeseedReconcileUnitType;
	provider: TreeseedReconcileProviderId;
	identity: TreeseedReconcileIdentity;
	target: TreeseedReconcileTarget;
	logicalName: string;
	desiredSpecHash: string;
	lastObservedAt: string | null;
	lastReconciledAt: string | null;
	lastVerifiedAt: string | null;
	lastStatus: TreeseedReconcileStatusKind;
	lastObservedState: Record<string, unknown>;
	lastReconciledState: Record<string, unknown>;
	lastDiff: TreeseedUnitDiff | null;
	lastVerification: TreeseedUnitVerificationResult | null;
	lastAction: TreeseedReconcileActionKind | null;
	resourceLocators: Record<string, string | null>;
	warnings: string[];
	error: string | null;
}

export interface TreeseedUnitPostcondition {
	key: string;
	description: string;
}

export interface TreeseedUnitVerificationCheck {
	key: string;
	description: string;
	source: TreeseedReconcileVerificationSource;
	exists: boolean;
	configured: boolean;
	ready: boolean;
	verified: boolean;
	expected?: unknown;
	observed?: unknown;
	issues: string[];
}

export interface TreeseedUnitVerificationResult {
	unitId: TreeseedReconcileUnitId;
	supported: boolean;
	exists: boolean;
	configured: boolean;
	ready: boolean;
	verified: boolean;
	checks: TreeseedUnitVerificationCheck[];
	missing: string[];
	drifted: string[];
	warnings: string[];
}

export interface TreeseedReconcilePlan {
	unit: TreeseedDesiredUnit;
	observed: TreeseedObservedUnitState;
	diff: TreeseedUnitDiff;
	persisted: TreeseedUnitPersistedState | null;
}

export interface TreeseedReconcileResult {
	unit: TreeseedDesiredUnit;
	observed: TreeseedObservedUnitState;
	diff: TreeseedUnitDiff;
	action: TreeseedReconcileActionKind;
	warnings: string[];
	resourceLocators: Record<string, string | null>;
	state: Record<string, unknown>;
	verification: TreeseedUnitVerificationResult | null;
}

export interface TreeseedReconcileRunContext {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	deployConfig: TreeseedDeployConfig;
	launchEnv: NodeJS.ProcessEnv;
	write?: (line: string) => void;
	session: Map<string, unknown>;
}

export interface TreeseedReconcileAdapterInput {
	context: TreeseedReconcileRunContext;
	unit: TreeseedDesiredUnit;
	persistedState: TreeseedUnitPersistedState | null;
}

export interface TreeseedReconcileAdapter {
	providerId: TreeseedReconcileProviderId;
	unitTypes: TreeseedReconcileUnitType[];
	supports(unitType: TreeseedReconcileUnitType, providerId: TreeseedReconcileProviderId): boolean;
	validate?(input: TreeseedReconcileAdapterInput): Promise<void> | void;
	requiredPostconditions?(input: TreeseedReconcileAdapterInput): Promise<TreeseedUnitPostcondition[]> | TreeseedUnitPostcondition[];
	observe(input: TreeseedReconcileAdapterInput): Promise<TreeseedObservedUnitState> | TreeseedObservedUnitState;
	plan(input: TreeseedReconcileAdapterInput & { observed: TreeseedObservedUnitState }): Promise<TreeseedUnitDiff> | TreeseedUnitDiff;
	reconcile(input: TreeseedReconcileAdapterInput & { observed: TreeseedObservedUnitState; diff: TreeseedUnitDiff }): Promise<TreeseedReconcileResult> | TreeseedReconcileResult;
	verify(input: TreeseedReconcileAdapterInput & {
		observed: TreeseedObservedUnitState;
		diff: TreeseedUnitDiff;
		result: TreeseedReconcileResult | null;
		postconditions: TreeseedUnitPostcondition[];
	}): Promise<TreeseedUnitVerificationResult> | TreeseedUnitVerificationResult;
	destroy?(input: TreeseedReconcileAdapterInput & { observed: TreeseedObservedUnitState }): Promise<TreeseedReconcileResult> | TreeseedReconcileResult;
}

export interface TreeseedReconcileStateRecord {
	version: 1;
	target: TreeseedReconcileTarget;
	dependencyGraphVersion: number;
	units: Record<TreeseedReconcileUnitId, TreeseedUnitPersistedState>;
}
