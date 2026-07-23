import type { TreeseedFieldAliasBinding } from '../field-aliases.ts';
import type {
	CapacityBusinessModel,
	CapacityLaneUnit,
	CapacityReservation,
	NativeUsageObservation,
} from '../agent-capacity/contracts/financial-records.ts';
import type {
	CapacityExecutionProvider,
	CapacityExecutionProviderNativeLimit,
	CapacityExecutionProviderObservation,
	CapacityProviderMembershipView,
} from '../capacity-provider/contracts/index.ts';
import { CapacityApprovalState, PlannedTaskNode, TaskPlanProposal } from './create-project-web-deployment-request.ts';
import { ProjectEnvironmentName, RemoteJobRequestedByType, RemoteJobStatus, SdkDispatchExecutionClass, SdkDispatchNamespace, SdkDispatchPolicy, SdkDispatchTarget } from './sdk-model-names.ts';
import { SdkDispatchCapability } from './template-launch-requirements.ts';

export interface PlanningPolicy {
	maxDownstreamTasks: number;
	maxPlanningDepth: number;
	maxAdmittedPlanTasksPerCycle: number;
	planningTaskSignature: string;
}

export interface PlanningAdmissionResult {
	proposal: TaskPlanProposal;
	admitted: PlannedTaskNode[];
	deferred: PlannedTaskNode[];
	rejected: Array<{
		node: PlannedTaskNode;
		reasons: string[];
	}>;
	totalEstimatedCreditsP50: number;
	totalEstimatedCreditsP90: number;
	admittedCreditsP90: number;
	reasons: string[];
}

export interface CreditConversionProfile {
	id?: string | null;
	taskSignature: string;
	executionProfileId: string;
	executionProviderKind: string;
	nativeUnit: string;
	sampleCount: number;
	completedSampleCount: number;
	interruptedSampleCount?: number;
	nativeUnitsPerCreditP50: number | null;
	nativeUnitsPerCreditP90: number | null;
	creditsPerNativeUnitP50: number | null;
	creditsPerNativeUnitP90: number | null;
	actualCreditsP50: number | null;
	actualCreditsP90: number | null;
	confidence: 'low' | 'medium' | 'high' | string;
	formulaVersion: string;
	metadata?: Record<string, unknown>;
	createdAt?: string | null;
	updatedAt: string;
}

export interface DerivedCapacityAvailability {
	executionProviderId: string;
	capacityProviderId: string | null;
	executionProviderKind: string;
	nativeUnit: string;
	scope: string | null;
	configuredNativeLimit: number | null;
	observedNativeRemaining: number | null;
	nativeRemainingSource: 'observation' | 'configured_limit' | 'unknown';
	activeReservedNativeAmount: number;
	activeConsumedNativeAmount: number;
	reserveBufferPercent: number;
	reserveBufferNativeAmount: number;
	availableNativeAmount: number;
	nativeUnitsPerCredit: number | null;
	conversionProfileId?: string | null;
	conversionTaskSignature?: string | null;
	conversionConfidence?: string | null;
	derivedAvailableCredits: number | null;
	confidence: 'low' | 'medium' | 'high' | string;
	resetAt?: string | null;
	accountingWindowStartAt?: string | null;
	accountingWindowEndAt?: string | null;
	accountingWindowSource?: 'observation' | 'configured_reset' | 'unknown';
	reasons: string[];
	metadata?: Record<string, unknown>;
}

export interface DerivedCapacitySummary {
	entries: DerivedCapacityAvailability[];
	totalDerivedAvailableCredits?: number | null;
	derivedEntryCount?: number;
	learningEntryCount?: number;
	availableNativeByUnit?: Record<string, number>;
	providers?: Array<{
		capacityProviderId: string;
		entries?: DerivedCapacityAvailability[];
		totalDerivedAvailableCredits?: number | null;
		derivedEntryCount?: number;
		learningEntryCount?: number;
		availableNativeByUnit?: Record<string, number>;
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
}

export interface NativeReservationDebitAggregate {
	activeReservedNativeAmount: number;
	activeConsumedNativeAmount: number;
}

export interface DerivedCapacityInput {
	executionProvider: CapacityExecutionProvider;
	nativeLimit?: CapacityExecutionProviderNativeLimit | null;
	latestObservation?: CapacityExecutionProviderObservation | null;
	activeReservations?: CapacityReservation[];
	reservationDebits?: NativeReservationDebitAggregate | null;
	conversionProfile?: CreditConversionProfile | null;
	scope?: string | null;
	nativeUnit?: string | null;
	now?: Date | string | null;
}

export interface ApprovalRequest {
	id: string;
	teamId: string;
	projectId: string;
	workDayId: string | null;
	taskId: string | null;
	kind: string;
	state: CapacityApprovalState;
	severity: 'low' | 'medium' | 'high';
	requestedByType: 'agent' | 'scheduler' | 'worker' | 'service' | 'user';
	requestedById: string | null;
	title: string;
	summary: string;
	options: Record<string, unknown>[];
	recommendation: Record<string, unknown>;
	policySnapshot: Record<string, unknown>;
	expiresAt: string | null;
	decidedByType: string | null;
	decidedById: string | null;
	decidedAt: string | null;
	decision: Record<string, unknown> | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface ListApprovalRequestsRequest {
	projectId?: string | null;
	teamId?: string | null;
	state?: CapacityApprovalState | string | Array<CapacityApprovalState | string> | null;
	limit?: number;
}

export interface DecideApprovalRequestRequest {
	state: CapacityApprovalState | string;
	optionId?: string | null;
	note?: string | null;
	decision?: Record<string, unknown> | null;
	decidedByType?: string | null;
	decidedById?: string | null;
}

export interface UpsertTeamInboxItemRequest {
	id?: string;
	teamId: string;
	projectId?: string | null;
	kind: string;
	state: string;
	title: string;
	summary?: string | null;
	href?: string | null;
	itemKey?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface ProjectCapacityDiagnostics {
	projectId: string;
	teamId: string;
	environment: ProjectEnvironmentName | 'local';
	providers: CapacityProviderMembershipView[];
	executionProviders: CapacityExecutionProvider[];
	grants: import('./agent-capacity/allocation.ts').CapacityGrantV2[];
	activeReservations: CapacityReservation[];
	derivedCapacity?: DerivedCapacitySummary | null;
	remaining: {
		dailyCredits: number | null;
		monthlyCredits: number | null;
	};
}

export interface ProjectCapabilityGrant {
	id: string;
	projectId: string;
	namespace: SdkDispatchNamespace;
	operation: string;
	executionClass: SdkDispatchExecutionClass;
	allowedTargets: SdkDispatchTarget[];
	defaultDispatchMode: SdkDispatchPolicy;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface RemoteJobError {
	code?: string | null;
	message: string;
}

export interface RemoteJob {
	id: string;
	projectId: string;
	namespace: SdkDispatchNamespace;
	operation: string;
	status: RemoteJobStatus;
	preferredMode: SdkDispatchPolicy;
	selectedTarget: SdkDispatchTarget;
	input: Record<string, unknown>;
	output?: unknown;
	error?: RemoteJobError | null;
	requestedByType: RemoteJobRequestedByType;
	requestedById: string | null;
	assignedRunnerId: string | null;
	idempotencyKey: string | null;
	capability?: SdkDispatchCapability | null;
	pollUrl?: string | null;
	streamUrl?: string | null;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	cancelledAt: string | null;
}

export interface RemoteJobEvent {
	id: string;
	jobId: string;
	seq: number;
	kind: string;
	data?: Record<string, unknown>;
	createdAt: string;
}

export interface SdkDispatchRequest {
	namespace?: SdkDispatchNamespace;
	operation: string;
	input?: Record<string, unknown>;
	preferredMode?: SdkDispatchPolicy;
	idempotencyKey?: string;
}

export interface SdkDispatchInlineResult {
	ok: true;
	mode: 'inline';
	namespace: SdkDispatchNamespace;
	operation: string;
	target: SdkDispatchTarget;
	capability: SdkDispatchCapability;
	payload: unknown;
}

export interface SdkDispatchJobResult {
	ok: true;
	mode: 'job';
	namespace: SdkDispatchNamespace;
	operation: string;
	target: SdkDispatchTarget;
	capability: SdkDispatchCapability;
	job: RemoteJob;
}

export type SdkDispatchResult = SdkDispatchInlineResult | SdkDispatchJobResult;
