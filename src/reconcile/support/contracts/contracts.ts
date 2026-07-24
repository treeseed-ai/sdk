import type { DeployConfig } from '../../../platform/support/contracts.ts';

export type ReconcileProviderId = string;
export type ReconcileActionKind =
	| 'noop'
	| 'create'
	| 'update'
	| 'replace'
	| 'delete'
	| 'adopt'
	| 'rename'
	| 'reattach'
	| 'retain'
	| 'taint'
	| 'blocked';
export type ReconcileStatusKind = 'pending' | 'ready' | 'drifted' | 'error';
export type ReconcileVerificationSource = 'cli' | 'api' | 'sdk' | 'derived';
export type ReconcileUnitType =
	| 'web-ui'
	| 'api-runtime'
	| 'operations-runner-runtime'
	| 'workday-manager-runtime'
	| 'worker-runner-runtime'
	| 'edge-worker'
	| 'content-store'
	| 'queue'
	| 'database'
	| 'kv-form-guard'
	| 'turnstile-widget'
	| 'pages-project'
	| 'custom-domain:web'
	| 'custom-domain:api'
	| 'dns-record'
	| 'railway-service:api'
	| 'railway-service:operations-runner'
	| 'railway-service:workday-manager'
	| 'railway-service:worker-runner'
	| 'package-manifest'
	| 'template-manifest'
	| 'package-workflow'
	| 'package-image'
	| 'github-environment'
	| 'github-secret-binding'
	| 'github-variable-binding'
	| 'github-workflow-dispatch'
	| 'docker-image-build'
	| 'local-docker-compose'
	| 'local-treedx'
	| 'local-content-materialization'
	| 'local-seed-bootstrap'
	| 'local-process'
	| 'capacity-provider'
	| 'branch-preview'
	| 'branch-preview-cleanup'
	| 'workflow-gate'
	| 'save-gate:local-verify'
	| 'save-gate:promotion-readiness'
	| 'save-gate:hosted-verify'
	| 'release-gate:verify'
	| 'release-gate:template-verify'
	| 'release-gate:template-release-record'
	| 'release-gate:npm-publish'
	| 'release-gate:image-publish'
	| 'release-gate:hosted-reconcile'
	| 'release-gate:live-verify'
	| 'release-gate:candidate-record'
	| 'release-gate:production-record';

export type ReconcileTarget =
	| { kind: 'persistent'; scope: 'local' | 'staging' | 'prod' }
	| { kind: 'branch'; branchName: string };

export type ReconcileUnitId = string;

export interface ReconcileIdentity {
	teamId: string;
	projectId: string;
	slug: string;
	environment: string;
	deploymentKey: string;
	environmentKey: string;
}

export interface DesiredUnit {
	unitId: ReconcileUnitId;
	unitType: ReconcileUnitType;
	provider: ReconcileProviderId;
	identity: ReconcileIdentity;
	target: ReconcileTarget;
	logicalName: string;
	dependencies: ReconcileUnitId[];
	spec: Record<string, unknown>;
	secrets: Record<string, string | null | undefined>;
	metadata: Record<string, unknown>;
}

export interface ReconcileSelector {
	environment?: 'local' | 'staging' | 'prod';
	host?: string[];
	packageId?: string[];
	appId?: string[];
	serviceId?: string[];
	serviceType?: string[];
	placement?: string[];
	resourceKind?: string[];
	unitId?: string[];
	unitType?: ReconcileUnitType[];
	provider?: string[];
}

export interface ObservedUnitState {
	exists: boolean;
	status: ReconcileStatusKind;
	live: Record<string, unknown>;
	locators: Record<string, string | null>;
	warnings: string[];
}

export interface UnitDiff {
	action: ReconcileActionKind;
	reasons: string[];
	before: Record<string, unknown>;
	after: Record<string, unknown>;
}

export interface UnitPersistedState {
	unitId: ReconcileUnitId;
	unitType: ReconcileUnitType;
	provider: ReconcileProviderId;
	identity: ReconcileIdentity;
	target: ReconcileTarget;
	logicalName: string;
	desiredSpecHash: string;
	lastObservedAt: string | null;
	lastReconciledAt: string | null;
	lastVerifiedAt: string | null;
	lastStatus: ReconcileStatusKind;
	lastObservedState: Record<string, unknown>;
	lastReconciledState: Record<string, unknown>;
	lastDiff: UnitDiff | null;
	lastVerification: UnitVerificationResult | null;
	lastAction: ReconcileActionKind | null;
	resourceLocators: Record<string, string | null>;
	warnings: string[];
	error: string | null;
}

export interface UnitPostcondition {
	key: string;
	description: string;
}

export interface UnitVerificationCheck {
	key: string;
	description: string;
	source: ReconcileVerificationSource;
	exists: boolean;
	configured: boolean;
	ready: boolean;
	verified: boolean;
	expected?: unknown;
	observed?: unknown;
	issues: string[];
}

export interface UnitVerificationResult {
	unitId: ReconcileUnitId;
	supported: boolean;
	exists: boolean;
	configured: boolean;
	ready: boolean;
	verified: boolean;
	checks: UnitVerificationCheck[];
	missing: string[];
	drifted: string[];
	warnings: string[];
}

export interface ReconcilePlan {
	unit: DesiredUnit;
	observed: ObservedUnitState;
	diff: UnitDiff;
	persisted: UnitPersistedState | null;
}

export interface ReconcileResult {
	unit: DesiredUnit;
	observed: ObservedUnitState;
	diff: UnitDiff;
	action: ReconcileActionKind;
	warnings: string[];
	resourceLocators: Record<string, string | null>;
	state: Record<string, unknown>;
	verification: UnitVerificationResult | null;
}

export interface ReconcileRunContext {
	tenantRoot: string;
	target: ReconcileTarget;
	deployConfig: DeployConfig;
	launchEnv: NodeJS.ProcessEnv;
	planOnly?: boolean;
	write?: (line: string) => void;
	session: Map<string, unknown>;
}

export interface ReconcileAdapterInput {
	context: ReconcileRunContext;
	unit: DesiredUnit;
	persistedState: UnitPersistedState | null;
}

export interface ReconcileAdapter {
	providerId: ReconcileProviderId;
	unitTypes: ReconcileUnitType[];
	supports(unitType: ReconcileUnitType, providerId: ReconcileProviderId): boolean;
	validate?(input: ReconcileAdapterInput): Promise<void> | void;
	requiredPostconditions?(input: ReconcileAdapterInput): Promise<UnitPostcondition[]> | UnitPostcondition[];
	refresh(input: ReconcileAdapterInput): Promise<ObservedUnitState> | ObservedUnitState;
	diff(input: ReconcileAdapterInput & { observed: ObservedUnitState }): Promise<UnitDiff> | UnitDiff;
	apply(input: ReconcileAdapterInput & { observed: ObservedUnitState; diff: UnitDiff }): Promise<ReconcileResult> | ReconcileResult;
	verify(input: ReconcileAdapterInput & {
		observed: ObservedUnitState;
		diff: UnitDiff;
		result: ReconcileResult | null;
		postconditions: UnitPostcondition[];
	}): Promise<UnitVerificationResult> | UnitVerificationResult;
	destroy?(input: ReconcileAdapterInput & { observed: ObservedUnitState }): Promise<ReconcileResult> | ReconcileResult;
	importOrAdopt?(input: ReconcileAdapterInput & { observed: ObservedUnitState }): Promise<ReconcileResult> | ReconcileResult;
}

export interface ReconcileStateRecord {
	version: 1;
	target: ReconcileTarget;
	dependencyGraphVersion: number;
	units: Record<ReconcileUnitId, UnitPersistedState>;
}
